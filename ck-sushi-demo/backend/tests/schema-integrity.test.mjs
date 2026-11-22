import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// Node 22+ includes an in-memory SQLite engine; Node 20 can still run other tests.
// This database is isolated, entirely synthetic and never connects to Cloudflare.
let DatabaseSync;
try{({DatabaseSync}=await import("node:sqlite"))}catch{}
const migrationNames=[
 "0001_init.sql","0002_commerce.sql","0003_staging_guards.sql",
 "0004_financial_integrity.sql","0005_financial_snapshots.sql"
];
const buildDb=async()=>{
 const db=new DatabaseSync(":memory:");
 db.exec("PRAGMA foreign_keys=ON");
 for(const name of migrationNames){
  const sql=await readFile(new URL("../migrations/"+name,import.meta.url),"utf8");
  db.exec(sql);
 }
 return db;
};
const assertAbort=(fn,marker)=>assert.throws(fn,e=>String(e.message).includes(marker));
test("all staging migrations apply in order, preserving write-blocking triggers",{
 skip:!DatabaseSync&&"Requires Node 22+ built-in SQLite"
},async()=>{
 const db=await buildDb();
 try{
  assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,5);
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(v=>v.name);
  for(const name of [
   "staging_block_order_insert","staging_block_payment_insert",
   "staging_block_outbox_insert","commerce_line_snapshot_price_guard",
   "commerce_order_financial_snapshot_immutable","commerce_order_line_delete_guard",
   "commerce_payment_financial_snapshot_immutable","commerce_payment_delete_guard"
  ])assert(names.includes(name),"Missing trigger: "+name);
  assertAbort(()=>db.prepare(`INSERT INTO commerce_orders
    (id,idempotency_hash,request_fingerprint,status,payment_status,
     fulfillment,currency,subtotal_cents,discount_cents,delivery_fee_cents,total_cents)
    VALUES('TEST00001','a','b','pending_payment','pending','pickup','BRL',1200,0,0,1200)`).run(),"STAGING_ORDERS_DISABLED");
 }finally{db.close()}
});
test("financial records are immutable, while legitimate lifecycle transitions remain possible",{
 skip:!DatabaseSync&&"Requires Node 22+ built-in SQLite"
},async()=>{
 const db=await buildDb();
 try{
  // Synthetic future-production fixture: remove guards ONLY from in-memory DB.
  db.exec("DROP TRIGGER staging_block_order_insert; DROP TRIGGER staging_block_payment_insert;");
  db.prepare("INSERT INTO products(id,name,category,price_cents,image_url) VALUES(?,?,?,?,?)")
    .run("CK-TEST-001","Teste sintético","Combinados",600,"https://example.test/fixture");
  db.prepare(`INSERT INTO commerce_orders
   (id,idempotency_hash,request_fingerprint,status,payment_status,
    fulfillment,currency,subtotal_cents,discount_cents,delivery_fee_cents,total_cents)
   VALUES(?,?,?,'pending_payment','pending','pickup','BRL',1200,0,0,1200)`)
   .run("CK-TEST-ORDER-001","a".repeat(64),"b".repeat(64));
  db.prepare(`INSERT INTO commerce_order_lines
   (order_id,line_no,product_id,name_snapshot,unit_price_cents,quantity,total_cents)
   VALUES(?,?,?,?,?,?,?)`).run("CK-TEST-ORDER-001",1,"CK-TEST-001","Teste sintético",600,2,1200);
  assertAbort(()=>db.prepare("UPDATE commerce_orders SET fulfillment='delivery' WHERE id=?").run("CK-TEST-ORDER-001"),"ORDER_FINANCIAL_SNAPSHOT_IMMUTABLE");
  assertAbort(()=>db.prepare("DELETE FROM commerce_order_lines WHERE order_id=?").run("CK-TEST-ORDER-001"),"COMMERCE_ORDER_LINES_IMMUTABLE");
  assertAbort(()=>db.prepare("UPDATE commerce_orders SET subtotal_cents=1800,total_cents=1800 WHERE id=?").run("CK-TEST-ORDER-001"),"ORDER_FINANCIAL_SNAPSHOT_IMMUTABLE");
  // Valid lifecycle change is NOT rejected by financial-snapshot triggers.
  db.prepare("UPDATE commerce_orders SET status='paid',payment_status='approved',version=version+1 WHERE id=?")
   .run("CK-TEST-ORDER-001");
  assert.equal(db.prepare("SELECT status FROM commerce_orders WHERE id=?").get("CK-TEST-ORDER-001").status,"paid");
  assertAbort(()=>db.prepare(`INSERT INTO commerce_payments(id,order_id,provider,amount_cents,currency,status,idempotency_hash)
   VALUES(?,?,?,?,'BRL','pending',?)`).run("PAY-INVALID","CK-TEST-ORDER-001","mercadopago",1199,"c".repeat(64)),"PAYMENT_AMOUNT_MISMATCH");
  db.prepare(`INSERT INTO commerce_payments
   (id,order_id,provider,amount_cents,currency,status,idempotency_hash)
   VALUES(?,?,?,?,'BRL','pending',?)`)
   .run("PAY-OK-001","CK-TEST-ORDER-001","mercadopago",1200,"c".repeat(64));
  assertAbort(()=>db.prepare("UPDATE commerce_payments SET amount_cents=1300 WHERE id='PAY-OK-001'").run(),"PAYMENT_FINANCIAL_SNAPSHOT_IMMUTABLE");
  db.prepare("UPDATE commerce_payments SET provider_merchant_id='12345678',provider_payment_id='PAYTEST123' WHERE id='PAY-OK-001'").run();
  assertAbort(()=>db.prepare("UPDATE commerce_payments SET provider_payment_id='PAYTESTOTHER' WHERE id='PAY-OK-001'").run(),"PAYMENT_FINANCIAL_SNAPSHOT_IMMUTABLE");
  db.prepare("UPDATE commerce_payments SET status='approved' WHERE id='PAY-OK-001'").run();
  assertAbort(()=>db.prepare("DELETE FROM commerce_payments WHERE id='PAY-OK-001'").run(),"COMMERCE_PAYMENT_DELETE_REQUIRES_REVIEW");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM commerce_payments").get().count,1);
 }finally{db.close()}
});
