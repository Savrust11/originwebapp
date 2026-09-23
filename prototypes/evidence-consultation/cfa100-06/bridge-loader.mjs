import path from "node:path";
import fs from "node:fs";
import { fileURLToPath,pathToFileURL } from "node:url";
import { directory, output, pinned, sha } from "./prepare.mjs";
const virtual=new Map([["native-adapter.mjs","adapter-loader.mjs"],["runner-child.mjs","runner-child.mjs"],["verify.mts","verify.mts"],["search-adapter.mjs","search-adapter.mjs"]]);
export async function resolve(specifier,context,nextResolve){
  const url=specifier.startsWith("file:")?new URL(specifier):specifier.startsWith("/")?pathToFileURL(specifier):specifier.startsWith(".")&&context.parentURL?new URL(specifier,context.parentURL):null;
  if(url?.protocol==="file:"){
    const p=fileURLToPath(url);
    if(p===path.resolve(directory,"../search-repair-05/prepare.mjs"))return {url:new URL("./prepare.mjs",import.meta.url).href,shortCircuit:true};
    if(path.dirname(p)===directory&&virtual.has(path.basename(p)))return {url:url.href,shortCircuit:true};
  }
  return nextResolve(specifier,context);
}
export async function load(url,context,nextLoad){
  if(url.startsWith("file:")&&path.dirname(fileURLToPath(url))===directory){
    const name=virtual.get(path.basename(fileURLToPath(url)));
    if(name){
      let source;
      if(name==="search-adapter.mjs")source=pinned("prototypes/evidence-consultation/search-repair-05/search-adapter.mjs");
      else {
        const checked=pinned("prototypes/evidence-consultation/search-repair-05/checked-adapter.mjs").replace('"./prepare.mjs"',JSON.stringify(new URL("./prepare.mjs",import.meta.url).href));
        const {adapt}=await import(`data:text/javascript;base64,${Buffer.from(checked).toString("base64")}`);
        source=adapt(name).replaceAll("search-repair-05","cfa100-06");
        if(name==="adapter-loader.mjs")source=source.replace('  record(relative, original, source, adaptation);',`  if(relative === "tests/run-managed-tests.mjs") source = source.replace("function emitSafeChildDiagnostic(kind, output) {", 'function emitSafeChildDiagnostic(kind, output) {\\n  fs.writeFileSync(${JSON.stringify(path.join(output,"managed-child-failure.txt"))}, output);');\n  record(relative, original, source, adaptation);`);
        if(name==="runner-child.mjs")source=source.replace('if (code !== 0) {',`if (code !== 0) {\n      (await import("node:fs")).writeFileSync(${JSON.stringify(path.join(output,"owned-child-failure.txt"))},output);`);
      }
      fs.writeFileSync(path.join(output,`final-adapter-${name}.json`),JSON.stringify({adaptedSha256:sha(source),normalFilesEdited:false}));
      if(name.endsWith(".mts"))source=(await(await import("esbuild")).transform(source,{loader:"ts",format:"esm",target:"node20"})).code;
      return {format:"module",source,shortCircuit:true};
    }
  }
  return nextLoad(url,context);
}