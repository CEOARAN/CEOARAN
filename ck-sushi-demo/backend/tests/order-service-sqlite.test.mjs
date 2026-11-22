import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto,randomBytes} from "node:crypto";
let DatabaseSync;
try{({DatabaseSync}=await import("node:sqlite"))}catch{}
import {preparePickupOrder} from "../domain/order-service.mjs";
import {getOrderDetailsForAdmin,listRecentOrdersForAdmin} from "../domain/order-queries.mjs";
import {decryptCustomerForOrder} from "../security/customer-crypto.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const idempotencySecret="integration-test-secret-with-more-than-32-characters";
const customerEncryptionSecret=randomBytes(32).toString("base64");
const customer={name:"Pessoa Exemplo",phone:"11999999999"};
const productId="CK-SERVICE-TEST-001";
const baseBody={items:[{product_id:productId,quantity:2}],fulfillment:"pickup",customer};
const migrationNames=["0001_init.sql","0002_commerce.sql","0003_staging_guards.sql",
 "0004_financial_integrity.sql","0005_financial_snapshots.sql","0006_staging_feature_gates.sql"];
async function fixture({allowCommerce=false}={}){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of migrationNames)
  sqlite.exec(await readFile(new URL("../migrations/"+name,import.meta.url),"utf8"));
 sqlite.prepare("INSERT INTO products(id,name,category,price_cents,image_url,is_available,is_published) VALUES(?,?,?,?,?,1,1)")
  .run(productId,"Sushi de teste","Combinados",950,"https://images.unsplash.com/mock");
 if(allowCommerce){
  // In-memory production simulation ONLY. Remote staging retains all guards.
  sqlite.exec("DROP TRIGGER staging_block_order_insert; DROP TRIGGER staging_block_operational_insert; DROP TRIGGER staging_block_operational_update; DROP TRIGGER staging_block_operational_delete;");
  for(const key of ["orders_enabled","payments_enabled","customer_data_enabled"])
   sqlite.prepare("UPDATE operational_settings SET value='true' WHERE key=?").run(key);
 }
 const db={
  prepare(sql){return {
   bind(...args){const stmt=sqlite.prepare(sql);return{
    first:async()=>stmt.get(...args)??null,
    all:async()=>({results:stmt.all(...args)}),
    run:async()=>({meta:{changes:stmt.run(...args).changes}})
   }},
   first:async()=>sqlite.prepare(sql).get()??null,
   all:async()=>({results:sqlite.prepare(sql).all()})
  }},
  async batch(stmts){
   sqlite.exec("BEGIN IMMEDIATE");
   try{
    const result=[];
    for(const item of stmts)result.push(await item.run());
    sqlite.exec("COMMIT");
    return result;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 return {db,sqlite,close:()=>sqlite.close()};
}
let orderCounter=0;
const options=(body=baseBody,key="replay_secret_123456789")=>({
 body,idempotencyKey:key,idempotencySecret,customerEncryptionSecret,keyVersion:1,
 releaseApproved:true,orderIdFactory:()=>("CK-ORDER-TEST-"+String(++orderCounter).padStart(6,"0"))
});
const count=(db,table)=>db.prepare("SELECT COUNT(*) count FROM "+table).get().count;

test("release and D1 flags block processing before accepting personal details",{
 skip:!DatabaseSync&&"Node 22+ SQLite required"
},async()=>{
 const f=await fixture();
 try{
  await assert.rejects(preparePickupOrder(f.db,{...options({...baseBody,customer:{...customer,cpf:"not-allowed"}}),releaseApproved:false}),
   e=>e.code==="COMMERCE_RELEASE_NOT_APPROVED");
  await assert.rejects(preparePickupOrder(f.db,options()),e=>e.code==="DATABASE_COMMERCE_GATES_DISABLED");
  assert.equal(count(f.sqlite,"commerce_orders"),0);
 }finally{f.close()}
});

test("pickup creates one atomic snapshot, encrypts customer, no payment/delivery",{
 skip:!DatabaseSync&&"Node 22+ SQLite required"
},async()=>{
 const f=await fixture({allowCommerce:true});
 try{
  const result=await preparePickupOrder(f.db,options());
  assert.equal(result.status,"pending_payment");
  assert.equal(result.total_cents,1900);
  assert.equal(result.replay,false);
  assert.equal(result.payment_created,false);
  assert.equal(count(f.sqlite,"commerce_orders"),1);
  assert.equal(count(f.sqlite,"commerce_order_lines"),1);
  assert.equal(count(f.sqlite,"commerce_order_events"),1);
  assert.equal(count(f.sqlite,"commerce_payments"),0);
  assert.equal(count(f.sqlite,"commerce_delivery"),0);
  const row=f.sqlite.prepare("SELECT customer_encrypted,customer_key_version FROM commerce_orders").get();
  assert.match(row.customer_encrypted,/^CK1\./);
  assert(!row.customer_encrypted.includes(customer.name));
  assert.equal(row.customer_key_version,1);
  assert.deepEqual(await decryptCustomerForOrder({orderId:result.order_id,ciphertext:row.customer_encrypted,secret:customerEncryptionSecret}),
    {...customer,address:null});
 }finally{f.close()}
});

test("same HMAC idempotency key replays after price change without a second order",{
 skip:!DatabaseSync&&"Node 22+ SQLite required"
},async()=>{
 const f=await fixture({allowCommerce:true});
 try{
  const first=await preparePickupOrder(f.db,options());
  f.sqlite.prepare("UPDATE products SET price_cents=1250 WHERE id=?").run(productId);
  const replay=await preparePickupOrder(f.db,options());
  assert.equal(replay.replay,true);
  assert.equal(replay.order_id,first.order_id);
  assert.equal(replay.total_cents,1900);
  assert.equal(count(f.sqlite,"commerce_orders"),1);
  await assert.rejects(
   preparePickupOrder(f.db,options({...baseBody,items:[{product_id:productId,quantity:3}]})),
   e=>e.code==="IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"&&e.status===409
  );
  assert.equal(count(f.sqlite,"commerce_orders"),1);
 }finally{f.close()}
});

test("rejects monetary tampering, missing customer, unquoted deliveries and invalid pickup address",{
 skip:!DatabaseSync&&"Node 22+ SQLite required"
},async()=>{
 const f=await fixture({allowCommerce:true});
 try{
  for(const [body,expected] of [
   [{...baseBody,total_cents:1},"INVALID_ORDER_PAYLOAD"],
   [{...baseBody,customer:undefined},"INVALID_CUSTOMER"],
   [{...baseBody,fulfillment:"delivery"},"DELIVERY_CHECKOUT_NOT_READY"],
   [{...baseBody,customer:{...customer,address:{street:"Rua X"}}},"PICKUP_ADDRESS_NOT_ALLOWED"]
  ]){
   await assert.rejects(preparePickupOrder(f.db,options(body)),e=>e.code===expected);
  }
  assert.equal(count(f.sqlite,"commerce_orders"),0);
 }finally{f.close()}
});

test("minimum order and zero totals are rejected without persisting PII",{
 skip:!DatabaseSync&&"Node 22+ SQLite required"
},async()=>{
 const f=await fixture({allowCommerce:true});
 try{
  f.sqlite.prepare("INSERT INTO operational_settings(key,value) VALUES('minimum_order_cents','2500')").run();
  await assert.rejects(preparePickupOrder(f.db,options()),e=>e.code==="MINIMUM_ORDER_NOT_MET");
  assert.equal(count(f.sqlite,"commerce_orders"),0);
 }finally{f.close()}
});

test("admin projections omit encrypted PII and support status filters and cursor",{
 skip:!DatabaseSync&&"Node 22+ SQLite required"
},async()=>{
 const f=await fixture({allowCommerce:true});
 try{
  const first=await preparePickupOrder(f.db,options(baseBody,"unique_order_key_00000001"));
  const second=await preparePickupOrder(f.db,options(baseBody,"unique_order_key_00000002"));
  f.sqlite.prepare("UPDATE commerce_orders SET placed_at=? WHERE id=?").run("2026-11-20T10:00:00.000Z",first.order_id);
  f.sqlite.prepare("UPDATE commerce_orders SET placed_at=? WHERE id=?").run("2026-11-21T10:00:00.000Z",second.order_id);
  const page1=await listRecentOrdersForAdmin(f.db,{limit:1});
  assert.equal(page1.orders.length,1);
  assert.equal(page1.orders[0].id,second.order_id);
  assert(page1.next_cursor);
  assert(!JSON.stringify(page1).includes(customer.name));
  assert(!JSON.stringify(page1).includes("customer_encrypted"));
  const page2=await listRecentOrdersForAdmin(f.db,{limit:1,cursor:page1.next_cursor});
  assert.equal(page2.orders[0].id,first.order_id);
  assert.equal(page2.next_cursor,null);
  const details=await getOrderDetailsForAdmin(f.db,{orderId:first.order_id});
  assert.equal(details.items.length,1);
  assert.equal(details.events.length,1);
  assert(!JSON.stringify(details).includes(customer.phone));
  assert(!JSON.stringify(details).includes("customer_encrypted"));
  assert.equal((await listRecentOrdersForAdmin(f.db,{status:"paid"})).orders.length,0);
  await assert.rejects(listRecentOrdersForAdmin(f.db,{status:"INJECT' OR 1=1"}),e=>e.code==="INVALID_STATUS_FILTER");
  await assert.rejects(listRecentOrdersForAdmin(f.db,{limit:1000}),e=>e.code==="INVALID_PAGE_SIZE");
  await assert.rejects(listRecentOrdersForAdmin(f.db,{cursor:"corrupted"}),e=>e.code==="INVALID_CURSOR");
 }finally{f.close()}
});
