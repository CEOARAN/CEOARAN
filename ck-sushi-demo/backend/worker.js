/* CK Sushi backend — staging only. Authentication is fail-closed until Cloudflare Access is provisioned. */
const VERSION="2026.11.21.staging.1";
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
async function bodyJSON(req){const text=await req.text();if(te.encode(text).byteLength>8192)throw Error("BODY_TOO_LARGE");try{return JSON.parse(text)}catch{throw Error("INVALID_JSON")}}
async function audit(db,actor,action,id,detail=""){await db.prepare("INSERT INTO admin_audit (actor,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?)").bind(actor,action,"product",id,detail).run()}
function dbRow(p){return {id:p.id,name:p.name,desc:p.description,cat:p.category,price:p.price_cents/100,oldPrice:p.old_price_cents===null?null:p.old_price_cents/100,photo:p.image_url,thumb:p.thumbnail_url,tag:p.tag,featured:p.sort_order<4,isPublished:!!p.is_published,isAvailable:!!p.is_available,version:p.version,updatedAt:p.updated_at}}
async function catalog(env){const result=await DB(env).prepare("SELECT * FROM products WHERE is_published=1 ORDER BY sort_order,id LIMIT 500").all();return json({ok:true,mode:"homologacao",ordersEnabled:false,products:result.results.map(dbRow)},200,false)}
async function adminAPI(req,env,url){
 const auth=await validateAccess(req,env);if(auth.error)return auth.error;
 if(req.method!=="GET"&&!sameOriginMutation(req,auth.csrf))return problem(403,"CSRF_REJECTED","Origem ou token da requisição inválidos.");
 if(req.method==="GET"&&url.pathname==="/api/admin/session")return json({ok:true,email:auth.email,role:auth.role,csrf:auth.csrf,environment:"staging",ordersEnabled:false});
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
   await DB(env).prepare("INSERT INTO products(id,name,description,category,price_cents,old_price_cents,image_url,thumbnail_url,tag,is_published,is_available,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,p.name,p.description,p.category,p.price_cents,p.old_price_cents,p.image_url,p.thumbnail_url,p.tag,p.is_published,p.is_available,9999).run();
   await audit(DB(env),auth.email,"create",id,"Produto cadastrado");const row=await DB(env).prepare("SELECT * FROM products WHERE id=?").bind(id).first();return json({ok:true,product:dbRow(row)},201);
 }
 const productId=url.pathname.match(/^\/api\/admin\/products\/([A-Za-z0-9_-]{3,90})$/);
 if(req.method==="PATCH"&&productId){
   const id=productId[1],existing=await DB(env).prepare("SELECT * FROM products WHERE id=?").bind(id).first();if(!existing)return problem(404,"NOT_FOUND","Produto não localizado");
   const b=await bodyJSON(req);if(!Number.isInteger(b.version)||b.version!==existing.version)return problem(409,"VERSION_CONFLICT","Produto alterado desde a última leitura; atualize antes de salvar.");
   const p=normalizeProduct(b,existing);
   const result=await DB(env).prepare("UPDATE products SET name=?,description=?,category=?,price_cents=?,old_price_cents=?,image_url=?,thumbnail_url=?,tag=?,is_published=?,is_available=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?").bind(p.name,p.description,p.category,p.price_cents,p.old_price_cents,p.image_url,p.thumbnail_url,p.tag,p.is_published,p.is_available,id,b.version).run();
   if(result.meta.changes!==1)return problem(409,"VERSION_CONFLICT","Alteração concorrente detectada.");
   await audit(DB(env),auth.email,"update",id,"Produto atualizado / versão "+(b.version+1));const row=await DB(env).prepare("SELECT * FROM products WHERE id=?").bind(id).first();return json({ok:true,product:dbRow(row)});
 }
 return problem(404,"NOT_FOUND","Rota administrativa desconhecida.");
}
export default {async fetch(req,env){
 const url=new URL(req.url),p=url.pathname;
 if(req.method==="OPTIONS")return problem(405,"METHOD_NOT_ALLOWED","Não há CORS liberado para esta API.");
 try{
   if(p==="/api/health"&&req.method==="GET")return json({ok:true,service:"ck-sushi-backend",version:VERSION,environment:"staging",ordering:false},200,false);
   if(p==="/api/catalog"&&req.method==="GET"){if(!env.CATALOG_DB)return problem(503,"DATABASE_NOT_CONFIGURED","Banco de dados indisponível.");return catalog(env)}
   if(p==="/api/orders"||p==="/api/checkout"||p.startsWith("/api/payments"))return problem(503,"ORDERING_DISABLED","Pedidos e pagamentos reais não estão habilitados.");
   if(p.startsWith("/api/admin/")){if(!env.CATALOG_DB)return problem(503,"DATABASE_NOT_CONFIGURED","Banco de dados indisponível.");return await adminAPI(req,env,url)}
   if(req.method==="GET"&&(p==="/admin"||p==="/admin/"))return new Response(ADMIN_HTML,{headers:{...headers("text/html; charset=utf-8",true),"Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://instadelivery-public.nyc3.cdn.digitaloceanspaces.com https://images.unsplash.com; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
   if(req.method==="GET"&&p==="/admin/app.js")return new Response(ADMIN_JS,{headers:{...headers("text/javascript; charset=utf-8",true),"X-Content-Type-Options":"nosniff"}});
   if(req.method==="GET"&&p==="/admin/style.css")return new Response(ADMIN_CSS,{headers:headers("text/css; charset=utf-8",true)});
   if(req.method==="GET"&&p==="/robots.txt")return new Response("User-agent: *\nDisallow: /\n",{headers:headers("text/plain; charset=utf-8",true)});
   return problem(404,"NOT_FOUND","Rota inexistente.");
 }catch(error){
   const known=/^(INVALID_|BODY_TOO_LARGE|UNEXPECTED_FIELD)/.test(error?.message||"");
   if(!known)console.error("CK backend failure",p,String(error?.message||"unknown").slice(0,100));
   return known?problem(422,"VALIDATION_ERROR","Confira os campos do produto e tente novamente."):problem(500,"INTERNAL_ERROR","Não foi possível concluir a operação.");
 }
}};