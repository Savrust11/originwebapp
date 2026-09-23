import "../../../tests/safety/require-managed.mjs";
import fs from "node:fs";
import {openRuntime} from "./runtime.mts";
import {out,verifyPreservation} from "./preservation.mjs";
const stamp=new Date().toISOString().replaceAll(":","-");
const session=`${out}/preview-${stamp}`;fs.mkdirSync(session);
let runtime:any,reason="startup_failed",timer:any,stopPoll:any;
try{
  runtime=await openRuntime(true);
  const deadline=new Date(Date.now()+60*60*1000).toISOString();
  await runtime.page.locator("#status").evaluate((el:any,t:string)=>{el.textContent="架空の相談で操作してください。自動終了時刻（UTC）："+t},deadline);
  let finish:any,finished=false;const done=new Promise<void>(resolve=>finish=(why:string)=>{if(!finished){finished=true;reason=why;resolve()}});
  await runtime.page.exposeBinding("endPreviewBridge",async()=>finish("user_end_button"));
  runtime.browser.on("disconnected",()=>finish("browser_closed"));
  const onSignal=()=>finish("termination_signal");
  process.once("SIGTERM",onSignal);process.once("SIGINT",onSignal);
  timer=setTimeout(()=>finish("60_minute_timeout"),60*60*1000);
  stopPoll=setInterval(()=>{if(fs.existsSync(`${session}/stop-request`))finish("owner_stop_request")},500);
  fs.writeFileSync(`${session}/ready.json`,JSON.stringify({ready:true,headful:true,privateVncOnly:true,
    httpServer:false,existingDatabase:false,expiresAt:deadline,storesConsultationInputs:false,
    sources:runtime.initialized.corpus.sources.size,units:runtime.initialized.byUnit.size},null,2)+"\n",{flag:"wx"});
  console.log("PRIVATE_MATERIAL_PREVIEW_READY "+session);
  await done;
  process.off("SIGTERM",onSignal);process.off("SIGINT",onSignal);
}finally{
  clearTimeout(timer);
  clearInterval(stopPoll);
  let cleanupError:null|string=null;
  try{if(runtime)await runtime.close()}catch(e:any){cleanupError=e.message}
  fs.writeFileSync(`${session}/closed.json`,JSON.stringify({closed:cleanupError===null,reason,cleanupError,cleanupStatus:runtime?.cleanupStatus,
    protectedFiles:verifyPreservation(),
    browserDirectoryRemoved:runtime?!fs.existsSync(runtime.temp):true,
    outerDatabaseCleanup:"owner performs cleanup after this managed child exits; check owner exit"},null,2)+"\n",{flag:"wx"});
  console.log("PRIVATE_MATERIAL_PREVIEW_CLOSED "+session);
  if(cleanupError)throw Error(cleanupError);
}