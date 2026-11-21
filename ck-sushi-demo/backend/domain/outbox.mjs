/** Transactional outbox. This module is not invoked by any live endpoint.
 * Required for future at-least-once delivery from payment/fulfillment processors.
 * D1 UPDATE ... RETURNING atomically claims one lease; acknowledgements require token match.
 */
export class OutboxError extends Error {constructor(code){super(code);this.name="OutboxError";this.code=code;}}
const TASK_KINDS=new Set(["payment_reconcile","delivery_request","delivery_status","notification"]);
export const OUTBOX_MAX_ATTEMPTS=8;
const ISO=date=>{if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new OutboxError("INVALID_CLOCK");return date.toISOString()};
function validToken(token){return typeof token==="string"&&/^[0-9a-f-]{36}$/i.test(token)}
export function retryDelaySeconds(attempt){
 if(!Number.isInteger(attempt)||attempt<1||attempt>OUTBOX_MAX_ATTEMPTS)throw new OutboxError("INVALID_ATTEMPT");
 return Math.min(3600,30*(2**(attempt-1)));
}
export async function claimOutboxTask(db,{now=new Date(),leaseSeconds=120}={}){
 if(!db||typeof db.prepare!=="function")throw new OutboxError("DATABASE_REQUIRED");
 if(!Number.isInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>900)throw new OutboxError("INVALID_LEASE");
 const stamp=ISO(now),expiry=ISO(new Date(now.getTime()+leaseSeconds*1000)),token=crypto.randomUUID();
 const query=String.raw`UPDATE delivery_outbox
  SET state='processing',lease_token=?,lease_expires_at=?,attempts=attempts+1
  WHERE id=(
    SELECT id FROM delivery_outbox
    WHERE attempts < ? AND
      ((state='pending' AND next_attempt_at<=?) OR
       (state='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?))
    ORDER BY next_attempt_at,id LIMIT 1
  )
  RETURNING id,kind,attempts,lease_token,lease_expires_at,payload_encrypted`;
 const row=await db.prepare(query).bind(token,expiry,OUTBOX_MAX_ATTEMPTS,stamp,stamp).first();
 if(!row)return null;
 if(!TASK_KINDS.has(row.kind)||row.lease_token!==token)throw new OutboxError("OUTBOX_INTEGRITY");
 return row;
}
export async function finishOutboxTask(db,{taskId,leaseToken,now=new Date()}){
 if(!validToken(leaseToken)||typeof taskId!=="string"||taskId.length>120)throw new OutboxError("INVALID_LEASE_TOKEN");
 const result=await db.prepare(String.raw`UPDATE delivery_outbox SET state='done',processed_at=?,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL
 WHERE id=? AND state='processing' AND lease_token=? AND lease_expires_at>?`).bind(ISO(now),taskId,leaseToken,ISO(now)).run();
 if(result.meta?.changes!==1)throw new OutboxError("STALE_LEASE");
 return true;
}
export async function failOutboxTask(db,{taskId,leaseToken,attempt,errorCode,now=new Date()}){
 if(typeof taskId!=="string"||taskId.length>120||!validToken(leaseToken)||!Number.isInteger(attempt)||attempt<1||attempt>OUTBOX_MAX_ATTEMPTS||typeof errorCode!=="string"||!/^[A-Z][A-Z0-9_]{2,63}$/.test(errorCode))throw new OutboxError("INVALID_RETRY");
 const final=attempt>=OUTBOX_MAX_ATTEMPTS;
 const at=ISO(new Date(now.getTime()+retryDelaySeconds(attempt)*1000));
 const result=await db.prepare(String.raw`UPDATE delivery_outbox SET state=?,next_attempt_at=?,last_error_code=?,lease_token=NULL,lease_expires_at=NULL
 WHERE id=? AND state='processing' AND lease_token=? AND lease_expires_at>? AND attempts=?`).bind(final?"failed":"pending",at,errorCode,taskId,leaseToken,ISO(now),attempt).run();
 if(result.meta?.changes!==1)throw new OutboxError("STALE_LEASE");
 return {state:final?"failed":"pending",retryAt:final?null:at};
}
