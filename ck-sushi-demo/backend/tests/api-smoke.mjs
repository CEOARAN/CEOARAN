// Non-destructive smoke tests: node backend/tests/api-smoke.mjs
const base=process.env.CK_SUSHI_STAGING_URL||"https://ck-sushi-backend-staging.ceoaran-dev.workers.dev";
const assert=(condition,msg)=>{if(!condition)throw new Error(msg)};
const request=async(path,options)=>{const response=await fetch(base+path,options);return{status:response.status,data:await response.json()}};
const health=await request("/api/health");assert(health.status===200&&health.data.environment==="staging","Health route failed");
// Health readiness requires schema v6, 18 named guards, empty commerce tables and four disabled flags.
const ready=await request("/api/health/ready");assert(ready.status===200&&ready.data.status==="ready"&&ready.data.commerceEnabled===false,"Staging DB readiness failed");
const catalog=await request("/api/catalog");assert(catalog.status===200&&Array.isArray(catalog.data.products),"Catalog response failed");
assert(catalog.data.products.length===103,"Catalog count mismatch: "+catalog.data.products.length);
assert(catalog.data.products.every(p=>typeof p.price==="number"&&p.photo.startsWith("https://")),"Invalid catalog entries");
const webhook=await request("/api/webhooks/mercadopago/test?type=order&data.id=ORD01TEST12345678901234",{
 method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"order",live_mode:false,data:{id:"ORD01TEST12345678901234"}})
});
assert(webhook.status===503||webhook.status===429,"Staging webhook unexpectedly accepted without configured credentials");
const admin=await request("/api/admin/session");assert([401,403,503].includes(admin.status),"Unauthenticated admin access unexpectedly allowed");
const orders=await request("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customer:"do-not-store"})});assert(orders.status===503,"Customer orders unexpectedly enabled");
const mutation=await request("/api/admin/products",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"test"})});assert([401,403,503].includes(mutation.status),"Unauthenticated write unexpectedly allowed");
const config=await request("/api/store/config");assert(config.status===200&&!config.data.orders_enabled&&!config.data.payments_enabled,"Unsafe checkout configuration");
const sample=catalog.data.products.find(p=>p.isAvailable!==false&&p.isPublished!==false);assert(sample,"Sample product unavailable");
const origin=new URL(base).origin;const quoteReq={items:[{product_id:sample.id,quantity:2}],fulfillment:"pickup"};
const quote=await request("/api/checkout/quote",{method:"POST",headers:{"Content-Type":"application/json","Origin":origin},body:JSON.stringify(quoteReq)});
assert(quote.status===200&&quote.data.quote.subtotal_cents===Math.round(sample.price*100)*2,"Server-side pricing failed");
assert(quote.data.quote.can_pay===false,"Checkout unexpectedly enabled");
const delivery=await request("/api/checkout/quote",{method:"POST",headers:{"Content-Type":"application/json","Origin":origin},body:JSON.stringify({...quoteReq,fulfillment:"delivery"})});
assert(delivery.status===200&&delivery.data.quote.total_cents===null,"Invented delivery fee");
const tamper=await request("/api/checkout/quote",{method:"POST",headers:{"Content-Type":"application/json","Origin":origin},body:JSON.stringify({...quoteReq,total_cents:1})});
assert(tamper.status===422,"Browser-controlled total accepted");
const crossSite=await request("/api/checkout/quote",{method:"POST",headers:{"Content-Type":"application/json","Origin":"https://evil.example"},body:JSON.stringify(quoteReq)});
assert(crossSite.status===403,"Cross-site request accepted");
console.log(JSON.stringify({passed:true,products:catalog.data.products.length,adminStatus:admin.status,ordersStatus:orders.status,writeStatus:mutation.status,quoteStatus:quote.status,tamperStatus:tamper.status,crossSiteStatus:crossSite.status},null,2));