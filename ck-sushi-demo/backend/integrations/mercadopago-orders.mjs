/**
 * New Mercado Pago Checkout Transparente Orders API (preferred over legacy Payments).
 * Pure builders and response validation; NEVER calls Mercado Pago, creates money or stores PII.
 * Official: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix
 */
export class MercadoPagoOrdersError extends Error {
  constructor(code){super(code);this.name="MercadoPagoOrdersError";this.code=code}
}
const ORDER_REF_RE=/^[A-Za-z0-9_-]{8,120}$/;
const PROVIDER_ID_RE=/^[A-Za-z0-9_-]{5,100}$/;
export function formatBRLCents(cents){
 if(!Number.isSafeInteger(cents)||cents<1||cents>2_000_000)throw new MercadoPagoOrdersError("INVALID_ORDER_AMOUNT");
 return Math.floor(cents/100)+"."+String(cents%100).padStart(2,"0");
}
export function parseMoneyCents(raw){
 if((typeof raw!=="string"&&typeof raw!=="number")||!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(String(raw)))throw new MercadoPagoOrdersError("INVALID_PROVIDER_AMOUNT");
 const [whole,fraction=""]=String(raw).split(".");
 const cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 if(!Number.isSafeInteger(cents))throw new MercadoPagoOrdersError("INVALID_PROVIDER_AMOUNT");
 return cents;
}
function validatePayer(payer){
 if(!payer||typeof payer!=="object"||Array.isArray(payer)||Object.keys(payer).some(k=>!["email","first_name"].includes(k)))throw new MercadoPagoOrdersError("INVALID_PAYER");
 if(typeof payer.email!=="string"||payer.email.length>254||!(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payer.email)))throw new MercadoPagoOrdersError("INVALID_PAYER_EMAIL");
 if(typeof payer.first_name!=="string"||payer.first_name.trim().length<2||payer.first_name.length>60)throw new MercadoPagoOrdersError("INVALID_PAYER_NAME");
 return {email:payer.email.toLowerCase().trim(),first_name:payer.first_name.trim()};
}
/** Must only receive totalCents derived from a persisted, verified, server-calculated order. */
export function createPixOrderPayload({orderId,totalCents,payer}){
 if(typeof orderId!=="string"||!ORDER_REF_RE.test(orderId))throw new MercadoPagoOrdersError("INVALID_REFERENCE");
 const amount=formatBRLCents(totalCents),safePayer=validatePayer(payer);
 return {
  type:"online",processing_mode:"automatic",external_reference:orderId,total_amount:amount,payer:safePayer,
  transactions:{payments:[{amount,payment_method:{id:"pix",type:"bank_transfer"}}]}
 };
}
function safeTicketUrl(raw){
 if(typeof raw!=="string"||raw.length>1500)return null;
 try{const u=new URL(raw);if(u.protocol!=="https:"||u.hostname!=="www.mercadopago.com.br"||u.username||u.password)return null;return u.href}catch{return null}
}
/** A webhook is NEVER enough to mark an order paid. Pass only a fresh GET /v1/orders/{id} response. */
export function reconcilePixOrderResponse(provider,{orderId,totalCents,merchantId}){
 if(!provider||typeof provider!=="object"||!ORDER_REF_RE.test(orderId)||
  !PROVIDER_ID_RE.test(String(provider.id||""))||provider.type!=="online"||
  provider.external_reference!==orderId)
    throw new MercadoPagoOrdersError("ORDER_REFERENCE_MISMATCH");
 if(!merchantId||String(provider.user_id)!==String(merchantId))
    throw new MercadoPagoOrdersError("MERCHANT_MISMATCH");
 if(parseMoneyCents(provider.total_amount)!==totalCents)
    throw new MercadoPagoOrdersError("AMOUNT_MISMATCH");
 const payments=provider.transactions?.payments;
 if(!Array.isArray(payments)||payments.length!==1)throw new MercadoPagoOrdersError("UNEXPECTED_PROVIDER_PAYMENTS");
 const payment=payments[0];
 if(payment.payment_method?.id!=="pix"||payment.payment_method?.type!=="bank_transfer")
    throw new MercadoPagoOrdersError("NOT_PIX_PAYMENT");
 if(parseMoneyCents(payment.amount)!==totalCents)
    throw new MercadoPagoOrdersError("PAYMENT_AMOUNT_MISMATCH");
 const accredited=PROVIDER_ID_RE.test(String(payment.id||""))&&
  provider.status==="processed"&&provider.status_detail==="accredited"&&
  payment.status==="processed"&&payment.status_detail==="accredited"&&
  parseMoneyCents(provider.total_paid_amount)===totalCents;
 return {
  provider_order_id:String(provider.id),payment_id:String(payment.id||""),
  external_reference:orderId,amount_cents:totalCents,
  payment_status:accredited?"approved":"pending",approved:accredited,
  qr_code:typeof payment.payment_method?.qr_code==="string"&&payment.payment_method.qr_code.length<=3000?
    payment.payment_method.qr_code:null,
  ticket_url:safeTicketUrl(payment.payment_method?.ticket_url),
  // Never expose full payer object, access token, merchant credentials or provider raw payload.
 };
}
