import "../../../tests/safety/require-managed.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const rootOut="evidence-work/parent-reading-evaluation/vocabulary-inventory-review-01";
fs.mkdirSync(rootOut,{recursive:true});
let number=1;while(fs.existsSync(`${rootOut}/attempt-${String(number).padStart(2,"0")}`))number++;
const out=`${rootOut}/attempt-${String(number).padStart(2,"0")}`;
fs.mkdirSync(out);
const checks:any[]=[],cases:any[]=[],images:any[]=[],inventory:any[]=[];
const check=(name:string,value:any)=>{assert(value,name);checks.push({name,result:"PASS"})};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const input=(question:string,target="child",years:number|null=1,months:number|null=8)=>({
  question,target,children:[{id:"c1",years,months}],health:{},confirmed:true,ageConflictAcknowledged:true,
});
const units=(r:any)=>[...new Set(r.groups.flatMap((g:any)=>g.items.map((i:any)=>i.unitId)))];
let browser:any,pool:any,temp:string|undefined,failure:any,externalRequests=0,sqlCalls=0;
try{
  const {Pool}=await import("pg");
  const {initializePrototypeCorpus}=await import("../../../tests/fixtures/real-corpus/setup.mts");
  const {createVocabularyConnection,aliases,compoundExceptions}=await import("./vocabulary.mts");
  const {renderInputPage}=await import("../retrieval-fact-connection/ui.mjs");
  const {loadValidatedCatalog}=await import("../fact-display-pilot/projection.mjs");
  const {chromium}=await import("playwright");
  pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
  const initialized=await initializePrototypeCorpus(pool);
  check("All four prepared sources imported",initialized.corpus.sources.size===4);
  check("All eleven logical units imported",initialized.byUnit.size===11);
  const connection=await createVocabularyConnection(pool,initialized);
  const state=await pool.query("SELECT publication_status,manual_reviewed,reviewer_name,reviewed_at FROM evidence_versions");
  check("Four draft unreviewed versions without human approval",state.rows.length===4&&state.rows.every((r:any)=>r.publication_status==="draft"&&!r.manual_reviewed&&r.reviewer_name===null&&r.reviewed_at===null));
  check("Sources not activated or published",(await pool.query("SELECT status,current_published_version_id FROM evidence_sources")).rows.every((r:any)=>r.status==="draft"&&r.current_published_version_id===null));
  check("Normal search excludes all candidates",(await connection.normalControl()).results.length===0);
  const ask=async(name:string,payload:any,lane="adapted")=>{
    const r=await (lane==="raw"?connection.searchOriginal:connection.search)({input:payload});
    cases.push({name,lane,input:payload,units:units(r),result:r});return r;
  };
  const trials=[
    {q:"ねんねはどれくらい",expected:"E02-S01",kind:"positive"},
    {q:"眠る時間の目安",expected:"E02-S01",kind:"positive"},
    {q:"補完食の始めどき",expected:"E01-S03",kind:"positive"},
    {q:"粉ミルクを選ぶこと",expected:"E01-S01",kind:"positive"},
    {q:"親子のやりとりについて",expected:"E03-S01",kind:"positive"},
    {q:"画面を見る時間について",expected:"E04-S01",kind:"positive"},
    {q:"ねんねアートの撮影背景",kind:"compound-negative"},
    {q:"ねんねグッズを買いたい",kind:"compound-negative"},
    {q:"親子丼の作り方",kind:"negative-observation"},
    {q:"ねんね用品の通販",kind:"negative-observation"},
    {q:"動画編集ソフトの選び方",kind:"negative-observation"},
    {q:"うつ伏せの写真",kind:"negative-observation"},
  ];
  for(const t of trials)await ask(`before:${t.q}`,input(t.q),"raw");
  await connection.installAliases();
  const beforeRepair=await ask("complementary-alias-before-keyword-repair",input("補完食の始めどき"));
  check("Existing complementary concept gap reproduced before repair",units(beforeRepair).length===0&&beforeRepair.groups[0].state==="no_matching");
  const keywordRepair=await connection.repairComplementaryKeyword();
  fs.writeFileSync(`${out}/keyword-repair.json`,JSON.stringify(keywordRepair,null,2)+"\n",{flag:"wx"});
  fs.writeFileSync(`${out}/lexical-policy.json`,JSON.stringify({aliases,compoundExceptions,
    questionRouting:false,caseRouting:false,subjectInference:false,
    scope:"dictionary aliases and two lexical compound exclusions; remaining substring false positives are measured"},null,2)+"\n",{flag:"wx"});
  for(const t of trials){
    const raw=await ask(`raw-after:${t.q}`,input(t.q),"raw");
    const result=await ask(`after:${t.q}`,input(t.q));
    if(t.expected)check(`Alias retrieves source unit: ${t.q}`,units(result).includes(t.expected));
    if(t.kind==="compound-negative")check(`Compound does not trigger sleep: ${t.q}`,units(result).length===0);
    if(t.kind==="negative-observation")checks.push({name:`Observed negative: ${t.q}`,result:"OBSERVATION",
      falsePositive:units(result).length>0,retrieved:units(result)});
    check(`Alias never changes explicit target/age: ${t.q}`,result.groups[0].id==="child:c1"&&result.groups[0].ageMonths===20);
  }
  const mixture=await ask("compound-plus-valid-term",input("ねんねアートと睡眠時間について"));
  check("Compound suppression preserves other valid terms",units(mixture).includes("E02-S01"));
  const unknown=await ask("no-inference",input("ねんねについて","unknown",null,null));
  check("Ambiguous daily language does not infer subject or age",unknown.groups[0].id==="unknown"&&unknown.groups[0].ageMonths===null&&unknown.groups[0].healthPrompts.length===0);
  const queries:Record<string,string>={
    "E01-S01":"ミルク","E01-S02":"離乳","E01-S03":"離乳食をいつ始める？","E01-S04":"授乳",
    "E02-S01":"睡眠時間","E02-S02":"睡眠時間","E02-S03":"保護者の睡眠",
    "E03-S01":"育児支援","E03-S02":"depressive symptoms","E04-S01":"動画","E04-S02":"screen use",
  };
  const facts=loadValidatedCatalog().facts;
  for(const [id,unit] of initialized.byUnit as any){
    const response=await ask(`inventory:${id}`,input(queries[id],"unknown",null,null));
    const matches=response.groups.flatMap((g:any)=>g.items).filter((i:any)=>i.unitId===id);
    const fragment=initialized.byFragment.get(unit.fragmentId);
    const sourceJson=JSON.parse(fs.readFileSync(`evidence-work/v0.2/${unit.sourceId}.json`,"utf8"));
    const saved=sourceJson.units.find((u:any)=>u.id===id);
    check(`Inventory root is retrievable: ${id}`,matches.length>0);
    check(`Inventory root exact: ${id}`,hash(matches[0].originalText)===fragment.textSha256);
    inventory.push({unitId:id,sourceId:unit.sourceId,fragmentId:unit.fragmentId,
      originalSaved:true,originalSha256:fragment.textSha256,requiredContextIds:saved.required_context_ids,
      requiredContextSaved:saved.required_context_ids.every((c:string)=>initialized.byFragment.has(c)),
      priorEnvironmentImported:unit.sourceId!=="E01",currentEnvironmentImported:true,
      query:queries[id],queryTarget:"unknown",queryAgeMonths:null,
      witnessInput:input(queries[id],"unknown",null,null),retrievedLogicalUnitIds:units(response),
      currentRetrievable:matches.length>0,originalReturned:matches[0].originalText,
      requiredContextReturned:matches[0].requiredContext,
      factIds:facts.filter((f:any)=>f.unitId===id&&f.sourceId===unit.sourceId).map((f:any)=>f.id),
      persistedStatus:"draft/test-only/unreviewed",
      formalApproval:{humanApproval:saved.human_approval,publicationStatus:saved.publication_status}});
  }
  check("Inventory covers exactly eleven units",inventory.length===11);
  check("No new facts added",facts.length===5);
  const feeding=await ask("feeding-current-restored",input("離乳食をいつ始める？","child",0,5));
  const feedingItem=feeding.groups.flatMap((g:any)=>g.items).find((i:any)=>i.unitId==="E01-S03");
  check("E01-S03 found with required footnotes and no invented fact",feedingItem&&feedingItem.missingFact&&feedingItem.requiredContext.length>0);
  const priorBlind=(await connection.normalControl("離乳食をいつ始める？")).results;
  check("Normal gate remains closed for E01",priorBlind.length===0);
  temp=fs.mkdtempSync(path.join(os.tmpdir(),"vocabulary-inventory-ui-"));
  fs.writeFileSync(path.join(temp,"index.html"),renderInputPage());
  browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--disable-background-networking","--disable-component-update","--disable-sync","--host-resolver-rules=MAP * ~NOTFOUND"]});
  const context=await browser.newContext({offline:true,serviceWorkers:"block",viewport:{width:390,height:844}});
  await context.route("**/*",(r:any)=>{if(/^(file|data):/.test(r.request().url()))return r.continue();externalRequests++;return r.abort()});
  const page=await context.newPage();const errors:string[]=[];
  page.on("pageerror",(e:any)=>errors.push(e.message));
  await page.exposeBinding("searchEvidenceBridge",async(_s:any,payload:any)=>connection.search(payload));
  await page.goto(`file://${path.join(temp,"index.html")}`);
  await page.evaluate(()=>document.fonts.ready);
  const run=async(q:string,y:string,m:string)=>{
    await page.locator("#question").fill(q);await page.locator("#target").selectOption("child");
    await page.locator(".years").fill(y);await page.locator(".months").fill(m);
    await page.locator("#confirmed").check();await page.locator("#search").click();
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.startsWith("検索状態"));
  };
  const capture=async(name:string,selector?:string)=>{
    check(`${name}: no overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const p=`${out}/${name}.png`;
    if(selector)await page.locator(selector).first().screenshot({path:p});
    else await page.screenshot({path:p,fullPage:true});
    images.push({name,path:p,sha256:createHash("sha256").update(fs.readFileSync(p)).digest("hex")});
  };
  await run("離乳食をいつ始める？","0","5");
  check("Plain missing explanation message",await page.locator('[data-unit="E01-S03"] .missing-fact').innerText()==="関連資料はありますが、分かりやすい説明は準備中です");
  await page.locator('[data-unit="E01-S03"] .missing-original summary').click();
  for(const c of feedingItem.requiredContext)check("Feeding footnote displayed exactly: "+c.sectionId,(await page.locator('[data-unit="E01-S03"]').textContent()).includes(c.originalText));
  await capture("feeding-full");await capture("feeding-original-context",'[data-unit="E01-S03"]');
  await run("ねんねはどれくらい","1","8");
  check("Daily-language UI uses existing fact renderer",await page.locator('[data-fact="sleep-guidance"]').count()===1);
  check("Sleep inputs not inferred",await page.locator(".night").inputValue()===""&&await page.locator(".nap").inputValue()==="");
  await capture("daily-sleep-full");
  await page.locator('[data-fact="sleep-guidance"]').scrollIntoViewIfNeeded();
  const sleepShot=`${out}/daily-sleep-fact-top.png`;await page.screenshot({path:sleepShot});
  images.push({name:"daily-sleep-fact-top",path:sleepShot,sha256:createHash("sha256").update(fs.readFileSync(sleepShot)).digest("hex")});
  await run("ねんねアートの撮影背景","1","8");
  check("No-hit friendly message",await page.locator(".search-gap").innerText()==="登録資料から該当箇所を見つけられませんでした");
  check("Technical no-hit diagnostic stays internal",!(await page.locator("body").innerText()).includes("no_vocabulary"));
  await capture("compound-no-hit");
  await run("予防接種の予約先","1","8");await capture("unrelated-no-hit");
  check("Unrelated query not existence claim",await page.locator(".search-gap").innerText()==="登録資料から該当箇所を見つけられませんでした");
  check("Browser no script errors",errors.length===0);check("Browser external requests zero",externalRequests===0);
  check("Final sources remain draft",(await pool.query("SELECT status,current_published_version_id FROM evidence_sources")).rows.every((r:any)=>r.status==="draft"&&r.current_published_version_id===null));
  check("Final versions remain unreviewed drafts",(await pool.query("SELECT publication_status,manual_reviewed FROM evidence_versions")).rows.every((r:any)=>r.publication_status==="draft"&&!r.manual_reviewed));
  check("Normal search still excludes candidates",(await connection.normalControl()).results.length===0);
  sqlCalls=connection.getSqlCalls();check("Actual canonical SQL executed",sqlCalls>0);
}catch(e:any){failure={message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]"),stack:String(e.stack).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]")}}
finally{if(browser)await browser.close();if(pool)await pool.end();if(temp)fs.rmSync(temp,{recursive:true,force:true})}
fs.writeFileSync(`${out}/inventory.json`,JSON.stringify(inventory,null,2)+"\n",{flag:"wx"});
fs.writeFileSync(`${out}/verification.json`,JSON.stringify({result:failure?"FAILED":"PASSED",failure,checks,cases,images,
  sqlCalls,externalBrowserRequests:externalRequests,newModelApiCalls:0,existingDatabaseAccess:false,
  normalApplicationStarted:false,httpServerStarted:false,approvalsChanged:false,
  temporaryBrowserDirectoryRemoved:temp?!fs.existsSync(temp):true,
  outerClusterCleanup:"Owner finally; inspect owner exit and directories after command"},null,2)+"\n",{flag:"wx"});
if(failure)throw Error("vocabulary inventory verification failed; see append-only attempt record");