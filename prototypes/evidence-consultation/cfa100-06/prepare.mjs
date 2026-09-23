import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
export const directory = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(directory, "../../..");
export const output = path.join(root,"evidence-work/cfa100-06/validation");
export const sha = x => createHash("sha256").update(x).digest("hex");
export function preservation(create=false) {
  const prior=JSON.parse(fs.readFileSync(path.join(root,"evidence-work/search-repair-05/validation/preservation.json")));
  const walk=p=>fs.readdirSync(path.join(root,p),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
    assert(!e.isSymbolicLink());const name=`${p}/${e.name}`;
    return e.isDirectory()?walk(name):[{path:name,sha256:sha(fs.readFileSync(path.join(root,name)))}];
  });
  const files=[...prior.files,...walk("prototypes/evidence-consultation/search-repair-05"),...walk("evidence-work/search-repair-05")];
  for(const f of prior.files)assert.equal(sha(fs.readFileSync(path.join(root,f.path))),f.sha256);
  fs.mkdirSync(output,{recursive:true});
  const manifest=path.join(output,"preservation.json");
  if(!fs.existsSync(manifest)){assert(create);fs.writeFileSync(manifest,JSON.stringify({currentUnits:51,files},null,2),{flag:"wx"});}
  else assert.deepEqual(JSON.parse(fs.readFileSync(manifest)).files,files,"frozen corpus bytes changed");
  return files;
}
export function pinned(relative) {
  const f=JSON.parse(fs.readFileSync(path.join(output,"preservation.json"))).files.find(f=>f.path===relative);
  assert(f,relative);const text=fs.readFileSync(path.join(root,relative),"utf8");assert.equal(sha(text),f.sha256);return text;
}
export function once(text,anchor,replacement){assert.equal(text.split(anchor).length,2,`nonunique anchor: ${anchor.slice(0,80)}`);return text.replace(anchor,replacement);}