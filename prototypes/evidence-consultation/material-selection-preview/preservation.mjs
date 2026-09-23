import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
export const out="evidence-work/parent-reading-evaluation/material-selection-preview-01";
const skip=[out,"prototypes/evidence-consultation/material-selection-preview"];
export const hash=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
export function baseline(){
  fs.mkdirSync(out,{recursive:true});
  const p=out+"/preservation-baseline.json";
  if(fs.existsSync(p))return JSON.parse(fs.readFileSync(p,"utf8"));
  const files=[];function walk(d){if(skip.includes(d)||!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile())files.push(p)}}
  for(const d of ["server","shared","client","tests/fixtures/real-corpus","prototypes/evidence-consultation","evidence-work"])walk(d);
  const b={createdAt:new Date().toISOString(),scope:"historical files before execution; successor implementation excluded",entries:files.map(p=>({path:p,sha256:hash(p)}))};
  fs.writeFileSync(p,JSON.stringify(b,null,2)+"\n",{flag:"wx"});return b;
}
export function verifyPreservation(){const b=baseline();const changed=b.entries.filter(f=>!fs.existsSync(f.path)||hash(f.path)!==f.sha256);if(changed.length)throw Error("Historical files changed");return b.entries.length}
baseline();