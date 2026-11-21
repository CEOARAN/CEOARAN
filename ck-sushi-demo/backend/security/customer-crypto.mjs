/**
 * Data minimization and AES-256-GCM encryption for authorized real orders ONLY.
 * The staging API never invokes this module to accept customer information.
 * The AES key must come from a secret binding (32 random bytes, base64).
 */
export class CustomerCryptoError extends Error{constructor(code){super(code);this.name="CustomerCryptoError";this.code=code}}
const customerEncoder=new TextEncoder(),customerDecoder=new TextDecoder("utf-8",{fatal:true});
function fromB64(b){if(typeof b!=="string"||!/^[a-zA-Z0-9+/_=-]{20,120}$/.test(b))throw new CustomerCryptoError("INVALID_KEY");try{return Uint8Array.from(atob(b.replace(/-/g,"+").replace(/_/g,"/")),x=>x.charCodeAt(0))}catch{throw new CustomerCryptoError("INVALID_KEY")}}
function toURL(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
async function getKey(secret){const bytes=fromB64(secret);if(bytes.length!==32)throw new CustomerCryptoError("INVALID_KEY_LENGTH");return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
function contextFor(orderId){if(typeof orderId!=="string"||!/^[A-Za-z0-9_-]{4,100}$/.test(orderId))throw new CustomerCryptoError("INVALID_ORDER_ID");return customerEncoder.encode("CKSUSHI:customer:v1:"+orderId)}
function sanitizeCustomer(v){
 if(!v||typeof v!=="object"||Array.isArray(v))throw new CustomerCryptoError("INVALID_CUSTOMER");
 if(Object.keys(v).some(k=>!["name","phone","address"].includes(k)))throw new CustomerCryptoError("EXCESS_DATA");
 if(typeof v.name!=="string"||v.name.trim().length<2||v.name.length>120)throw new CustomerCryptoError("INVALID_NAME");
 if(typeof v.phone!=="string"||!/^\+?[0-9()\-\s]{10,22}$/.test(v.phone))throw new CustomerCryptoError("INVALID_PHONE");
 let address=null;
 if(v.address!==null&&v.address!==undefined){
  if(!v.address||typeof v.address!=="object"||Array.isArray(v.address))throw new CustomerCryptoError("INVALID_ADDRESS");
  if(Object.keys(v.address).some(k=>!["street","number","district","city","postalCode","complement"].includes(k)))throw new CustomerCryptoError("EXCESS_ADDRESS_DATA");
  address={};
  for(const [k,val] of Object.entries(v.address)){
   if(typeof val!=="string"||val.length>150)throw new CustomerCryptoError("INVALID_ADDRESS_FIELD");
   address[k]=val.trim();
  }
 }
 return{name:v.name.trim(),phone:v.phone.trim(),address};
}
export async function encryptCustomerForOrder({orderId,customer,secret}){
 const normalized=sanitizeCustomer(customer),plaintext=customerEncoder.encode(JSON.stringify(normalized));
 if(plaintext.length>3000)throw new CustomerCryptoError("CUSTOMER_PAYLOAD_TOO_LARGE");
 const key=await getKey(secret),iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:contextFor(orderId),tagLength:128},key,plaintext));
 return "CK1."+toURL(iv)+"."+toURL(encrypted);
}
export async function decryptCustomerForOrder({orderId,ciphertext,secret}){
 if(typeof ciphertext!=="string"||ciphertext.length>8000)throw new CustomerCryptoError("INVALID_CIPHERTEXT");
 const fields=ciphertext.split(".");if(fields.length!==3||fields[0]!=="CK1")throw new CustomerCryptoError("INVALID_CIPHERTEXT");
 const iv=fromB64(fields[1]),data=fromB64(fields[2]);if(iv.length!==12||data.length<16)throw new CustomerCryptoError("INVALID_CIPHERTEXT");
 try{
  const key=await getKey(secret),clear=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:contextFor(orderId),tagLength:128},key,data);
  return sanitizeCustomer(JSON.parse(customerDecoder.decode(clear)));
 }catch(e){if(e instanceof CustomerCryptoError)throw e;throw new CustomerCryptoError("DECRYPTION_FAILED")}
}
