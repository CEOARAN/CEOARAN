/* CK Sushi backend — staging only. Authentication is fail-closed until Cloudflare Access is provisioned. */
const VERSION="2026.11.22.staging.8";
/* PURE_CHECKOUT_DOMAIN */
const DB=env=>env.CATALOG_DB;
const HOSTS=new Set(["instadelivery-public.nyc3.cdn.digitaloceanspaces.com","images.unsplash.com"]);
const ROLE_RANK={viewer:0,editor:1,owner:2};
const te=new TextEncoder();
function headers(contentType="application/json; charset=utf-8",admin=false){return {"Content-Type":contentType,"Cache-Control":admin?"no-store, max-age=0":"public, max-age=30","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","X-Frame-Options":"DENY","X-Robots-Tag":"noindex,nofollow","Strict-Transport-Security":"max-age=31536000; includeSubDomains","Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=()"}}
function json(x,status=200,admin=true){return new Response(JSON.stringify(x),{status,headers:headers("application/json; charset=utf-8",admin)})}
function problem(status,code,detail){return json({ok:false,code,message:detail},status)}
const str=(s,max)=>typeof s==="string"&&s.trim().length<=max?s.trim():null;
function httpUrl(v){if(typeof v!=="string"||v.length>500)return null;try{const u=new URL(v);if(u.protocol!=="https:"||!HOSTS.has(u.hostname)||u.username||u.password)return null;return u.toString()}catch{return null}}
function cents(v){return Number.isInteger(v)&&v>=0&&v<=100000000?v:null}
function normalizeProduct(body,old){if(!body||typeof body!=="object"||Array.isArray(body))throw Error("INVALID_BODY");const defaults=old||{};const allowed=new Set(["name","description","category","price_cents","old_price_cents","image_url","thumbnail_url","tag","is_published","is_available","version"]);if(Object.keys(body).some(k=>!allowed.has(k)))throw Error("UNEXPECTED_FIELD");const p={name:body.name??defaults.name,description:body.description??defaults.description??"",category:body.category??defaults.category,price_cents:body.price_cents??defaults.price_cents,old_price_cents:Object.hasOwn(body,"old_price_cents")?body.old_price_cents:defaults.old_price_cents??null,image_url:body.image_url??defaults.image_url,thumbnail_url:body.thumbnail_url??defaults.thumbnail_url??"",tag:body.tag??defaults.tag??null,is_published:body.is_published??defaults.is_published??0,is_available:body.is_available??defaults.is_available??1};
  for(const key of ["name","category"]){p[key]=str(p[key],key==="name"?180:80);if(!p[key]||p[key].length<2)throw Error("INVALID_"+key.toUpperCase())}
  p.description=str(p.description,2000);if(p.description===null)throw Error("INVALID_DESCRIPTION");
  if(!Number.isInteger(p.price_cents)||cents(p.price_cents)===null)throw Error("INVALID_PRICE");
  if(p.old_price_cents!==null&&(cents(p.old_price_cents)===null||p.old_price_cents<p.price_cents))throw Error("INVALID_OLD_PRICE");
  p.image_url=httpUrl(p.image_url);if(!p.image_url)throw Error("INVALID_IMAGE");
  if(p.thumbnail_url){p.thumbnail_url=httpUrl(p.thumbnail_url);if(!p.thumbnail_url)throw Error("INVALID_THUMBNAIL")}
  if(p.tag!==null){p.tag=str(p.tag,35);if(p.tag===null)throw Error("INVALID_TAG")}
  for(const k of ["is_published","is_available"]){p[k]=Number(p[k]);if(p[k]!==0&&p[k]!==1)throw Error("INVALID_"+k.toUpperCase())}
  return p;
}
function b64(str){const safe=str.replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(safe+"=".repeat((4-safe.length%4)%4)),c=>c.charCodeAt(0))}
function claimsPart(b){return JSON.parse(new TextDecoder().decode(b64(b)))}
function authConfig(env){const team=env.ACCESS_TEAM_NAME,aud=env.ACCESS_AUD,owners=env.ACCESS_OWNER_EMAILS,editors=env.ACCESS_EDITOR_EMAILS;return !!team&&/^[a-z0-9-]{2,80}$/.test(team)&&!!aud&&typeof aud==="string"&&(!!owners||!!editors)}
async function validateAccess(request,env){
 if(!authConfig(env))return {error:problem(503,"ADMIN_NOT_CONFIGURED","O acesso administrativo requer configuração do Cloudflare Access.")};
 const jwt=request.headers.get("Cf-Access-Jwt-Assertion");
 if(!jwt||jwt.length>10000)return {error:problem(401,"ACCESS_REQUIRED","Autenticação administrativa necessária.")};
 try {
   const parts=jwt.split(".");if(parts.length!==3)throw Error("Malformed");
   const head=claimsPart(parts[0]),claim=claimsPart(parts[1]);
   const issuer="https://"+env.ACCESS_TEAM_NAME+".cloudflareaccess.com";
   if(head.alg!=="RS256"||typeof head.kid!=="string"||claim.iss!==issuer||!([].concat(claim.aud||[])).includes(env.ACCESS_AUD))throw Error("JWT_POLICY");
   const now=Math.floor(Date.now()/1000);if(!Number.isFinite(claim.exp)||claim.exp<now-30||claim.exp>now+86400*30||claim.nbf>now+30||claim.iat>now+30)throw Error("JWT_TIME");
   const keyResult=await fetch(issuer+"/cdn-cgi/access/certs",{cf:{cacheTtl:300}});if(!keyResult.ok)throw Error("JWKS_UNAVAILABLE");
   const jwks=await keyResult.json();const jwk=jwks.keys?.find(x=>x.kid===head.kid&&x.kty==="RSA");if(!jwk)throw Error("KEY_NOT_FOUND");
   const publicKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
   if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,b64(parts[2]),te.encode(parts[0]+"."+parts[1])))throw Error("BAD_SIGNATURE");
   const email=(claim.email||"").toLowerCase().trim();if(!email||email.length>254)throw Error("IDENTITY_MISSING");
   const listed=x=>String(x||"").split(",").map(t=>t.toLowerCase().trim()).includes(email);
   const role=listed(env.ACCESS_OWNER_EMAILS)?"owner":listed(env.ACCESS_EDITOR_EMAILS)?"editor":null;
   if(!role)return {error:problem(403,"ACCESS_DENIED","A identidade autenticada não tem permissão administrativa.")};
   const digest=await crypto.subtle.digest("SHA-256",te.encode("ck-sushi-csrf-v1|"+new URL(request.url).origin+"|"+jwt));
   const csrf=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
   return {email,role,csrf};
 }catch{return {error:problem(401,"INVALID_ACCESS_TOKEN","Falha na validação da sessão Cloudflare Access.")}}
}
function sameOriginMutation(req,csrf){const origin=req.headers.get("Origin");if(origin!==new URL(req.url).origin)return false;if(req.headers.get("X-CSRF-Token")!==csrf)return false;if(req.headers.get("Sec-Fetch-Site")==="cross-site")return false;return /^application\/json(?:;|$)/i.test(req.headers.get("Content-Type")||"")}
async function bodyJSON(req){
  const limit=8192,declared=Number(req.headers.get("Content-Length")||0);
  if(declared>limit)throw Error("BODY_TOO_LARGE");
  if(!req.body)throw Error("INVALID_JSON");
  const reader=req.body.getReader();const chunks=[];let total=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw Error("BODY_TOO_LARGE")}chunks.push(value)}}
  finally{reader.releaseLock()}
  const bytes=new Uint8Array(total);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes))}catch{throw Error("INVALID_JSON")}
}
async function audit(db,actor,action,id,detail=""){await db.prepare("INSERT INTO admin_audit (actor,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?)").bind(actor,action,"product",id,detail).run()}
function dbRow(p){return {id:p.id,name:p.name,desc:p.description,cat:p.category,price:p.price_cents/100,oldPrice:p.old_price_cents===null?null:p.old_price_cents/100,photo:p.image_url,thumb:p.thumbnail_url,tag:p.tag,featured:p.sort_order<4,isPublished:!!p.is_published,isAvailable:!!p.is_available,version:p.version,updatedAt:p.updated_at}}
async function catalog(env){const result=await DB(env).prepare("SELECT * FROM products WHERE is_published=1 ORDER BY sort_order,id LIMIT 500").all();return json({ok:true,mode:"homologacao",ordersEnabled:false,products:result.results.map(dbRow)},200,false)}

