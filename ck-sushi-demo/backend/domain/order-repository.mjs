/**
 * Future commerce repository — not attached to HTTP routes.
 * All writes explicitly require a release gate plus database feature gates.
 * D1 batch() is transactional: header + immutable lines + event insert all roll back together.
 * The staging migration 0003 separately blocks commerce INSERTs at the database level.
 */
import {validateTransition} from "./order-machine.mjs";

export class CommerceRepositoryError extends Error{
 constructor(code){super(code);this.name="CommerceRepositoryError";this.code=code;}
}
const HEX64=/^[0-9a-f]{64}$/i, ORDER_ID=/^[A-Za-z0-9_-]{8,120}$/;
const ROLES=new Set(["system","store","payment_provider","logistics_provider"]);
const hashInput=async text=>{
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
};
async function gateCommerce(db,releaseApproved){
 if(releaseApproved!==true)throw new CommerceRepositoryError("COMMERCE_RELEASE_NOT_APPROVED");
 const rows=await db.prepare("SELECT key,value FROM operational_settings WHERE key IN ('orders_enabled','payments_enabled','customer_data_enabled')").all();
 const config=new Map((rows.results||[]).map(row=>[row.key,row.value]));
 if(["orders_enabled","payments_enabled","customer_data_enabled"].some(k=>config.get(k)!=="true"))throw new CommerceRepositoryError("DATABASE_COMMERCE_GATES_DISABLED");
}
function validatePersistedQuote(quote){
 if(!quote||quote.currency!=="BRL"||!Array.isArray(quote.items)||!quote.items.length||quote.items.length>30)throw new CommerceRepositoryError("INVALID_QUOTE");
 if(!Number.isSafeInteger(quote.subtotal_cents)||quote.subtotal_cents<0||quote.total_cents===null||!Number.isSafeInteger(quote.total_cents)||quote.total_cents<0)throw new CommerceRepositoryError("UNCONFIRMED_TOTAL");
 if(!Number.isSafeInteger(quote.delivery_fee_cents)||quote.delivery_fee_cents<0||!Number.isSafeInteger(quote.discount_cents)||quote.discount_cents<0||quote.total_cents!==quote.subtotal_cents-quote.discount_cents+quote.delivery_fee_cents)throw new CommerceRepositoryError("QUOTE_MISMATCH");
 if(!["pickup","delivery"].includes(quote.fulfillment))throw new CommerceRepositoryError("INVALID_FULFILLMENT");
 let sum=0;const seen=new Set();
 quote.items.forEach(line=>{
  if(!line||typeof line.product_id!=="string"||typeof line.name!=="string"||line.name.length<2||line.name.length>180||
  !Number.isInteger(line.quantity)||line.quantity<1||line.quantity>20||!Number.isSafeInteger(line.unit_price_cents)||line.unit_price_cents<0||
  !Number.isSafeInteger(line.line_total_cents)||line.line_total_cents!==line.quantity*line.unit_price_cents||
  seen.has(line.product_id))throw new CommerceRepositoryError("INVALID_ORDER_LINE");
  seen.add(line.product_id);sum+=line.line_total_cents;
 });
 if(!Number.isSafeInteger(sum)||sum!==quote.subtotal_cents)throw new CommerceRepositoryError("LINE_TOTAL_MISMATCH");
 return quote;
}
export async function persistPreparedOrder(db,{orderId,idempotencyHash,requestFingerprint,quote,customerEncrypted=null,keyVersion=null,releaseApproved=false}){
 if(!db||typeof db.batch!=="function")throw new CommerceRepositoryError("DATABASE_REQUIRED");
 await gateCommerce(db,releaseApproved);
 if(!ORDER_ID.test(orderId)||!HEX64.test(idempotencyHash)||!HEX64.test(requestFingerprint))throw new CommerceRepositoryError("INVALID_ORDER_IDENTITY");
 if(customerEncrypted!==null&&(typeof customerEncrypted!=="string"||customerEncrypted.length>8000||!customerEncrypted.startsWith("CK1.")||!Number.isInteger(keyVersion)||keyVersion<1))throw new CommerceRepositoryError("CUSTOMER_ENCRYPTION_REQUIRED");
 if(customerEncrypted===null&&keyVersion!==null)throw new CommerceRepositoryError("CUSTOMER_ENCRYPTION_REQUIRED");
 const q=validatePersistedQuote(quote);
 const existing=await db.prepare("SELECT id,request_fingerprint FROM commerce_orders WHERE idempotency_hash=?").bind(idempotencyHash).first();
 if(existing){if(existing.request_fingerprint!==requestFingerprint)throw new CommerceRepositoryError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");return{orderId:existing.id,replay:true}}
 const id=orderId;
 const stmts=[db.prepare(String.raw`INSERT INTO commerce_orders
 (id,idempotency_hash,request_fingerprint,status,payment_status,fulfillment,currency,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,customer_encrypted,customer_key_version)
 VALUES(?,?,?,'pending_payment','pending',?,'BRL',?,?,?,?,?,?)`).bind(id,idempotencyHash,requestFingerprint,q.fulfillment,q.subtotal_cents,q.discount_cents,q.delivery_fee_cents,q.total_cents,customerEncrypted,keyVersion)];
 q.items.forEach((line,i)=>stmts.push(db.prepare(String.raw`INSERT INTO commerce_order_lines(order_id,line_no,product_id,name_snapshot,unit_price_cents,quantity,total_cents)
 VALUES(?,?,?,?,?,?,?)`).bind(id,i+1,line.product_id,line.name,line.unit_price_cents,line.quantity,line.line_total_cents)));
 const hash=await hashInput("CKSUSHI:order-created:"+id+":"+requestFingerprint);
 stmts.push(db.prepare("INSERT INTO commerce_order_events(order_id,actor_type,from_status,to_status,event_hash) VALUES(?,'system',NULL,'pending_payment',?)").bind(id,hash));
 try{await db.batch(stmts);return{orderId:id,replay:false}}catch(e){
  const current=await db.prepare("SELECT id,request_fingerprint FROM commerce_orders WHERE idempotency_hash=?").bind(idempotencyHash).first();
  if(current){if(current.request_fingerprint!==requestFingerprint)throw new CommerceRepositoryError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");return{orderId:current.id,replay:true}}
  throw e;
 }
}
export async function transitionPersistedOrder(db,{orderId,to,actor,expectedVersion,releaseApproved=false,providerEvidence=null}){
 await gateCommerce(db,releaseApproved);
 if(!ORDER_ID.test(orderId)||!Number.isSafeInteger(expectedVersion)||expectedVersion<1||!ROLES.has(actor))throw new CommerceRepositoryError("INVALID_TRANSITION_REQUEST");
 const row=await db.prepare("SELECT id,status,payment_status,fulfillment,version FROM commerce_orders WHERE id=?").bind(orderId).first();
 if(!row)throw new CommerceRepositoryError("ORDER_NOT_FOUND");
 if(row.version!==expectedVersion)throw new CommerceRepositoryError("VERSION_CONFLICT");
 const providerVerified=providerEvidence?.verified===true&&providerEvidence?.reconciled===true;
 if(actor==="payment_provider"&&!providerVerified)throw new CommerceRepositoryError("PAYMENT_PROVIDER_EVIDENCE_REQUIRED");
 if(actor==="logistics_provider"&&!providerEvidence?.verified)throw new CommerceRepositoryError("LOGISTICS_PROVIDER_EVIDENCE_REQUIRED");
 // A boolean claim of "verified" alone must never mark an order paid.
 // A matching, approved, persisted Mercado Pago record is mandatory.
 if(to==="paid"){
  const approved=await db.prepare("SELECT id FROM commerce_payments WHERE order_id=? AND status='approved' AND currency='BRL' AND amount_cents=(SELECT total_cents FROM commerce_orders WHERE id=?) AND provider_payment_id IS NOT NULL AND provider_order_id IS NOT NULL LIMIT 1").bind(orderId,orderId).first();
  if(!approved)throw new CommerceRepositoryError("APPROVED_PAYMENT_RECORD_REQUIRED");
 }
 // A refund is a financial side effect. Provider evidence must be recorded
 // in the payment ledger before the state machine may mark it finalized.
 if(to==="refunded"){
  const refunded=await db.prepare("SELECT id FROM commerce_payments WHERE order_id=? AND status='refunded' AND currency='BRL' AND amount_cents=(SELECT total_cents FROM commerce_orders WHERE id=?) AND provider_order_id IS NOT NULL AND provider_payment_id IS NOT NULL LIMIT 1").bind(orderId,orderId).first();
  if(!refunded)throw new CommerceRepositoryError("VERIFIED_REFUND_RECORD_REQUIRED");
 }
 const paymentStatus=to==="paid"?"approved":to==="refunded"?"refunded":row.payment_status;
 validateTransition({from:row.status,to,actor,paymentStatus,fulfillment:row.fulfillment});
 const hash=await hashInput("CKSUSHI:order-transition:"+orderId+":"+expectedVersion+":"+row.status+":"+to);
 const stmt=db.prepare(String.raw`UPDATE commerce_orders SET status=?,payment_status=?,version=version+1,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=? AND status=?`).bind(to,paymentStatus,orderId,expectedVersion,row.status);
 const event=db.prepare(String.raw`INSERT INTO commerce_order_events(order_id,actor_type,from_status,to_status,event_hash)
 SELECT id,?,?,?,? FROM commerce_orders WHERE id=? AND status=? AND version=?`).bind(actor,row.status,to,hash,orderId,to,expectedVersion+1);
 const results=await db.batch([stmt,event]);
 if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)throw new CommerceRepositoryError("TRANSITION_CONFLICT");
 return{orderId,status:to,version:expectedVersion+1};
}
