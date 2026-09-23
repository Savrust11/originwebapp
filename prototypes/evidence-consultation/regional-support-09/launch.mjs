import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {fileURLToPath,pathToFileURL} from "node:url";
import {chromium} from "playwright";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../../..");
const out=path.join(root,"evidence-work/regional-support-09/preview");
const catalogPath=path.join(root,"evidence-work/regional-support-09/data/catalog.json");
assert(process.argv.includes("--workspace-vnc-confirmed"),"Launch requires --workspace-vnc-confirmed");
assert(fs.existsSync(path.join(out,"index.html")),"Build the checked preview before launch");
const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
const verified=new Set([
  ...catalog.municipalities.map(x=>x.officialEntryUrl),
  ...catalog.services.map(x=>x.officialUrl),
]);
for(const url of verified)assert(/^https:\/\//.test(url),`Only HTTPS official URLs: ${url}`);
const run=fs.mkdtempSync(path.join(out,"live-owned-"));
const home=path.join(run,"browser-home");fs.mkdirSync(home);
const metadata=path.join(run,"lifecycle.json"),started=new Date(),expires=new Date(started.getTime()+3600000);
let browser,context,timer,closing;
const write=(state,extra={})=>fs.writeFileSync(metadata,JSON.stringify({state,pid:process.pid,startedAt:started.toISOString(),expiresAt:expires.toISOString(),mode:"workspace-vnc-private-file-preview",...extra},null,2)+"\n");
async function close(reason="owner"){
  if(closing)return closing;
  closing=(async()=>{
    clearTimeout(timer);process.off("SIGINT",signal);process.off("SIGTERM",signal);
    const errors=[];try{if(browser?.isConnected())await browser.close()}catch{errors.push("browser close failed")}
    try{fs.rmSync(home,{recursive:true,force:true})}catch{errors.push("HOME removal failed")}
    write(errors.length?"cleanup-failed":"closed",{reason,closedAt:new Date().toISOString(),browserClosed:!browser?.isConnected(),homeRemoved:!fs.existsSync(home),errors});
    if(errors.length)throw Error(errors.join("; "));
  })();return closing;
}
const signal=()=>void close("signal").catch(()=>{process.exitCode=1});
process.once("SIGINT",signal);process.once("SIGTERM",signal);
try{
  write("starting");
  browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",headless:false,
    env:{PATH:"/usr/bin:/bin",HOME:home,LANG:"C.UTF-8",DISPLAY:process.env.DISPLAY||":0"},
    args:["--disable-background-networking","--disable-component-update","--disable-sync","--disable-default-apps","--no-first-run","--no-default-browser-check","--disable-domain-reliability","--disable-breakpad","--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication","--start-maximized"]});
  context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false,viewport:null});
  const target=pathToFileURL(path.join(out,"index.html")).href;
  const allowedOrigins=new WeakMap();
  await context.route("**/*",route=>{
    const request=route.request(),url=request.url(),method=request.method();
    if(url===target||url.startsWith("data:"))return route.continue();
    let page;try{page=request.frame().page()}catch{return route.abort("blockedbyclient")}
    if(method!=="GET")return route.abort("blockedbyclient");
    if(verified.has(url)){allowedOrigins.set(page,new URL(url).origin);return route.continue()}
    const origin=allowedOrigins.get(page);
    if(origin&&new URL(url).origin===origin)return route.continue();
    return route.abort("blockedbyclient");
  });
  const page=await context.newPage();
  await page.exposeBinding("endRegionalPreview",(_source,reason)=>{setImmediate(()=>void close(reason==="ttl"?"ttl":"button").catch(()=>{process.exitCode=1}));return true});
  page.on("close",()=>void close("window").catch(()=>{process.exitCode=1}));
  browser.on("disconnected",()=>void close("disconnected").catch(()=>{process.exitCode=1}));
  await page.goto(target);await page.evaluate(()=>document.fonts.ready);
  timer=setTimeout(()=>void close("ttl").catch(()=>{process.exitCode=1}),3600000);
  write("ready",{officialNavigation:"Only deliberate GET navigation to exact catalog URL; subsequent GETs restricted to that official origin.",databaseUsed:false,modelApiUsed:false});
  console.log(`Regional support preview ready in workspace VNC. Expires ${expires.toISOString()}. Use the on-screen stop button.`);
  await new Promise(resolve=>browser.once("disconnected",resolve));
}catch(error){await close("startup-failed");throw error}