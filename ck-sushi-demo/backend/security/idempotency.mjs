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
