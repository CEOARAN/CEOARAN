/** iFood Shipping / On-Demand Off Platform — provider data validation only.
 * No API calls, no customer data collection and no driver dispatch in staging.
 * Source: https://developer.ifood.com.br/en-US/docs/food/guides/modules/shipping/outside
 */
export class IfoodValidationError extends Error {constructor(code){super(code);this.name="IfoodValidationError";this.code=code}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function realsToCents(value){
 const text=typeof value==="number"?String(value):value;
 if(typeof text!=="string"||!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(text))throw new IfoodValidationError("INVALID_DELIVERY_PRICE");
 const [whole,fraction=""]=text.split(".");
 return Number(whole)*100+Number(fraction.padEnd(2,"0"));
}
export function validateIfoodShippingQuote(raw,nowMs=Date.now()){
 if(!raw||typeof raw!=="object"||!UUID.test(raw.id||""))throw new IfoodValidationError("INVALID_QUOTE_ID");
 const expiry=Date.parse(raw.expirationAt);
 if(!Number.isFinite(expiry)||expiry<=nowMs+60_000)throw new IfoodValidationError("EXPIRED_QUOTE");
 if(!raw.quote||typeof raw.quote!=="object")throw new IfoodValidationError("QUOTE_MISSING");
 const price=realsToCents(raw.quote.netValue);
 if(price>500_000)throw new IfoodValidationError("DELIVERY_PRICE_OVER_LIMIT");
 if(!Number.isSafeInteger(raw.distance)||raw.distance<0||raw.distance>250_000)throw new IfoodValidationError("INVALID_DISTANCE");
 const min=raw.deliveryTime?.min,max=raw.deliveryTime?.max;
 if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<0||max<min||max>86_400)throw new IfoodValidationError("INVALID_DELIVERY_TIME");
 return{provider:"ifood",quote_id:raw.id,expires_at:new Date(expiry).toISOString(),merchant_fee_cents:price,distance_m:raw.distance,eta_min_s:min,eta_max_s:max};
}
export function validateIfoodTrackingUrl(raw){
 if(typeof raw!=="string"||raw.length>600)throw new IfoodValidationError("INVALID_TRACKING_URL");
 let u;try{u=new URL(raw)}catch{throw new IfoodValidationError("INVALID_TRACKING_URL")}
 if(u.protocol!=="https:"||u.hostname!=="meupedido.ifood.com.br"||u.port||u.username||u.password||u.hash||!UUID.test(u.pathname.slice(1))||u.pathname.split("/").length!==2)
   throw new IfoodValidationError("UNTRUSTED_TRACKING_URL");
 return u.href;
}
export function validateIfoodDispatchAcknowledgment(raw){
 if(!raw||!UUID.test(raw.id||""))throw new IfoodValidationError("INVALID_DELIVERY_ID");
 return{provider_delivery_id:raw.id,tracking_url:validateIfoodTrackingUrl(raw.trackingUrl),state:"requested"};
}
