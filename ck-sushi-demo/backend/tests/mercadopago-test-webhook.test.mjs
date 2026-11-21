import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {verifyMercadoPagoSignature} from "../integrations/mercadopago.mjs";
import {validateMercadoPagoTestWebhook,recordMercadoPagoTestWebhook} from "../integrations/mercadopago-test-webhook.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret="test-webhook-secret-only-not-for-production";
const applicationId="7255333517291496",dataId="ORD01M28P44G5FG8RJPM579EH56FV",requestId="bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
const url="https://ck-sushi-backend-staging.ceoaran-dev.workers.dev/api/webhooks/mercadopago/test?type=order&data.id="+dataId;
const event={application_id:applicationId,type:"order",live_mode:false,data:{id:dataId},action:"order.processed"};
async function headersFor(now=Date.now()){
 const ts=String(Math.floor(now/1000));
 const manifest="id:"+dataId.toLowerCase()+";request-id:"+requestId+";ts:"+ts+";";
 const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(manifest)));
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
 return new Headers({"x-request-id":requestId,"x-signature":"ts="+ts+",v1="+hex});
}
test("signed test-order webhook accepted without storing original body",async()=>{
 const verified=await validateMercadoPagoTestWebhook({url,headers:await headersFor(),body:event,webhookSecret:secret,applicationId,verifySignature:verifyMercadoPagoSignature});
 assert.match(verified.replayHash,/^[a-f0-9]{64}$/);assert(!verified.replayHash.includes(dataId));
 const stub={prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})};
 assert.deepEqual(await recordMercadoPagoTestWebhook(stub,verified),{ok:true,received:true,duplicate:false,processed:false,environment:"staging"});
});
test("duplicate sandbox webhook is acknowledged but not processed",async()=>{
 const result=await recordMercadoPagoTestWebhook({prepare:()=>({bind:()=>({run:async()=>({meta:{changes:0}})})})},{replayHash:"a".repeat(64),expiresAt:new Date().toISOString()});
 assert.equal(result.duplicate,true);assert.equal(result.processed,false);
});
test("production-mode webhook is rejected in staging",async()=>{
 await assert.rejects(()=>validateMercadoPagoTestWebhook({url,headers:await headersFor(),body:{...event,live_mode:true},webhookSecret:secret,applicationId,verifySignature:verifyMercadoPagoSignature}),e=>e.code==="WEBHOOK_EVENT_MISMATCH");
});
test("different application and source identity are rejected",async()=>{
 await assert.rejects(()=>validateMercadoPagoTestWebhook({url,headers:await headersFor(),body:{...event,application_id:"wrong-app"},webhookSecret:secret,applicationId,verifySignature:verifyMercadoPagoSignature}),e=>e.code==="WEBHOOK_EVENT_MISMATCH");
 await assert.rejects(()=>validateMercadoPagoTestWebhook({url,headers:await headersFor(),body:event,webhookSecret:"different-test-secret!",applicationId,verifySignature:verifyMercadoPagoSignature}),e=>e.code==="INVALID_WEBHOOK_SIGNATURE");
});
test("malformed data id, missing credentials or wrong topic are rejected",async()=>{
 await assert.rejects(()=>validateMercadoPagoTestWebhook({url:url.replace("type=order","type=payment"),headers:await headersFor(),body:event,webhookSecret:secret,applicationId,verifySignature:verifyMercadoPagoSignature}),e=>e.code==="UNEXPECTED_EVENT_TYPE");
 await assert.rejects(()=>validateMercadoPagoTestWebhook({url,headers:await headersFor(),body:event,webhookSecret:undefined,applicationId,verifySignature:verifyMercadoPagoSignature}),e=>e.code==="WEBHOOK_NOT_CONFIGURED");
});