/** Public pricing preview: no names, address, phone, or payment data accepted/stored. */
async function checkoutQuote(req,env){
 if(!env.QUOTE_RATE_LIMIT)return problem(503,"RATE_LIMIT_NOT_CONFIGURED","Proteção de limite de consultas indisponível.");
 const ip=req.headers.get("CF-Connecting-IP")||"unknown";
 const limit=await env.QUOTE_RATE_LIMIT.limit({key:"checkout:"+ip});
 if(!limit.success){const response=problem(429,"RATE_LIMITED","Muitas consultas em um período curto. Tente novamente depois.");response.headers.set("Retry-After","60");return response}
 const origin=new URL(req.url).origin;
 if(req.headers.get("Origin")!==origin||req.headers.get("Sec-Fetch-Site")==="cross-site")return problem(403,"ORIGIN_DENIED","Origem de checkout inválida.");
 if(!/^application\/json(?:;|$)/i.test(req.headers.get("Content-Type")||""))return problem(415,"JSON_REQUIRED","Envie JSON válido.");
 let cart;
 try {cart=parseQuoteRequest(await bodyJSON(req))}
 catch(e){if(e instanceof CheckoutValidationError)return problem(e.status,e.code,"Carrinho inválido. Confira itens e quantidades.");throw e}
 const ids=cart.items.map(x=>x.product_id);
 const sql="SELECT id,name,price_cents,is_published,is_available FROM products WHERE id IN ("+ids.map(()=>"?").join(",")+")";
 const found=await DB(env).prepare(sql).bind(...ids).all();
 let settings=await DB(env).prepare("SELECT value FROM operational_settings WHERE key='minimum_order_cents'").first();
 let minimumOrderCents=settings?Number(settings.value):0;
 if(!Number.isSafeInteger(minimumOrderCents)||minimumOrderCents<0)return problem(503,"STORE_CONFIGURATION_INVALID","Regra de pedido mínimo inválida.");
 try{return json({ok:true,quote:computeQuote(cart,found.results,{minimumOrderCents})},200,true)}
 catch(e){if(e instanceof CheckoutValidationError)return problem(e.status,e.code,e.code==="PRODUCT_UNAVAILABLE"?"Produto indisponível ou não encontrado.":"Não é possível calcular este pedido.");throw e}
}
/** Minimal public readiness signal; no credentials, customers, payment IDs or secrets. */
async function stagingReadiness(env){
 if(!env.CATALOG_DB)return problem(503,"NOT_READY","Serviço temporariamente indisponível.");
 const report=await env.CATALOG_DB.prepare(String.raw`SELECT
  (SELECT COALESCE(MAX(version),0) FROM schema_migrations) AS schema_version,
  (SELECT COUNT(*) FROM products WHERE is_published=1) AS active_products,
  (SELECT COUNT(*) FROM sqlite_master
   WHERE type='trigger' AND name IN (
    'staging_block_order_insert',
    'staging_block_legacy_order_insert',
    'staging_block_payment_insert',
    'staging_block_delivery_insert',
    'staging_block_payment_webhook_insert',
    'staging_block_outbox_insert',
    'commerce_line_snapshot_price_guard',
    'commerce_line_immutable_guard',
    'commerce_payment_amount_guard',
    'commerce_order_version_guard',
    'commerce_order_no_direct_terminal_reopen',
    'commerce_order_financial_snapshot_immutable',
    'commerce_order_line_delete_guard',
    'commerce_payment_financial_snapshot_immutable',
    'commerce_payment_delete_guard',
    'staging_block_operational_insert',
    'staging_block_operational_update',
    'staging_block_operational_delete'
   )) AS required_guards,
  (SELECT COUNT(*) FROM commerce_orders) AS orders,
  (SELECT COUNT(*) FROM commerce_payments) AS payments,
  (SELECT COUNT(*) FROM delivery_outbox) AS pending_tasks,
  (SELECT COUNT(*) FROM order_records) AS legacy_orders,
  (SELECT COUNT(*) FROM order_items) AS legacy_order_items,
  (SELECT COUNT(*) FROM commerce_order_lines) AS order_lines,
  (SELECT COUNT(*) FROM commerce_order_events) AS order_events,
  (SELECT COUNT(*) FROM commerce_payment_events) AS payment_events,
  (SELECT COUNT(*) FROM commerce_delivery) AS deliveries,
  (SELECT value FROM operational_settings WHERE key='orders_enabled') AS orders_enabled,
  (SELECT value FROM operational_settings WHERE key='payments_enabled') AS payments_enabled,
  (SELECT value FROM operational_settings WHERE key='customer_data_enabled') AS customer_data_enabled,
  (SELECT value FROM operational_settings WHERE key='tracking_enabled') AS tracking_enabled`).first();
 const ready=report?.schema_version>=6&&report.active_products>0&&report.required_guards===18&&
  ["orders","payments","pending_tasks","legacy_orders","legacy_order_items","order_lines","order_events","payment_events","deliveries"].every(k=>report[k]===0)&&
  ["orders_enabled","payments_enabled","customer_data_enabled","tracking_enabled"].every(k=>report[k]==="false");
 return json({ok:ready,status:ready?"ready":"not_ready",environment:"staging",commerceEnabled:false},ready?200:503,true);
}

