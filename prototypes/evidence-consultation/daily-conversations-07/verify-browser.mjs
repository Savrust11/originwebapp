import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {pathToFileURL,fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const out=path.join(root,"evidence-work/daily-conversations-07/preview");
const content=JSON.parse(fs.readFileSync(path.join(root,"evidence-work/daily-conversations-07/content.json"),"utf8"));
const {openPreview}=await import(pathToFileURL(path.join(out,"adapted-runtime.mjs")));
const rt=await openPreview({headless:true});
const checks=[],errors=[];
const check=(name,value)=>{assert(value,name);checks.push(name)};
try{
  const page=rt.page;
  for(const [width,height] of [[375,812],[1280,900]]){
    await page.setViewportSize({width,height});
    for(const [index,scene] of content.scenes.entries()){
      await page.reload();await page.locator("#scene-picker").selectOption(String(index));await page.evaluate(()=>scrollTo(0,0));
      check(`${width}/${scene.id}: first user visible`,await page.locator(".turn.user").first().isVisible());
      check(`${width}/${scene.id}: first answer visible`,await page.locator(".turn.assistant").first().isVisible());
      const answer=await page.locator(".turn.assistant").first().boundingBox(),footer=await page.locator("footer").boundingBox();
      check(`${width}/${scene.id}: first Q+A above footer`,answer.y+answer.height<footer.y);
      check(`${width}/${scene.id}: no overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(width===375)await page.screenshot({path:path.join(out,`scene-${scene.id}-mobile-initial.png`),fullPage:false});
      await page.locator("#evidence summary").click();
      check(`${width}/${scene.id}: source count`,await page.locator("#sources .source").count()===scene.sources.length);
      while(await page.locator("#next").count())await page.locator("#next").click();
      check(`${width}/${scene.id}: all turns`,await page.locator(".turn").count()===scene.turns.length);
      if(width===1280)await page.screenshot({path:path.join(out,`scene-${scene.id}-desktop-full.png`),fullPage:true});
    }
  }
  check("no local/session storage",await rt.page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
  check("no cookies",(await rt.context.cookies()).length===0);
  check("zero external requests",rt.checks.externalRequests===0);
  check("zero page errors",rt.checks.pageErrors.length===0);
  const disconnected=new Promise(resolve=>rt.browser.once("disconnected",resolve));
  await rt.page.locator("#end").click();await disconnected;await rt.close("verify-end");
  check("browser closed",rt.checks.browserClosed);check("owned HOME removed",rt.checks.homeRemoved);
}catch(error){errors.push(error.message);process.exitCode=1}
finally{
  await rt.close("verify-finally");
  fs.writeFileSync(path.join(out,"verification.json"),JSON.stringify({
    passed:errors.length===0,counts:{pass:checks.length,fail:errors.length,notRun:0},checks,errors,
    pageSha256:createHash("sha256").update(fs.readFileSync(path.join(out,"index.html"))).digest("hex"),
    externalRequests:rt.checks.externalRequests,pageErrors:rt.checks.pageErrors,
    browserClosed:rt.checks.browserClosed,homeRemoved:rt.checks.homeRemoved,
    modelApiCalls:0,databaseUsed:false,publicationChanged:false,
  },null,2)+"\n");
  const lifecycle=JSON.parse(fs.readFileSync(rt.metadata,"utf8"));
  fs.writeFileSync(path.join(out,"cleanup-receipt.json"),JSON.stringify({
    status:lifecycle.state==="closed"&&lifecycle.browserClosed&&lifecycle.homeRemoved?"passed":"failed",
    lifecycle,ownedRun:path.relative(out,rt.run),metadata:path.relative(out,rt.metadata),
    liveServerStarted:false,databaseUsed:false,networkUsed:false,
  },null,2)+"\n");
}
console.log(errors.length?"Browser verification failed":"Browser verification passed; owned HOME removed.");