import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {encryptCustomerForOrder,decryptCustomerForOrder,CustomerCryptoError} from "../security/customer-crypto.mjs";
import {deriveIdempotencyHash,IdempotencyError} from "../security/idempotency.mjs";
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