/** Mercado Pago test-only callback: signature + matching app + short-lived replay hash. */
async function mpSandboxNotification(req,env){
 if(!env.QUOTE_RATE_LIMIT)return problem(503,"RATE_LIMIT_NOT_CONFIGURED","Proteção de abuso indisponível.");
 const ip=req.headers.get("CF-Connecting-IP")||"unknown";
 const limit=await env.QUOTE_RATE_LIMIT.limit({key:"mp-test-webhook:"+ip});
 if(!limit.success){const response=problem(429,"RATE_LIMITED","Muitas notificações em curto período.");response.headers.set("Retry-After","60");return response}
 if(!env.MP_TEST_WEBHOOK_SECRET||!env.MP_TEST_APPLICATION_ID)
  return problem(503,"MP_TEST_NOT_CONFIGURED","Integração de teste ainda não configurada.");
 if(!env.CATALOG_DB)return problem(503,"DATABASE_NOT_CONFIGURED","Banco de homologação indisponível.");
 const length=Number(req.headers.get("Content-Length")||0);
 if(length>8192)return problem(413,"PAYLOAD_TOO_LARGE","Evento de teste excede o tamanho permitido.");
 if(!/^application\/json(?:;|$)/i.test(req.headers.get("Content-Type")||""))
  return problem(415,"JSON_REQUIRED","É necessário JSON.");
 let event;try{event=await bodyJSON(req)}catch(e){
  if(e.message==="BODY_TOO_LARGE")return problem(413,"PAYLOAD_TOO_LARGE","Evento muito grande.");
  return problem(400,"INVALID_JSON","Evento inválido.");
 }
 try{
  const verified=await validateMercadoPagoTestWebhook({
   url:req.url,headers:req.headers,body:event,webhookSecret:env.MP_TEST_WEBHOOK_SECRET,
   applicationId:env.MP_TEST_APPLICATION_ID,verifySignature:verifyMercadoPagoSignature
  });
  return json(await recordMercadoPagoTestWebhook(env.CATALOG_DB,verified),200,true);
 }catch(e){if(e instanceof MercadoPagoWebhookError)return problem(e.status,e.code,
    e.status===503?"Verificação de teste indisponível.":"Notificação de teste recusada.");
  throw e;
 }
}

