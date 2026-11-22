import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import {enqueueOutboxJob,processOutboxBatch} from "../domain/outbox-processor.mjs";
let DatabaseSync;try{({DatabaseSync}=await import("node:sqlite"))}catch{}
if(!globalThis.crypto)globalThis.crypto=webcrypto;

async function fixture({releaseFlags=false}={}){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_init.sql","0002_commerce.sql","0003_staging_guards.sql",
  "0004_financial_integrity.sql","0005_financial_snapshots.sql",
  "0006_staging_feature_gates.sql","0007_payment_order_reconciliation.sql"]){
  sqlite.exec(await readFile(new URL("../migrations/"+name,import.meta.url),"utf8"));
 }
 if(releaseFlags){
  // Isolated test-only simulation, never remote staging.
  sqlite.exec("DROP TRIGGER staging_block_outbox_insert; DROP TRIGGER staging_block_operational_insert; DROP TRIGGER staging_block_operational_update; DROP TRIGGER staging_block_operational_delete;");
  for(const key of ["orders_enabled","payments_enabled","customer_data_enabled"])
   sqlite.prepare("UPDATE operational_settings SET value='true' WHERE key=?").run(key);
 }
 const db={prepare(sql){return{
  bind(...params){const stmt=sqlite.prepare(sql);return{
   first:async()=>stmt.get(...params)??null,
   all:async()=>({results:stmt.all(...params)}),
   run:async()=>({meta:{changes:stmt.run(...params).changes}})
  }},
  first:async()=>sqlite.prepare(sql).get()??null,
  all:async()=>({results:sqlite.prepare(sql).all()})
 }}};
 return {sqlite,db,close:()=>sqlite.close()};
}
const fakeNow=()=>new Date("2026-11-22T10:00:00.000Z");
const taskProps={kind:"payment_reconcile",dedupeHash:"f".repeat(64),
 nextAttemptAt:fakeNow().toISOString(),idFactory:()=>"CKJOB000001",releaseApproved:true};
test("outbox cannot write or claim tasks without explicit commercial release",{
 skip:!DatabaseSync&&"Requires Node 22+ SQLite"
},async()=>{
 const f=await fixture();
 try{
  await assert.rejects(enqueueOutboxJob(f.db,{...taskProps,releaseApproved:false}),
   e=>e.code==="COMMERCE_RELEASE_NOT_APPROVED");
  await assert.rejects(enqueueOutboxJob(f.db,taskProps),
   e=>e.code==="DATABASE_COMMERCE_GATES_DISABLED");
  await assert.rejects(processOutboxBatch(f.db,{handlers:{payment_reconcile:()=>{}},releaseApproved:false,now:fakeNow}),
   e=>e.code==="COMMERCE_RELEASE_NOT_APPROVED");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM delivery_outbox").get().n,0);
 }finally{f.close()}
});
test("outbox adds one task, replays idempotently and dispatches at most once",{
 skip:!DatabaseSync&&"Requires Node 22+ SQLite"
},async()=>{
 const f=await fixture({releaseFlags:true});
 try{
  const first=await enqueueOutboxJob(f.db,taskProps);
  const same=await enqueueOutboxJob(f.db,{...taskProps,idFactory:()=>"CKJOB000002"});
  assert.equal(first.queued,true);
  assert.equal(same.replay,true);
  assert.equal(same.taskId,first.taskId);
  let calls=0;
  const a=await processOutboxBatch(f.db,{
   handlers:{payment_reconcile:async task=>{
    calls++;assert.equal(task.taskId,first.taskId);
    assert.equal(task.payloadEncrypted,null);
   }},releaseApproved:true,now:fakeNow
  });
  assert.deepEqual(a,{claimed:1,completed:1,retried:0,exhausted:0,stale:0});
  assert.equal(calls,1);
  const b=await processOutboxBatch(f.db,{
   handlers:{payment_reconcile:()=>{throw Error("Unexpected call")}},
   releaseApproved:true,now:fakeNow
  });
  assert.equal(b.claimed,0);
  assert.equal(f.sqlite.prepare("SELECT state FROM delivery_outbox").get().state,"done");
 }finally{f.close()}
});
test("failed handler receives bounded retry and sanitized error code",{
 skip:!DatabaseSync&&"Requires Node 22+ SQLite"
},async()=>{
 const f=await fixture({releaseFlags:true});
 try{
  await enqueueOutboxJob(f.db,taskProps);
  const outcome=await processOutboxBatch(f.db,{
   handlers:{payment_reconcile:()=>{const e=new Error("Sensitive PII must not be stored");e.code="PROVIDER_UNAVAILABLE";throw e}},
   releaseApproved:true,now:fakeNow
  });
  assert.equal(outcome.claimed,1);
  assert.equal(outcome.retried,1);
  const job=f.sqlite.prepare("SELECT state,attempts,next_attempt_at,last_error_code FROM delivery_outbox").get();
  assert.equal(job.state,"pending");assert.equal(job.attempts,1);
  assert.equal(job.last_error_code,"PROVIDER_UNAVAILABLE");
  assert.equal(job.next_attempt_at,"2026-11-22T10:00:30.000Z");
  assert(!JSON.stringify(job).includes("Sensitive PII"));
 }finally{f.close()}
});
test("delivery tasks require tracking enabled even if payments are enabled",{
 skip:!DatabaseSync&&"Requires Node 22+ SQLite"
},async()=>{
 const f=await fixture({releaseFlags:true});
 try{
  await assert.rejects(enqueueOutboxJob(f.db,{...taskProps,kind:"delivery_request"}),
   e=>e.code==="DATABASE_COMMERCE_GATES_DISABLED");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM delivery_outbox").get().n,0);
 }finally{f.close()}
});
