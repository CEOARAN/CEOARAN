import test from "node:test";
import assert from "node:assert/strict";
import {runStagingMaintenance} from "../jobs/staging-maintenance.mjs";
test("staging scheduled cleanup deletes only expired replay fingerprints and records outcome",async()=>{
 let sql=[],count=0;const db={prepare(statement){sql.push(statement);return {first:async()=>({orders:0,payments:0,tasks:0}),bind(...a){return {run:async()=>{count++;return {meta:{changes:statement.includes("DELETE")?3:1}}}}}}}};
 const result=await runStagingMaintenance(db,Date.parse("2026-11-21T00:00:00Z"));
 assert.equal(result.expiredRemoved,3);assert(sql.some(x=>x.includes("DELETE FROM commerce_webhook_replay_guard")));
 assert(!sql.some(x=>x.includes("DELETE FROM commerce_orders")));assert.equal(count,2);
});
test("maintenance refuses to run when staging unexpectedly contains commerce data",async()=>{
 let mutations=0;const db={prepare:()=>({first:async()=>({orders:1,payments:0,tasks:0}),bind:()=>({run:async()=>{mutations++}})})};
 await assert.rejects(()=>runStagingMaintenance(db),e=>e.code==="STAGING_COMMERCE_DATA_FOUND");assert.equal(mutations,0);
});
