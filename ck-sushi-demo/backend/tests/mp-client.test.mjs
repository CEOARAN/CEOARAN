import test from "node:test";
import assert from "node:assert/strict";
import {createPixAtMercadoPago,fetchVerifiedPixOrder} from "../integrations/mercadopago-client.mjs";

const orderId="CK-ORDER-PIXTST-000001",totalCents=5090,merchantId="1234567890",
 token="APP_USR-this-is-a-synthetic-test-token",idempotencyKey="CKSUSHI_MP_1234567890";
const pending={
 id:"ORD01TEST12345",type:"online",external_reference:orderId,
 total_amount:"50.90",status:"action_required",status_detail:"waiting_transfer",
 transactions:{payments:[{id:"PAY01TEST12345",amount:"50.90",status:"action_required",status_detail:"waiting_transfer",
  payment_method:{id:"pix",type:"bank_transfer",qr_code:"000201PIXTEST",ticket_url:"https://www.mercadopago.com.br/sandbox/payments/000123"}}]}
};
const approved={...pending,status:"processed",status_detail:"accredited",total_paid_amount:"50.90",
 transactions:{payments:[{...pending.transactions.payments[0],status:"processed",status_detail:"accredited"}]}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
function fakeClient(provider=pending,profile={id:merchantId}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method,redirect:options.redirect,headers:options.headers,body:options.body});
  if(url.endsWith("/users/me"))return response(profile);
  return response(provider);
 };
 return {fetchImpl,calls};
}
test("create Pix verifies merchant before making the payment request",async()=>{
 const c=fakeClient();
 const r=await createPixAtMercadoPago({orderId,totalCents,merchantId,
  payer:{email:"buyer@example.com",first_name:"Comprador"},idempotencyKey,
  token,releaseApproved:true,fetchImpl:c.fetchImpl});
 assert.equal(c.calls.length,2);
 assert.equal(c.calls[0].url,"https://api.mercadopago.com/users/me");
 assert.equal(c.calls[1].url,"https://api.mercadopago.com/v1/orders");
 assert.equal(c.calls[1].headers["X-Idempotency-Key"],idempotencyKey);
 assert.equal(c.calls[1].redirect,"error");
 const payload=JSON.parse(c.calls[1].body);
 assert.equal(payload.processing_mode,"automatic");
 assert.equal(payload.external_reference,orderId);
 assert.equal(payload.total_amount,"50.90");
 assert.equal(r.approved,false);
 assert.equal(r.ticket_url,"https://www.mercadopago.com.br/sandbox/payments/000123");
 assert(!JSON.stringify(r).includes(token));
 assert(!JSON.stringify(r).includes("buyer@example.com"));
});
test("invalid merchant identity fails before any POST",async()=>{
 const c=fakeClient(pending,{id:"999999999"});
 await assert.rejects(createPixAtMercadoPago({orderId,totalCents,merchantId,
  payer:{email:"buyer@example.com",first_name:"Comprador"},idempotencyKey,
  token,releaseApproved:true,fetchImpl:c.fetchImpl}),e=>e.code==="MERCHANT_IDENTITY_MISMATCH");
 assert.equal(c.calls.length,1);
 assert.equal(c.calls[0].method,"GET");
});
test("no release approval means no provider requests",async()=>{
 const c=fakeClient();
 await assert.rejects(createPixAtMercadoPago({orderId,totalCents,merchantId,
  payer:{email:"buyer@example.com",first_name:"Comprador"},idempotencyKey,
  token,releaseApproved:false,fetchImpl:c.fetchImpl}),e=>e.code==="PAYMENTS_RELEASE_NOT_APPROVED");
 assert.equal(c.calls.length,0);
});
test("fresh provider GET must match order, amount, payment and merchant",async()=>{
 const c=fakeClient(approved);
 const r=await fetchVerifiedPixOrder({providerOrderId:approved.id,orderId,
  totalCents,merchantId,token,releaseApproved:true,fetchImpl:c.fetchImpl});
 assert.equal(r.approved,true);
 assert.equal(r.reconciliation_verified,true);
 assert.equal(r.amount_cents,totalCents);
 assert.equal(c.calls.at(-1).url,"https://api.mercadopago.com/v1/orders/"+approved.id);
 const wrong=fakeClient({...approved,external_reference:"CK-OTHER-ORDER"});
 await assert.rejects(fetchVerifiedPixOrder({providerOrderId:approved.id,orderId,totalCents,merchantId,
  token,releaseApproved:true,fetchImpl:wrong.fetchImpl}),e=>e.code==="ORDER_REFERENCE_MISMATCH");
});
test("provider 429/500 are retryable, malformed JSON is never trusted",async()=>{
 const fetchImpl=async(url)=>url.endsWith("/users/me")?response({id:merchantId}):response({error:"busy"},429);
 await assert.rejects(createPixAtMercadoPago({orderId,totalCents,merchantId,
  payer:{email:"buyer@example.com",first_name:"Comprador"},idempotencyKey,
  token,releaseApproved:true,fetchImpl}),e=>e.code==="PROVIDER_RATE_LIMIT"&&e.retryable===true);
 const invalid=async(url)=>url.endsWith("/users/me")?response({id:merchantId}):
  new Response("not json",{status:200,headers:{"content-type":"application/json"}});
 await assert.rejects(fetchVerifiedPixOrder({providerOrderId:pending.id,orderId,totalCents,
  merchantId,token,releaseApproved:true,fetchImpl:invalid}),e=>e.code==="PROVIDER_INVALID_JSON");
});
