// Non-destructive smoke tests: node backend/tests/api-smoke.mjs
const base=process.env.CK_SUSHI_STAGING_URL||"https://ck-sushi-backend-staging.ceoaran-dev.workers.dev";
const assert=(condition,msg)=>{if(!condition)throw new Error(msg)};
const request=async(path,options)=>{const response=await fetch(base+path,options);return{status:response.status,data:await response.json()}};
const health=await request("/api/health");assert(health.status===200&&health.data.environment==="staging","Health route failed");
const catalog=await request("/api/catalog");assert(catalog.status===200&&Array.isArray(catalog.data.products),"Catalog response failed");
assert(catalog.data.products.length===103,"Catalog count mismatch: "+catalog.data.products.length);
assert(catalog.data.products.every(p=>typeof p.price==="number"&&p.photo.startsWith("https://")),"Invalid catalog entries");
const admin=await request("/api/admin/session");assert([401,403,503].includes(admin.status),"Unauthenticated admin access unexpectedly allowed");
const orders=await request("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customer:"do-not-store"})});assert(orders.status===503,"Customer orders unexpectedly enabled");
const mutation=await request("/api/admin/products",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"test"})});assert([401,403,503].includes(mutation.status),"Unauthenticated write unexpectedly allowed");
console.log(JSON.stringify({passed:true,products:catalog.data.products.length,adminStatus:admin.status,ordersStatus:orders.status,writeStatus:mutation.status},null,2));