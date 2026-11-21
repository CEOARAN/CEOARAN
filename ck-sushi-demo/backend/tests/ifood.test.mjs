import test from "node:test";
import assert from "node:assert/strict";
import {IfoodValidationError,validateIfoodShippingQuote,validateIfoodTrackingUrl,validateIfoodDispatchAcknowledgment} from "../integrations/ifood.mjs";
const orderId="522e4d7e-0ce1-44f3-8cc7-73a9f190a5e8",quoteId="57cd1046-2e06-446f-a2dd-18a518212c3c";
test("iFood external shipping quote uses provider-confirmed price in cents",()=>{
 const input={id:quoteId,expirationAt:new Date(Date.now()+3600_000).toISOString(),quote:{netValue:5.99},distance:3100,deliveryTime:{min:1100,max:1800}};
 const actual=validateIfoodShippingQuote(input);
 assert.equal(actual.merchant_fee_cents,599);
 assert.equal(actual.quote_id,quoteId);
 assert.equal(actual.distance_m,3100);
});
test("iFood shipping cannot use expired quote or invalid charge",()=>{
 const input={id:quoteId,expirationAt:new Date(Date.now()+3600_000).toISOString(),quote:{netValue:5.99},distance:3100,deliveryTime:{min:1100,max:1800}};
 assert.throws(()=>validateIfoodShippingQuote({...input,expirationAt:new Date(Date.now()-1000).toISOString()}),e=>e.code==="EXPIRED_QUOTE");
 assert.throws(()=>validateIfoodShippingQuote({...input,quote:{netValue:5.999}}),e=>e.code==="INVALID_DELIVERY_PRICE");
});
test("iFood official tracking domain and delivery ID are mandatory",()=>{
 const valid="https://meupedido.ifood.com.br/"+orderId;
 assert.equal(validateIfoodTrackingUrl(valid),valid);
 assert.deepEqual(validateIfoodDispatchAcknowledgment({id:orderId,trackingUrl:valid}),{provider_delivery_id:orderId,tracking_url:valid,state:"requested"});
 assert.throws(()=>validateIfoodTrackingUrl("https://meupedido.ifood.com.br.attacker.example/"+orderId),e=>e.code==="UNTRUSTED_TRACKING_URL");
 assert.throws(()=>validateIfoodTrackingUrl("http://meupedido.ifood.com.br/"+orderId),e=>e.code==="UNTRUSTED_TRACKING_URL");
});
