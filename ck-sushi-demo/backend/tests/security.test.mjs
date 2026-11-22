import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {encryptCustomerForOrder,decryptCustomerForOrder,normalizeCustomer,CustomerCryptoError} from "../security/customer-crypto.mjs";
import {deriveIdempotencyHash,deriveOrderRequestFingerprint,IdempotencyError} from "../security/idempotency.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const demo={name:"Pessoa Fictícia",phone:"11912345678",address:{street:"Rua de Testes",number:"10",city:"Cidade Exemplo",postalCode:"00000-000"}};
test("AES-GCM encrypts and decrypts bound to the correct order",async()=>{
 const ciphertext=await encryptCustomerForOrder({orderId:"CK-TEST-100",customer:demo,secret});
 assert.match(ciphertext,/^CK1\./);assert(!ciphertext.includes(demo.name));
 assert.deepEqual(await decryptCustomerForOrder({orderId:"CK-TEST-100",ciphertext,secret}),demo);
 await assert.rejects(()=>decryptCustomerForOrder({orderId:"CK-TEST-OTHER",ciphertext,secret}),e=>e.code==="DECRYPTION_FAILED");
});
test("refuse collecting personal data outside explicit whitelist",async()=>{
 await assert.rejects(()=>encryptCustomerForOrder({orderId:"CK-TEST-100",customer:{...demo,cpf:"11111111111"},secret}),e=>e.code==="EXCESS_DATA");
});
test("HMAC-based request IDs separate orders, payments, refunds and deliveries",async()=>{
 const key="CKSUSHI_demo_1234567890",s="some-long-application-secret-used-only-in-tests";
 const a=await deriveIdempotencyHash({scope:"orders",key,secret:s});
 const b=await deriveIdempotencyHash({scope:"payments",key,secret:s});
 assert.equal(a.length,64);assert.notEqual(a,b);
 assert.equal(a,await deriveIdempotencyHash({scope:"orders",key,secret:s}));
});
test("weak idempotency keys are rejected",async()=>{
 await assert.rejects(()=>deriveIdempotencyHash({scope:"orders",key:"1",secret:"some-long-application-secret-used-only-in-tests"}),e=>e.code==="INVALID_KEY");
});

test("HMAC order fingerprint is independent of item order but binds identity and quantities",async()=>{
 const longSecret="test-only-HMAC-secret-12345678901234567890";
 const cart1={fulfillment:"pickup",items:[{product_id:"CK-P2",quantity:1},{product_id:"CK-P1",quantity:2}]};
 const cart2={fulfillment:"pickup",items:[{product_id:"CK-P1",quantity:2},{product_id:"CK-P2",quantity:1}]};
 const shopper=normalizeCustomer({name:"Pessoa Teste",phone:"11911112222"});
 const a=await deriveOrderRequestFingerprint({cart:cart1,customer:shopper,secret:longSecret});
 const b=await deriveOrderRequestFingerprint({cart:cart2,customer:shopper,secret:longSecret});
 const changed=await deriveOrderRequestFingerprint({cart:{...cart1,items:[{product_id:"CK-P2",quantity:2},{product_id:"CK-P1",quantity:2}]},customer:shopper,secret:longSecret});
 const different=await deriveOrderRequestFingerprint({cart:cart1,customer:{...shopper,phone:"11933334444"},secret:longSecret});
 assert.match(a,/^[0-9a-f]{64}$/);
 assert.equal(a,b);
 assert.notEqual(a,changed);
 assert.notEqual(a,different);
 assert(!a.includes(shopper.phone));
});
test("normalizer rejects fields outside customer minimization contract",()=>{
 assert.deepEqual(normalizeCustomer({name:" Pessoa ",phone:"11911112222"}),{name:"Pessoa",phone:"11911112222",address:null});
 assert.throws(()=>normalizeCustomer({name:"Pessoa",phone:"11911112222",cpf:"00000000000"}),e=>e.code==="EXCESS_DATA");
});
