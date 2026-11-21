/**
 * Receives a simulated/sandbox Mercado Pago Orders API notification.
 * Security: only test mode; no payment state change, no PII/body persistence, no outbound calls.
 * Inbound signature is HMAC-verified before any D1 write.
 */
export class MercadoPagoWebhookError extends Error {
 constructor(code,status=400){super(code);this.name="MercadoPagoWebhookError";this.code=code;this.status=status}
}
const testOrderID=/^[A-Za-z0-9_-]{8,110}$/;
const testAppID=/^[A-Za-z0-9_-]{4,100}$/;
const digest=async value=>{
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
};
export async function validateMercadoPagoTestWebhook({url,headers,body,webhookSecret,applicationId,verifySignature,nowMs=Date.now()}){
 const parsed=new URL(url);
 if(parsed.searchParams.get("type")!=="order")throw new MercadoPagoWebhookError("UNEXPECTED_EVENT_TYPE");
 const dataId=parsed.searchParams.get("data.id");
 const requestId=headers.get("x-request-id"),signature=headers.get("x-signature");
 if(!testOrderID.test(dataId||"")||typeof requestId!=="string"||requestId.length<10||requestId.length>200||
  typeof signature!=="string"||signature.length>300)throw new MercadoPagoWebhookError("INVALID_WEBHOOK_HEADERS",401);
 if(!testAppID.test(String(applicationId||""))||typeof webhookSecret!=="string"||webhookSecret.length<12||
  typeof verifySignature!=="function")throw new MercadoPagoWebhookError("WEBHOOK_NOT_CONFIGURED",503);
 if(!body||typeof body!=="object"||Array.isArray(body)||body.type!=="order"||
  body.live_mode!==false||String(body.application_id)!==String(applicationId)||
  String(body.data?.id)!==dataId)throw new MercadoPagoWebhookError("WEBHOOK_EVENT_MISMATCH",403);
 let isValid=false;
 try{isValid=await verifySignature({signature,requestId,dataId,secret:webhookSecret,nowMs,maxAgeMs:600_000})}catch{}
 if(isValid!==true)throw new MercadoPagoWebhookError("INVALID_WEBHOOK_SIGNATURE",401);
 return {
  // Hash only short identifiers and a constant domain; never store raw event payload or payer data.
  replayHash:await digest("CKSUSHI:MP:ORDERS:TEST:v1:"+applicationId+":"+dataId+":"+requestId),
  expiresAt:new Date(nowMs+86_400_000).toISOString(),
 };
}
export async function recordMercadoPagoTestWebhook(db,validated){
 if(!db||typeof db.prepare!=="function"||!validated||!(/^[a-f0-9]{64}$/.test(validated.replayHash)))
  throw new MercadoPagoWebhookError("WEBHOOK_RECORD_INVALID",503);
 const res=await db.prepare(String.raw`INSERT OR IGNORE INTO commerce_webhook_replay_guard(provider,event_key_hash,expires_at) VALUES('mercadopago-test',?,?)`).bind(validated.replayHash,validated.expiresAt).run();
 return {ok:true,received:true,duplicate:res.meta?.changes===0,processed:false,environment:"staging"};
}
