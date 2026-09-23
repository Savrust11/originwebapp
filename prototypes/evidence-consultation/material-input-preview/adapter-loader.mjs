import fs from "node:fs";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {transform} from "esbuild";
const base=new URL("../material-selection-preview/",import.meta.url);
const directory=fileURLToPath(new URL("./",import.meta.url)).replace(/\/$/,"");
let live=false, smoke=false, prior;
export function initialize(data){live=data.live===true;smoke=data.smoke===true}
export async function resolve(specifier,context,nextResolve){
  const candidate=new URL(specifier,context.parentURL||import.meta.url);
  if(candidate.href.startsWith(new URL("./",import.meta.url).href)&&["runtime.mts","preview.mts","gate.mts","preservation.mjs","stop-preview.mjs"].includes(candidate.pathname.split("/").pop()))
    return{url:candidate.href,shortCircuit:true};
  return nextResolve(specifier,context);
}
function once(s,a,b){assert.equal(s.split(a).length,2,`unique successor anchor: ${a}`);return s.replace(a,b)}
function record(name,original,source){
  const out=new URL("../../../evidence-work/parent-reading-evaluation/material-input-preview-01/",import.meta.url);
  fs.mkdirSync(out,{recursive:true});
  const sha=s=>createHash("sha256").update(s).digest("hex");
  const text=JSON.stringify({name,originalSha256:sha(original),adaptedSha256:sha(source),originalFileChanged:false},null,2)+"\n";
  const dest=new URL(`successor-${name}-${sha(source).slice(0,12)}.json`,out);
  if(fs.existsSync(dest))assert.equal(fs.readFileSync(dest,"utf8"),text);else fs.writeFileSync(dest,text,{flag:"wx"});
}
export async function load(url,context,nextLoad){
  // The delegate itself is a data: module. Do not recursively initialize it
  // while Node is awaiting that very module. Its esbuild dependency is already
  // loaded above, before registration installs this hook.
  if(!url.startsWith("file:"))return nextLoad(url,context);
  if(!prior){
    let s=fs.readFileSync(new URL("adapter-loader.mjs",base),"utf8");
    s=s.replaceAll("material-selection-preview","material-input-preview").replaceAll("material-selection-live","material-input-live");
    if(smoke)s=once(s,'.replaceAll("vocabulary-inventory-review","material-input-preview");','.replaceAll("vocabulary-inventory-review","material-input-preview").replaceAll("verify.mts","smoke.mts").replaceAll("register.mjs","register-smoke.mjs");');
    s=once(s,'const directory=path.dirname(fileURLToPath(import.meta.url));\nconst root=',`const directory=${JSON.stringify(directory)};\nconst root=`);
    s=s.replaceAll('new URL("../../../node_modules/esbuild/lib/main.js",import.meta.url)',`new URL(${JSON.stringify(new URL("../../../node_modules/esbuild/lib/main.js",import.meta.url).href)})`);
    s=s.replace('from "esbuild"',`from ${JSON.stringify(new URL("../../../node_modules/esbuild/lib/main.js",import.meta.url).href)}`);
    prior=await import("data:text/javascript;base64,"+Buffer.from(s).toString("base64"));prior.initialize({live});
  }
  const own=new URL("./",import.meta.url).href;
  if(url.startsWith(own)&&["runtime.mts","preview.mts","gate.mts","preservation.mjs","stop-preview.mjs"].includes(url.slice(own.length))){
    const name=url.slice(own.length), original=fs.readFileSync(new URL(name,base),"utf8");
    let source=original.replaceAll("material-selection-preview","material-input-preview");
    if(name==="runtime.mts")source=once(source,'from "./ui.mjs"','from "./ui.mjs"');
    record(name,original,source);
    return{format:"module",shortCircuit:true,source:(await transform(source,{loader:name.endsWith(".mts")?"ts":"js",format:"esm"})).code};
  }
  const result=await prior.load(url,context,nextLoad);
  if(url.endsWith("/retrieval-fact-connection/connection.mts")){
    const original=String(result.source);
    let source=once(original,"sleep?.link === true ? proof : null","evidenceAvailable && age !== undefined && age >= 12 && age < 36 ? proof : null");
    source=once(source,"hasSleep && sleep?.link === true","hasSleep && evidenceAvailable");
    source=`import {checkSupplement} from ${JSON.stringify(new URL("./provenance.mjs",import.meta.url).href)};\n`+once(source,"let sqlCalls = 0;",`const evidenceAvailable = checkSupplement(minutes, initialized).available;
    let sqlCalls = 0;`);
    record("connection",original,source);return{...result,source};
  }
  if(url.endsWith("/flow.ts")){
    const original=String(result.source);
    // esbuild/tsx may already have transformed this module. Adapt the original TS
    // instead, checking the exact age function before compilation.
    let source=fs.readFileSync(fileURLToPath(url),"utf8");
    source=once(source,"export function ageMonthsForChild(child", "export function ageMonthsForChild(child");
    const marker="export function ageMonthsForChild";
    const at=source.indexOf("{",source.indexOf(marker));
    source=source.slice(0,at+1)+"\n if (child?.years === null || child?.years === undefined) return undefined;\n"+source.slice(at+1);
    record("flow",original,source);
    return{format:"module",shortCircuit:true,source:(await transform(source,{loader:"ts",format:"esm"})).code};
  }
  return result;
}