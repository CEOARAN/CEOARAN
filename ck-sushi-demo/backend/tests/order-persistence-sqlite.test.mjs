import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
let DatabaseSync;
try{({DatabaseSync}=await import("node:sqlite"))}catch{}
import {persistPreparedOrder,transitionPersistedOrder} from "../domain/order-repository.mjs";

// No Cloudflare credentials or network: every transaction runs in isolated RAM.
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const orderId="CK-INMEMORY-ORDER-001";
const idempotencyHash="a".repeat(64),requestFingerprint="b".repeat(64);
const productId="CK-TEST-PERSIST";
const quote={currency:"BRL",fulfillment:"pickup",subtotal_cents:1800,
 discount_cents:0,delivery_fee_cents:0,total_cents:1800,items:[
  {product_id:productId,name:"Sushi de teste",quantity:3,unit_price_cents:600,line_total_cents:1800}
 ]};
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_init.sql","0002_commerce.sql","0003_staging_guards.sql","0004_financial_integrity.sql","0005_financial_snapshots.sql","0006_staging_feature_gates.sql","0007_payment_order_reconciliation.sql"]){
  sqlite.exec(await readFile(new URL("../migrations/"+name,import.meta.url),"utf8"));
 }
 sqlite.prepare("INSERT INTO products(id,name,category,price_cents,image_url) VALUES(?,?,?,?,?)")
  .run(productId,"Sushi de teste","Combinados",600,"https://example.test/sushi");
 // Only THIS in-memory fixture models future approved commerce.
 // The actual Cloudflare D1 retains this trigger and flags set to false.
 // Explicitly model a separate production database only inside this in-memory fixture.
 sqlite.exec("DROP TRIGGER staging_block_order_insert; DROP TRIGGER staging_block_operational_insert; DROP TRIGGER staging_block_operational_update; DROP TRIGGER staging_block_operational_delete;");
 for(const key of ["orders_enabled","payments_enabled","customer_data_enabled"])
  sqlite.prepare("UPDATE operational_settings SET value='true' WHERE key=?").run(key);
 const d1={
  prepare(sql){return{
   bind(...args){const stmt=sqlite.prepare(sql);return{
    first:async()=>stmt.get(...args)??null,
    all:async()=>({results:stmt.all(...args)}),
    run:async()=>({meta:{changes:stmt.run(...args).changes}})
   }},
   all:async()=>({results:sqlite.prepare(sql).all()}),
   first:async()=>sqlite.prepare(sql).get()??null
  }},
  async batch(statements){
   sqlite.exec("BEGIN IMMEDIATE");
   try{
    const results=[];
    for(const stmt of statements)results.push(await stmt.run());
    sqlite.exec("COMMIT");
    return results;
   }catch(error){
    sqlite.exec("ROLLBACK");
    throw error;
   }
  }
 };
 return {sqlite,d1,close:()=>sqlite.close()};
}
const create=(db,q=quote)=>persistPreparedOrder(db,{orderId,idempotencyHash,requestFingerprint,quote:q,releaseApproved:true});
const counts=db=>({
 orders:db.prepare("SELECT COUNT(*) n FROM commerce_orders").get().n,
 lines:db.prepare("SELECT COUNT(*) n FROM commerce_order_lines").get().n,
 events:db.prepare("SELECT COUNT(*) n FROM commerce_order_events").get().n
});
test("SQL transaction stores one order, immutable lines and creation event; identical retries replay",{skip:!DatabaseSync&&"Node 22+ SQLite required"},async()=>{
 const f=await fixture();
 try{
  assert.deepEqual(await create(f.d1),{orderId,replay:false});
  assert.deepEqual(counts(f.sqlite),{orders:1,lines:1,events:1});
  assert.deepEqual(await create(f.d1),{orderId,replay:true});
  assert.deepEqual(counts(f.sqlite),{orders:1,lines:1,events:1});
  await assert.rejects(
   persistPreparedOrder(f.d1,{orderId:"CK-INMEMORY-ORDER-002",idempotencyHash,requestFingerprint:"c".repeat(64),quote,releaseApproved:true}),
   e=>e.code==="IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"
  );
  assert.deepEqual(counts(f.sqlite),{orders:1,lines:1,events:1});
 }finally{f.close()}
});
test("SQL rollback prevents orphan order header when item price changes before commit",{skip:!DatabaseSync&&"Node 22+ SQLite required"},async()=>{
 const f=await fixture();
 try{
  f.sqlite.prepare("UPDATE products SET price_cents=700 WHERE id=?").run(productId);
  await assert.rejects(create(f.d1),e=>String(e.message).includes("COMMERCE_PRODUCT_UNAVAILABLE_OR_PRICE_CHANGED"));
  assert.deepEqual(counts(f.sqlite),{orders:0,lines:0,events:0});
 }finally{f.close()}
});
test("SQL transitions update order and append event atomically with version checks",{skip:!DatabaseSync&&"Node 22+ SQLite required"},async()=>{
 const f=await fixture();
 try{
  await create(f.d1);
  const args={orderId,to:"paid",actor:"payment_provider",expectedVersion:1,
   providerEvidence:{verified:true,reconciled:true},releaseApproved:true};
  assert.deepEqual(await transitionPersistedOrder(f.d1,args),{orderId,status:"paid",version:2});
  assert.equal(f.sqlite.prepare("SELECT status FROM commerce_orders WHERE id=?").get(orderId).status,"paid");
  assert.deepEqual(counts(f.sqlite),{orders:1,lines:1,events:2});
  await assert.rejects(transitionPersistedOrder(f.d1,args),e=>e.code==="VERSION_CONFLICT");
  await assert.rejects(transitionPersistedOrder(f.d1,{orderId,to:"delivered",actor:"logistics_provider",
   expectedVersion:2,releaseApproved:true,providerEvidence:{verified:true}}),
   e=>e.code==="ILLEGAL_ORDER_TRANSITION");
  assert.deepEqual(counts(f.sqlite),{orders:1,lines:1,events:2});
  assert.deepEqual(await transitionPersistedOrder(f.d1,{orderId,to:"accepted",actor:"store",expectedVersion:2,releaseApproved:true}),
   {orderId,status:"accepted",version:3});
  assert.deepEqual(counts(f.sqlite),{orders:1,lines:1,events:3});
 }finally{f.close()}
});
