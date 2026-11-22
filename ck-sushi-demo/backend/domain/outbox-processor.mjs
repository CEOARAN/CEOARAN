/**
 * Future commerce task dispatch: explicitly opt-in, finite batches, leased
 * at-least-once processing. Handlers MUST be idempotent by provider reference.
 * No production work runs while the CK Sushi staging feature flags are false.
 */
import {claimOutboxTask,finishOutboxTask,failOutboxTask,recoverExpiredOutboxLeases} from "./outbox.mjs";

export class OutboxProcessorError extends Error{
 constructor(code){super(code);this.name="OutboxProcessorError";this.code=code}
}
const KINDS=new Set(["payment_reconcile","delivery_request","delivery_status","notification"]);
const HASH=/^[a-f0-9]{64}$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
async function requireCommerceOps(db,releaseApproved,needsTracking=false){
 if(releaseApproved!==true)throw new OutboxProcessorError("COMMERCE_RELEASE_NOT_APPROVED");
 if(!db||typeof db.prepare!=="function")throw new OutboxProcessorError("DATABASE_REQUIRED");
 const rows=await db.prepare("SELECT key,value FROM operational_settings WHERE key IN ('orders_enabled','payments_enabled','customer_data_enabled','tracking_enabled')").all();
 const flags=new Map((rows?.results||[]).map(row=>[row.key,row.value]));
 const keys=["orders_enabled","payments_enabled","customer_data_enabled"];
 if(needsTracking)keys.push("tracking_enabled");
 if(keys.some(key=>flags.get(key)!=="true"))throw new OutboxProcessorError("DATABASE_COMMERCE_GATES_DISABLED");
}
export async function enqueueOutboxJob(db,{
 kind,dedupeHash,payloadEncrypted=null,nextAttemptAt=new Date().toISOString(),releaseApproved=false,
 idFactory=()=>crypto.randomUUID()
}={}){
 if(!KINDS.has(kind)||typeof dedupeHash!=="string"||!HASH.test(dedupeHash)||
    (payloadEncrypted!==null&&(typeof payloadEncrypted!=="string"||
     payloadEncrypted.length>8000||!payloadEncrypted.startsWith("CKOB1.")))||
    typeof nextAttemptAt!=="string"||!ISO.test(nextAttemptAt))
  throw new OutboxProcessorError("INVALID_OUTBOX_JOB");
 await requireCommerceOps(db,releaseApproved,kind.startsWith("delivery_"));
 const id=idFactory();
 if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{8,120}$/.test(id))
  throw new OutboxProcessorError("INVALID_OUTBOX_ID");
 const result=await db.prepare("INSERT OR IGNORE INTO delivery_outbox (id,kind,dedupe_key,payload_encrypted,state,attempts,next_attempt_at) VALUES(?,?,?,?,'pending',0,?)").bind(id,kind,dedupeHash,payloadEncrypted,nextAttemptAt).run();
 const record=await db.prepare("SELECT id,kind FROM delivery_outbox WHERE dedupe_key=?").bind(dedupeHash).first();
 if(!record||record.kind!==kind)
  throw new OutboxProcessorError("OUTBOX_DEDUPE_INTEGRITY");
 return {queued:result?.meta?.changes===1,replay:result?.meta?.changes===0,taskId:record.id};
}
export async function processOutboxBatch(db,{
 handlers,releaseApproved=false,maxTasks=5,now=()=>new Date()
}={}){
 // A handler is injected by a *separately approved* production service.
 // Never call external payment, courier or notification APIs by default.
 if(!handlers||typeof handlers!=="object"||Array.isArray(handlers)||
    !Number.isInteger(maxTasks)||maxTasks<1||maxTasks>20||typeof now!=="function")
  throw new OutboxProcessorError("INVALID_PROCESSOR_CONFIG");
 await requireCommerceOps(db,releaseApproved,false);
 const summary={claimed:0,completed:0,retried:0,exhausted:0,stale:0};
 await recoverExpiredOutboxLeases(db,{now:now(),limit:100});
 for(let count=0;count<maxTasks;count++){
  const task=await claimOutboxTask(db,{now:now(),leaseSeconds:180});
  if(!task)break;
  summary.claimed++;
  try{
   const handler=Object.hasOwn(handlers,task.kind)?handlers[task.kind]:null;
   if(typeof handler!=="function")throw new OutboxProcessorError("NO_JOB_HANDLER");
   await handler(Object.freeze({
     taskId:task.id,kind:task.kind,attempt:task.attempts,
     payloadEncrypted:task.payload_encrypted
   }));
   await finishOutboxTask(db,{taskId:task.id,leaseToken:task.lease_token,now:now()});
   summary.completed++;
  }catch(error){
   const code=typeof error?.code==="string"&&/^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)?
    error.code:"JOB_PROCESSING_FAILED";
   try{
    const res=await failOutboxTask(db,{
     taskId:task.id,leaseToken:task.lease_token,attempt:task.attempts,errorCode:code,now:now()
    });
    if(res.state==="failed")summary.exhausted++;
    else summary.retried++;
   }catch{
    // A lease may have expired and moved to another worker.
    // Never acknowledge work we no longer own. No task payload in logs.
    summary.stale++;
   }
  }
 }
 return summary;
}