async function publicStoreConfig(env){
 const rows=await DB(env).prepare("SELECT key,value FROM operational_settings WHERE key IN ('orders_enabled','payments_enabled','tracking_enabled','catalog_reviewed')").all();
 const config=Object.fromEntries(rows.results.map(r=>[r.key,r.value==="true"]));
 return json({ok:true,environment:"staging",currency:"BRL",orders_enabled:false,payments_enabled:false,tracking_enabled:false,catalog_reviewed:config.catalog_reviewed??false,fulfillment_modes:["pickup","delivery"],delivery_quotation_available:false},200,false);
}

async function adminAPI(req,env,url){
 const auth=await validateAccess(req,env);if(auth.error)return auth.error;
 if(req.method!=="GET"&&!sameOriginMutation(req,auth.csrf))return problem(403,"CSRF_REJECTED","Origem ou token da requisição inválidos.");
 if(req.method==="GET"&&url.pathname==="/api/admin/session")return json({ok:true,email:auth.email,role:auth.role,csrf:auth.csrf,environment:"staging",ordersEnabled:false});
 if(req.method==="GET"&&url.pathname==="/api/admin/integrations/mercadopago"){
   return json({
    ok:true,environment:"staging",provider:"mercadopago",api:"orders",
    test_access_token_configured:typeof env.MP_TEST_ACCESS_TOKEN==="string"&&env.MP_TEST_ACCESS_TOKEN.length>16,
    test_webhook_secret_configured:typeof env.MP_TEST_WEBHOOK_SECRET==="string"&&env.MP_TEST_WEBHOOK_SECRET.length>12,
    test_application_id_configured:!!env.MP_TEST_APPLICATION_ID,
    orders_enabled:false,payments_enabled:false,production_integrated:false
   });
 }
 if(req.method==="GET"&&url.pathname==="/api/admin/summary"){
   const [prod,settings]=await Promise.all([
     DB(env).prepare("SELECT COUNT(*) total, SUM(is_published) published, COUNT(DISTINCT category) categories, SUM(CASE WHEN old_price_cents IS NOT NULL THEN 1 ELSE 0 END) promotions FROM products").first(),
     DB(env).prepare("SELECT key,value FROM operational_settings ORDER BY key").all()
   ]);
   return json({ok:true,stats:prod,settings:Object.fromEntries(settings.results.map(x=>[x.key,x.value]))});
 }
 if(req.method==="GET"&&url.pathname==="/api/admin/products"){
   const r=await DB(env).prepare("SELECT * FROM products ORDER BY sort_order,id LIMIT 500").all();
   return json({ok:true,products:r.results.map(dbRow)});
 }
 if(req.method==="GET"&&url.pathname==="/api/admin/audit"){
   if(ROLE_RANK[auth.role]<ROLE_RANK.owner)return problem(403,"OWNER_ONLY","Permissão de proprietário necessária.");
   const r=await DB(env).prepare("SELECT id,actor,action,entity_type,entity_id,detail,created_at FROM admin_audit ORDER BY id DESC LIMIT 100").all();return json({ok:true,events:r.results});
 }
 if(req.method==="POST"&&url.pathname==="/api/admin/products"){
   const b=await bodyJSON(req);const p=normalizeProduct(b);const id="CK-ADM-"+crypto.randomUUID();
   await DB(env).prepare("INSERT INTO products(id,name,description,category,price_cents,old_price_cents,image_url,thumbnail_url,tag,is_published,is_available,sort_order,last_modified_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,p.name,p.description,p.category,p.price_cents,p.old_price_cents,p.image_url,p.thumbnail_url,p.tag,p.is_published,p.is_available,9999,auth.email).run();const row=await DB(env).prepare("SELECT * FROM products WHERE id=?").bind(id).first();return json({ok:true,product:dbRow(row)},201);
 }
 const productId=url.pathname.match(/^\/api\/admin\/products\/([A-Za-z0-9_-]{3,90})$/);
 if(req.method==="PATCH"&&productId){
   const id=productId[1],existing=await DB(env).prepare("SELECT * FROM products WHERE id=?").bind(id).first();if(!existing)return problem(404,"NOT_FOUND","Produto não localizado");
   const b=await bodyJSON(req);if(!Number.isInteger(b.version)||b.version!==existing.version)return problem(409,"VERSION_CONFLICT","Produto alterado desde a última leitura; atualize antes de salvar.");
   const p=normalizeProduct(b,existing);
   const result=await DB(env).prepare("UPDATE products SET name=?,description=?,category=?,price_cents=?,old_price_cents=?,image_url=?,thumbnail_url=?,tag=?,is_published=?,is_available=?,last_modified_by=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?").bind(p.name,p.description,p.category,p.price_cents,p.old_price_cents,p.image_url,p.thumbnail_url,p.tag,p.is_published,p.is_available,auth.email,id,b.version).run();
   if(result.meta.changes!==1)return problem(409,"VERSION_CONFLICT","Alteração concorrente detectada.");const row=await DB(env).prepare("SELECT * FROM products WHERE id=?").bind(id).first();return json({ok:true,product:dbRow(row)});
 }
 return problem(404,"NOT_FOUND","Rota administrativa desconhecida.");
}
export default {async fetch(req,env){
 const url=new URL(req.url),p=url.pathname;
 if(req.method==="OPTIONS")return problem(405,"METHOD_NOT_ALLOWED","Não há CORS liberado para esta API.");
 try{
   if(req.method==="GET"&&(p==="/"||p==="/index.html"))return new Response(FRONTEND_HTML,{headers:{...headers("text/html; charset=utf-8",true),"Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'"}});
   if(p==="/api/health"&&req.method==="GET")return json({ok:true,service:"ck-sushi-backend",version:VERSION,environment:"staging",ordering:false},200,false);
   if(p==="/api/health/ready"&&req.method==="GET")return stagingReadiness(env);
   if(p==="/api/catalog"&&req.method==="GET"){if(!env.CATALOG_DB)return problem(503,"DATABASE_NOT_CONFIGURED","Banco de dados indisponível.");return catalog(env)}
   if(p==="/api/store/config"&&req.method==="GET"){if(!env.CATALOG_DB)return problem(503,"DATABASE_NOT_CONFIGURED","Banco de dados indisponível.");return publicStoreConfig(env)}
   if(p==="/api/checkout/quote"&&req.method==="POST"){if(!env.CATALOG_DB)return problem(503,"DATABASE_NOT_CONFIGURED","Banco de dados indisponível.");return checkoutQuote(req,env)}
   if(p==="/api/webhooks/mercadopago/test"&&req.method==="POST")return mpSandboxNotification(req,env);
   if(p==="/api/orders"||p==="/api/checkout"||p.startsWith("/api/payments"))return problem(503,"ORDERING_DISABLED","Pedidos e pagamentos reais não estão habilitados.");
   if(p.startsWith("/api/admin/")){if(!env.CATALOG_DB)return problem(503,"DATABASE_NOT_CONFIGURED","Banco de dados indisponível.");return await adminAPI(req,env,url)}
   if(req.method==="GET"&&(p==="/admin"||p==="/admin/"))return new Response(ADMIN_HTML,{headers:{...headers("text/html; charset=utf-8",true),"Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://instadelivery-public.nyc3.cdn.digitaloceanspaces.com https://images.unsplash.com; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
   if(req.method==="GET"&&p==="/admin/app.js")return new Response(ADMIN_JS,{headers:{...headers("text/javascript; charset=utf-8",true),"X-Content-Type-Options":"nosniff"}});
   if(req.method==="GET"&&p==="/admin/style.css")return new Response(ADMIN_CSS,{headers:headers("text/css; charset=utf-8",true)});
   if(req.method==="GET"&&p==="/robots.txt")return new Response("User-agent: *\nDisallow: /\n",{headers:headers("text/plain; charset=utf-8",true)});
   return problem(404,"NOT_FOUND","Rota inexistente.");
 }catch(error){
   const reason=String(error?.message||"");
   if(reason==="BODY_TOO_LARGE")return problem(413,"PAYLOAD_TOO_LARGE","O corpo da requisição excede o limite permitido.");
   if(reason==="INVALID_JSON")return problem(400,"INVALID_JSON","JSON inválido.");
   if(/^(INVALID_|UNEXPECTED_FIELD)/.test(reason))return problem(422,"VALIDATION_ERROR","Confira os campos enviados.");
   console.error("CKSUSHI_BACKEND_INTERNAL_FAILURE",p);
   return problem(500,"INTERNAL_ERROR","Não foi possível concluir a operação.");
 }
},
 async scheduled(controller,env){
   if(!env.CATALOG_DB)throw Error("STAGING_MAINTENANCE_DB_UNAVAILABLE");
   await runStagingMaintenance(env.CATALOG_DB,controller?.scheduledTime??Date.now());
 }
};