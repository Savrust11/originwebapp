import fs from "node:fs";
import path from "node:path";
import {openPreview,out} from "./runtime.mjs";
if(!process.argv.includes("--workspace-vnc-confirmed")){
  throw Error("Confirm native workspace VNC access and no external VNC exposure, then pass --workspace-vnc-confirmed. This does not establish per-user medical confidentiality.");
}
if(!fs.existsSync(path.join(out,"index.html")))throw Error("Run build.mjs first.");
let finish;const closed=new Promise(resolve=>{finish=resolve;});
const rt=await openPreview({onClose:finish});
console.log(`Private offline editorial preview ready. Lifecycle metadata: ${rt.metadata}`);
await closed;