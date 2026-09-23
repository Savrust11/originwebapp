import "../../../tests/safety/require-managed.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import {openRuntime} from "./runtime.mts";
import {out,hash,verifyPreservation} from "./preservation.mjs";
let n=1;while(fs.existsSync(`${out}/attempt-${String(n).padStart(2,"0")}`))n++;
const dir=`${out}/attempt-${String(n).padStart(2,"0")}`;fs.mkdirSync(dir);
const checks:any[]=[],images:any[]=[],cases:any[]=[];
const check=(name:string,v:any)=>{assert(v,name);checks.push({name,result:"PASS"})};
const input=(question:string,unknown=false)=>({question,target:unknown?"unknown":"child",children:[{id:"c1",years:unknown?null:1,months:unknown?null:8}],health:{},confirmed:true,ageConflictAcknowledged:true});
const supplied={night:10,nap:1,actual:true,sameDay:true,complete:true,napIncluded:true,link:true};
const hasComparison=(r:any)=>r.groups.some((g:any)=>g.sleepResult!==null);
let rt:any,headful:any,failure:any,sqlCalls=0;
try{
  rt=await openRuntime(true);const {gate,page}=rt;
  await page.setViewportSize({width:390,height:844});
  check("Four sources eleven units",rt.initialized.corpus.sources.size===4&&rt.initialized.byUnit.size===11);
  check("Normal SQL excludes candidates",(await gate.normalControl()).results.length===0);
  const plan=JSON.parse(fs.readFileSync("evidence-work/parent-reading-evaluation/candidate-relevance-gate-01/test-plan.json","utf8"));
  for(const set of ["known","novel"])for(const spec of plan[set]){
    const p:any={input:input(spec.question,!!spec.unknownConditions),sleep:{"child:c1":supplied}};
    if(spec.action==="upfront")p.upfrontTopic=spec.topic;
    const initial=await gate.search(p);
    let selected=initial;
    if(["confirm","reject","rephrase"].includes(spec.action))
      selected=await gate.search({...p,token:initial.token,action:spec.action==="confirm"?"select":spec.action,topic:spec.topic});
    check(`${spec.id} selection never calculates`,!hasComparison(selected));
    const ids=selected.groups.flatMap((g:any)=>g.items.map((i:any)=>i.unitId));
    if(spec.relatedUnits.length)check(`${spec.id} related material retained`,ids.some((id:string)=>spec.relatedUnits.includes(id)));
    if(spec.expectFinalComparison){
      const compare=await gate.search({...p,token:selected.token,action:"compare",compareGroupId:"child:c1"});
      check(`${spec.id} explicit comparison succeeds`,compare.groups.some((g:any)=>g.sleepResult?.comparison.performed));
    }
    cases.push({id:spec.id,set,candidateUnits:initial.candidates.map((c:any)=>c.unitId),selectedUnits:ids,
      personalComparisonOnSelection:false,expectationDelta:"Material selection no longer authorizes comparison; separate compare operation required."});
  }
  const p={input:input("ねんね用品の通販"),sleep:{"child:c1":supplied}};
  let a=await gate.search(p);a=await gate.search({...p,token:a.token,action:"select",topic:"sleep"});
  check("Prior wrong affirmative no automatic arithmetic",a.groups.every((g:any)=>g.sleepResult===null));
  const b=await gate.search({...p,token:a.token,action:"compare",compareGroupId:"child:c1"});
  check("Deliberate separate purpose can compare entered numbers",b.groups.some((g:any)=>g.sleepResult?.comparison.performed));
  const retained=await gate.search({...p,token:a.token,sleep:{"child:c1":{...supplied,nap:2}}});
  check("Sleep edit retains materials but not comparison",retained.state==="materials_displayed"&&!hasComparison(retained));
  const incomplete=await gate.search({...p,token:a.token,action:"compare",compareGroupId:"child:c1",sleep:{"child:c1":{...supplied,sameDay:false}}});
  check("Missing condition blocks numerical comparison",incomplete.groups.every((g:any)=>!g.sleepResult?.comparison.performed));
  const stale=await gate.search({...p,token:a.token,input:{...p.input,children:[{id:"c1",years:2,months:0}]}});
  check("Age edit invalidates old selection",stale.state==="choose_material"&&!hasComparison(stale));
  await assert.rejects(()=>gate.search({...p,token:a.token,action:"compare",input:{...p.input,question:"別の相談"}}));
  check("Changed query cannot reuse comparison operation",true);
  const sibling={input:{...input("睡眠時間"),children:[{id:"c1",years:1,months:8},{id:"c2",years:2,months:0}]},
    sleep:{"child:c1":supplied,"child:c2":supplied},upfrontTopic:"sleep"};
  const siblingMaterials=await gate.search(sibling);
  const oneChild=await gate.search({...sibling,token:siblingMaterials.token,action:"compare",compareGroupId:"child:c1"});
  check("Sibling comparison only explicit child's operation",oneChild.groups.find((g:any)=>g.id==="child:c1").sleepResult?.comparison.performed&&oneChild.groups.find((g:any)=>g.id==="child:c2").sleepResult===null);
  const run=async(q:string,topic="")=>{
    await page.locator("#question").fill(q);await page.locator("#target").selectOption("child");
    await page.locator(".years").fill("1");await page.locator(".months").fill("8");
    await page.locator("#topic").selectOption(topic);await page.locator("#confirmed").check();
    await page.locator("#search").click();await page.waitForFunction(()=>!!(window as any).lastConnectionResult);
  };
  const shot=async(name:string,selector?:string)=>{
    check(`${name} no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const p=`${dir}/${name}.png`;await (selector?page.locator(selector):page).screenshot({path:p,...(selector?{}:{fullPage:true})});
    images.push({name,path:p,sha256:hash(p)});
  };
  await run("動画編集ソフトを購入したい。それとは別に子どもの睡眠時間の目安を知りたい");
  check("Multiple candidates one chooser",await page.locator("#material-chooser").count()===1&&await page.locator("#candidate-topic option").count()>2);
  await shot("single-material-chooser");
  await page.locator("#candidate-topic").selectOption("sleep");await page.locator("#show-material").click();
  await page.waitForSelector('[data-fact="sleep-guidance"]');
  check("Selection displays material notice not comparison",await page.locator(".comparison").count()===0&&(await page.locator("#status").innerText()).includes("睡眠についての資料を表示しています"));
  check("Mixed unrelated screen material not displayed",await page.locator('[data-fact="screen-duration"]').count()===0);
  await shot("materials-without-comparison");
  await page.locator(".night").fill("10");await page.locator(".nap").fill("1");
  for(const key of ["sameDay","actual","complete","napIncluded","link"])await page.locator(`[data-sleep="${key}"]`).check();
  check("Sleep edits retain selected material",await page.locator('[data-fact="sleep-guidance"]').count()===1&&await page.locator("#material-chooser").count()===0);
  await page.locator(".compare").click();await page.waitForSelector('[data-comparison="within_numeric_range"]');
  check("Comparison uses already entered information",await page.locator(".night").inputValue()==="10"&&(await page.locator(".comparison-inputs").innerText()).includes("20か月"));
  await shot("explicit-comparison",".group");
  await shot("comparison-result-detail",".comparison");
  await shot("comparison-input-detail",".comparison-inputs");
  await page.locator(".nap").fill("2");
  check("Sleep edit immediately removes old result only",await page.locator(".comparison,.comparison-inputs").count()===0&&await page.locator('[data-fact="sleep-guidance"]').count()===1);
  await shot("edited-comparison-withheld",".sleep");
  await page.locator(".compare").click();await page.waitForSelector(".comparison-inputs");
  check("Recomparison uses new value", (await page.locator(".comparison-inputs").innerText()).includes("合計：12時間"));
  await page.locator(".years").fill("2");check("Age edit immediately clears stale material/results",await page.locator("[data-fact],.comparison").count()===0);
  await run("眠る時間の目安","sleep");check("Upfront selection skips chooser",await page.locator("#material-chooser").count()===0&&await page.locator('[data-fact="sleep-guidance"]').count()===1);
  await page.setViewportSize({width:1200,height:900});await shot("desktop-materials");await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{const w=window as any;w.originalBridge=w.searchEvidenceBridge;let count=0;w.searchEvidenceBridge=async(p:any)=>{const index=++count;const r=await w.originalBridge(p);if(index===1)await new Promise(resolve=>w.releaseOld=resolve);return r};w.older=w.search();w.newer=w.search("reject")});
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="not_applicable"&&typeof(window as any).releaseOld==="function");
  await page.evaluate(async()=>{const w=window as any;w.releaseOld();await w.older;w.searchEvidenceBridge=w.originalBridge});
  check("Old response cannot restore rejected material",await page.locator("[data-fact],.comparison").count()===0);
  await run("うつ伏せの写真");await page.locator('[data-material-action="rephrase"]').click();
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="rephrase");
  check("Rephrase remains available",await page.locator("#question").evaluate((e:any)=>document.activeElement===e));
  await run("ねんね用品の通販");await page.locator('[data-material-action="reject"]').click();
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="not_applicable");await shot("not-applicable");
  check("No browser errors or external requests",rt.errors.length===0&&rt.getExternalRequests()===0);
  check("Versions remain draft and unreviewed",(await rt.pool.query("SELECT publication_status,manual_reviewed FROM evidence_versions")).rows.every((r:any)=>r.publication_status==="draft"&&!r.manual_reviewed));
  sqlCalls=gate.getSqlCalls();
  check("Headful private file preview opens",await page.locator("#end-preview").count()===1);
  await page.exposeBinding("endPreviewBridge",async()=>{});
  await page.locator("#end-preview").click();
  check("Headful end operation shown",(await page.locator("body").innerText()).includes("終了しています"));
  const realClose=rt.browser.close.bind(rt.browser);
  rt.browser.close=async()=>{await realClose();throw Error("controlled close failure after real browser exit")};
  await assert.rejects(()=>rt.close(),/browser close failed/);
  check("Browser close failure cannot skip pool and directory cleanup",rt.cleanupStatus.poolEnded&&rt.cleanupStatus.browserDirectoryRemoved&&!fs.existsSync(rt.temp));
  rt=null;
  check("Historical files unchanged",verifyPreservation()>0);
}catch(e:any){failure={message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]"),stack:String(e.stack).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]")}}
finally{if(rt)await rt.close();if(headful)await headful.close()}
fs.writeFileSync(`${dir}/verification.json`,JSON.stringify({result:failure?"FAILED":"PASSED",failure,checks,cases,images,sqlCalls,
  operationDelta:"Selection only chooses materials; explicit comparison is separate and non-sticky.",
  modelApiCalls:0,existingDatabaseAccess:false,normalApplicationStarted:false,httpServerStarted:false,approvalsChanged:false},null,2)+"\n",{flag:"wx"});
if(failure)throw Error("material selection verification failed; see append-only attempt");