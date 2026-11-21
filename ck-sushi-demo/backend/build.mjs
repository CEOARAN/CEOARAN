// Build-only tooling. Does not read secrets or issue network requests.
// Run with Node 20+: node backend/build.mjs
import {readFile,writeFile,mkdir} from "node:fs/promises";
const file=x=>new URL(x,import.meta.url);
const [worker,adminHTML,adminJS,adminCSS,quoteModule,orderModule,outboxModule,repositoryModule,paymentModule,mpOrdersModule,mpTestWebhookModule,ifoodModule,customerCryptoModule,idempotencyModule,frontendSource]=await Promise.all([
  readFile(file("./worker.js"),"utf8"),readFile(file("./admin.html"),"utf8"),readFile(file("./admin.js"),"utf8"),readFile(file("./admin.css"),"utf8"),readFile(file("./domain/quote.mjs"),"utf8"),readFile(file("./domain/order-machine.mjs"),"utf8"),readFile(file("./domain/outbox.mjs"),"utf8"),readFile(file("./domain/order-repository.mjs"),"utf8"),readFile(file("./integrations/mercadopago.mjs"),"utf8"),readFile(file("./integrations/mercadopago-orders.mjs"),"utf8"),readFile(file("./integrations/mercadopago-test-webhook.mjs"),"utf8"),readFile(file("./integrations/ifood.mjs"),"utf8"),readFile(file("./security/customer-crypto.mjs"),"utf8"),readFile(file("./security/idempotency.mjs"),"utf8"),readFile(file("../index.html"),"utf8")
]);
const anchor="render();\nconst loaderEl=";
if(!frontendSource.includes(anchor))throw new Error("Frontend sync anchor was removed; review changes before deploying.");
const hook=String.raw`render();
async function syncCatalogFromBackend(){try{const res=await fetch("/api/catalog",{cache:"no-store"});if(!res.ok)throw Error("Catalog unavailable");const data=await res.json();if(!data.ok||!Array.isArray(data.products)||data.products.length===0)throw Error("Invalid catalog");d.splice(0,d.length,...data.products.filter(p=>p.isAvailable!==false));for(const c of cats){if(c!=="Todos"){const item=d.find(p=>p.cat===c);if(item)pictures[c]=item.photo}}if(state.panel===null)render()}catch(error){console.warn("Using bundled demo catalog:",String(error.message||error))}}
syncCatalogFromBackend();
const loaderEl=`;
const storefrontHTML=frontendSource.replace(anchor,hook);
const bundle=[
  "const ADMIN_HTML="+JSON.stringify(adminHTML)+";",
  "const ADMIN_JS="+JSON.stringify(adminJS)+";",
  "const ADMIN_CSS="+JSON.stringify(adminCSS)+";",
  "const FRONTEND_HTML="+JSON.stringify(storefrontHTML)+";",
  "// Pure domain modules inlined by the staging build",
  ...[quoteModule,orderModule,outboxModule,repositoryModule,paymentModule,ifoodModule,customerCryptoModule,idempotencyModule].map(src=>src.replace(/^export /gm,"")),
  worker
].join("\n");
await mkdir(file("./dist"),{recursive:true});
await writeFile(file("./dist/worker.js"),bundle,"utf8");
console.log("CK Sushi staging bundle generated: backend/dist/worker.js");
