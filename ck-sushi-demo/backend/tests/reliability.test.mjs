import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {retryDelaySeconds,claimOutboxTask,finishOutboxTask,failOutboxTask} from "../domain/outbox.mjs";
import {persistPreparedOrder,transitionPersistedOrder} from "../domain/order-repository.mjs";
import {validateTransition} from "../domain/order-machine.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const orderId="CK-TEST-ORDER-001";
const hash="a".repeat(64),fingerprint="b".repeat(64);
const quote={currency:"BRL",fulfillment:"pickup",subtotal_cents:1200,discount_cents:0,delivery_fee_cents:0,total_cents:1200,items:[{product_id:"CK-123",name:"Item de teste",quantity:2,unit_price_cents:600,line_total_cents:1200}]};
const dbStub=(settings=[],order=null)=>({calls:[],prepare(sql){this.calls.push(sql);return{bind:(...params)=>({first:async()=>sql.includes("FROM commerce_orders")?order:null,all:async()=>({results:settings}),run:async()=>({meta:{changes:1}})}),all:async()=>({results:settings})}},batch:async statements=>statements.map(()=>({meta:{changes:1}}))});
const assertCode=async(promise,code)=>assert.rejects(promise,e=>e.code===code);
test("staging release gate rejects commerce without touching DB",async()=>{
 const db=dbStub();await assertCode(persistPreparedOrder(db,{orderId,idempotencyHash:hash,requestFingerprint:fingerprint,quote}),"COMMERCE_RELEASE_NOT_APPROVED");
 assert.equal(db.calls.length,0);
});
test("even explicit release does not override disabled database settings",async()=>{
 const db=dbStub([{key:"orders_enabled",value:"false"},{key:"payments_enabled",value:"false"},{key:"customer_data_enabled",value:"false"}]);
 await assertCode(persistPreparedOrder(db,{orderId,idempotencyHash:hash,requestFingerprint:fingerprint,quote,releaseApproved:true}),"DATABASE_COMMERCE_GATES_DISABLED");
});
test("order creation is one atomic D1 batch after permitted release and valid quote",async()=>{
 const db=dbStub(["orders_enabled","payments_enabled","customer_data_enabled"].map(key=>({key,value:"true"})));
 let count=0;db.batch=async statements=>{count++;assert.equal(statements.length,3);return statements.map(()=>({meta:{changes:1}}))};
 const out=await persistPreparedOrder(db,{orderId,idempotencyHash:hash,requestFingerprint:fingerprint,quote,releaseApproved:true});
 assert.equal(out.replay,false);assert.equal(count,1);
});
test("idempotency returns same order only for identical request fingerprint",async()=>{
 const settings=["orders_enabled","payments_enabled","customer_data_enabled"].map(key=>({key,value:"true"}));
 const db=dbStub(settings,{id:"CK-PREVIOUS",request_fingerprint:fingerprint});db.batch=async()=>{throw Error("Must not call batch")};
 const result=await persistPreparedOrder(db,{orderId,idempotencyHash:hash,requestFingerprint:fingerprint,quote,releaseApproved:true});
 assert.deepEqual(result,{orderId:"CK-PREVIOUS",replay:true});
 await assertCode(persistPreparedOrder(db,{orderId,idempotencyHash:hash,requestFingerprint:"c".repeat(64),quote,releaseApproved:true}),"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
});
test("invalid quote total is rejected before any D1 batch",async()=>{
 const db=dbStub(["orders_enabled","payments_enabled","customer_data_enabled"].map(key=>({key,value:"true"})));
 db.batch=async()=>{throw Error("Must not batch invalid quote")};
 await assertCode(persistPreparedOrder(db,{orderId,idempotencyHash:hash,requestFingerprint:fingerprint,quote:{...quote,total_cents:100},releaseApproved:true}),"QUOTE_MISMATCH");
});
test("retries use bounded backoff, cannot exceed eight attempts",()=>{
 assert.equal(retryDelaySeconds(1),30);assert.equal(retryDelaySeconds(2),60);assert.equal(retryDelaySeconds(8),3600);
 assert.throws(()=>retryDelaySeconds(9),e=>e.code==="INVALID_ATTEMPT");
});
test("outbox claims exactly one lease and prevents stale acknowledgements",async()=>{
 const now=new Date("2026-11-21T17:00:00Z"),db={prepare(sql){return{bind:(...args)=>({first:async()=>({id:"TASK_1",kind:"notification",attempts:1,lease_token:args[0],lease_expires_at:args[1],payload_encrypted:null}),run:async()=>({meta:{changes:0}})})}}};
 const claimed=await claimOutboxTask(db,{now});assert.equal(claimed.kind,"notification");
 await assertCode(finishOutboxTask(db,{taskId:claimed.id,leaseToken:claimed.lease_token,now}),"STALE_LEASE");
});
test("outbox final failure stops after eight attempts",async()=>{
 const now=new Date("2026-11-21T17:00:00Z"),token="d1d2d3d4-1111-4444-8888-123456789012";
 const db={prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})};
 const final=await failOutboxTask(db,{taskId:"TASK1",leaseToken:token,attempt:8,errorCode:"UPSTREAM_TIMEOUT",now});
 assert.equal(final.state,"failed");assert.equal(final.retryAt,null);
});
test("transition requires verified processor evidence",async()=>{
 const db=dbStub(["orders_enabled","payments_enabled","customer_data_enabled"].map(key=>({key,value:"true"})),{id:orderId,status:"pending_payment",payment_status:"pending",fulfillment:"delivery",version:1});
 await assertCode(transitionPersistedOrder(db,{orderId,to:"paid",actor:"payment_provider",expectedVersion:1,releaseApproved:true}),"PAYMENT_PROVIDER_EVIDENCE_REQUIRED");
});

