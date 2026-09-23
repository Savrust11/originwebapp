import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {openPreview,out} from "./runtime.mjs";
import {scenes,disclosure,providerDisclosure} from "./scenes.mjs";
const rt=await openPreview({headless:true});
const checks=[],errors=[];
const check=(name,ok)=>{assert(ok,name);checks.push(name)};
try{
 const p=rt.page;
 const select=async i=>{await p.reload();await p.getByRole("tab").nth(i).click()};
 const advance=async count=>{for(let j=1;j<count;j++)await p.locator("#next").click()};
 const fieldsEqual=async (expected,label)=>{
  for(const [field,value] of Object.entries(expected))check(label+"/"+field,await p.locator(`[id="field-${field}"]`).inputValue()===value);
 };
 for(const [width,height] of [[375,812],[1280,900]]){
  await p.setViewportSize({width,height});
  for(let i=0;i<scenes.length;i++){
   const s=scenes[i];await select(i);await p.evaluate(()=>window.scrollTo(0,0));
   const q=await p.locator(".parent .bubble").first().boundingBox(),a=await p.locator(".answer .bubble").first().boundingBox(),footer=await p.locator("footer").boundingBox();
   check(`${width}/scene${i+1}: first question+answer visible`,q.y>=0&&a.y+a.height<footer.y);
   check("persistent compact labels",(await p.locator("footer").textContent()).includes(disclosure)&&(await p.locator("footer").textContent()).includes(providerDisclosure));
   check("no horizontal overflow",await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   check("no initial automatic handoff",await p.locator("#handoff").isHidden());
   await p.screenshot({path:path.join(out,`scene-${i+1}-${width}-top.png`)});
   await advance(s.turns.length);
   check("all authored pairs",await p.locator(".pair").count()===s.turns.length);
   check("editorial continuation label",(await p.locator("#next").textContent()).includes("編集見本の続きは未作成"));
   check("endpoint handoff only on request",s.handoffAt===null?await p.locator("#handoff").isHidden():await p.locator("#handoff").isVisible());
   await p.locator(".pair").last().scrollIntoViewIfNeeded();
   await p.screenshot({path:path.join(out,`scene-${i+1}-${width}-endpoint.png`)});
   if(s.id==="food"){
    check("food immediate human handoff",await p.locator("#handoff").isVisible()&&await p.locator("#next").isDisabled());
    check("food empathetic and no followup question",(await p.locator(".answer .bubble").last().textContent()).includes("不安ですよね")&&!(await p.locator(".answer .bubble").last().textContent()).includes("？"));
   }
   if(s.handoffAt===null)await p.locator("#human").click();
   await fieldsEqual(s.handoffAt===null?s.earlySummaries.at(-1).summary:s.summary,"clean default");
   check("clean recipient",await p.locator("#recipient").inputValue()===s.recipient);
   await p.locator("#handoff").screenshot({path:path.join(out,`scene-${i+1}-${width}-handoff-defaults.png`)});
   await p.locator("#confirm").click();check("confirmation works",await p.locator("#confirm").isDisabled());
   await p.locator("#correction summary").click();await p.locator("#apply-correction").click();
   check("authored correction updates and invalidates",await p.locator("#confirm").isEnabled()&&(await p.locator("#draft").textContent()).includes(s.correction.text));
   await p.locator("#confirm").click();check("correction re-review works",await p.locator("#confirm").isDisabled());
  }
 }
 // Zero-based stage indices cover first display through every scene's final turn.
 for(let i=0;i<scenes.length;i++){
  const s=scenes[i];
  for(let index=0;index<s.turns.length;index++){
   const count=index+1;await select(i);await advance(count);
   const alreadyRequested=s.handoffAt!==null&&count>=s.handoffAt;
   check(`scene${i+1}/stage${count}: no unsolicited routing`,alreadyRequested?await p.locator("#handoff").isVisible():await p.locator("#handoff").isHidden());
   await p.locator("#human").click();
   const expected=s.earlySummaries[index];
   check("human request opens now without another turn",await p.locator("#handoff").isVisible()&&await p.locator(".pair").count()===count);
   await fieldsEqual(expected.summary,"only authored known facts");
   check("recipient based on revealed proposal",await p.locator("#recipient").inputValue()===expected.recipient);
   if(count<s.turns.length){
    check("future correction withheld",await p.locator("#correction").isHidden()&&(await p.locator("#correction-parent").textContent())==="");
    const futureOnly=["利用するところまで人に","責められる","遅れそうで焦って"];
    check("no last-turn facts leaked",!(await p.locator("#draft").textContent()).includes(futureOnly[i]));
   }else check("final correction available only after explicit handoff",await p.locator("#correction").isVisible());
   if(s.proposedAt===null||count<s.proposedAt)check("no premature professional options",await p.locator("#recipient option").count()===2);
   await p.locator("#confirm").click();check("confirm without more AI",await p.locator("#confirm").isDisabled()&&await p.locator(".pair").count()===count);
   await p.locator("textarea").first().fill("本人が修正した架空の内容");
   check("free edit updates and invalidates",await p.locator("#confirm").isEnabled()&&(await p.locator("#draft").textContent()).includes("本人が修正した架空の内容"));
   await p.locator("#confirm").click();await p.locator("#recipient").selectOption("本人が希望する別の人・職種（未確認／送信なし）");
   check("recipient change invalidates",await p.locator("#confirm").isEnabled());
   for(const state of ["absent","unknown","uncontracted"]){
    await p.locator("#confirm").click();await p.locator("#availability").selectOption(state);
    check("availability invalidates: "+state,await p.locator("#confirm").isEnabled());
   }
   await p.locator("#confirm").click();check("re-review works",await p.locator("#confirm").isDisabled());
   check("full transcript excluded",!(await p.locator("#draft").textContent()).includes(s.turns[0][0]));
   if(count<s.turns.length){
    for(let j=count;j<s.turns.length;j++)await p.locator("#next").click();
    if(s.handoffAt!==null)await fieldsEqual(s.summary,"later scripted handoff remains unmodified");
    else check("continued scene still no automatic handoff",await p.locator("#handoff").isHidden());
   }
  }
 }
 await select(0);await p.getByRole("tab").nth(0).press("ArrowRight");
 check("keyboard tab advances",await p.getByRole("tab").nth(1).getAttribute("aria-selected")==="true");
 check("no persisted notes",await p.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
 check("no cookies",(await rt.context.cookies()).length===0);
 check("no external request attempts",rt.checks.externalRequests===0);
 check("no runtime errors",rt.checks.pageErrors.length===0);
 check("no reviewer data embedded",await p.content().then(t=>!t.includes("missingEvidence")&&!t.includes("needsChecking")&&!t.includes("source-claim-map")));
 const disconnected=new Promise(resolve=>rt.browser.once("disconnected",resolve));
 await p.locator("#end").click();await disconnected;await rt.close("verify-end");
 check("end closes browser",rt.checks.browserClosed);check("owned HOME removed",rt.checks.homeRemoved);
}catch(e){errors.push(e.message);process.exitCode=1}
finally{
 await rt.close("verify-finally");
 fs.writeFileSync(path.join(out,"verification.json"),JSON.stringify({passed:errors.length===0,pageSha256:createHash("sha256").update(fs.readFileSync(path.join(out,"index.html"))).digest("hex"),checks,errors,externalRequests:rt.checks.externalRequests,pageErrors:rt.checks.pageErrors,browserClosed:rt.checks.browserClosed,homeRemoved:rt.checks.homeRemoved,clinicalApproval:false,inputCaptured:false},null,2)+"\n");
}
console.log(errors.length?"Browser verification failed":"Browser verification passed; owned HOME removed.");