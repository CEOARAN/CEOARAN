/** HMAC-hashed idempotency tokens for future order/payment writes. */
export class IdempotencyError extends Error{constructor(code){super(code);this.name="IdempotencyError";this.code=code}}
export async function deriveIdempotencyHash({scope,key,secret}){
 if(!["orders","payments","refunds","deliveries"].includes(scope))throw new IdempotencyError("INVALID_SCOPE");
 if(typeof key!=="string"||key.length<16||key.length>128||!/^[A-Za-z0-9_-]+$/.test(key))throw new IdempotencyError("INVALID_KEY");
 if(typeof secret!=="string"||secret.length<32)throw new IdempotencyError("SECRET_NOT_CONFIGURED");
 const data=new TextEncoder(),cryptoKey=await crypto.subtle.importKey("raw",data.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",cryptoKey,data.encode("CKSUSHI:idem:v1:"+scope+":"+key)));
 return Array.from(signature,b=>b.toString(16).padStart(2,"0")).join("");
}


/**
 * Canonical order request fingerprint, HMAC rather than plain SHA-256 so
 * phone/name are not vulnerable to low-entropy dictionary attacks.
 * Never log the request or return the fingerprint to a customer.
 */
export async function deriveOrderRequestFingerprint({cart,customer,secret}={}){
 if(typeof secret!=="string"||secret.length<32)throw new IdempotencyError("SECRET_NOT_CONFIGURED");
 if(!cart||!Array.isArray(cart.items)||!["pickup","delivery"].includes(cart.fulfillment)||
    !customer||typeof customer!=="object"||Array.isArray(customer))
  throw new IdempotencyError("INVALID_REQUEST_FINGERPRINT");
 // The parser and customer normalizer must already have validated data.
 const canonical=JSON.stringify({
  fulfillment:cart.fulfillment,
  items:[...cart.items].sort((a,b)=>a.product_id.localeCompare(b.product_id)).map(x=>[x.product_id,x.quantity]),
  customer:{name:customer.name,phone:customer.phone,address:customer.address??null}
 });
 if(canonical.length>6000)throw new IdempotencyError("INVALID_REQUEST_FINGERPRINT");
 const enc=new TextEncoder(),key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode("CKSUSHI:order-request:v1:"+canonical)));
 return Array.from(signature,b=>b.toString(16).padStart(2,"0")).join("");
}
