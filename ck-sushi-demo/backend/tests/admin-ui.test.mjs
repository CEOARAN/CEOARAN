import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Script} from "node:vm";

const files=Object.fromEntries(await Promise.all(["admin.html","admin.css","admin.js"].map(async file=>
 [file,await readFile(new URL("../"+file,import.meta.url),"utf8")])));
const html=files["admin.html"],css=files["admin.css"],js=files["admin.js"];

test("admin UI markup has unique IDs and the complete navigation",()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(ids.length,new Set(ids).size,"Duplicate HTML id");
 const tabs=["overview","products","orders","analytics","support","integrations","compliance","audit"];
 for(const id of tabs){
  assert.match(html,new RegExp('id="tab-'+id+'"'));
  assert.match(html,new RegExp('data-tab="'+id+'"'));
 }
 for(const id of ["product-dialog","product-form","save-product","refresh-audit","category-chart",
  "analytics-category-chart","availability-donut","recent-products","audit-rows","product-rows",
  "stat-total","stat-available","session-status","security-banner"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
});
test("admin page uses standalone same-origin assets and supports mobile",()=>{
 assert.match(html,/<script src="\/admin\/app\.js" defer>/);
 assert.match(html,/<link rel="stylesheet" href="\/admin\/style\.css">/);
 assert.doesNotMatch(html,/<script(?![^>]*src=)[^>]*>/);
 assert.doesNotMatch(html,/\bon(?:click|input|change|load)\s*=/i);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/\prefers-reduced-motion/);
 assert.match(css,/\.mobile-tabbar/);
 assert.match(html,/id="mobile-more"/);
});
test("all simple IDs used by admin UI exist",()=>{
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
 for(const match of js.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g))
  assert(ids.has(match[1]),"Missing "+match[1]);
});
test("admin JS parses and never simulates orders, money or Access privileges",()=>{
 assert.doesNotThrow(()=>new Script(js));
 assert.match(js,/function canEdit\(\)/);
 assert.match(js,/STATE\.role==="owner"/);
 assert.match(js,/STATE\.csrf/);
 assert.match(js,/\/api\/admin\/products/);
 assert.match(js,/\/api\/admin\/audit/);
 assert.match(js,/\/api\/store\/config/);
 assert.match(js,/\/api\/catalog/);
 assert.match(js,/function csvCell\(/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|eval\(/);
 assert.doesNotMatch(js,/\.innerHTML\s*=/);
 assert.match(html,/Nenhum pedido real/i);
 assert.match(html,/Sem GPS ou motorista fictício/i);
});
