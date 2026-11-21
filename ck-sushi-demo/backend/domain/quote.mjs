/** Pure server-side pricing. Browser-supplied monetary fields are rejected. */
export class CheckoutValidationError extends Error {
 constructor(code,status=422){super(code);this.name="CheckoutValidationError";this.code=code;this.status=status}
}
const SKU_RE=/^[A-Za-z0-9_-]{3,90}$/;
const MAX_ITEMS=30,MAX_QTY=20,MAX_UNITS=80,MAX_TOTAL=2_000_000;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype}
export function parseQuoteRequest(body){
 if(!obj(body)||Object.keys(body).some(k=>!["items","fulfillment"].includes(k)))throw new CheckoutValidationError("INVALID_QUOTE_PAYLOAD");
 if(!["pickup","delivery"].includes(body.fulfillment))throw new CheckoutValidationError("INVALID_FULFILLMENT");
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>MAX_ITEMS)throw new CheckoutValidationError("INVALID_ITEM_COUNT");
 let count=0;const ids=new Set();
 const items=body.items.map(v=>{
   if(!obj(v)||Object.keys(v).some(k=>!["product_id","quantity"].includes(k))||typeof v.product_id!=="string"||!SKU_RE.test(v.product_id)||!Number.isInteger(v.quantity)||v.quantity<1||v.quantity>MAX_QTY)throw new CheckoutValidationError("INVALID_CART_ITEM");
   if(ids.has(v.product_id))throw new CheckoutValidationError("DUPLICATED_PRODUCT");
   ids.add(v.product_id);count+=v.quantity;return{product_id:v.product_id,quantity:v.quantity}
 });
 if(count>MAX_UNITS)throw new CheckoutValidationError("TOO_MANY_UNITS");
 return{items,fulfillment:body.fulfillment};
}
export function computeQuote(cart,rows,{deliveryFeeCents=null,minimumOrderCents=0}={}){
 if(!Number.isSafeInteger(minimumOrderCents)||minimumOrderCents<0)throw new CheckoutValidationError("INVALID_STORE_CONFIG",503);
 const found=new Map(rows.map(v=>[v.id,v]));let subtotal=0;
 const lines=cart.items.map(x=>{
  const p=found.get(x.product_id);
  if(!p||p.is_available!==1||p.is_published!==1)throw new CheckoutValidationError("PRODUCT_UNAVAILABLE",409);
  if(!Number.isSafeInteger(p.price_cents)||p.price_cents<0||p.price_cents>100_000_000)throw new CheckoutValidationError("CATALOG_PRICE_INVALID",503);
  const amount=p.price_cents*x.quantity;if(!Number.isSafeInteger(amount))throw new CheckoutValidationError("TOTAL_OVERFLOW");
  subtotal+=amount;if(subtotal>MAX_TOTAL)throw new CheckoutValidationError("ORDER_LIMIT_EXCEEDED");
  return{product_id:p.id,name:p.name,unit_price_cents:p.price_cents,quantity:x.quantity,line_total_cents:amount};
 });
 const needsDelivery=cart.fulfillment==="delivery"&&deliveryFeeCents===null;
 const fee=cart.fulfillment==="pickup"?0:deliveryFeeCents;
 if(fee!==null&&(!Number.isSafeInteger(fee)||fee<0||fee>500000))throw new CheckoutValidationError("INVALID_DELIVERY_QUOTE",503);
 const total=needsDelivery?null:subtotal+fee;
 if(total!==null&&total>MAX_TOTAL)throw new CheckoutValidationError("ORDER_LIMIT_EXCEEDED");
 const minMet=subtotal>=minimumOrderCents;
 return{currency:"BRL",items:lines,fulfillment:cart.fulfillment,subtotal_cents:subtotal,discount_cents:0,delivery_fee_cents:needsDelivery?null:fee,total_cents:total,minimum_order_cents:minimumOrderCents,minimum_order_met:minMet,delivery_quote_required:needsDelivery,can_place_order:false,can_pay:false,environment:"staging",expires_in_seconds:0,reason:needsDelivery?"DELIVERY_QUOTE_REQUIRED":!minMet?"MINIMUM_ORDER_NOT_MET":"CHECKOUT_NOT_ENABLED"};
}
