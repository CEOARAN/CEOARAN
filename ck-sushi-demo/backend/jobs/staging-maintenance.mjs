/** CK Sushi staging daily maintenance — no payment processing, no external network. */
export class MaintenanceError extends Error {constructor(code){super(code);this.name='MaintenanceError';this.code=code}}
export async function runStagingMaintenance(db,atMs=Date.now()){
 if(!db||typeof db.prepare!=='function'||!Number.isSafeInteger(atMs)||atMs<0)throw new MaintenanceError('INVALID_MAINTENANCE_CONTEXT');
 const counts=await db.prepare('SELECT (SELECT COUNT(*) FROM commerce_orders) AS orders,(SELECT COUNT(*) FROM commerce_payments) AS payments,(SELECT COUNT(*) FROM delivery_outbox) AS tasks').first();
 if(!counts||counts.orders!==0||counts.payments!==0||counts.tasks!==0)throw new MaintenanceError('STAGING_COMMERCE_DATA_FOUND');
 const now=new Date(atMs).toISOString();
 const removed=await db.prepare('DELETE FROM commerce_webhook_replay_guard WHERE expires_at<=?').bind(now).run();
 const deleted=removed.meta?.changes??0;
 if(!Number.isSafeInteger(deleted)||deleted<0)throw new MaintenanceError('INVALID_DELETION_COUNT');
 await db.prepare(String.raw`INSERT INTO maintenance_runs(job_key,checked_at,outcome,summary)
 VALUES('mercadopago-test-fingerprint-retention',?,'success',?)
 ON CONFLICT(job_key) DO UPDATE SET checked_at=excluded.checked_at,outcome=excluded.outcome,summary=excluded.summary`)
 .bind(now,'expired_webhook_hashes_removed='+deleted).run();
 return {ok:true,expiredRemoved:deleted,checkedAt:now};
}
