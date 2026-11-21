/** Mercado Pago validation primitives — no network or payment action in staging. */
export class PaymentValidationError extends Error{constructor(code){super(code);this.name="PaymentValidationError";this.code=code}}
const encode=new TextEncoder();
function bytes(hex){if(!/^[0-9a-fA-F]{64}$/.test(hex))throw new PaymentValidationError("BAD_SIGNATURE");return Uint8Array.from(hex.match(/../g),x=>parseInt(x,16))}
function parseHeader(v){
 if(typeof v!=="string"||v.length>300)throw new PaymentValidationError("MISSING_SIGNATURE");
 const parts=v.split(",").map(x=>x.trim()),values={};
 for(const part of parts){const m=part.match(/^(ts|v1)=(.+)$/);if(m&&!Object.hasOwn(values,m[1]))values[m[1]]=m[2]}
 if(!values.ts||!values.v1||!/^\d{10,16}$/.test(values.ts))throw new PaymentValidationError("BAD_SIGNATURE_HEADER");
 return values;
}
export async function verifyMercadoPagoSignature({signature,requestId,dataId,secret,nowMs=Date.now(),maxAgeMs=7*86400_000}){
 if(typeof secret!=="string"||secret.length<10)throw new PaymentValidationError("SECRET_NOT_CONFIGURED");
 if(typeof requestId!=="string"||!requestId.length||requestId.length>200)throw new PaymentValidationError("BAD_REQUEST_ID");
 if(typeof dataId!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(dataId))throw new PaymentValidationError("BAD_DATA_ID");
 const {ts,v1}=parseHeader(signature),timestamp=Number(ts);
 if(!Number.isSafeInteger(timestamp)||timestamp>nowMs+300_000||nowMs-timestamp>maxAgeMs)throw new PaymentValidationError("STALE_SIGNATURE");
 // Per MP Webhooks documentation. Server must also query provider by ID and deduplicate events.
 const manifest="id:"+dataId.toLowerCase()+";request-id:"+requestId+";ts:"+ts+";";
 const key=await crypto.subtle.importKey("raw",encode.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 return crypto.subtle.verify("HMAC",key,bytes(v1),encode.encode(manifest));
}
export function parseBRLCents(value){
 const raw=typeof value==="number"?String(value):value;
 if(typeof raw!=="string"||!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(raw))throw new PaymentValidationError("INVALID_PAYMENT_AMOUNT");
 const [whole,fraction=""]=raw.split(".");
 const result=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 if(!Number.isSafeInteger(result))throw new PaymentValidationError("INVALID_PAYMENT_AMOUNT");
 return result;
}
export function reconcilePayment(provider,expected){
 if(!provider||typeof provider!=="object")throw new PaymentValidationError("INVALID_PAYMENT");
 if(String(provider.id)!==String(expected.paymentId)||String(provider.external_reference)!==String(expected.orderId))throw new PaymentValidationError("PAYMENT_REFERENCE_MISMATCH");
 if(provider.currency_id!=="BRL"||provider.payment_method_id!=="pix")throw new PaymentValidationError("PAYMENT_METHOD_MISMATCH");
 if(expected.collectorId!=null&&String(provider.collector_id)!==String(expected.collectorId))throw new PaymentValidationError("MERCHANT_MISMATCH");
 if(parseBRLCents(provider.transaction_amount)!==expected.amountCents)throw new PaymentValidationError("PAYMENT_AMOUNT_MISMATCH");
 return{approved:provider.status==="approved",status:provider.status,paymentId:String(provider.id),orderId:String(provider.external_reference)};
}
