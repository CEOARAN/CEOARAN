import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import {persistPreparedOrder} from "../domain/order-repository.mjs";
import {initializePixForPickup,reconcilePixForPickup} from "../domain/payment-service.mjs";
let DatabaseSync;try{({DatabaseSync}=await import("node:sqlite"))}catch{}
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const orderId="CK-ORDER-PIXTST-000001",merchantId="1234567890",
 token="APP_USR-synthetic-test-only-credential-no-network";
const secret="synthetic-idempotency-secret-32-characters-minimum";
const productId="CK-TEST-PAYMENT-SKU";
const providerId="ORD01TEST12345",paymentId="PAY01TEST12345";
const quote={currency:"BRL",fulfillment:"pickup",subtotal_cents:1900,discount_cents:0,
 delivery_fee_cents:0,total_cents:1900,items:[{product_id:productId,name:"Sushi teste",
 quantity:2,unit_price_cents:950,line_total_cents:1900}]};
const pending={
 id:providerId,type:"online",external_reference:orderId,total_amount:"19.00",
 status:"action_required",status_detail:"waiting_transfer",transactions:{payments:[
 {id:paymentId,amount:"19.00",status:"action_required",status_detail:"waiting_transfer",
 payment_method:{id:"pix",type:"bank_transfer",qr_code:"TESTPIXSTRING",
 ticket_url:"https://www.mercadopago.com.br/sandbox/payments/test"}}]}
};
const approved={...pending,status:"processed",status_detail:"accredited",total_paid_amount:"19.00",
 transactions:{payments:[{...pending.transactions.payments[0],status:"processed",status_detail:"accredited"}]}};
