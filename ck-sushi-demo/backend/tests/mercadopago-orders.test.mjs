import test from "node:test";
import assert from "node:assert/strict";
import {
 createPixOrderPayload,reconcilePixOrderResponse,formatBRLCents,parseMoneyCents
} from "../integrations/mercadopago-orders.mjs";
const orderId="CK-ORDER-TEST-001",merchantId="1234567890",amount=5090;
const payer={email:"tester@example.test",first_name:"Pessoa"};
const provider={
 id:"ORD01TEST12345",type:"online",external_reference:orderId,user_id:merchantId,
 total_amount:"50.90",total_paid_amount:"50.90",status:"processed",status_detail:"accredited",
 transactions:{payments:[{id:"PAY01TEST12345",amount:"50.90",status:"processed",status_detail:"accredited",payment_method:{id:"pix",type:"bank_transfer",qr_code:"000201FAKE",ticket_url:"https://www.mercadopago.com.br/sandbox/payments/demo"}}]}
};
test("Orders API Pix payload uses server-cents, correct payment method and no secrets",()=>{
 const payload=createPixOrderPayload({orderId,totalCents:amount,payer});
 assert.equal(payload.total_amount,"50.90");assert.equal(payload.processing_mode,"automatic");assert.equal(payload.transactions.payments[0].amount,"50.90");
 assert.equal(payload.transactions.payments[0].payment_method.type,"bank_transfer");
 assert.equal(payload.payer.email,"tester@example.test");
 assert.deepEqual(Object.keys(payload),["type","processing_mode","external_reference","total_amount","payer","transactions"]);
 assert.equal(formatBRLCents(1),"0.01");
 assert.equal(parseMoneyCents("50.90"),amount);
});
test("Orders API rejects browser-supplied fake extras and invalid values",()=>{
 assert.throws(()=>createPixOrderPayload({orderId,totalCents:50.911,payer}),e=>e.code==="INVALID_ORDER_AMOUNT");
 assert.throws(()=>createPixOrderPayload({orderId,totalCents:amount,payer:{...payer,document:"111"}}),e=>e.code==="INVALID_PAYER");
 assert.throws(()=>createPixOrderPayload({orderId:"a",totalCents:amount,payer}),e=>e.code==="INVALID_REFERENCE");
});
test("merchant, reference and amounts are reconciled against authenticated server context",()=>{
 assert.throws(()=>reconcilePixOrderResponse({...provider,user_id:"other"},{orderId,totalCents:amount,merchantId}),e=>e.code==="MERCHANT_MISMATCH");
 assert.throws(()=>reconcilePixOrderResponse({...provider,total_amount:"50.00"},{orderId,totalCents:amount,merchantId}),e=>e.code==="AMOUNT_MISMATCH");
 assert.throws(()=>reconcilePixOrderResponse({...provider,external_reference:"CK-OTHER-ORDER"},{orderId,totalCents:amount,merchantId}),e=>e.code==="ORDER_REFERENCE_MISMATCH");
});
test("provider pending and approved payments are distinct; QR never marks paid",()=>{
 const context={orderId,totalCents:amount,merchantId};
 assert.equal(reconcilePixOrderResponse(provider,context).approved,true);
 assert.equal(reconcilePixOrderResponse({...provider,status:"action_required",status_detail:"waiting_transfer",total_paid_amount:"0.00",transactions:{payments:[{...provider.transactions.payments[0],status:"action_required",status_detail:"waiting_transfer"}]}},context).approved,false);
 assert.equal(reconcilePixOrderResponse({...provider,transactions:{payments:[{...provider.transactions.payments[0],id:null}]}},context).approved,false);
});
test("Pix response restricts ticket domain",()=>{
 const result=reconcilePixOrderResponse({...provider,transactions:{payments:[{...provider.transactions.payments[0],payment_method:{...provider.transactions.payments[0].payment_method,ticket_url:"https://www.mercadopago.com.br.fake.example/steal"}}]}},{orderId,totalCents:amount,merchantId});
 assert.equal(result.ticket_url,null);
});