test("successful verified payment transition writes status and event atomically",async()=>{
 const settings=["orders_enabled","payments_enabled","customer_data_enabled"].map(key=>({key,value:"true"}));
 const db=dbStub(settings,{id:orderId,status:"pending_payment",payment_status:"pending",fulfillment:"delivery",version:1});
 let transactions=0;
 db.batch=async statements=>{transactions++;assert.equal(statements.length,2);return [{meta:{changes:1}},{meta:{changes:1}}]};
 const result=await transitionPersistedOrder(db,{orderId,to:"paid",actor:"payment_provider",expectedVersion:1,
  providerEvidence:{verified:true,reconciled:true},releaseApproved:true});
 assert.deepEqual(result,{orderId,status:"paid",version:2});
 assert.equal(transactions,1);
});
test("invalid workflow transition never starts a database mutation",async()=>{
 const settings=["orders_enabled","payments_enabled","customer_data_enabled"].map(key=>({key,value:"true"}));
 const db=dbStub(settings,{id:orderId,status:"pending_payment",payment_status:"pending",fulfillment:"delivery",version:1});
 db.batch=async()=>{throw Error("Unsafe database mutation")};
 await assertCode(transitionPersistedOrder(db,{orderId,to:"accepted",actor:"store",expectedVersion:1,releaseApproved:true}),"ILLEGAL_ORDER_TRANSITION");
 await assertCode(transitionPersistedOrder(db,{orderId,to:"paid",actor:"store",expectedVersion:1,releaseApproved:true}),"PAYMENT_NOT_CONFIRMED");
});
test("optimistic version conflicts are not acknowledged as completed transitions",async()=>{
 const settings=["orders_enabled","payments_enabled","customer_data_enabled"].map(key=>({key,value:"true"}));
 const db=dbStub(settings,{id:orderId,status:"pending_payment",payment_status:"pending",fulfillment:"delivery",version:1});
 db.batch=async()=>[{meta:{changes:0}},{meta:{changes:0}}];
 await assertCode(transitionPersistedOrder(db,{orderId,to:"paid",actor:"payment_provider",expectedVersion:1,
  providerEvidence:{verified:true,reconciled:true},releaseApproved:true}),"TRANSITION_CONFLICT");
});
