// Cheap syntax/unique-anchor checks only; does not start a DB, browser or app.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { load } from "./adapter-loader.mjs";
import { renderInputPage } from "./ui.mjs";
for(const p of ["tests/run-ephemeral-tests.mjs","tests/run-managed-tests.mjs",
  "tests/fixtures/real-corpus/setup.mts",
  "prototypes/evidence-consultation/fact-display-pilot/render.mjs"]){
  const result=await load(pathToFileURL(path.resolve(p)).href,{},()=>{throw Error("expected adaptation")});
  assert.equal(result.shortCircuit,true);
  assert.equal(result.format,"module");
}
for(const name of ["connection.mts","verify.mts"]){
  await transform(fs.readFileSync(new URL(name,import.meta.url),"utf8"),{loader:"ts",format:"esm",target:"node20"});
}
const html=renderInputPage();
const script=html.slice(html.indexOf("<script>")+8,html.lastIndexOf("</script>"));
new vm.Script(script);
assert(!script.includes("P01")&&!script.includes("P04"));
assert(!html.includes('value="10"')&&!html.includes('value="1"'));
console.log("load-time unique anchors, TypeScript syntax and inline UI syntax passed; no runtime retrieval claimed");