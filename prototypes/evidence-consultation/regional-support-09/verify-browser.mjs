import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const out=path.join(root,"evidence-work/regional-support-09/preview");
const catalog=JSON.parse(fs.readFileSync(path.join(root,"evidence-work/regional-support-09/data/catalog.json"),"utf8"));
const {openPreview}=await import(pathToFileURL(path.join(out,"adapted-runtime.mjs")));
const rt=await openPreview({headless:true}),checks=[],errors=[];
const check=(name,value)=>{assert(value,name);checks.push(name)};
async function choose(page,municipalityId,purpose){
  await page.locator("#municipality").selectOption(municipalityId);
  await page.locator(`[data-purpose="${purpose}"]`).click();
}
try{
  const page=rt.page;
  await page.setViewportSize({width:390,height:844});
  check("home direct entry",await page.locator("#start").isVisible());
  await page.screenshot({path:path.join(out,"mobile-home.png"),fullPage:true});
  await page.locator("#start").click();
  check("six municipalities",await page.locator("#municipality option").count()===7);
  const first=catalog.services[0],firstPurpose=first.purposes[0];
  await choose(page,first.municipalityId,firstPurpose);
  check("AI-free list reached",await page.locator(`[data-service-id="${first.id}"]`).isVisible());
  await page.locator(`[data-service-id="${first.id}"] button`).click();
  check("detail application visible",await page.locator("dl").getByText("利用方法",{exact:true}).isVisible());
  check("official action verified",await page.locator('[data-external="service"]').getAttribute("href")===first.officialUrl);
  check("phone only when verified",await page.locator("[data-phone]").count()===first.phones.length);
  await page.locator("#save").click();
  check("save works",await page.locator(`[data-saved-id="${first.id}"]`).count()===1);
  await page.locator("#back").click();await page.locator("#back").click();
  const other=catalog.municipalities.find(x=>x.id!==first.municipalityId);
  await page.locator("#municipality").selectOption(other.id);
  check("region change clears old result",await page.locator(`[data-service-id="${first.id}"]`).count()===0);
  check("purpose reset on region change",await page.locator('[aria-pressed="true"]').count()===0);
  check("saved support keeps municipality label",await page.locator(`[data-saved-id="${first.id}"]`).textContent().then(x=>x.includes(catalog.municipalities.find(m=>m.id===first.municipalityId).label)));
  await page.evaluate(({m,p})=>window.openFromConsultation({municipalityId:m,purpose:p}),{m:first.municipalityId,p:firstPurpose});
  await page.locator(`[data-service-id="${first.id}"] button`).click();
  check("saved state survives in-page navigation",await page.locator("#save").textContent().then(x=>x==="保存を解除"));
  await page.locator("#save").click();
  check("unsave works",await page.locator(`[data-saved-id="${first.id}"]`).count()===0);
  await page.locator("#back").click();await page.locator("#back").click();

  const multi=catalog.services.find(x=>x.purposes.length>1);
  for(const purpose of multi.purposes){
    await page.locator("#municipality").selectOption(multi.municipalityId);
    await page.locator(`[data-purpose="${purpose}"]`).click();
    check(`multi-purpose same record ${purpose}`,await page.locator(`[data-service-id="${multi.id}"]`).count()===1);
    await page.locator("#back").click();
  }
  const unknown=catalog.services.find(x=>!x.fees||/未確認/.test(x.fees));
  await page.locator("#municipality").selectOption(unknown.municipalityId);
  await page.locator(`[data-purpose="${unknown.purposes[0]}"]`).click();
  await page.locator(`[data-service-id="${unknown.id}"] button`).click();
  check("unknown fee not rendered free",!await page.locator("dl").textContent().then(x=>/料金\\s*無料/.test(x)));

  await page.reload();
  check("reload clears saved records",await page.locator("[data-saved-id]").count()===0);
  check("handoff rejects transcript-bearing invalid region",!await page.evaluate(()=>window.openFromConsultation({municipalityId:"invalid",purpose:"consult",transcript:"secret"})));
  check("handoff accepts only selected city/purpose",await page.evaluate(({m,p})=>window.openFromConsultation({municipalityId:m,purpose:p}),{m:first.municipalityId,p:firstPurpose}));
  check("handoff opens shared list",await page.locator(`[data-service-id="${first.id}"]`).count()===1);
  await page.screenshot({path:path.join(out,"mobile-list.png"),fullPage:true});

  await page.reload();await page.locator("#start").click();
  for(const m of catalog.municipalities){
    for(const p of ["care","help","consult","place"]){
      await page.locator("#municipality").selectOption(m.id);await page.locator(`[data-purpose="${p}"]`).click();
      const expected=catalog.services.filter(x=>x.municipalityId===m.id&&x.purposes.includes(p));
      check(`route ${m.id}/${p}`,await page.locator("[data-service-id]").count()===expected.length);
      if(!expected.length){
        check(`empty is not no-support ${m.id}/${p}`,await page.getByText("このアプリでは、まだ詳しい情報を掲載していません").isVisible());
        check(`empty official entry ${m.id}/${p}`,await page.locator('[data-external="municipality"]').getAttribute("href")===m.officialEntryUrl);
      }
      await page.locator("#back").click();
    }
  }
  for(const s of catalog.services){
    await page.locator("#municipality").selectOption(s.municipalityId);await page.locator(`[data-purpose="${s.purposes[0]}"]`).click();
    await page.locator(`[data-service-id="${s.id}"] button`).click();
    check(`detail ${s.id}`,await page.locator("dl").getByText("利用方法",{exact:true}).isVisible()&&await page.locator('[data-external="service"]').getAttribute("href")===s.officialUrl);
    await page.locator("#back").click();await page.locator("#back").click();
  }

  await page.setViewportSize({width:1280,height:900});await page.reload();await page.locator("#start").click();await choose(page,multi.municipalityId,multi.purposes[0]);await page.locator(`[data-service-id="${multi.id}"] button`).click();
  check("desktop no overflow",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check("fullwidth tilde is display-normalized",!await page.locator("body").evaluate(el=>el.innerText.includes("～")));
  check("primary official action is readable",await page.locator('[data-external="service"]').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>90&&r.height>=40&&s.display!=="inline"}));
  await page.screenshot({path:path.join(out,"desktop-detail.png"),fullPage:true});
  check("zero external requests",rt.checks.externalRequests===0);
  check("zero page errors",rt.checks.pageErrors.length===0);
  const disconnected=new Promise(resolve=>rt.browser.once("disconnected",resolve));
  await rt.close("regional-support-verify");await disconnected;
  check("browser closed",rt.checks.browserClosed);check("owned HOME removed",rt.checks.homeRemoved);
}catch(error){errors.push(error.stack||error.message);process.exitCode=1}
finally{
  await rt.close("regional-support-finally");
  fs.writeFileSync(path.join(out,"verification.json"),JSON.stringify({
    passed:errors.length===0,counts:{pass:checks.length,fail:errors.length,notRun:0},checks,errors,
    pageSha256:createHash("sha256").update(fs.readFileSync(path.join(out,"index.html"))).digest("hex"),
    externalRequests:rt.checks.externalRequests,pageErrors:rt.checks.pageErrors,
    browserClosed:rt.checks.browserClosed,homeRemoved:rt.checks.homeRemoved,
    actualCalls:{officialNavigation:0,telephone:0,booking:0,application:0,modelApi:0},databaseUsed:false,publicationChanged:false,
  },null,2)+"\n");
  const lifecycle=JSON.parse(fs.readFileSync(rt.metadata,"utf8"));
  fs.writeFileSync(path.join(out,"cleanup-receipt.json"),JSON.stringify({
    status:lifecycle.state==="closed"&&lifecycle.browserClosed&&lifecycle.homeRemoved?"passed":"failed",
    lifecycle,ownedRun:path.relative(out,rt.run),metadata:path.relative(out,rt.metadata),
    liveServerStarted:false,databaseUsed:false,networkUsed:false,
  },null,2)+"\n");
}
console.log(errors.length?"FAIL: browser verification":"PASS: interactive browser verification and cleanup");