"use strict";

/* CK Sushi Operations Console v11.
 * All statistics below come from the public catalog or authorized admin API.
 * No fictional orders, revenue, couriers or customer records are generated.
 * Admin writes require a real Access identity and CSRF verified by the Worker.
 */
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const TABS=Object.freeze({
 overview:"Hoje",products:"Cardápio",orders:"Pedidos",categories:"Categorias",analytics:"Análises",
 support:"Atendimento",integrations:"Integrações",compliance:"Privacidade e LGPD",audit:"Histórico de ações"
});
const STATE={products:[],role:null,email:null,csrf:null,editing:null,tab:"overview",loading:false,inventorySource:"public",store:null};
const money=c=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100);
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node};
const append=(parent,...nodes)=>parent.append(...nodes);
const safeString=x=>typeof x==="string"?x:"";
const safeImage=url=>{
 try{const u=new URL(url,location.origin);return u.protocol==="https:"&&
  ["instadelivery-public.nyc3.cdn.digitaloceanspaces.com","images.unsplash.com"].includes(u.hostname)?
  u.toString():""}catch{return ""}
};
const tag=(text,className="")=>el("span","tag "+className,text);
const asNum=v=>Number.isFinite(Number(v))?Number(v):0;
function calc(){
 const list=STATE.products;
 const categories=new Map();
 for(const p of list)categories.set(p.cat||"Sem categoria",(categories.get(p.cat||"Sem categoria")||0)+1);
 const published=list.filter(p=>p.isPublished===true);
 const available=published.filter(p=>p.isAvailable===true);
 const promotions=list.filter(p=>p.oldPrice!=null&&p.oldPrice>p.price);
 return {total:list.length,categories, published:published.length,available:available.length,
  unavailable:list.filter(p=>p.isAvailable===false).length,promotions:promotions.length,
  mean:list.length?Math.round(list.reduce((total,p)=>total+Math.round(asNum(p.price)*100),0)/list.length):0};
}
function closeNav(){
 $("#admin-layout").classList.remove("drawer-open");
 $("#nav-backdrop").hidden=true;
 $("#open-sidebar").setAttribute("aria-expanded","false");
}
function openNav(){
 $("#nav-backdrop").hidden=false;
 $("#admin-layout").classList.add("drawer-open");
 $("#open-sidebar").setAttribute("aria-expanded","true");
}
function go(tab){
 if(!Object.hasOwn(TABS,tab))return;
 STATE.tab=tab;
 $$("[data-tab]").forEach(n=>{
  const selected=n.dataset.tab===tab;
  n.classList.toggle("selected",selected);
  if(n.matches(".nav-item"))n.setAttribute("aria-current",selected?"page":"false");
 });
 $$(".tab").forEach(n=>n.classList.toggle("active",n.id==="tab-"+tab));
 $("#section-heading").textContent=TABS[tab];
 document.title=TABS[tab]+" — CK Sushi Operações";
 closeNav();
 if(location.hash!=="#"+tab)history.replaceState(null,"","#"+tab);
 window.scrollTo({top:0,behavior:"instant"});
 if(tab==="audit"&&STATE.role==="owner")void loadAudit();
 if(tab==="integrations")void loadIntegrations();
 if(tab==="orders"&&STATE.role)void loadOrders();
}
async function api(path,options={}){
 const response=await fetch(path,{...options,credentials:"same-origin",cache:"no-store",
  headers:{"Accept":"application/json",...options.headers}});
 let data;
 try{data=await response.json()}catch{data={ok:false,message:"O servidor retornou uma resposta inesperada."}}
 if(!response.ok)throw new Error(data.message||data.code||"Não foi possível concluir a requisição.");
 return data;
}
function canEdit(){return STATE.role==="owner"||STATE.role==="editor"}
function locked(reason){
 STATE.role=null;STATE.email=null;STATE.csrf=null;
 $("#session-status").textContent="Acesso restrito";
 $("#security-banner").classList.remove("authorized");
 $("#security-title").textContent="Catálogo em modo de consulta";
 $("#security-desc").textContent=reason?
  "A edição exige uma sessão Cloudflare Access autorizada. "+reason:
  "Cloudflare Access precisa ser configurado para permitir edição. O catálogo público continua disponível em consulta.";
 $("#new-product").disabled=true;
 $("#refresh-audit").disabled=true;
 $("#int-access-state").textContent="Acesso não configurado";
 $("#int-access-state").className="integration-status pending";
 $("#int-access-detail").textContent="Edição e auditoria continuam bloqueadas";
 if(STATE.tab==="audit")$("#audit-rows").textContent="Somente o proprietário autenticado pode visualizar o histórico de alterações.";
 renderTable();
}
function authorized(data){
 STATE.role=data.role;STATE.email=data.email;STATE.csrf=data.csrf;
 $("#session-status").textContent=data.role==="owner"?"Proprietário conectado":"Editor conectado";
 $("#security-banner").classList.add("authorized");
 $("#security-title").textContent="Sessão administrativa autorizada";
 $("#security-desc").textContent="Seu acesso foi verificado pelo servidor. Alterações no catálogo usam validação anti-CSRF e auditoria. Compras e pagamentos reais continuam bloqueados.";
 $(".banner-icon").textContent="✓";
 $("#new-product").disabled=!canEdit();
 $("#refresh-audit").disabled=data.role!=="owner";
 $("#int-access-state").textContent="Sessão autorizada";
 $("#int-access-state").className="integration-status ready";
 $("#int-access-detail").textContent="Permissão: "+(data.role==="owner"?"proprietário":"editor");
 renderTable();
 if(STATE.tab==="orders")void loadOrders();
}
function barChart(groups){
 const host=$("#category-chart");host.replaceChildren();
 const sorted=[...groups].sort((a,b)=>b[1]-a[1]);
 let display=sorted.slice(0,6);
 if(sorted.length>6)display.push(["Outros",sorted.slice(6).reduce((sum,row)=>sum+row[1],0)]);
 const max=Math.max(1,...display.map(row=>row[1]));
 if(!display.length){host.append(el("p","","Nenhuma categoria cadastrada."));return}
 for(const [name,count] of display){
  const item=el("div","chart-group");
  const value=el("span","chart-number",count);
  const bar=el("span","chart-bar");
  bar.style.setProperty("--height",Math.max(3,Math.round(count/max*69))+"%");
  bar.setAttribute("role","img");bar.setAttribute("aria-label",name+": "+count+" produtos");
  const label=el("span","chart-label",name);label.title=name;
  append(item,value,bar,label);host.append(item);
 }
}
function categoryBreakdown(groups,total){
 const host=$("#analytics-category-chart");host.replaceChildren();
 const sorted=[...groups].sort((a,b)=>b[1]-a[1]);
 if(!sorted.length){host.textContent="Nenhum dado para exibir.";return}
 for(const [name,count] of sorted){
  const item=el("div","distribution-item"),top=el("div","distribution-text");
  append(top,el("b","",name),el("small","",count+" produtos · "+Math.round(count/Math.max(1,total)*100)+"%"));
  const track=el("div","distribution-rail"),fill=el("span","distribution-fill");
  fill.style.setProperty("--amount",Math.round(count/Math.max(1,total)*100)+"%");
  track.append(fill);append(item,top,track);host.append(item);
 }
}
function availabilityDonut({published,available}){
 const host=$("#availability-donut");host.replaceChildren();
 const percentage=published?Math.round(available/published*100):0;
 const circle=el("div","donut-ring");
 circle.style.setProperty("--pct",percentage+"%");
 const center=el("div","donut-center");append(center,el("strong","",percentage+"%"),el("small","","disponíveis"));circle.append(center);
 const legend=el("div","donut-legend");
 const a=el("div");a.append(el("i"));a.append(document.createTextNode(available+" disponíveis"));
 const b=el("div");b.append(el("i"));b.append(document.createTextNode(Math.max(0,published-available)+" indisponíveis"));
 append(legend,a,b);append(host,circle,legend);
 host.setAttribute("aria-label",available+" de "+published+" produtos publicados disponíveis");
}

