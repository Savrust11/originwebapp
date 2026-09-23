import fs from "node:fs";
import assert from "node:assert/strict";
import {createConnection} from "../retrieval-fact-connection/connection.mts";
import {checkSupplement} from "./provenance.mjs";
import {evaluateSleep} from "../p01-aggregation-addendum/model.mjs";
export async function regressions(rt:any,check:any,dir:string){
  const {gate,page,initialized}=rt;
  const input=(question="睡眠時間",unknown=false)=>({question,target:unknown?"unknown":"child",children:[{id:"c1",years:unknown?null:1,months:unknown?null:8}],health:{},confirmed:true,ageConflictAcknowledged:true});
  const supplied={night:10,nap:1,actual:true,sameDay:true,complete:true,napIncluded:true,link:false};
  const p={input:input(),sleep:{"child:c1":supplied}};
  const hasComparison=(r:any)=>r.groups.some((g:any)=>g.sleepResult?.comparison.performed);
  // Reuse the frozen predeclared cases and the same sibling/stale contracts.
  const plan=JSON.parse(fs.readFileSync("evidence-work/parent-reading-evaluation/candidate-relevance-gate-01/test-plan.json","utf8"));
  for(const set of ["known","novel"])for(const spec of plan[set]){
    const q:any={...p,input:input(spec.question,!!spec.unknownConditions)};
    if(spec.action==="upfront")q.upfrontTopic=spec.topic;
    const initial=await gate.search(q);
    const selected=["confirm","reject","rephrase"].includes(spec.action)?await gate.search({...q,token:initial.token,action:spec.action==="confirm"?"select":spec.action,topic:spec.topic}):initial;
    check(spec.id+" 資料選択は比較ではない",!hasComparison(selected));
    if(spec.relatedUnits.length)check(spec.id+" 関連資料を保持",selected.groups.flatMap((g:any)=>g.items.map((i:any)=>i.unitId)).some((id:string)=>spec.relatedUnits.includes(id)));
    if(spec.expectFinalComparison)check(spec.id+" 明示比較",hasComparison(await gate.search({...q,token:selected.token,action:"compare",compareGroupId:"child:c1"})));
  }
  const a=await gate.search({...p,upfrontTopic:"sleep"});
  const stale=await gate.search({...p,token:a.token,input:{...p.input,children:[{id:"c1",years:2,months:0}]}});
  check("年齢変更は古い選択を無効化",stale.state==="choose_material"&&!hasComparison(stale));
  await assert.rejects(()=>gate.search({...p,token:a.token,action:"compare",input:{...p.input,question:"別の相談"}}));
  check("変更した相談で古い比較操作を再利用できない",true);
  for(const key of ["sameDay","actual","complete","napIncluded"]){
    const selected=await gate.search({...p,upfrontTopic:"sleep"});
    const result=await gate.search({...p,token:selected.token,action:"compare",compareGroupId:"child:c1",sleep:{"child:c1":{...supplied,[key]:false}}});
    check(key+" は個別に必要で省略できない",!hasComparison(result));
  }
  const sibling={...p,input:{...input(),children:[{id:"c1",years:1,months:8},{id:"c2",years:2,months:0}]},sleep:{"child:c1":supplied,"child:c2":supplied},upfrontTopic:"sleep"};
  const sib=await gate.search(sibling);
  const one=await gate.search({...sibling,token:sib.token,action:"compare",compareGroupId:"child:c1"});
  check("兄弟は明示した一人だけ比較",one.groups.find((g:any)=>g.id==="child:c1").sleepResult?.comparison.performed&&one.groups.find((g:any)=>g.id==="child:c2").sleepResult===null);
  const minutes=JSON.parse(fs.readFileSync("evidence-work/parent-reading-evaluation/p01-aggregation-addendum-01/minutes-source.json","utf8"));
  check("実際の保存済み補足出典を照合",checkSupplement(minutes,initialized).available);
  const night={value:10,unit:"hours",kind:"actual-sleep",dayId:"one",complete:true,approximate:true};
  for(const [name,value] of [
    ["補足出典なし",null],["帰属改ざん",{...minutes,sourceId:"forged"}],
    ["リンク先改ざん",{...minutes,linkedUnitId:"E03-S01"}],
    ["原文改ざん",{...minutes,fragments:minutes.fragments.map((f:any,i:number)=>i?f:{...f,text:f.text+"改変"})}],
    ["集計年齢改ざん",{...minutes,scope:{...minutes.scope,ageMonths:{minInclusive:0,maxExclusive:36}}}]
  ] as any[]){
    const availability=checkSupplement(value,initialized);
    check(name+" は検証不可",!availability.available&&availability.reason.length>0);
    const forgedInput={ageMonths:20,night,nap:{...night,value:1},link:true};
    check(name+" forged link trueでも比較不可",!evaluateSleep(forgedInput,availability.available?{sourceId:minutes.sourceId,linkedUnitId:minutes.linkedUnitId,ageMinMonths:12,ageMaxMonthsExclusive:36,includesNaps:true,verified:true}:null).comparison.performed);
  }
  // Exercise the real gate with an unavailable linked source, without writing
  // any corpus/archive or adding a production evidence override.
  const missing={...initialized,byUnit:new Map([...initialized.byUnit].filter(([,u]:any)=>u.id!=="E02-S01"))};
  const absentGate=await createConnection(rt.pool,missing);
  const forged={...p,upfrontTopic:"sleep",sleep:{"child:c1":{...supplied,link:true}}};
  check("実検索でも元資料なし・偽装linkで比較不可",!hasComparison(await absentGate.search({...forged,compare:true,compareGroupId:"child:c1"})));
  const targetUnit=initialized.byUnit.get("E02-S01");
  const fragment=initialized.byFragment.get(targetUnit.fragmentId);
  const tampered={...initialized,byFragment:new Map(initialized.byFragment)};
  tampered.byFragment.set(targetUnit.fragmentId,{...fragment,textSha256:"0".repeat(64)});
  const tamperedConnection=await createConnection(rt.pool,tampered);
  await assert.rejects(()=>tamperedConnection.search({...forged,compare:true,compareGroupId:"child:c1"}));
  check("実検索は元資料ハッシュ改ざんで明示失敗",true);
  for(const [years,months,eligible] of [[0,11,false],[1,0,true],[2,11,true],[3,0,false]]){
    const q={...p,upfrontTopic:"sleep",input:{...input(),children:[{id:"c1",years,months}]}};
    const selected=await gate.search(q);
    const result=await gate.search({...q,token:selected.token,action:"compare",compareGroupId:"child:c1"});
    check(years+"歳"+months+"か月 境界で比較を制限",hasComparison(result)===eligible);
  }
  const run=async()=>{
    await page.locator("#question").fill("睡眠時間");await page.locator("#target").selectOption("child");
    await page.locator(".years").fill("1");await page.locator(".months").fill("8");
    await page.locator("#topic").selectOption("sleep");await page.locator("#confirmed").check();await page.locator("#age-ack").check();
    await page.locator("#search").click();await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="materials_displayed");
  };
  await run();
  await page.locator(".night").fill("10");await page.locator(".nap").fill("1");
  for(const k of ["sameDay","actual","complete","napIncluded"])await page.locator('[data-sleep="'+k+'"]').check();
  await page.locator(".compare").click();await page.waitForSelector('[data-comparison="within_numeric_range"]');
  check("明示比較だけが表示される",await page.locator(".comparison").count()===1);
  const comparisonText=await page.locator(".comparison").innerText();
  check("比較結果は平易な合計ラベル",comparisonText.includes("入力した睡眠時間の合計")&&!comparisonText.includes("算術"));
  const visibleResults=await page.locator("#results").innerText();
  check("開いた利用者表示に出典ID・版ID・承認メタデータなし",!/\bE0[1-4](?:\b|-)|MHLW-MINUTES-20231221|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|資料採用・公開|公開状態|未承認/.test(visibleResults));
  check("比較後も資料通知は一度だけ",((await page.locator("body").innerText()).match(/についての資料を表示しています/g)||[]).length===1);
  check("比較後も未入力か月なし",!visibleResults.includes("未入力か月"));
  check("比較後もユーザーの出典関連付け確認なし",await page.locator('[data-sleep="link"]').count()===0&&!visibleResults.includes("集計範囲の出典関連付け"));
  check("補足根拠はシステム照合として閉じた詳細へ",(await page.locator("details.reviewer").allTextContents()).some((t:string)=>t.includes("保存済み原文・出典・対象条件の照合済み"))&&await page.locator("details.reviewer[open]").count()===0);
  await page.screenshot({path:`${dir}/explicit-comparison.png`,fullPage:true});
  await page.locator(".comparison").screenshot({path:`${dir}/comparison-result-detail.png`});
  await page.locator(".comparison-inputs").screenshot({path:`${dir}/comparison-input-detail.png`});
  await page.locator(".nap").fill("2");
  check("編集は比較だけ即時消去",await page.locator(".comparison,.comparison-inputs").count()===0&&await page.locator('[data-fact="sleep-guidance"]').count()===1);
  await page.evaluate(()=>{const w=window as any;w.originalBridge=w.searchEvidenceBridge;let count=0;w.searchEvidenceBridge=async(p:any)=>{const index=++count;const r=await w.originalBridge(p);if(index===1)await new Promise(resolve=>w.releaseOld=resolve);return r};w.older=w.search();w.newer=w.search("reject")});
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="not_applicable"&&typeof(window as any).releaseOld==="function");
  await page.evaluate(async()=>{const w=window as any;w.releaseOld();await w.older;w.searchEvidenceBridge=w.originalBridge});
  check("遅い成功応答で棄却済み資料が復活しない",await page.locator("[data-fact],.comparison").count()===0);
  await run();
  await page.evaluate(()=>{const w=window as any;w.originalBridge=w.searchEvidenceBridge;let count=0;w.searchEvidenceBridge=async(p:any)=>{if(++count===1){await new Promise(resolve=>w.releaseError=resolve);throw Error("controlled stale error")}return w.originalBridge(p)};w.older=w.search();w.newer=w.search("reject")});
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="not_applicable"&&typeof(window as any).releaseError==="function");
  await page.evaluate(async()=>{const w=window as any;w.releaseError();await w.older;w.searchEvidenceBridge=w.originalBridge});
  check("遅いエラーが新しい状態を上書きしない",!(await page.locator("#status").innerText()).includes("controlled stale error"));
  await run();
  await page.locator(".years").fill("2");
  check("年齢編集は古い結果を即時消去",await page.locator("[data-fact],.comparison").count()===0);
}