import "../../../tests/safety/require-managed.mjs";
import fs from "node:fs";
import assert from "node:assert/strict";
import {openRuntime} from "./runtime.mts";
import {out,verifyPreservation} from "./preservation.mjs";
import {regressions} from "./regressions.mts";
import {endButtonSmoke} from "./lifecycle.mts";
const dir=`${out}/attempt-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
const checks:string[]=[];let rt:any,failure:any=null;
const check=(name:string,ok:any)=>{assert(ok,name);checks.push(name)};
try{
  rt=await openRuntime(true);
  const {page,gate}=rt;
  await page.setViewportSize({width:390,height:844});
  check("通常検索は未承認候補を含まない",(await gate.normalControl()).results.length===0);
  for(const [name,years,months] of [["blank-years-month8","", "8"],["0y8m","0","8"],["1y8m","1","8"],["unknown","",""],["11m","0","11"],["12m","1","0"],["35m","2","11"],["36m","3","0"]] as string[][]){
    await page.locator("#question").fill("睡眠時間");
    await page.locator("#target").selectOption("child");
    await page.locator(".years").fill(years);await page.locator(".months").fill(months);
    await page.locator("#topic").selectOption("sleep");
    await page.locator("#confirmed").check();await page.locator("#age-ack").check();
    await page.locator("#search").click();
    await page.waitForFunction(()=>window.lastConnectionResult?.state==="materials_displayed");
    const eligible=["1y8m","12m","35m"].includes(name);
    check(name+" 年齢に合う入力欄",(await page.locator(".sleep").count())===(eligible?1:0));
    if(!eligible)check(name+" 比較不可の具体的理由",(await page.locator(".comparison-unavailable").innerText()).includes(years===""?"年齢が未確認":"12か月以上36か月未満"));
    check(name+" 未入力か月なし",!(await page.locator("body").innerText()).includes("未入力か月"));
    check(name+" 関連付けチェックなし",await page.locator('[data-sleep="link"]').count()===0);
    check(name+" 詳細は閉じている",await page.locator("details.reviewer[open]").count()===0);
    const visible=await page.locator("body").innerText();
    check(name+" 資料通知は一度だけ",(visible.match(/についての資料を表示しています/g)||[]).length===1);
    check(name+" 比較結果を勝手に表示しない",await page.locator(".comparison").count()===0);
    check(name+" 横にはみ出さない",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(eligible){
      check(name+" 補足前と補足後を区別",(await page.locator(".aggregation-explanation").innerText()).includes("元の睡眠資料だけでは昼寝を含むか未確認でした。補足の議事録では"));
      check(name+" 重複なしの4つの確認",await page.locator("[data-sleep]").count()===4);
      for(const key of ["sameDay","actual","complete","napIncluded"])check(name+" "+key+" は一度だけ",await page.locator('[data-sleep="'+key+'"]').count()===1);
    }
    if(name==="blank-years-month8")check("空欄を0歳と解釈しない",(await page.locator(".age-error").innerText())==="0歳8か月ですか？ 歳を入力してください");
    await page.screenshot({path:`${dir}/${name}.png`,fullPage:true});
  }
  const input={question:"睡眠時間",target:"child",children:[{id:"c1",years:1,months:8}],health:{},confirmed:true,ageConflictAcknowledged:true};
  const sleep={"child:c1":{night:10,nap:1,actual:true,sameDay:true,complete:true,napIncluded:true,link:false}};
  const selected=await gate.search({input,sleep,upfrontTopic:"sleep"});
  check("選択だけでは比較しない",selected.groups.every((g:any)=>!g.sleepResult));
  const compared=await gate.search({input,sleep,token:selected.token,action:"compare",compareGroupId:"child:c1"});
  check("link falseでも検証済み出典で比較",compared.groups.some((g:any)=>g.sleepResult?.comparison.performed));
  await regressions(rt,check,dir);
  check("外部通信なし",rt.getExternalRequests()===0);
  check("ページエラーなし",rt.errors.length===0);
  check("未承認のまま",(await rt.pool.query("SELECT publication_status,manual_reviewed FROM evidence_versions")).rows.every((r:any)=>r.publication_status==="draft"&&!r.manual_reviewed));
  await endButtonSmoke(rt,dir,check);
}catch(e:any){failure={message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]")};throw e}
finally{
  if(rt)await rt.close();
  fs.writeFileSync(`${dir}/results.json`,JSON.stringify({result:failure?"FAILED":"PASSED",failure,checks,headful:true,cleanupStatus:rt?.cleanupStatus,preservedFiles:verifyPreservation(),outerCleanup:"親ランナー終了後に確認が必要"},null,2));
}