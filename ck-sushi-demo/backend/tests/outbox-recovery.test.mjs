import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
let DatabaseSync;
try{({DatabaseSync}=await import("node:sqlite"))}catch{}
import {claimOutboxTask,finishOutboxTask,failOutboxTask,recoverExpiredOutboxLeases,OUTBOX_MAX_ATTEMPTS} from "../domain/outbox.mjs";

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const now=new Date("2026-11-22T12:00:00.000Z");
const old="2026-11-22T11:00:00.000Z",later="2026-11-22T13:00:00.000Z";
const token="afcc0a84-246e-4b1d-a372-733be573b3d2";

function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec(`CREATE TABLE delivery_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  next_attempt_at TEXT NOT NULL,
  processed_at TEXT,
  payload_encrypted TEXT
 )`);
 const d1={
  prepare(sql){return{
   bind(...args){const stmt=sqlite.prepare(sql);return{
    first:async()=>stmt.get(...args)??null,
    all:async()=>({results:stmt.all(...args)}),
    run:async()=>({meta:{changes:stmt.run(...args).changes}})
   }}
  }}
 };
 const insert=(id,state,attempts,expires,nextAttempt=old)=>{
  sqlite.prepare(`INSERT INTO delivery_outbox
   (id,kind,state,attempts,lease_token,lease_expires_at,last_error_code,next_attempt_at)
   VALUES(?,'notification',?,?,?,?,NULL,?)`)
   .run(id,state,attempts,state==="processing"?token:null,expires,nextAttempt)
 };
 return {sqlite,d1,insert,close:()=>sqlite.close()};
}

test("expired final-attempt tasks become failed, leaving live and reclaimable leases untouched",{skip:!DatabaseSync&&"Node 22+ SQLite required"},async()=>{
 const db=fixture();
 try{
  db.insert("dead-8","processing",8,old);
  db.insert("live-8","processing",8,later);
  db.insert("expired-7","processing",7,old);
  db.insert("pending-8","pending",8,null);
  const result=await recoverExpiredOutboxLeases(db.d1,{now});
  assert.equal(result.recovered,1);
  assert.equal(result.at,now.toISOString());
  const rows=db.sqlite.prepare("SELECT id,state,attempts,lease_token,lease_expires_at,last_error_code FROM delivery_outbox ORDER BY id").all();
  const byId=Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(byId["dead-8"].state,"failed");
  assert.equal(byId["dead-8"].last_error_code,"OUTBOX_LEASE_EXHAUSTED");
  assert.equal(byId["dead-8"].lease_token,null);
  assert.equal(byId["dead-8"].lease_expires_at,null);
  assert.equal(byId["live-8"].state,"processing");
  assert.equal(byId["expired-7"].state,"processing");
  assert.equal(byId["pending-8"].state,"pending");
  assert.equal((await recoverExpiredOutboxLeases(db.d1,{now})).recovered,0);
  const claimed=await claimOutboxTask(db.d1,{now});
  assert.equal(claimed.id,"expired-7");
  assert.equal(claimed.attempts,OUTBOX_MAX_ATTEMPTS);
  assert.notEqual(claimed.lease_token,token);
  assert.equal(await finishOutboxTask(db.d1,{taskId:claimed.id,leaseToken:claimed.lease_token,now}),true);
  assert.equal(db.sqlite.prepare("SELECT state FROM delivery_outbox WHERE id='expired-7'").get().state,"done");
 }finally{db.close()}
});

test("recovery honors a strict batch limit, retries and rejects malformed limits",{skip:!DatabaseSync&&"Node 22+ SQLite required"},async()=>{
 const db=fixture();
 try{
  db.insert("dead-a","processing",8,old);
  db.insert("dead-b","processing",9,old);
  db.insert("dead-c","processing",10,old);
  const first=await recoverExpiredOutboxLeases(db.d1,{now,limit:2});
  assert.equal(first.recovered,2);
  assert.equal((await recoverExpiredOutboxLeases(db.d1,{now,limit:2})).recovered,1);
  assert.equal((await recoverExpiredOutboxLeases(db.d1,{now,limit:2})).recovered,0);
  await assert.rejects(recoverExpiredOutboxLeases(db.d1,{now,limit:0}),e=>e.code==="INVALID_RECOVERY_LIMIT");
  await assert.rejects(recoverExpiredOutboxLeases(db.d1,{now,limit:501}),e=>e.code==="INVALID_RECOVERY_LIMIT");
  await assert.rejects(recoverExpiredOutboxLeases(db.d1,{now:new Date(NaN)}),e=>e.code==="INVALID_CLOCK");
 }finally{db.close()}
});

test("acknowledgement and final failure require the current, unexpired lease token",{skip:!DatabaseSync&&"Node 22+ SQLite required"},async()=>{
 const db=fixture();
 try{
  db.insert("recoverable","processing",7,old);
  const task=await claimOutboxTask(db.d1,{now});
  await assert.rejects(finishOutboxTask(db.d1,{taskId:task.id,leaseToken:token,now}),e=>e.code==="STALE_LEASE");
  const done=await failOutboxTask(db.d1,{taskId:task.id,leaseToken:task.lease_token,attempt:8,errorCode:"UPSTREAM_TIMEOUT",now});
  assert.equal(done.state,"failed");
  assert.equal(done.retryAt,null);
  assert.equal(db.sqlite.prepare("SELECT state,lease_token FROM delivery_outbox WHERE id=?").get(task.id).state,"failed");
  await assert.rejects(finishOutboxTask(db.d1,{taskId:task.id,leaseToken:task.lease_token,now}),e=>e.code==="STALE_LEASE");
 }finally{db.close()}
});
