import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {chromium} from "playwright";
const here=path.dirname(fileURLToPath(import.meta.url));
export const out=path.resolve(here,"../../../evidence-work/parent-reading-evaluation/conversation-editorial-preview-01");
export async function openPreview({headless=false,onClose=()=>{}}={}){
  const run=fs.mkdtempSync(path.join(out,headless?"verify-owned-":"preview-owned-"));
  const home=path.join(run,"browser-home");fs.mkdirSync(home);
  const metadata=path.join(run,"lifecycle.json");
  const started=new Date(),expires=new Date(started.getTime()+3600000);
  let browser,context,page,timer,closing;
  const checks={externalRequests:0,pageErrors:[],browserClosed:false,homeRemoved:false};
  const write=(state,extra={})=>fs.writeFileSync(metadata,JSON.stringify({state,pid:process.pid,startedAt:started.toISOString(),expiresAt:expires.toISOString(),headless,inputCaptured:false,...extra},null,2));
  write("starting");
  const signal=()=>{void close("signal").catch(()=>{process.exitCode=1;});};
  async function close(reason="owner"){
    if(closing)return closing;
    closing=(async()=>{
      clearTimeout(timer);process.off("SIGINT",signal);process.off("SIGTERM",signal);
      const errors=[];
      try{if(browser?.isConnected())await browser.close();checks.browserClosed=!browser?.isConnected();}catch{errors.push("Owned browser cleanup failed");}
      try{fs.rmSync(home,{recursive:true,force:true});checks.homeRemoved=!fs.existsSync(home);}catch{errors.push("Owned home cleanup failed");}
      write(errors.length?"cleanup-failed":"closed",{reason,closedAt:new Date().toISOString(),browserClosed:checks.browserClosed,homeRemoved:checks.homeRemoved,externalRequests:checks.externalRequests,errors});
      onClose();if(errors.length)throw Error(errors.join("; "));
    })();return closing;
  }
  process.once("SIGINT",signal);process.once("SIGTERM",signal);
  try{
    browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",headless,
      env:{PATH:"/usr/bin:/bin",HOME:home,LANG:"C.UTF-8",DISPLAY:process.env.DISPLAY||":0"},
      args:["--disable-background-networking","--disable-component-update","--disable-sync","--disable-default-apps","--no-first-run","--no-default-browser-check","--disable-domain-reliability","--disable-breakpad","--disable-client-side-phishing-detection","--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,CertificateTransparencyComponentUpdater","--host-resolver-rules=MAP * ~NOTFOUND",...(!headless?["--start-maximized"]:[])]});
    context=await browser.newContext({offline:true,serviceWorkers:"block",acceptDownloads:false,viewport:headless?{width:1280,height:960}:null});
    const target=pathToFileURL(path.join(out,"index.html")).href;
    await context.route("**/*",route=>{
      const url=route.request().url();
      if(url===target||url.startsWith("data:"))return route.continue();
      checks.externalRequests++;return route.abort("blockedbyclient");
    });
    page=await context.newPage();
    page.on("pageerror",e=>checks.pageErrors.push(e.message));
    context.on("page",p=>{if(p!==page)void p.close();});
    await page.exposeBinding("endEditorialPreview",(_source,reason)=>{
      // The only bridge is an end signal; no text input or conversation leaves the page.
      setImmediate(()=>{void close(reason==="ttl"?"ttl":"button").catch(()=>{process.exitCode=1;});});
      return true;
    });
    page.on("close",()=>{void close("window").catch(()=>{process.exitCode=1;});});
    browser.on("disconnected",()=>{void close("disconnected").catch(()=>{process.exitCode=1;});});
    await page.goto(target);await page.evaluate(()=>document.fonts.ready);
    timer=setTimeout(()=>{void close("ttl").catch(()=>{process.exitCode=1;});},3600000);
    write("ready",{mode:"offline-file-workspace-vnc",databaseUsed:false});
    return{browser,context,page,checks,run,metadata,close};
  }catch(e){await close("startup-failed");throw e;}
}