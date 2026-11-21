import test from "node:test";
import assert from "node:assert/strict";
import {parseQuoteRequest,computeQuote,CheckoutValidationError} from "../domain/quote.mjs";
import {validateTransition,OrderTransitionError} from "../domain/order-machine.mjs";
import {verifyMercadoPagoSignature,parseBRLCents,reconcilePayment,PaymentValidationError} from "../integrations/mercadopago.mjs";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const P={id:"CK-SRC-005",name:"Produto teste",price_cents:3590,is_published:1,is_available:1};
const cart={items:[{product_id:P.id,quantity:2}],fulfillment:"pickup"};
const assertCode=(fn,code)=>assert.throws(fn,e=>e.code===code);
test("server-side quote ignores no browser prices; rejects extra price field",()=>{
 assertCode(()=>parseQuoteRequest({...cart,total_cents:1}),"INVALID_QUOTE_PAYLOAD");
 assertCode(()=>parseQuoteRequest({items:[{...cart.items[0],unit_price_cents:1}],fulfillment:"pickup"}),"INVALID_CART_ITEM");
});
test("cart quantity, duplicate, shape and max limits",()=>{
 assertCode(()=>parseQuoteRequest({items:[cart.items[0],cart.items[0]],fulfillment:"pickup"}),"DUPLICATED_PRODUCT");
 assertCode(()=>parseQuoteRequest({items:[{product_id:P.id,quantity:0}],fulfillment:"pickup"}),"INVALID_CART_ITEM");
 assertCode(()=>parseQuoteRequest({items:[{product_id:P.id,quantity:21}],fulfillment:"pickup"}),"INVALID_CART_ITEM");
 assertCode(()=>parseQuoteRequest({items:[],fulfillment:"pickup"}),"INVALID_ITEM_COUNT");
 assertCode(()=>parseQuoteRequest({...cart,fulfillment:"drone"}),"INVALID_FULFILLMENT");
});
test("correct integer money calculation and no order enablement",()=>{
 const q=computeQuote(parseQuoteRequest(cart),[P]);assert.equal(q.subtotal_cents,7180);assert.equal(q.total_cents,7180);
 assert.equal(q.delivery_fee_cents,0);assert.equal(q.can_pay,false);assert.equal(q.reason,"CHECKOUT_NOT_ENABLED");
});
test("shipping is never invented",()=>{
 const q=computeQuote(parseQuoteRequest({...cart,fulfillment:"delivery"}),[P]);
 assert.equal(q.total_cents,null);assert.equal(q.delivery_quote_required,true);assert.equal(q.reason,"DELIVERY_QUOTE_REQUIRED");
});
test("unavailable products and excessive totals rejected",()=>{
 assertCode(()=>computeQuote(parseQuoteRequest(cart),[{...P,is_available:0}]),"PRODUCT_UNAVAILABLE");
 assertCode(()=>computeQuote(parseQuoteRequest(cart),[]),"PRODUCT_UNAVAILABLE");
 const large={...P,price_cents:1_200_000};assertCode(()=>computeQuote(parseQuoteRequest(cart),[large]),"ORDER_LIMIT_EXCEEDED");
});
test("order transition only from trusted actors and paid orders",()=>{
 assert.deepEqual(validateTransition({from:"pending_payment",to:"paid",actor:"payment_provider",paymentStatus:"approved",fulfillment:"delivery"}),{from:"pending_payment",to:"paid",actor:"payment_provider"});
 assertCode(()=>validateTransition({from:"pending_payment",to:"paid",actor:"store",paymentStatus:"approved",fulfillment:"delivery"}),"PAYMENT_NOT_CONFIRMED");
 assertCode(()=>validateTransition({from:"ready",to:"courier_assigned",actor:"store",paymentStatus:"approved",fulfillment:"delivery"}),"ILLEGAL_ORDER_TRANSITION");
 assertCode(()=>validateTransition({from:"ready",to:"awaiting_courier",actor:"store",paymentStatus:"approved",fulfillment:"pickup"}),"COURIER_NOT_ALLOWED_FOR_PICKUP");
 assertCode(()=>validateTransition({from:"paid",to:"preparing",actor:"store",paymentStatus:"approved",fulfillment:"pickup"}),"ILLEGAL_ORDER_TRANSITION");
 assertCode(()=>validateTransition({from:"refund_pending",to:"refunded",actor:"store",paymentStatus:"approved",fulfillment:"pickup"}),"REFUND_NOT_VERIFIED");
});
test("only store advances kitchen and courier provider advances delivery",()=>{
 assertCode(()=>validateTransition({from:"paid",to:"accepted",actor:"payment_provider",paymentStatus:"approved",fulfillment:"delivery"}),"STORE_ACTION_REQUIRED");
 assertCode(()=>validateTransition({from:"awaiting_courier",to:"courier_assigned",actor:"store",paymentStatus:"approved",fulfillment:"delivery"}),"LOGISTICS_ACTION_REQUIRED");
 assertCode(()=>validateTransition({from:"courier_assigned",to:"picked_up",actor:"store",paymentStatus:"approved",fulfillment:"delivery"}),"DELIVERY_REQUIRES_COURIER");
 assertCode(()=>validateTransition({from:"picked_up",to:"delivered",actor:"logistics_provider",paymentStatus:"approved",fulfillment:"pickup"}),"DELIVERY_PROVIDER_CONFIRMATION_REQUIRED");
 assert.deepEqual(validateTransition({from:"ready",to:"picked_up",actor:"store",paymentStatus:"approved",fulfillment:"pickup"}),{from:"ready",to:"picked_up",actor:"store"});
});
test("monetary validation and exact reference/merchant checks",()=>{
 assert.equal(parseBRLCents("109.90"),10990);assert.equal(parseBRLCents(19.9),1990);
 assertCode(()=>parseBRLCents("1.999"),"INVALID_PAYMENT_AMOUNT");
 assertCode(()=>reconcilePayment({id:"333",external_reference:"o1",currency_id:"BRL",payment_method_id:"pix",collector_id:"44",transaction_amount:99,status:"approved"},{paymentId:"333",orderId:"o1",collectorId:"44",amountCents:10000}),"PAYMENT_AMOUNT_MISMATCH");
 const expected={paymentId:"333",orderId:"o1",collectorId:"44",amountCents:10000};
 assert.equal(reconcilePayment({id:"333",external_reference:"o1",currency_id:"BRL",payment_method_id:"pix",collector_id:"44",transaction_amount:"100.00",status:"approved"},expected).approved,true);
 assertCode(()=>reconcilePayment({id:"333",external_reference:"other",currency_id:"BRL",payment_method_id:"pix",collector_id:"44",transaction_amount:100,status:"approved"},expected),"PAYMENT_REFERENCE_MISMATCH");
});
test("Mercado Pago webhook HMAC signature and stale verification",async()=>{
 const secret="not_a_real_mercado_pago_secret",id="Pay12",requestId="r-123",ts=String(Date.now());
 const manifest="id:pay12;request-id:r-123;ts:"+ts+";";
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(manifest)));
 const hex=Array.from(signature,b=>b.toString(16).padStart(2,"0")).join("");
 const params={signature:"ts="+ts+",v1="+hex,requestId,dataId:id,secret};
 assert.equal(await verifyMercadoPagoSignature(params),true);
 assert.equal(await verifyMercadoPagoSignature({...params,dataId:"other"}),false);
 await assert.rejects(()=>verifyMercadoPagoSignature({...params,nowMs:Number(ts)+9*86400_000}),e=>e.code==="STALE_SIGNATURE");
});


test("Mercado Pago 10-digit timestamp in seconds is signed correctly",async()=>{
 const secret="not_a_real_mercado_pago_secret",dataId="12345",requestId="secure-test",ts=String(Math.floor(Date.now()/1000));
 const manifest="id:12345;request-id:secure-test;ts:"+ts+";";
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(manifest)));
 const hex=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
 const p={signature:"ts="+ts+",v1="+hex,requestId,dataId,secret};
 assert.equal(await verifyMercadoPagoSignature(p),true);
 await assert.rejects(()=>verifyMercadoPagoSignature({...p,nowMs:Date.now()+3600_000}),e=>e.code==="STALE_SIGNATURE");
});
