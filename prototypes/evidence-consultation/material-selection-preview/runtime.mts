import "../../../tests/safety/require-managed.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {Pool} from "pg";
import {chromium} from "playwright";
import {initializePrototypeCorpus} from "../../../tests/fixtures/real-corpus/setup.mts";
import {createMaterialGate} from "./gate.mts";
import {renderMaterialPage} from "./ui.mjs";
export async function openRuntime(live=false){
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
  let browser:any,temp:string|undefined;
  let closing:Promise<void>|undefined;
  const cleanupStatus={browserClosed:false,poolEnded:false,browserDirectoryRemoved:false};
  function close(){
    if(closing)return closing;
    closing=(async()=>{
      const failures:string[]=[];
      try{if(browser)await browser.close();cleanupStatus.browserClosed=true}catch{failures.push("browser close failed")}
      try{await pool.end();cleanupStatus.poolEnded=true}catch{failures.push("pool end failed")}
      try{if(temp)fs.rmSync(temp,{recursive:true,force:true});cleanupStatus.browserDirectoryRemoved=!temp||!fs.existsSync(temp)}catch{failures.push("temporary directory removal failed")}
      if(failures.length)throw Error(failures.join("; "));
    })();
    return closing;
  }
  try{
    const initialized=await initializePrototypeCorpus(pool);
    const gate=await createMaterialGate(pool,initialized);
    temp=fs.mkdtempSync(path.join(os.tmpdir(),"material-selection-ui-"));
    fs.writeFileSync(path.join(temp,"index.html"),renderMaterialPage({live}));
    browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",headless:!live,
      ...(live?{env:{PATH:"/usr/bin:/bin",DISPLAY:":0",LANG:"C.UTF-8",HOME:temp}}:{}),
      args:["--disable-background-networking","--disable-component-update","--disable-sync","--host-resolver-rules=MAP * ~NOTFOUND",
        ...(live?["--start-maximized"]:[])]});
    const context=await browser.newContext({offline:true,serviceWorkers:"block",viewport:live?null:{width:390,height:844}});
    let externalRequests=0;
    await context.route("**/*",(r:any)=>{if(/^(file|data):/.test(r.request().url()))return r.continue();externalRequests++;return r.abort()});
    const page=await context.newPage(),errors:string[]=[];
    page.on("pageerror",(e:any)=>errors.push(e.message));
    await page.exposeBinding("searchEvidenceBridge",async(_:any,p:any)=>gate.search(p));
    await page.goto(`file://${path.join(temp,"index.html")}`);
    await page.evaluate(()=>document.fonts.ready);
    return{pool,initialized,gate,browser,context,page,errors,temp,getExternalRequests:()=>externalRequests,close,cleanupStatus};
  }catch(e){try{await close()}catch(cleanupError){throw new AggregateError([e,cleanupError],"Startup and independent cleanup failed")}throw e}
}