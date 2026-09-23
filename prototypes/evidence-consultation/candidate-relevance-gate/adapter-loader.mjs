import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {transform} from "esbuild";
const directory=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(directory,"../../..");
const out=path.join(root,"evidence-work/parent-reading-evaluation/candidate-relevance-gate-01");
const hash=s=>createHash("sha256").update(s).digest("hex");
function once(s,a,b){assert.equal(s.split(a).length,2,`unique adapter anchor: ${a}`);return s.replace(a,b)}
export async function load(url,context,nextLoad){
  if(!url.startsWith("file:"))return nextLoad(url,context);
  const rel=path.relative(root,fileURLToPath(url));
  // Reuse the previous checked loader by changing only its owned suite paths.
  if(rel==="prototypes/evidence-consultation/candidate-relevance-gate/prior-adapter.mjs")throw Error("no copied adapter file permitted");
  const ownTargets=["tests/run-ephemeral-tests.mjs","tests/run-managed-tests.mjs","tests/fixtures/real-corpus/setup.mts",
    "prototypes/evidence-consultation/fact-display-pilot/render.mjs","prototypes/evidence-consultation/retrieval-fact-connection/ui.mjs"];
  if(ownTargets.includes(rel)){
    const prior=path.join(root,"prototypes/evidence-consultation/vocabulary-inventory-review/adapter-loader.mjs");
    let source=fs.readFileSync(prior,"utf8");
    source=source.replaceAll("vocabulary-inventory-review","candidate-relevance-gate");
    // Evaluate this loader at this module URL, preserving its relative root.
    source=source.replace('const directory=path.dirname(fileURLToPath(import.meta.url));',`const directory=${JSON.stringify(directory)};`);
    const adapter=await import("data:text/javascript;base64,"+Buffer.from(source
      .replace('from "esbuild"','from '+JSON.stringify(new URL("../../../node_modules/esbuild/lib/main.js",import.meta.url).href))).toString("base64"));
    return adapter.load(url,context,nextLoad);
  }
  if(rel!=="prototypes/evidence-consultation/retrieval-fact-connection/connection.mts")return nextLoad(url,context);
  const original=fs.readFileSync(fileURLToPath(url),"utf8");let source=original;
  source=once(source,'html:facts.map(factHtml).join(""),','html:payload.candidateOnly ? "" : facts.map(factHtml).join(""),');
  source=once(source,'const hasSleep=items.some(i=>i.factIds.includes("sleep-guidance"));',
    'const hasSleep=!payload.candidateOnly && items.some(i=>i.factIds.includes("sleep-guidance"));');
  source=once(source,'for (const unit of candidates as any[]) {',
    'for (const unit of candidates as any[]) {\n           if(payload.allowedUnitIds && !payload.allowedUnitIds.includes(unit.id)) continue;');
  const record={path:rel,originalSha256:hash(original),adaptedSha256:hash(source),
    changes:"candidateOnly bypasses factHtml and evaluateSleep before relevance gate; no frozen file edit"};
  const p=path.join(out,"adaptation-connection.json"),text=JSON.stringify(record,null,2)+"\n";
  if(fs.existsSync(p))assert.equal(fs.readFileSync(p,"utf8"),text);else fs.writeFileSync(p,text,{flag:"wx"});
  return{format:"module",source:(await transform(source,{loader:"ts",format:"esm",target:"node20"})).code,shortCircuit:true};
}