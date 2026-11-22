/**
 * Mercado Pago Checkout API Orders client, fail-closed and provider-isolated.
 * Never persist raw provider responses or write bearer tokens to logs.
 * Real payments require explicit upstream release gates and merchant approval.
 * Official: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix
 */
import {createPixOrderPayload,reconcilePixOrderResponse} from "./mercadopago-orders.mjs";

export class MercadoPagoClientError extends Error{
 constructor(code,{retryable=false}={}){
  super(code);this.name="MercadoPagoClientError";this.code=code;this.retryable=retryable;
 }
}
const MP_BASE="https://api.mercadopago.com/v1/orders";
const MP_ID=/^[A-Za-z0-9_-]{5,100}$/;
const IDEMPOTENCY=/^[A-Za-z0-9_-]{16,128}$/;
const jsonMime=/^application\/(?:[\w.+-]*\+)?json(?:;|$)/i;
function validateClient({token,merchantId,releaseApproved,fetchImpl,timeoutMs}){
 if(releaseApproved!==true)throw new MercadoPagoClientError("PAYMENTS_RELEASE_NOT_APPROVED");
 if(typeof token!=="string"||token.length<20||token.length>512||!token.startsWith("APP_USR-"))
  throw new MercadoPagoClientError("PAYMENT_TOKEN_NOT_CONFIGURED");
 if(!/^[0-9]{3,24}$/.test(String(merchantId||"")))
  throw new MercadoPagoClientError("MERCHANT_NOT_CONFIGURED");
 if(typeof fetchImpl!=="function")throw new MercadoPagoClientError("FETCH_NOT_CONFIGURED");
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>15000)
  throw new MercadoPagoClientError("INVALID_TIMEOUT");
}
async function providerRequest({token,fetchImpl,method,path,idempotencyKey=null,body=null,timeoutMs}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const headers={"Accept":"application/json","Authorization":"Bearer "+token};
  if(body!==null){
   headers["Content-Type"]="application/json";
   headers["X-Idempotency-Key"]=idempotencyKey;
  }
  // Only the fixed Mercado Pago API host is reachable. Do not allow redirects.
  const response=await fetchImpl(MP_BASE+path,{
   method,headers,body:body===null?undefined:JSON.stringify(body),
   redirect:"error",signal:controller.signal
  });
  if(!response||typeof response.status!=="number"||typeof response.text!=="function")
   throw new MercadoPagoClientError("INVALID_PROVIDER_RESPONSE",{retryable:true});
  if(response.status===429)throw new MercadoPagoClientError("PROVIDER_RATE_LIMIT",{retryable:true});
  if(response.status>=500)throw new MercadoPagoClientError("PROVIDER_UNAVAILABLE",{retryable:true});
  if(response.status<200||response.status>=300)
   throw new MercadoPagoClientError("PROVIDER_REJECTED_REQUEST");
  const length=Number(response.headers?.get?.("content-length")||0);
  if(length>131072)throw new MercadoPagoClientError("PROVIDER_RESPONSE_TOO_LARGE");
  if(!jsonMime.test(response.headers?.get?.("content-type")||""))
   throw new MercadoPagoClientError("PROVIDER_WRONG_CONTENT_TYPE");
  const raw=await response.text();
  if(raw.length>131072)throw new MercadoPagoClientError("PROVIDER_RESPONSE_TOO_LARGE");
  let data;
  try{data=JSON.parse(raw)}catch{throw new MercadoPagoClientError("PROVIDER_INVALID_JSON")}
  if(!data||typeof data!=="object"||Array.isArray(data))
   throw new MercadoPagoClientError("PROVIDER_INVALID_JSON");
  return data;
 }catch(error){
  if(error instanceof MercadoPagoClientError)throw error;
  throw new MercadoPagoClientError("PROVIDER_NETWORK_ERROR",{retryable:true});
 }finally{clearTimeout(timer)}
}
export async function createPixAtMercadoPago({
 orderId,totalCents,payer,idempotencyKey,token,merchantId,
 releaseApproved=false,fetchImpl=fetch,timeoutMs=8000
}={}){
 validateClient({token,merchantId,releaseApproved,fetchImpl,timeoutMs});
 if(typeof idempotencyKey!=="string"||!IDEMPOTENCY.test(idempotencyKey))
  throw new MercadoPagoClientError("INVALID_PAYMENT_IDEMPOTENCY");
 const body=createPixOrderPayload({orderId,totalCents,payer});
 const provider=await providerRequest({token,fetchImpl,method:"POST",path:"",
  idempotencyKey,body,timeoutMs});
 // Reject provider response that does not match the persisted local amount,
 // reference and merchant. This response alone never settles a payment.
 const verified=reconcilePixOrderResponse(provider,{orderId,totalCents,merchantId});
 return {provider_order_id:verified.provider_order_id,
  provider_payment_id:verified.payment_id,
  payment_status:verified.payment_status,approved:verified.approved,
  qr_code:verified.qr_code,ticket_url:verified.ticket_url};
}
export async function fetchVerifiedPixOrder({
 providerOrderId,orderId,totalCents,token,merchantId,
 releaseApproved=false,fetchImpl=fetch,timeoutMs=8000
}={}){
 validateClient({token,merchantId,releaseApproved,fetchImpl,timeoutMs});
 if(typeof providerOrderId!=="string"||!MP_ID.test(providerOrderId))
  throw new MercadoPagoClientError("INVALID_PROVIDER_ORDER_ID");
 const provider=await providerRequest({token,fetchImpl,method:"GET",
  path:"/"+encodeURIComponent(providerOrderId),timeoutMs});
 if(String(provider.id)!==providerOrderId)
  throw new MercadoPagoClientError("PROVIDER_ORDER_ID_MISMATCH");
 const result=reconcilePixOrderResponse(provider,{orderId,totalCents,merchantId});
 // Only GET verified status may be used downstream to approve payment.
 return {provider_order_id:result.provider_order_id,
  provider_payment_id:result.payment_id,payment_status:result.payment_status,
  approved:result.approved,amount_cents:result.amount_cents,
  reconciliation_verified:true};
}
