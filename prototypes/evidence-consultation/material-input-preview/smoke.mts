import "../../../tests/safety/require-managed.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import {openRuntime} from "./runtime.mts";
import {out,verifyPreservation} from "./preservation.mjs";
import {endButtonSmoke} from "./lifecycle.mts";
const dir=`${out}/smoke-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
const checks:string[]=[];let rt:any,failure:any=null;
const check=(name:string,ok:any)=>{assert(ok,name);checks.push(name)};
try{
  rt=await openRuntime(true);
  await endButtonSmoke(rt,dir,check);
  check("外部通信なし",rt.getExternalRequests()===0);
}catch(e:any){failure={message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]")};throw e}
finally{
  if(rt)await rt.close();
  fs.writeFileSync(`${dir}/results.json`,JSON.stringify({result:failure?"FAILED":"PASSED",failure,checks,headful:true,cleanupStatus:rt?.cleanupStatus,preservedFiles:verifyPreservation(),outerCleanup:"外側ランナー終了後の証跡で別途確認"},null,2));
}