function renderCategories(){
 const host=$("#category-rows");host.replaceChildren();
 const categories=[...calc().categories].sort((a,b)=>b[1]-a[1]);
 if(!categories.length){host.textContent="Nenhuma categoria encontrada.";return}
 categories.forEach(([name,count],index)=>{
  const row=el("div","category-row");
  append(row,el("span","category-row-number",String(index+1).padStart(2,"0")),
    el("strong","",name),el("small","",count+" produtos"));
  const open=el("button","", "Ver produtos");
  open.type="button";open.addEventListener("click",()=>{go("products");$("#category-filter").value=name;renderTable()});
  row.append(open);host.append(row);
 });
}
function overview(){
 const stats=calc();
 $("#stat-total").textContent=stats.total;
 $("#stat-categories").textContent=stats.categories.size;
 $("#stat-promotions").textContent=stats.promotions;
 $("#stat-available").textContent=stats.available;
 $("#stat-published").textContent=stats.published;
 const availableRatio=stats.published?Math.round(stats.available/stats.published*100):0;
 $("#stat-available-ratio").textContent=availableRatio+"%";
 $("#catalog-progress-fill").style.width=availableRatio+"%";
 $("#stat-available-label").textContent=stats.published+" produtos publicados";
 $("#prod-summary-total").textContent=stats.total;
 $("#prod-summary-live").textContent=stats.available;
 $("#prod-summary-hidden").textContent=stats.unavailable;
 $("#analytics-published").textContent=stats.published;
 $("#analytics-unavailable").textContent=stats.unavailable;
 $("#analytics-price").textContent=stats.total?money(stats.mean):"—";
 barChart(stats.categories);
 renderCategories();
 categoryBreakdown(stats.categories,stats.total);
 availabilityDonut(stats);
 const recent=$("#recent-products");recent.replaceChildren();
 const shown=STATE.products.filter(p=>p.isPublished).slice(0,4);
 if(!shown.length){recent.textContent="Ainda não há produtos publicados.";return}
 for(const p of shown){
  const row=el("div","recent");
  const img=el("img");img.loading="lazy";img.alt="";
  const src=safeImage(p.thumb||p.photo);if(src)img.src=src;
  const details=el("div","recent-text");
  append(details,el("strong","",p.name),el("small","",p.cat||"Sem categoria"));
  append(row,img,details,el("span","recent-price",money(Math.round(asNum(p.price)*100))));
  recent.append(row);
 }
}
function filtered(){
 const query=($("#product-search").value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
 const category=$("#category-filter").value;
 const status=$("#product-status").value,sort=$("#product-sort").value;
 const list=STATE.products.filter(p=>{
  if(category!=="Todas"&&p.cat!==category)return false;
  if(status==="available"&&!(p.isPublished&&p.isAvailable))return false;
  if(status==="unavailable"&&p.isAvailable)return false;
  if(status==="hidden"&&p.isPublished)return false;
  return [p.name,p.desc,p.id,p.cat].join(" ")
   .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().includes(query);
 });
 if(sort==="name")list.sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
 if(sort==="price_asc")list.sort((a,b)=>a.price-b.price);
 if(sort==="price_desc")list.sort((a,b)=>b.price-a.price);
 return list;
}
function makeTextCell(strong,small){
 const td=el("td");td.append(el("b","",strong));if(small)td.append(el("small","",small));return td;
}
function renderTable(){
 const selector=$("#category-filter"),original=selector.value||"Todas";
 const names=[...new Set(STATE.products.map(p=>p.cat).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
 selector.replaceChildren(new Option("Todas as categorias","Todas"));
 for(const name of names)selector.append(new Option(name,name));
 selector.value=names.includes(original)?original:"Todas";
 const rows=filtered(),host=$("#product-rows");host.replaceChildren();
 $("#results-count").textContent=rows.length+" itens";
 for(const p of rows){
  const tr=el("tr"),td=el("td"),wrap=el("div","product-flex");
  const img=el("img","thumb");img.alt="";img.loading="lazy";const src=safeImage(p.thumb||p.photo);if(src)img.src=src;
  const label=el("div");append(label,el("b","",p.name),el("small","",p.id));
  append(wrap,img,label);td.append(wrap);tr.append(td);
  tr.append(makeTextCell(p.cat,""));
  tr.append(makeTextCell(money(Math.round(asNum(p.price)*100)),p.oldPrice!=null?"De "+money(Math.round(asNum(p.oldPrice)*100)):""));
  const availability=el("td");
  availability.append(tag(p.isAvailable===true?"Disponível":"Indisponível",p.isAvailable===true?"yes":""));
  tr.append(availability);
  const controls=el("td");
  const edit=el("button","table-action",canEdit()?"Editar":"Visualizar");
  edit.type="button";edit.addEventListener("click",()=>openEditor(p));controls.append(edit);
  tr.append(controls);host.append(tr);
 }
 if(!rows.length){const tr=el("tr"),td=el("td","","Nenhum produto encontrado.");td.colSpan=5;tr.append(td);host.append(tr)}
}
function normalizeProductList(products){
 if(!Array.isArray(products))throw new Error("Formato inesperado do catálogo.");
 return products.filter(p=>p&&typeof p==="object"&&typeof p.id==="string").map(p=>({
  ...p,name:safeString(p.name),desc:safeString(p.desc),cat:safeString(p.cat),
  photo:safeString(p.photo),thumb:safeString(p.thumb||p.photo),price:asNum(p.price),
  oldPrice:p.oldPrice===null||p.oldPrice===undefined?null:asNum(p.oldPrice),
  isPublished:p.isPublished===true,isAvailable:p.isAvailable===true
 }));
}
async function getPublicCatalog(){
 const result=await api("/api/catalog");
 STATE.products=normalizeProductList(result.products);STATE.inventorySource="public";
 overview();renderTable();
}
async function refreshAll(){
 if(STATE.loading)return;
 STATE.loading=true;
 const button=$("#refresh-dashboard");button.disabled=true;
 try{
  const endpoint=STATE.role?"/api/admin/products":"/api/catalog";
  const result=await api(endpoint);
  STATE.products=normalizeProductList(result.products);
  STATE.inventorySource=STATE.role?"admin":"public";
  overview();renderTable();
 }catch(error){
  if(STATE.role){
   // Account or Access configuration may have changed. Retain public visibility, not edit rights.
   locked("Sessão indisponível. Consulte a configuração do Cloudflare Access.");
   try{await getPublicCatalog()}catch{}
  }else{
   $("#results-count").textContent="Falha ao atualizar";
   $("#product-rows").replaceChildren(el("tr"));
   $("#product-rows").firstChild.append(el("td","",error.message));
   $("#product-rows").firstChild.firstChild.colSpan=5;
  }
 }finally{STATE.loading=false;button.disabled=false}
}
function openEditor(p){
 if(!p&&!canEdit())return;
 STATE.editing=p||null;
 const editable=canEdit();
 $("#dialog-title").textContent=!editable?"Detalhes do produto":p?"Editar produto":"Novo produto";
 $("#field-name").value=p?.name||"";
 $("#field-description").value=p?.desc||"";
 $("#field-category").value=p?.cat||"";
 $("#field-price").value=p?.price?.toFixed(2)||"";
 $("#field-old-price").value=p?.oldPrice?.toFixed(2)||"";
 $("#field-image").value=p?.photo||"";
 $("#field-published").checked=p?.isPublished??false;
 $("#field-available").checked=p?.isAvailable??true;
 $$("#product-dialog input,#product-dialog textarea").forEach(x=>x.disabled=!editable);
 $("#save-product").hidden=!editable;
 $("#save-status").textContent=editable?"":"Somente leitura. Habilite o Cloudflare Access para editar.";
 $("#product-dialog").showModal();
}
function closeEditor(){
 if($("#product-dialog").open)$("#product-dialog").close();
 STATE.editing=null;
}
function priceCents(v){
 if(typeof v!=="string"||!v.trim()||!/^\d{1,7}(?:\.\d{1,2})?$/.test(v.trim()))throw new Error("Informe um valor em reais com até duas casas decimais.");
 const [integer,fraction=""]=v.trim().split(".");
 const cents=Number(integer)*100+Number(fraction.padEnd(2,"0"));
 if(!Number.isSafeInteger(cents)||cents>100000000)throw new Error("Preço fora do limite permitido.");
 return cents;
}
async function saveProduct(event){
 event.preventDefault();
 if(!canEdit()||!STATE.csrf)return;
 const button=$("#save-product");
 if(button.disabled)return;
 let body;
 try{
  const name=$("#field-name").value.trim(),description=$("#field-description").value.trim(),category=$("#field-category").value.trim();
  const price=priceCents($("#field-price").value),previous=$("#field-old-price").value.trim();
  const oldPrice=previous?priceCents(previous):null;
  const image=$("#field-image").value.trim();
  if(name.length<2||category.length<2||name.length>180||category.length>80)throw new Error("Informe um nome e uma categoria válidos.");
  if(description.length>2000)throw new Error("A descrição excede 2.000 caracteres.");
  if(oldPrice!==null&&oldPrice<price)throw new Error("O preço anterior não pode ser menor que o preço atual.");
  if(!safeImage(image))throw new Error("Imagem não autorizada: use HTTPS de um domínio de fotos aprovado.");
  body={name,description,category,price_cents:price,old_price_cents:oldPrice,image_url:image,
   thumbnail_url:STATE.editing?.thumb||image,tag:STATE.editing?.tag||null,
   is_published:Number($("#field-published").checked),is_available:Number($("#field-available").checked)};
  if(STATE.editing)body.version=STATE.editing.version;
 }catch(error){$("#save-status").textContent=error.message;return}
 button.disabled=true;$("#save-status").textContent="Salvando…";
 try{
  const editing=STATE.editing;
  await api(editing?"/api/admin/products/"+encodeURIComponent(editing.id):"/api/admin/products",{
   method:editing?"PATCH":"POST",
   headers:{"Content-Type":"application/json","X-CSRF-Token":STATE.csrf},
   body:JSON.stringify(body)
  });
  STATE.loading=false;
  await refreshAll();closeEditor();
 }catch(error){
  $("#save-status").textContent=error.message.includes("versão")||error.message.includes("concorren")?
   "Este produto foi alterado em outra sessão. Recarregue o catálogo antes de editar novamente.":
   error.message;
 }finally{button.disabled=false}
}
async function loadAudit(){
 const host=$("#audit-rows");
 if(STATE.role!=="owner"){host.textContent="Somente o proprietário autorizado pode consultar o histórico.";return}
 host.textContent="Carregando histórico…";
 try{
  const data=await api("/api/admin/audit");host.replaceChildren();
  if(!Array.isArray(data.events)||!data.events.length){host.textContent="Nenhuma alteração registrada.";return}
  for(const entry of data.events){
   const row=el("div","audit-row"),left=el("span");
   append(left,el("strong","",safeString(entry.action)+" · "+safeString(entry.entity_id)));
   append(row,left,el("small","",safeString(entry.actor)+" · "+safeString(entry.created_at)));host.append(row);
  }
 }catch(error){host.textContent=error.message}
}
async function loadIntegrations(){
 try{
  const config=await api("/api/store/config");STATE.store=config;
  $("#int-summary").textContent=
   "Pedidos: "+(config.orders_enabled?"habilitados":"desativados")+" · Pagamentos: "+(config.payments_enabled?"habilitados":"desativados")+
   " · Rastreamento: "+(config.tracking_enabled?"habilitado":"desativado")+
   ". Estes dados refletem o ambiente de homologação.";
 }catch{$("#int-summary").textContent="Não foi possível consultar as configurações de homologação."}
 if(!STATE.role){
  $("#int-mp-state").textContent="Não conectado";
  $("#int-mp-detail").textContent="Sem autorização para inspecionar credenciais de teste";
  return;
 }
 try{
  const mp=await api("/api/admin/integrations/mercadopago");
  const configured=mp.test_access_token_configured&&mp.test_webhook_secret_configured&&mp.test_application_id_configured;
  $("#int-mp-state").textContent=configured?"Sandbox configurado":"Configuração incompleta";
  $("#int-mp-state").className="integration-status "+(configured?"ready":"pending");
  $("#int-mp-detail").textContent=configured?
   "Somente credenciais de teste — pagamento real desabilitado":
   "Ainda faltam credenciais e/ou configuração de webhooks de teste";
 }catch{
  $("#int-mp-state").textContent="Sem acesso ao status";
  $("#int-mp-state").className="integration-status pending";
  $("#int-mp-detail").textContent="Consulte o ambiente de testes com uma conta autorizada";
 }
}
const SUPPORT=Object.freeze({
 delivery:{
  intro:"Onde está meu pedido?",
  answer:"No sistema final, o status virá do pedido registrado e do provedor de entrega. Neste ambiente não existe pedido real, GPS nem entregador para acompanhar."
 },
 change:{
  intro:"Preciso mudar o endereço de entrega.",
  answer:"Antes de permitir alterações, a CK Sushi precisará definir até qual etapa o endereço pode ser mudado. Um atendente autorizado deverá confirmar a solicitação."
 },
 refund:{
  intro:"Quero cancelar um pedido ou pedir reembolso.",
  answer:"A política e os prazos devem ser aprovados pelo restaurante. O sistema não efetua cancelamentos financeiros sem confirmação do provedor e registro auditável."
 }
});
function previewSupport(topic){
 if(!Object.hasOwn(SUPPORT,topic))return;
 $$("[data-topic]").forEach(button=>button.classList.toggle("active",button.dataset.topic===topic));
 const host=$("#chat-messages");host.replaceChildren();
 append(host,el("div","chat-message note","CONVERSA EXEMPLIFICATIVA · NÃO ENVIADA"),el("div","chat-message user",SUPPORT[topic].intro),
  el("div","chat-message assistant",SUPPORT[topic].answer));
}
function csvCell(v){
 let text=String(v??"");
 // Prevent spreadsheet formula execution on opening a downloaded CSV.
 if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
function exportCatalog(){
 if(!STATE.products.length)return;
 const header=["Código","Nome","Descrição","Categoria","Preço R$","Preço anterior R$","Publicado","Disponível"];
 const lines=STATE.products.map(p=>[
  p.id,p.name,p.desc,p.cat,p.price.toFixed(2),p.oldPrice==null?"":p.oldPrice.toFixed(2),
  p.isPublished?"Sim":"Não",p.isAvailable?"Sim":"Não"].map(csvCell).join(";"));
 const csv="\uFEFF"+header.map(csvCell).join(";")+"\r\n"+lines.join("\r\n")+"\r\n";
 const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");
 link.href=url;link.download="ck-sushi-catalogo-staging.csv";
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function focusSearch(){
 go("products");
 const input=$("#product-search");
 input.focus({preventScroll:true});
}
function setToday(){
 const now=new Date();
 const date=new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"numeric",month:"short",timeZone:"America/Sao_Paulo"}).format(now);
 $("#today-label").textContent="CK SUSHI · "+date.toLocaleUpperCase("pt-BR");
 const hour=Number(new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",hourCycle:"h23",timeZone:"America/Sao_Paulo"}).format(now));
 $("#welcome-greeting").textContent=hour<12?"Bom dia, equipe CK.":hour<18?"Boa tarde, equipe CK.":"Boa noite, equipe CK.";
}

const ORDER_STATUS_NAMES=Object.freeze({
 pending_payment:"Aguardando pagamento",paid:"Pago",accepted:"Aceito",preparing:"Em preparo",
 ready:"Pronto",awaiting_courier:"Aguardando entrega",courier_assigned:"Entregador atribuído",
 picked_up:"Retirado",delivery_exception:"Problema na entrega",delivered:"Entregue",
 cancelled:"Cancelado",refund_pending:"Reembolso pendente",refund_failed:"Falha no reembolso",refunded:"Reembolsado"
});
let orderPageCursor=null,orderGroup="all",loadedOrders=[];
function renderOrderFeed(){
 const host=$("#order-feed");host.replaceChildren();
 $("#orders-count-label").textContent=loadedOrders.length+" REGISTRO(S) CARREGADOS";
 $("#orders-empty-state").hidden=loadedOrders.length>0;
 $("#orders-load-more").hidden=!orderPageCursor;
 for(const order of loadedOrders){
  if(!order||typeof order.id!=="string"||!ORDER_STATUS_NAMES[order.status])continue;
  const button=el("button","order-feed-row");button.type="button";
  const left=el("span","order-feed-description");
  append(left,el("strong","",order.id),el("small","",String(order.placed_at||"").slice(0,16).replace("T"," ")));
  const right=el("span","order-feed-value");
  append(right,el("strong","",money(Number(order.total_cents)||0)),el("small","",ORDER_STATUS_NAMES[order.status]));
  append(button,left,right);
  button.addEventListener("click",()=>void showOrderDetail(order.id));host.append(button);
 }
}
async function loadOrders({append=false}={}){
 if(!STATE.role)return;
 const params=new URLSearchParams({limit:"30"});
 if(orderGroup!=="all")params.set("group",orderGroup);
 if(append&&orderPageCursor)params.set("cursor",orderPageCursor);
 try{
  const res=await api("/api/admin/orders?"+params.toString());
  if(!Array.isArray(res.orders))throw Error("INVALID_ORDERS_RESPONSE");
  loadedOrders=append?[...loadedOrders,...res.orders]:res.orders;
  orderPageCursor=typeof res.next_cursor==="string"?res.next_cursor:null;
  renderOrderFeed();
 }catch{
  if(!append){loadedOrders=[];orderPageCursor=null;renderOrderFeed()}
  $("#orders-empty-title").textContent="Não foi possível consultar os pedidos.";
 }
}
async function showOrderDetail(id){
 if(!STATE.role||!/^[A-Za-z0-9_-]{8,120}$/.test(String(id)))return;
 const host=$("#order-details");host.hidden=false;host.replaceChildren(el("p","muted","Carregando detalhes…"));
 try{
  const res=await api("/api/admin/orders/"+encodeURIComponent(id));
  if(res.order?.id!==id||!Array.isArray(res.items)||!Array.isArray(res.events))throw Error("INVALID_DETAILS");
  host.replaceChildren();
  append(host,el("span","eyebrow","PEDIDO"),el("h3","",id),
    el("p","",ORDER_STATUS_NAMES[res.order.status]||"Em análise"),
    el("strong","",money(Number(res.order.total_cents)||0)));
  const lines=el("div","order-detail-items");
  for(const item of res.items){
   const row=el("div");
   append(row,el("span","",String(item.quantity)+" × "+String(item.name_snapshot||"Item")),
     el("strong","",money(Number(item.total_cents)||0)));
   lines.append(row);
  }
  host.append(lines,el("small","muted",res.events.length+" evento(s) no histórico"));
 }catch{host.replaceChildren(el("p","muted","Não foi possível carregar os detalhes do pedido."))}
}

function orderFilter(value){
 const labels={all:"Nenhum pedido real ainda.",pending:"Nenhum pedido em andamento.",done:"Nenhum pedido concluído.",cancelled:"Nenhum pedido cancelado."};
 if(!Object.hasOwn(labels,value))return;
 $$("[data-order-filter]").forEach(button=>{
  const selected=button.dataset.orderFilter===value;
  button.classList.toggle("active",selected);
  button.setAttribute("aria-pressed",String(selected));
 });
 orderGroup=value;
 $("#orders-empty-title").textContent=labels[value];
 if(STATE.role)void loadOrders();
}
async function boot(){
 $$("#admin-layout [data-tab]").forEach(button=>button.addEventListener("click",()=>go(button.dataset.tab)));
 $("#open-sidebar").addEventListener("click",openNav);
 $("#close-sidebar").addEventListener("click",closeNav);
 $("#nav-backdrop").addEventListener("click",closeNav);
 $("#mobile-more").addEventListener("click",openNav);
 $("#top-search-trigger").addEventListener("click",focusSearch);
 $("#notification-button").addEventListener("click",()=>go("integrations"));
 window.addEventListener("keydown",event=>{
  if(event.key==="Escape")closeNav();
  if(event.key==="/"&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&
   !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)){
   event.preventDefault();focusSearch();
  }
 });
 $$("[data-order-filter]").forEach(button=>button.addEventListener("click",()=>orderFilter(button.dataset.orderFilter)));
 $("#product-search").addEventListener("input",renderTable);
 $("#category-filter").addEventListener("change",renderTable);
 $("#product-status").addEventListener("change",renderTable);
 $("#product-sort").addEventListener("change",renderTable);
 $("#clear-filters").addEventListener("click",()=>{
  $("#product-search").value="";$("#category-filter").value="Todas";$("#product-status").value="all";$("#product-sort").value="original";renderTable();
 });
 $("#new-product").addEventListener("click",()=>openEditor(null));
 $("#orders-load-more").addEventListener("click",()=>{if(orderPageCursor)void loadOrders({append:true})});
 $("#refresh-dashboard").addEventListener("click",refreshAll);
 $("#refresh-integrations").addEventListener("click",loadIntegrations);
 $("#export-catalog").addEventListener("click",exportCatalog);
 $("#refresh-audit").addEventListener("click",loadAudit);
 $$("#admin-layout [data-topic]").forEach(button=>button.addEventListener("click",()=>previewSupport(button.dataset.topic)));
 $("#close-dialog").addEventListener("click",closeEditor);
 $("#cancel-dialog").addEventListener("click",closeEditor);
 $("#product-form").addEventListener("submit",saveProduct);
 $("#product-dialog").addEventListener("click",event=>{
  if(event.target===$("#product-dialog"))closeEditor();
 });
 setToday();
 previewSupport("delivery");
 const initial=location.hash.slice(1);
 window.addEventListener("hashchange",()=>{const t=location.hash.slice(1);if(Object.hasOwn(TABS,t)&&t!==STATE.tab)go(t)});

 go(Object.hasOwn(TABS,initial)?initial:"overview");
 try{await getPublicCatalog()}
 catch(error){
  $("#product-rows").replaceChildren();
  const tr=el("tr"),td=el("td","", "O catálogo está indisponível: "+error.message);td.colSpan=5;tr.append(td);$("#product-rows").append(tr);
  $("#session-status").textContent="Catálogo indisponível";
 }
 try{
  const session=await api("/api/admin/session");
  authorized(session);
  await refreshAll();
 }catch(error){locked(error.message)}
}
document.addEventListener("DOMContentLoaded",boot);
