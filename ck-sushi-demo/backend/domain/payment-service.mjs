/**
 * CK Sushi future Pix payment orchestration. Never called by the staging HTTP
 * routes or staging scheduled task. Gate checks run before any external calls.
 * Provider writes use order-scoped, deterministic idempotency. Only a fresh
 * verified GET /v1/orders/{id} can produce an approved local payment.
 */
import {deriveIdempotencyHash} from "../security/idempotency.mjs";
import {createPixAtMercadoPago,fetchVerifiedPixOrder} from "../integrations/mercadopago-client.mjs";

export class PaymentServiceError extends Error{
 constructor(code){super(code);this.name="PaymentServiceError";this.code=code}
}
const PAY_ORDER_ID=/^[A-Za-z0-9_-]{16,120}$/, PAY_PROVIDER_ID=/^[A-Za-z0-9_-]{5,100}$/;
async function gate(db,releaseApproved){
 if(releaseApproved!==true)throw new PaymentServiceError("PAYMENTS_RELEASE_NOT_APPROVED");
 if(!db||typeof db.prepare!=="function"||typeof db.batch!=="function")
  throw new PaymentServiceError("DATABASE_REQUIRED");
 const flags=await db.prepare("SELECT key,value FROM operational_settings WHERE key IN ('orders_enabled','payments_enabled','customer_data_enabled')").all();
 const m=new Map((flags?.results||[]).map(x=>[x.key,x.value]));
 if(["orders_enabled","payments_enabled","customer_data_enabled"].some(k=>m.get(k)!=="true"))
  throw new PaymentServiceError("DATABASE_COMMERCE_GATES_DISABLED");
}
async function loadLocal(db,orderId){
 if(!PAY_ORDER_ID.test(String(orderId||"")))throw new PaymentServiceError("INVALID_ORDER_ID");
 const order=await db.prepare("SELECT id,status,payment_status,total_cents,currency,version FROM commerce_orders WHERE id=?").bind(orderId).first();
 if(!order)throw new PaymentServiceError("ORDER_NOT_FOUND");
 if(order.currency!=="BRL"||!Number.isSafeInteger(order.total_cents)||order.total_cents<1)
  throw new PaymentServiceError("ORDER_NOT_PAYABLE");
 return order;
}
const paymentFor=db=>db.prepare("SELECT id,status,provider_order_id,provider_payment_id,provider_merchant_id,amount_cents,currency FROM commerce_payments WHERE order_id=? ORDER BY created_at DESC,id DESC LIMIT 1");
async function digestEvent(text){
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)));
 return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
}
export async function initializePixForPickup(db,{
 orderId,payer,merchantId,token,idempotencySecret,releaseApproved=false,fetchImpl=fetch
}={}){
 await gate(db,releaseApproved);
 const order=await loadLocal(db,orderId);
 if(order.status!=="pending_payment"||order.payment_status!=="pending")
  throw new PaymentServiceError("ORDER_ALREADY_PROCESSED");
 const existing=await paymentFor(db).bind(orderId).first();
 if(existing){
  if(existing.currency!=="BRL"||existing.amount_cents!==order.total_cents||
      String(existing.provider_merchant_id)!==String(merchantId))
    throw new PaymentServiceError("EXISTING_PAYMENT_MISMATCH");
  // No second POST, even if another invocation used a different payer.
  return {order_id:orderId,replay:true,payment_id:existing.id,
   provider_order_id:existing.provider_order_id,payment_status:existing.status,
   requires_readback:true};
 }
 const key=await deriveIdempotencyHash({scope:"payments",key:orderId,secret:idempotencySecret});
 const verified=await createPixAtMercadoPago({
  orderId,totalCents:order.total_cents,payer,idempotencyKey:key,merchantId,token,
  releaseApproved:true,fetchImpl
 });
 if(!PAY_PROVIDER_ID.test(verified.provider_order_id)||!PAY_PROVIDER_ID.test(verified.provider_payment_id))
  throw new PaymentServiceError("INVALID_PROVIDER_PAYMENT_REFERENCE");
 const id="CKPAY-"+crypto.randomUUID();
 // This table's unique idempotency_hash and provider IDs protect concurrent
 // requests, while the provider uses the same X-Idempotency-Key for the order.
 try{
  await db.prepare("INSERT OR IGNORE INTO commerce_payments (id,order_id,provider,provider_order_id,provider_payment_id,provider_merchant_id,amount_cents,currency,status,idempotency_hash) VALUES(?,?,'mercadopago',?,?,?,?,'BRL','pending',?)")
   .bind(id,orderId,verified.provider_order_id,verified.provider_payment_id,
     String(merchantId),order.total_cents,key).run();
 }catch{
  // Do not echo provider error payload or credentials.
  throw new PaymentServiceError("PAYMENT_PERSISTENCE_UNCERTAIN");
 }
 const persisted=await paymentFor(db).bind(orderId).first();
 if(!persisted||persisted.amount_cents!==order.total_cents||
   String(persisted.provider_order_id)!==verified.provider_order_id||
   String(persisted.provider_merchant_id)!==String(merchantId))
  throw new PaymentServiceError("PAYMENT_PERSISTENCE_UNCERTAIN");
 return {order_id:orderId,replay:persisted.id!==id,payment_id:persisted.id,
  provider_order_id:persisted.provider_order_id,payment_status:persisted.status,
  qr_code:verified.qr_code,ticket_url:verified.ticket_url,requires_readback:true};
}
export async function reconcilePixForPickup(db,{
 orderId,merchantId,token,releaseApproved=false,fetchImpl=fetch
}={}){
 await gate(db,releaseApproved);
 const order=await loadLocal(db,orderId);
 const payment=await paymentFor(db).bind(orderId).first();
 if(!payment||payment.currency!=="BRL"||payment.amount_cents!==order.total_cents||
    !MP_ID.test(String(payment.provider_order_id||""))||
    !MP_ID.test(String(payment.provider_payment_id||""))||
    String(payment.provider_merchant_id)!==String(merchantId))
  throw new PaymentServiceError("PAYMENT_RECORD_MISMATCH");
 if(order.status==="paid"&&payment.status==="approved")
  return {order_id:orderId,status:"paid",version:order.version,replay:true};
 if(order.status!=="pending_payment"||order.payment_status!=="pending")
  throw new PaymentServiceError("ORDER_NOT_AWAITING_PAYMENT");
 const checked=await fetchVerifiedPixOrder({
  providerOrderId:payment.provider_order_id,orderId,totalCents:order.total_cents,
  token,merchantId,releaseApproved:true,fetchImpl
 });
 if(String(checked.provider_payment_id)!==String(payment.provider_payment_id))
  throw new PaymentServiceError("PAYMENT_PROVIDER_ID_MISMATCH");
 if(!checked.approved)
  return {order_id:orderId,status:"pending_payment",version:order.version,
   provider_status:"pending",replay:false};
 const hash=await digestEvent("CKSUSHI:pix-confirmed:"+orderId+":"+payment.id);
 const updates=[
  db.prepare("UPDATE commerce_payments SET status='approved',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND order_id=? AND status IN ('pending','created') AND amount_cents=? AND EXISTS (SELECT 1 FROM commerce_orders WHERE id=? AND status='pending_payment' AND version=?)")
   .bind(payment.id,orderId,order.total_cents,orderId,order.version),
  db.prepare("UPDATE commerce_orders SET status='paid',payment_status='approved',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending_payment' AND version=? AND EXISTS (SELECT 1 FROM commerce_payments WHERE id=? AND status='approved' AND amount_cents=commerce_orders.total_cents)")
   .bind(orderId,order.version,payment.id),
  db.prepare("INSERT INTO commerce_order_events(order_id,actor_type,from_status,to_status,event_hash) SELECT id,'payment_provider','pending_payment','paid',? FROM commerce_orders WHERE id=? AND status='paid' AND version=?")
   .bind(hash,orderId,order.version+1)
 ];
 const result=await db.batch(updates);
 if(result.every(x=>x?.meta?.changes===1))
  return {order_id:orderId,status:"paid",version:order.version+1,replay:false};
 // If a concurrent worker already confirmed payment, idempotently accept it.
 const current=await loadLocal(db,orderId);
 const currentPayment=await paymentFor(db).bind(orderId).first();
 if(current.status==="paid"&&currentPayment?.status==="approved")
  return {order_id:orderId,status:"paid",version:current.version,replay:true};
 throw new PaymentServiceError("PAYMENT_TRANSITION_CONFLICT");
}