const json=body=>new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
function mockProvider({getApproved=false,wrongMerchant=false,wrongAmount=false}={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,method:opts.method,body:opts.body});
  if(url.endsWith("/users/me"))return json({id:wrongMerchant?"4444":merchantId});
  const order=opts.method==="GET"&&getApproved?approved:pending;
  return json(wrongAmount?{...order,total_amount:"1.00"}:order);
 };
 return {calls,fetchImpl};
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 for(const name of ["0001_init.sql","0002_commerce.sql","0003_staging_guards.sql","0004_financial_integrity.sql",
  "0005_financial_snapshots.sql","0006_staging_feature_gates.sql","0007_payment_order_reconciliation.sql"]){
  sqlite.exec(await readFile(new URL("../migrations/"+name,import.meta.url),"utf8"));
 }
 sqlite.prepare("INSERT INTO products(id,name,category,price_cents,image_url) VALUES(?,?,?,?,?)")
  .run(productId,"Sushi teste","Sushi",950,"https://images.unsplash.com/mock");
 // Isolated RAM-only simulation: actual remote staging retains all blockers.
 sqlite.exec("DROP TRIGGER staging_block_order_insert; DROP TRIGGER staging_block_payment_insert; DROP TRIGGER staging_block_operational_insert; DROP TRIGGER staging_block_operational_update; DROP TRIGGER staging_block_operational_delete;");
 for(const key of ["orders_enabled","payments_enabled","customer_data_enabled"])
  sqlite.prepare("UPDATE operational_settings SET value='true' WHERE key=?").run(key);
 const db={
  prepare(sql){return{
   bind(...params){const stmt=sqlite.prepare(sql);return{
    first:async()=>stmt.get(...params)??null,
    all:async()=>({results:stmt.all(...params)}),
    run:async()=>({meta:{changes:stmt.run(...params).changes}})
   }},
   first:async()=>sqlite.prepare(sql).get()??null,
   all:async()=>({results:sqlite.prepare(sql).all()})
  }},
  async batch(statements){
   sqlite.exec("BEGIN IMMEDIATE");
   try{
    const out=[];
    for(const stmt of statements)out.push(await stmt.run());
    sqlite.exec("COMMIT");
    return out;
   }catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 await persistPreparedOrder(db,{orderId,idempotencyHash:"a".repeat(64),
  requestFingerprint:"b".repeat(64),quote,releaseApproved:true});
 return {db,sqlite,close:()=>sqlite.close()};
}
const start=(db,provider,releaseApproved=true)=>initializePixForPickup(db,{orderId,
 payer:{email:"ficticio@example.test",first_name:"Teste"},
 merchantId,token,idempotencySecret:secret,releaseApproved,fetchImpl:provider.fetchImpl});
const check=(db,provider,releaseApproved=true)=>reconcilePixForPickup(db,{
 orderId,merchantId,token,releaseApproved,fetchImpl:provider.fetchImpl});

test("Pix initializes once: remote POST idempotent, pending payment stored",{
 skip:!DatabaseSync&&"Requires Node 22+ built-in SQLite"
},async()=>{
 const f=await fixture();
 try{
  const provider=mockProvider();
  const first=await start(f.db,provider);
  assert.equal(first.payment_status,"pending");
  assert.equal(first.replay,false);
  assert.equal(provider.calls.filter(c=>c.method==="POST").length,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM commerce_payments").get().n,1);
  const again=await start(f.db,provider);
  assert.equal(again.replay,true);
  assert.equal(provider.calls.filter(c=>c.method==="POST").length,1);
  assert.equal(first.provider_order_id,providerId);
  assert.equal(f.sqlite.prepare("SELECT status FROM commerce_orders WHERE id=?").get(orderId).status,"pending_payment");
 }finally{f.close()}
});
test("fresh GET reconciles amount, merchant and transaction before marking paid; retries replay",{
 skip:!DatabaseSync&&"Requires Node 22+ built-in SQLite"
},async()=>{
 const f=await fixture();
 try{
  await start(f.db,mockProvider());
  const provider=mockProvider({getApproved:true});
  const confirmed=await check(f.db,provider);
  assert.equal(confirmed.status,"paid");
  assert.equal(confirmed.version,2);
  assert.equal(confirmed.replay,false);
  assert.equal(f.sqlite.prepare("SELECT payment_status FROM commerce_orders WHERE id=?").get(orderId).payment_status,"approved");
  assert.equal(f.sqlite.prepare("SELECT status FROM commerce_payments WHERE order_id=?").get(orderId).status,"approved");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM commerce_order_events WHERE order_id=?").get(orderId).n,2);
  const retry=await check(f.db,provider);
  assert.equal(retry.replay,true);
  assert.equal(provider.calls.filter(c=>c.method==="GET"&&c.url.includes("/v1/orders/")).length,1);
 }finally{f.close()}
});
test("pending Pix remains pending; incorrect amounts or merchant identities cannot approve",{
 skip:!DatabaseSync&&"Requires Node 22+ built-in SQLite"
},async()=>{
 const f=await fixture();
 try{
  await start(f.db,mockProvider());
  const stillPending=await check(f.db,mockProvider());
  assert.equal(stillPending.status,"pending_payment");
  await assert.rejects(check(f.db,mockProvider({getApproved:true,wrongMerchant:true})),
   e=>e.code==="MERCHANT_IDENTITY_MISMATCH");
  await assert.rejects(check(f.db,mockProvider({getApproved:true,wrongAmount:true})),
   e=>e.code==="AMOUNT_MISMATCH");
  assert.equal(f.sqlite.prepare("SELECT status FROM commerce_orders WHERE id=?").get(orderId).status,"pending_payment");
  assert.equal(f.sqlite.prepare("SELECT status FROM commerce_payments WHERE order_id=?").get(orderId).status,"pending");
 }finally{f.close()}
});
test("all operations reject unapproved release and cannot send requests",{
 skip:!DatabaseSync&&"Requires Node 22+ built-in SQLite"
},async()=>{
 const f=await fixture();
 try{
  const p=mockProvider();
  await assert.rejects(start(f.db,p,false),e=>e.code==="PAYMENTS_RELEASE_NOT_APPROVED");
  await assert.rejects(check(f.db,p,false),e=>e.code==="PAYMENTS_RELEASE_NOT_APPROVED");
  assert.equal(p.calls.length,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM commerce_payments").get().n,0);
 }finally{f.close()}
});
