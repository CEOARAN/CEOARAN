"use strict";
const $=q=>document.querySelector(q);
const STATE={products:[],role:null,email:null,csrf:null,editing:null,tab:"overview"};
const money=c=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100);
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node};
const append=(parent,...children)=>children.forEach(c=>parent.append(c));
function go(tab){STATE.tab=tab;document.querySelectorAll("[data-tab]").forEach(n=>n.classList.toggle("selected",n.dataset.tab===tab));document.querySelectorAll(".tab").forEach(n=>n.classList.toggle("active",n.id==="tab-"+tab));$("#section-heading").textContent={overview:"Visão geral",products:"Produtos",compliance:"Privacidade e LGPD",audit:"Auditoria"}[tab]||"Admin";if(tab==="audit"&&STATE.role==="owner")loadAudit()}
async function api(path,options={}){const res=await fetch(path,{...options,credentials:"same-origin",cache:"no-store",headers:{"Accept":"application/json",...options.headers}});let data;try{data=await res.json()}catch{data={ok:false,message:"Resposta inesperada do servidor."}}if(!res.ok)throw new Error(data.message||data.code||"Falha de comunicação");return data}
function locked(reason){$("#session-status").textContent="Edição bloqueada";$("#security-title").textContent="Acesso administrativo bloqueado";$("#security-desc").textContent=reason||"A edição exige autenticação Cloudflare Access validada no servidor e identidade expressamente autorizada.";$("#new-product").disabled=true;$("#refresh-audit").disabled=true;renderTable()}
function authorized(data){STATE.role=data.role;STATE.email=data.email;STATE.csrf=data.csrf;$("#session-status").textContent=data.email+" · "+data.role;$("#security-banner").classList.add("authorized");$("#security-title").textContent="Sessão autenticada e autorizada";$("#security-desc").textContent="As operações são verificadas no servidor, protegidas por token anti-CSRF e registradas na auditoria. Pedidos e pagamentos reais continuam bloqueados.";$(".lock-mark").textContent="✓";$("#new-product").disabled=false;$("#refresh-audit").disabled=data.role!=="owner"}
function overview(){const products=STATE.products;$("#stat-total").textContent=products.length;$("#stat-categories").textContent=new Set(products.map(p=>p.cat)).size;$("#stat-promotions").textContent=products.filter(p=>p.oldPrice!==null&&p.oldPrice>p.price).length;const host=$("#recent-products");host.replaceChildren();products.slice(0,6).forEach(p=>{const row=el("div","recent"),name=el("strong","",p.name),price=el("small","",money(Math.round(p.price*100)));append(row,name,price);host.append(row)})}
function makeTextCell(strong,small){const cell=el("td"),b=el("b","",strong);cell.append(b);if(small)cell.append(el("small","",small));return cell}
function filtered(){const search=($("#product-search").value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();const category=$("#category-filter").value;return STATE.products.filter(p=>(category==="Todas"||p.cat===category)&&[p.name,p.desc,p.id,p.cat].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().includes(search))}
function renderTable(){const categories=[...new Set(STATE.products.map(p=>p.cat))].sort((a,b)=>a.localeCompare(b,"pt-BR")),selector=$("#category-filter"),selection=selector.value;selector.replaceChildren(new Option("Todas as categorias","Todas"));categories.forEach(x=>selector.append(new Option(x,x)));selector.value=categories.includes(selection)?selection:"Todas";
 const rows=filtered(),tbody=$("#product-rows");tbody.replaceChildren();$("#results-count").textContent=rows.length+" itens";
 for(const p of rows){const tr=el("tr"),td=el("td"),wrap=el("div","product-flex"),img=el("img","thumb");img.src=p.photo;img.alt="";img.loading="lazy";const description=el("div");append(description,el("b","",p.name),el("small","",p.id));append(wrap,img,description);td.append(wrap);tr.append(td);
 tr.append(makeTextCell(p.cat,null));
 const price=makeTextCell(money(Math.round(p.price*100)),p.oldPrice!=null?("De "+money(Math.round(p.oldPrice*100))):null);tr.append(price);
 const availability=el("td"),status=el("span","tag "+(p.isAvailable!==false?"yes":""),p.isAvailable!==false?"Sim":"Indisponível");availability.append(status);tr.append(availability);
 const controls=el("td"),edit=el("button","table-action",STATE.role?"Editar":"Visualizar");edit.type="button";edit.disabled=!STATE.role;edit.addEventListener("click",()=>openEditor(p));controls.append(edit);tr.append(controls);tbody.append(tr)}
 if(!rows.length){const tr=el("tr"),td=el("td","", "Nenhum produto encontrado.");td.colSpan=5;tr.append(td);tbody.append(tr)}
}
async function refreshAll(){const result=await api("/api/admin/products");STATE.products=result.products;overview();renderTable()}
function openEditor(p){if(!STATE.role)return;STATE.editing=p||null;$("#dialog-title").textContent=p?"Editar produto":"Novo produto";
 $("#field-name").value=p?.name||"";$("#field-description").value=p?.desc||"";$("#field-category").value=p?.cat||"";$("#field-price").value=p?.price?.toFixed(2)||"";$("#field-old-price").value=p?.oldPrice?.toFixed(2)||"";$("#field-image").value=p?.photo||"";$("#field-published").checked=p?.isPublished??false;$("#field-available").checked=p?.isAvailable??true;$("#save-status").textContent="";$("#product-dialog").showModal()}
function closeEditor(){$("#product-dialog").close();STATE.editing=null}
function priceCents(value){const num=Number(value);if(!Number.isFinite(num)||num<0||num>1000000)throw new Error("Informe um preço válido.");return Math.round(num*100)}
async function saveProduct(e){e.preventDefault();if(!STATE.role||!STATE.csrf)return;const button=$("#save-product");let body;try{
 const name=$("#field-name").value.trim(),desc=$("#field-description").value.trim(),category=$("#field-category").value.trim(),oldVal=$("#field-old-price").value.trim(),price=priceCents($("#field-price").value);
 if(name.length<2||category.length<2)throw new Error("Informe nome e categoria.");let oldCents=oldVal===""?null:priceCents(oldVal);if(oldCents!==null&&oldCents<price)throw new Error("O preço anterior não pode ser menor que o atual.");
 body={name,description:desc,category,price_cents:price,old_price_cents:oldCents,image_url:$("#field-image").value.trim(),thumbnail_url:STATE.editing?.thumb||$("#field-image").value.trim(),tag:STATE.editing?.tag||null,is_published:Number($("#field-published").checked),is_available:Number($("#field-available").checked)};
 if(STATE.editing)body.version=STATE.editing.version;
 }catch(error){$("#save-status").textContent=error.message;return}
 button.disabled=true;$("#save-status").textContent="Salvando…";try{
 const editing=STATE.editing;const result=await api(editing?"/api/admin/products/"+encodeURIComponent(editing.id):"/api/admin/products",{method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":STATE.csrf},body:JSON.stringify(body)});
 if(!result.ok)throw Error("Não foi possível salvar.");await refreshAll();closeEditor();
 }catch(error){$("#save-status").textContent=error.message}finally{button.disabled=false}
}
async function loadAudit(){if(STATE.role!=="owner")return;const host=$("#audit-rows");host.textContent="Carregando auditoria…";try{const result=await api("/api/admin/audit");host.replaceChildren();if(!result.events.length){host.textContent="Nenhuma alteração registrada.";return}result.events.forEach(v=>{const row=el("div","audit-row");append(row,el("span","",v.action+" • "+v.entity_id),el("small","",v.actor+" · "+v.created_at));host.append(row)})}catch(e){host.textContent=e.message}}
async function boot(){
 document.querySelectorAll("[data-tab]").forEach(n=>n.addEventListener("click",()=>go(n.dataset.tab)));
 $("#product-search").addEventListener("input",renderTable);$("#category-filter").addEventListener("change",renderTable);
 $("#new-product").addEventListener("click",()=>openEditor(null));$("#refresh-audit").addEventListener("click",loadAudit);
 $("#close-dialog").addEventListener("click",closeEditor);$("#cancel-dialog").addEventListener("click",closeEditor);$("#product-form").addEventListener("submit",saveProduct);
 try{const result=await api("/api/catalog");STATE.products=result.products.map(p=>({...p,thumb:p.thumb||p.photo}));overview();renderTable()}catch(error){$("#product-rows").textContent="O catálogo não está disponível: "+error.message;$("#session-status").textContent="Banco indisponível"}
 try{const session=await api("/api/admin/session");authorized(session);await refreshAll()}catch(error){locked(error.message)}
}
document.addEventListener("DOMContentLoaded",boot);