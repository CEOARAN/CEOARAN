/**
 * CK Sushi future order application service. Does not call payment or courier APIs.
 *
 * Release gate + D1 feature gates MUST be enabled in a reviewed production
 * deployment. The staging D1 retains INSERT blockers and immutable false flags.
 * This service is not routed from the public staging Worker.
 */
import {parseQuoteRequest,computeQuote,CheckoutValidationError} from "./quote.mjs";
import {persistPreparedOrder,CommerceRepositoryError} from "./order-repository.mjs";
import {deriveIdempotencyHash,deriveOrderRequestFingerprint} from "../security/idempotency.mjs";
import {normalizeCustomer,encryptCustomerForOrder} from "../security/customer-crypto.mjs";

export class OrderServiceError extends Error {
 constructor(code,status=422){super(code);this.name="OrderServiceError";this.code=code;this.status=status}
}
function object(x){return x!==null&&typeof x==="object"&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype}
function checkInput(body){
 if(!object(body)||Object.keys(body).some(k=>!["items","fulfillment","customer"].includes(k)))
  throw new OrderServiceError("INVALID_ORDER_PAYLOAD");
 const cart=parseQuoteRequest({items:body.items,fulfillment:body.fulfillment});
 // Never guess a courier fee. A separate, verified delivery quote/consent
 // workflow is required before delivery can be accepted.
 if(cart.fulfillment!=="pickup")throw new OrderServiceError("DELIVERY_CHECKOUT_NOT_READY",503);
 const customer=normalizeCustomer(body.customer);
 if(customer.address!==null)throw new OrderServiceError("PICKUP_ADDRESS_NOT_ALLOWED");
 return {cart,customer};
}
async function requireExplicitRelease(db,releaseApproved){
 if(releaseApproved!==true)throw new OrderServiceError("COMMERCE_RELEASE_NOT_APPROVED",503);
 if(!db||typeof db.prepare!=="function"||typeof db.batch!=="function")
  throw new OrderServiceError("DATABASE_REQUIRED",503);
 const rows=await db.prepare("SELECT key,value FROM operational_settings WHERE key IN ('orders_enabled','payments_enabled','customer_data_enabled')").all();
 const flags=new Map((rows?.results||[]).map(r=>[r.key,r.value]));
 if(["orders_enabled","payments_enabled","customer_data_enabled"].some(k=>flags.get(k)!=="true"))
  throw new OrderServiceError("DATABASE_COMMERCE_GATES_DISABLED",503);
}
function requireSecrets({idempotencySecret,customerEncryptionSecret,keyVersion}){
 if(typeof idempotencySecret!=="string"||idempotencySecret.length<32||
   typeof customerEncryptionSecret!=="string"||customerEncryptionSecret.length<40||
   !Number.isSafeInteger(keyVersion)||keyVersion<1)
  throw new OrderServiceError("ORDER_SECRETS_NOT_CONFIGURED",503);
}
/**
 * One atomic order snapshot, calculated from the current D1 catalog.
 * Duplicate requests replay the original order (even when menu prices change).
 * No payment processing, dispatch, or external service is performed.
 * Input includes customer data only in a reviewed, approved environment.
 */
export async function preparePickupOrder(db,{
 body,idempotencyKey,idempotencySecret,customerEncryptionSecret,keyVersion,
 releaseApproved=false,orderIdFactory=()=>("CK-ORD-"+crypto.randomUUID())
}={}){
 await requireExplicitRelease(db,releaseApproved); // before processing any PII
 requireSecrets({idempotencySecret,customerEncryptionSecret,keyVersion});
 const {cart,customer}=checkInput(body);
 const [idempotencyHash,requestFingerprint]=await Promise.all([
  deriveIdempotencyHash({scope:"orders",key:idempotencyKey,secret:idempotencySecret}),
  deriveOrderRequestFingerprint({cart,customer,secret:idempotencySecret})
 ]);
 // Replay by HMAC key before looking at products/prices; prevents a retry
 // being rejected merely because the merchant changed catalog prices.
 const existing=await db.prepare(
  "SELECT id,request_fingerprint,status,total_cents,currency FROM commerce_orders WHERE idempotency_hash=?"
 ).bind(idempotencyHash).first();
 if(existing){
  if(existing.request_fingerprint!==requestFingerprint)throw new OrderServiceError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",409);
  return {order_id:existing.id,status:existing.status,currency:existing.currency,
   total_cents:existing.total_cents,replay:true,payment_created:false};
 }
 const ids=cart.items.map(line=>line.product_id);
 const sql="SELECT id,name,price_cents,is_available,is_published FROM products WHERE id IN ("+ids.map(()=>"?").join(",")+")";
 const products=await db.prepare(sql).bind(...ids).all();
 const minRow=await db.prepare("SELECT value FROM operational_settings WHERE key='minimum_order_cents'").first();
 const minimumOrderCents=minRow?Number(minRow.value):0;
 const quote=computeQuote(cart,products.results||[],{minimumOrderCents});
 if(quote.minimum_order_met!==true)throw new OrderServiceError("MINIMUM_ORDER_NOT_MET",409);
 if(quote.delivery_quote_required||!Number.isSafeInteger(quote.total_cents)||quote.total_cents<1)
  throw new OrderServiceError("UNPAYABLE_TOTAL",409);
 const orderId=orderIdFactory();
 if(typeof orderId!=="string"||!/^[A-Za-z0-9_-]{8,100}$/.test(orderId))
  throw new OrderServiceError("INVALID_ORDER_IDENTIFIER",503);
 // AES-GCM with order-specific authenticated context. No raw PII in D1.
 const ciphertext=await encryptCustomerForOrder({orderId,customer,secret:customerEncryptionSecret});
 const saved=await persistPreparedOrder(db,{
  orderId,idempotencyHash,requestFingerprint,quote,
  customerEncrypted:ciphertext,keyVersion,releaseApproved:true
 });
 // A concurrent request may win the same key with a different orderId.
 // Re-read the persisted row instead of returning the losing candidate.
 const stored=await db.prepare("SELECT id,status,total_cents,currency,request_fingerprint FROM commerce_orders WHERE id=?")
  .bind(saved.orderId).first();
 if(!stored||stored.request_fingerprint!==requestFingerprint)
  throw new OrderServiceError("ORDER_CONFIRMATION_FAILED",503);
 return {order_id:stored.id,status:stored.status,total_cents:stored.total_cents,
  currency:stored.currency,replay:saved.replay,payment_created:false};
}
