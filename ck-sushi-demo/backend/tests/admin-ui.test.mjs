import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Script} from "node:vm";

const file=async name=>readFile(new URL("../"+name,import.meta.url),"utf8");
const [html,css,js]=await Promise.all([file("admin.html"),file("admin.css"),file("admin.js")]);

test("real admin navigation with no permanent generic sidebar and nine functional sections",()=>{
 const pages=["overview","orders","products","categories","analytics","support","integrations","compliance","audit"];
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,"Duplicate HTML IDs");
 for(const page of pages){
  assert.match(html,new RegExp('id="tab-'+page+'"'));
  assert.match(html,new RegExp('data-tab="'+page+'"'));
 }
 assert.match(html,/class="primary-nav"/);
 assert.match(html,/class="mobile-dock"/);
 assert.match(html,/id="admin-sidebar"/);
 assert.doesNotMatch(html,/class="sidebar-scroll"/);
 assert.doesNotMatch(html,/class="hero-summary"/);
 assert.doesNotMatch(html,/class="workbench-primary"/);
 assert.match(css,/\.primary-nav/);
 assert.match(css,/\.mobile-dock/);
 assert.doesNotMatch(css,/\/\* CK Sushi Business Console v9/);
});
test("every UI selector is present in the HTML",()=>{
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
 for(const m of js.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g))
  assert(ids.has(m[1]),"Missing #"+m[1]);
});
test("catalog, categories, orders, report, and support controls are functional",()=>{
 const ids=["stat-total","stat-categories","stat-available","stat-promotions","category-chart",
  "category-rows","product-status","product-sort","product-search","category-filter",
  "product-rows","orders-empty-title","chat-messages","analytics-category-chart",
  "availability-donut","export-catalog","refresh-dashboard","product-dialog"];
 for(const id of ids)assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/function renderCategories\(\)/);
 assert.match(js,/function orderFilter\(/);
 assert.match(js,/function filtered\(/);
 assert.match(js,/function exportCatalog\(/);
 assert.match(js,/sort==="price_asc"/);
 assert.match(js,/status==="hidden"/);
 assert.match(js,/\$\$\("\[data-order-filter\]"\)\.forEach/);
});
test("safe editing, auth and customer privacy invariants",()=>{
 assert.doesNotThrow(()=>new Script(js));
 assert.match(js,/function canEdit\(\)/);
 assert.match(js,/STATE\.csrf/);
 assert.match(js,/\/api\/admin\/session/);
 assert.match(js,/\/api\/admin\/products/);
 assert.match(js,/\/api\/admin\/audit/);
 assert.match(js,/\/api\/catalog/);
 assert.match(js,/function csvCell\(/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|eval\(/);
 assert.doesNotMatch(js,/\.innerHTML\s*=/);
 assert.match(html,/Nenhum pedido recebido/);
 assert.match(html,/Nenhum pedido real ainda/);
 assert.match(html,/Envio desabilitado/);
 assert.match(html,/Cloudflare Access/);
});
test("real mobile UX without horizontal scrolling in product tables",()=>{
 assert.match(html,/<script src="\/admin\/app\.js" defer>/);
 assert.match(html,/<link rel="stylesheet" href="\/admin\/style\.css">/);
 assert.doesNotMatch(html,/\bon(?:click|input|change|load)\s*=/i);
 assert.match(css,/@media\(max-width:620px\)/);
 assert.match(css,/\.products-table tbody\{display:grid/);
 assert.match(css,/\.utility-menu/);
 assert.match(css,/prefers-reduced-motion/);
});
