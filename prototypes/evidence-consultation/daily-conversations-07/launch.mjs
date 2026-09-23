import fs from "node:fs";
import path from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

if(!process.argv.includes("--workspace-vnc-confirmed"))
  throw Error("Confirm native workspace VNC access and no external VNC exposure, then pass --workspace-vnc-confirmed.");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const out=path.join(root,"evidence-work/daily-conversations-07/preview");
const runtime=path.join(out,"adapted-runtime.mjs");
if(!fs.existsSync(path.join(out,"index.html"))||!fs.existsSync(runtime))throw Error("Run build.mjs first.");
const {openPreview}=await import(pathToFileURL(runtime));
let finish;const closed=new Promise(resolve=>{finish=resolve});
const rt=await openPreview({onClose:finish});
console.log(`Private offline authored preview ready. Lifecycle metadata: ${rt.metadata}`);
await closed;