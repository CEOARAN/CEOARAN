import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createContext,runInContext} from "node:vm";

const code=await readFile(new URL("../admin.js",import.meta.url),"utf8");
function setup(){
 const nodes=Object.fromEntries(["#product-search","#category-filter","#product-status","#product-sort"].map(id=>[id,{value:""}]));
 nodes["#category-filter"].value="Todas";
 nodes["#product-status"].value="all";
 nodes["#product-sort"].value="original";
 const context=createContext({document:{querySelector:sel=>nodes[sel],addEventListener:()=>{}},
  location:{origin:"https://staging.test"},URL,Intl,console});
 runInContext(code,context);
 const fixture=[
  {id:"P-1",name:"Sushí de salmão",desc:"salmão",cat:"Combinados",price:29.99,oldPrice:36.99,isPublished:true,isAvailable:true},
  {id:"P-2",name:"Temaki vegano",desc:"sem peixe",cat:"Temakis",price:19,oldPrice:null,isPublished:true,isAvailable:false},
  {id:"P-3",name:"Sashimi",desc:"atum",cat:"Combinados",price:42,oldPrice:null,isPublished:false,isAvailable:false},
  {id:"P-4",name:"Poke",desc:"frio",cat:"Pokes",price:35,oldPrice:null,isPublished:true,isAvailable:true}
 ];
 runInContext("STATE.products="+JSON.stringify(fixture),context);
 return {nodes,run:expr=>runInContext(expr,context)};
}
test("catalog metrics are computed only from loaded products",()=>{
 const {run}=setup(),stats=run("calc()");
 assert.equal(stats.total,4);
 assert.equal(stats.categories.size,3);
 assert.equal(stats.published,3);
 assert.equal(stats.available,2);
 assert.equal(stats.unavailable,2);
 assert.equal(stats.promotions,1);
});
test("accent-insensitive search, combined status filters and ordering",()=>{
 const {nodes,run}=setup();
 nodes["#product-search"].value="salmao";
 assert.equal(run("filtered()[0].id"),"P-1");
 nodes["#product-search"].value="";
 nodes["#category-filter"].value="Combinados";
 assert.equal(run("filtered().length"),2);
 nodes["#product-status"].value="hidden";
 assert.equal(run("filtered()[0].id"),"P-3");
 nodes["#product-status"].value="all";
 nodes["#category-filter"].value="Todas";
 nodes["#product-sort"].value="price_desc";
 assert.equal(run("filtered()[0].id"),"P-3");
 nodes["#product-sort"].value="price_asc";
 assert.equal(run("filtered()[0].id"),"P-2");
});
test("CSV escapes quotes and spreadsheet formulas",()=>{
 const {run}=setup();
 assert.equal(run('csvCell("=HYPERLINK(1)")'),"\"'=HYPERLINK(1)\"");
 assert.equal(run('csvCell("+cmd")'),"\"'+cmd\"");
 assert.equal(run('csvCell("Produto; descrito")'),"\"Produto; descrito\"");
 assert.equal(run('csvCell("abc\\\"def")'),"\"abc\"\"def\"");
});
test("price precision and image host allowlist",()=>{
 const {run}=setup();
 assert.equal(run('priceCents("27.90")'),2790);
 assert.equal(run('priceCents("0.01")'),1);
 assert.throws(()=>run('priceCents("12.999")'),/duas casas/);
 assert.throws(()=>run('priceCents("-20")'),/duas casas/);
 assert.equal(run('safeImage("http://images.unsplash.com/image.jpg")'),"");
 assert.equal(run('safeImage("https://evil.example/pic.jpg")'),"");
 assert.match(run('safeImage("https://images.unsplash.com/image.jpg")'),/^https:\/\/images\.unsplash\.com\//);
});
test("only verified owner/editor state can expose editing actions",()=>{
 const {run}=setup();
 assert.equal(run("canEdit()"),false);
 run('STATE.role="viewer"');
 assert.equal(run("canEdit()"),false);
 run('STATE.role="editor"');
 assert.equal(run("canEdit()"),true);
 run('STATE.role="owner"');
 assert.equal(run("canEdit()"),true);
});
