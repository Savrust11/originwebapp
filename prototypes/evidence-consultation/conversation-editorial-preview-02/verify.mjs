import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {openPreview,out} from "./runtime.mjs";
import {writeReport} from "./report.mjs";
const results=[],images=[];
const check=(name,pass)=>{results.push({name,pass:!!pass});assert(pass,name);};
const transcript=JSON.parse(fs.readFileSync(path.join(out,"transcript.json")));
const trace=JSON.parse(fs.readFileSync(path.join(out,"source-grounding.json")));
const html=fs.readFileSync(path.join(out,"index.html"),"utf8");
const sha=x=>createHash("sha256").update(x).digest("hex");
let rt;
try{
 check("user HTML excludes reviewer payload and input fields",!/<textarea|<input|レビュー担当|下書き|drafts|quoteSha256|sourceFileSha256|originalId/.test(html));
 check("short disclosure exactly once",html.split("編集見本・AI未接続").length===2);
 for(const f of trace.fragments)check(f.originalId+" exact quote hash",sha(f.quote)===f.quoteSha256);
 check("3–5 aggregation independently verified",trace.aggregation.scene1.status==="verified");
 check("3–5 original quote hash and scope",sha(trace.aggregation.scene1.original.quote)===trace.aggregation.scene1.original.quoteSha256Utf8&&JSON.stringify(trace.aggregation.scene1.scope.recommendedAgeYearsInclusive)==="[3,5]"&&trace.aggregation.scene1.scope.includesNaps);
 check("3–5 body includes aggregation",/昼寝を含めて24時間あたり10〜13時間/.test(transcript[0].messages[1].text));
 check("1–2 body includes naps and 24-hour denominator",/昼寝を含む1日（24時間）の合計で11〜14時間/.test(transcript[2].messages[1].text));
 check("no generic caveats in scenes 1 and 2",transcript.slice(0,2).every(s=>s.messages.every(m=>!m.note&&!/判断できません|決められません/.test(m.text))));
 check("illness caveat retained only where relevant",transcript[2].messages[1].note.includes("病気かどうか"));
 check("1–2 supplement remains age restricted",trace.aggregation.scene3.scope.ageMonths.maxExclusive===36);
 rt=await openPreview({headless:true});
 const {page,context}=rt;
 check("three scenes",await page.getByRole("tab").count()===3);
 for(const width of [375,1280]){
  await page.setViewportSize({width,height:width===375?812:960});
  for(let i=0;i<3;i++){
   await page.getByRole("tab").nth(i).click();await page.evaluate(()=>window.scrollTo(0,0));
   check(`${width}/${i} first answer revealed`,await page.locator(".answer").count()===1);
   check(`${width}/${i} question and full short answer in first viewport`,await page.evaluate(()=>{
    const bottom=document.querySelector(".endbar").getBoundingClientRect().top;
    return [".parent",".answer"].every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.top>=0&&r.bottom<=bottom;});
   }));
   check(`${width}/${i} evidence initially closed`,await page.locator("details[open]").count()===0);
   const top=`scene-${i+1}-${width}-top.png`;
   await page.screenshot({path:path.join(out,top)});images.push(top);
   while(await page.locator("#next").isEnabled())await page.locator("#next").click();
   const bodies=await page.locator(".message").evaluateAll(nodes=>nodes.map(n=>{
    const copy=n.cloneNode(true);copy.querySelector(".who")?.remove();return copy.innerText.trim();
   }));
   const expected=transcript[i].messages.map(m=>[m.text,m.note,m.question,m.support,m.medical,m.emergency,m.editorial].filter(Boolean).join("\n"));
   check(`${width}/${i} every authored turn matches transcript`,bodies.length===expected.length&&bodies.every((b,j)=>b.replace(/\s/g,"")===expected[j].replace(/\s/g,"")));
   const chat=await page.locator(".chat").innerText();
   check(`${width}/${i} issuer absent from answer body`,!/厚生労働省|米国睡眠医学会|AASM/.test(chat));
   check(`${width}/${i} no duplicate blanket disclaimers`,!/実際のAI回答|AI未接続|この見本は相談サービス/.test(chat));
   check(`${width}/${i} only necessary question`,(chat.match(/？/g)||[]).length===(i===1?1:0));
   check(`${width}/${i} no overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator(".evidence summary").click();
   check(`${width}/${i} source attribution present`,(await page.locator(".evidence").innerText()).includes(trace.sourceTitle));
   await page.locator(".evidence a").first().click();
   check(`${width}/${i} source navigation blocked`,(await page.locator("#link-note").innerText()).includes("無効"));
  }
 }
 check("no forms or memo inputs",await page.locator("input,textarea,form,iframe").count()===0);
 check("no booking or sharing controls",!(await page.locator("button").allTextContents()).some(s=>/予約|共有|送信/.test(s)));
 check("no persistent storage",await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
 await page.getByRole("tab").first().focus();await page.keyboard.press("ArrowRight");
 check("keyboard tabs",await page.getByRole("tab").nth(1).getAttribute("aria-selected")==="true");
 check("single page",context.pages().length===1);
 check("no page errors",rt.checks.pageErrors.length===0);
 check("no external request",rt.checks.externalRequests===0);
 await page.locator("#end").click();
 for(let i=0;i<80&&JSON.parse(fs.readFileSync(rt.metadata)).state!=="closed";i++)await new Promise(r=>setTimeout(r,100));
 await rt.close("verify");
 check("owned browser and home cleaned",!rt.browser.isConnected()&&rt.checks.homeRemoved);
}catch(error){results.push({name:"verification stopped",pass:false,error:error.message});process.exitCode=1;}
finally{
 if(rt)await rt.close("verify-finally");
 fs.writeFileSync(path.join(out,"verification.json"),JSON.stringify({results,images,scope:"Offline engineering checks only. Not clinical, adoption or publication approval."},null,2));
 writeReport();
 console.log(`${results.filter(r=>r.pass).length}/${results.length} checks passed`);
}