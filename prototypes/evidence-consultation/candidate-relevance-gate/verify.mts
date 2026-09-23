import "../../../tests/safety/require-managed.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const rootOut="evidence-work/parent-reading-evaluation/candidate-relevance-gate-01";
const hash=(s:any)=>createHash("sha256").update(s).digest("hex");
const read=(p:string)=>JSON.parse(fs.readFileSync(p,"utf8"));
const seal=read(`${rootOut}/plan-seal.json`),plan=read(`${rootOut}/test-plan.json`);
assert.equal(hash(fs.readFileSync(`${rootOut}/test-plan.json`)),seal.sha256);
assert.equal(seal.implementationDirectoryExisted,false);
let n=1;while(fs.existsSync(`${rootOut}/attempt-${String(n).padStart(2,"0")}`))n++;
const out=`${rootOut}/attempt-${String(n).padStart(2,"0")}`;fs.mkdirSync(out);
const checks:any[]=[],cases:any[]=[],images:any[]=[],observations:any[]=[];
const check=(name:string,value:any)=>{assert(value,name);checks.push({name,result:"PASS"})};
const input=(q:string,unknown=false)=>({question:q,target:unknown?"unknown":"child",
  children:[{id:"c1",years:unknown?null:1,months:unknown?null:8}],health:{},confirmed:true,ageConflictAcknowledged:true});
const supplied={night:10,nap:1,actual:true,sameDay:true,complete:true,napIncluded:true,link:true};
const facts=(r:any)=>r.groups.flatMap((g:any)=>g.items.filter((i:any)=>i.factIds.length).map((i:any)=>i.unitId));
const compared=(r:any)=>r.groups.some((g:any)=>g.sleepResult?.comparison.performed);
let pool:any,browser:any,temp:string|undefined,failure:any,sqlCalls=0,externalRequests=0;
try{
  const {Pool}=await import("pg");
  const {initializePrototypeCorpus}=await import("../../../tests/fixtures/real-corpus/setup.mts");
  const {createGate}=await import("./gate.mts");
  const {renderGatePage}=await import("./ui.mjs");
  const {chromium}=await import("playwright");
  pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
  const initialized=await initializePrototypeCorpus(pool);
  check("Four sources eleven units",initialized.corpus.sources.size===4&&initialized.byUnit.size===11);
  const gate=await createGate(pool,initialized);
  check("Ordinary gate excludes draft candidates",(await gate.normalControl()).results.length===0);
  for(const set of ["known","novel"])for(const spec of plan[set]){
    const p:any={input:input(spec.question,!!spec.unknownConditions),sleep:{"child:c1":supplied}};
    if(spec.action==="upfront")p.upfrontTopic=spec.topic;
    const initial=await gate.search(p);
    const cu=[...new Set(initial.candidates.map((c:any)=>c.unitId))] as string[];
    const related=cu.filter(u=>spec.relatedUnits.includes(u));
    const unrelated=cu.filter(u=>!spec.relatedUnits.includes(u));
    check(`${spec.id} expected candidate coverage`,spec.expectedUnrelated.every((u:string)=>cu.includes(u))&&
      (spec.relatedUnits.length===0||related.length>0));
    check(`${spec.id} expected initial pause`,(initial.state==="needs_topic")===spec.expectInitialPause);
    if(spec.expectInitialPause){
      check(`${spec.id} API candidate-only, no facts/quotes/comparison`,initial.groups.length===0&&
        !JSON.stringify(initial).includes("originalText")&&!JSON.stringify(initial).includes("totalHours")&&
        !JSON.stringify(initial).includes("data-fact")&&!JSON.stringify(initial).includes('"factIds"')&&
        !JSON.stringify(initial).includes('"html"')&&!JSON.stringify(initial).includes('"sleepResult"'));
    }
    let final=initial;
    if(["confirm","reject","rephrase"].includes(spec.action))
      final=await gate.search({...p,token:initial.token,action:spec.action,topic:spec.topic});
    const finalFacts=facts(final);
    const finalUnits=final.groups.flatMap((g:any)=>g.items.map((i:any)=>i.unitId));
    const leak=finalFacts.some((u:string)=>!spec.relatedUnits.includes(u))||
      (compared(final)&&!spec.relatedUnits.includes("E02-S01"));
    check(`${spec.id} expected final facts`,(finalFacts.length>0)===spec.expectFinalFacts);
    check(`${spec.id} expected numeric comparison`,compared(final)===spec.expectFinalComparison);
    if(spec.expectFinalOriginal)check(`${spec.id} prepared original without invented fact`,finalUnits.includes("E01-S03"));
    check(`${spec.id} unrelated candidates do not reach fact or comparison`,!leak);
    check(`${spec.id} related question not permanently blocked`,!spec.relatedUnits.length||finalUnits.some((u:string)=>spec.relatedUnits.includes(u)));
    cases.push({id:spec.id,set,question:spec.question,input:p,expected:spec,initial,final,
      metrics:{relatedCandidateRetrieved:related.length>0,unrelatedCandidateRetrieved:unrelated.length>0,
        unrelatedCandidateReachedFactOrComparison:leak,
        neededConfirmationStopped:unrelated.length>0&&initial.state==="needs_topic"&&initial.groups.length===0,
        relatedQuestionIncorrectlyBlocked:spec.relatedUnits.length>0&&!finalUnits.some((u:string)=>spec.relatedUnits.includes(u)),
        initialPaused:initial.state==="needs_topic",extraConfirmationActions:spec.action==="upfront"||spec.action==="none"?0:1,
        upfrontTopicSelectionActions:spec.action==="upfront"?1:0},
      candidateUnitIds:cu,relatedCandidateUnitIds:related,unrelatedCandidateUnitIds:unrelated,finalUnitIds:finalUnits});
  }
  const base={input:input("ねんねはどれくらい"),sleep:{"child:c1":supplied}};
  const first=await gate.search(base);
  const yes=await gate.search({...base,token:first.token,action:"confirm",topic:"sleep"});
  const same=await gate.search({...base,token:yes.token});
  check("Confirmed unchanged input does not ask again",same.state==="topic_confirmed");
  for(const [label,p] of Object.entries({
    question:{...base,input:{...base.input,question:"ねんね用品の通販"}},
    target:{...base,input:{...base.input,target:"both"}},
    age:{...base,input:{...base.input,children:[{id:"c1",years:2,months:0}]}},
    health:{...base,input:{...base.input,health:{"child:c1":{diagnosed_illness_or_disability:"absent"}}}},
    sleep:{...base,sleep:{"child:c1":{...supplied,nap:2}}}
  })){
    const r=await gate.search({...p,token:yes.token});
    check(`${label} edit invalidates bound topic`,r.staleConfirmation&&r.groups.length===0&&r.approvedTopic===null);
    if(label==="health")check("Irrelevant health answer surfaces validation error, not material absence",r.state==="input_required");
  }
  const wrong={input:input("ねんね用品の通販"),sleep:{"child:c1":supplied}};
  const w=await gate.search(wrong);
  const wrongYes=await gate.search({...wrong,token:w.token,action:"confirm",topic:"sleep"});
  observations.push({name:"Wrong affirmative confirmation not semantically detected",factsShown:facts(wrongYes),comparison:compared(wrongYes),
    limitation:"The user's explicit topic choice is trusted. Wrong confirmation can expose irrelevant general facts/comparison; this is not a semantic adequacy classifier."});
  check("Wrong yes limitation measured rather than concealed",facts(wrongYes).length>0);
  check("No clinical adequacy claim",wrongYes.answerAdequacy==="not_assessed");
  temp=fs.mkdtempSync(path.join(os.tmpdir(),"candidate-relevance-ui-"));
  fs.writeFileSync(path.join(temp,"index.html"),renderGatePage());
  browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",
    args:["--disable-background-networking","--disable-component-update","--disable-sync","--host-resolver-rules=MAP * ~NOTFOUND"]});
  const context=await browser.newContext({offline:true,serviceWorkers:"block",viewport:{width:390,height:844}});
  await context.route("**/*",(r:any)=>{if(/^(file|data):/.test(r.request().url()))return r.continue();externalRequests++;return r.abort()});
  const page=await context.newPage();const errors:string[]=[];
  page.on("pageerror",(e:any)=>errors.push(e.message));
  await page.exposeBinding("searchEvidenceBridge",async(_:any,p:any)=>gate.search(p));
  await page.goto(`file://${path.join(temp,"index.html")}`);
  await page.evaluate(()=>document.fonts.ready);
  const run=async(q:string,topic="")=>{
    await page.locator("#question").fill(q);await page.locator("#target").selectOption("child");
    await page.locator(".years").fill("1");await page.locator(".months").fill("8");
    await page.locator("#topic").selectOption(topic);await page.locator("#confirmed").check();
    await page.locator("#search").click();
    await page.waitForFunction(()=>!!(window as any).lastConnectionResult);
  };
  const shot=async(name:string)=>{
    check(`${name} no mobile overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const p=`${out}/${name}.png`;await page.screenshot({path:p,fullPage:true});
    images.push({name,path:p,sha256:hash(fs.readFileSync(p))});
  };
  await run("ねんね用品の通販");await shot("shopping-candidates-paused");
  check("Browser candidate has no fact or comparison",await page.locator("[data-fact],.comparison").count()===0);
  await page.locator('[data-gate-action="reject"]').first().click();
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="not_applicable");
  check("Reject clears candidates and answers",await page.locator("[data-candidate],[data-fact],.comparison").count()===0);
  await shot("rejected-topic");
  await run("うつ伏せの写真");
  await page.locator('[data-gate-action="rephrase"]').first().click();
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="rephrase");
  check("Rephrase focuses question",await page.locator("#question").evaluate((e:any)=>document.activeElement===e));
  await run("動画編集ソフトを購入したい。それとは別に子どもの睡眠時間の目安を知りたい");
  await shot("mixed-topic-prompt");
  await page.locator('[data-confirm-topic="sleep"]').click();
  await page.waitForSelector('[data-fact="sleep-guidance"]');
  check("Mixed topic retains childcare but not screen facts",await page.locator('[data-fact="screen-duration"],[data-fact="screen-sleep"]').count()===0);
  await shot("confirmed-general-information");
  await page.locator(".night").fill("10");await page.locator(".nap").fill("1");
  for(const key of ["sameDay","actual","complete","napIncluded","link"])await page.locator(`[data-sleep="${key}"]`).check();
  check("Optional condition edit removes previous fact projection",await page.locator("[data-fact]").count()===0);
  await page.locator(".sleep .apply").click();
  await page.waitForSelector('[data-confirm-topic="sleep"]');
  check("Condition change needs re-confirmation, no numeric output",await page.locator(".comparison").count()===0);
  await page.locator('[data-confirm-topic="sleep"]').click();
  await page.waitForSelector('[data-comparison="within_numeric_range"]');
  // Readable viewport around comparison rather than a compressed long page.
  const cp=`${out}/confirmed-numeric-detail.png`;await page.locator(".comparison").screenshot({path:cp});
  images.push({name:"confirmed-numeric-detail",path:cp,sha256:hash(fs.readFileSync(cp))});
  await page.locator(".years").fill("2");
  check("Age edit clears all outputs",await page.locator("[data-fact],.comparison").count()===0);
  await run("眠る時間の目安","sleep");
  await page.waitForSelector('[data-fact="sleep-guidance"]');
  check("Upfront topic no follow-up prompt",await page.locator("[data-confirm-topic]").count()===0);
  // Supplementary concurrency checks refine the frozen input-binding rule.
  await page.evaluate(()=>{
    const w=window as any;w.originalBridge=w.searchEvidenceBridge;
    w.searchEvidenceBridge=async(p:any)=>{const r=await w.originalBridge(p);await new Promise(resolve=>w.releasePending=resolve);return r};
    w.pendingSearch=w.search();
  });
  check("Pending request synchronously clears eligible output",await page.locator("[data-fact],.comparison").count()===0&&await page.evaluate(()=>(window as any).lastConnectionResult===null));
  await page.waitForFunction(()=>typeof(window as any).releasePending==="function");
  await page.evaluate(()=>{const w=window as any;w.releasePending();w.searchEvidenceBridge=w.originalBridge});
  await page.waitForSelector('[data-fact="sleep-guidance"]');
  await page.evaluate(()=>{
    const w=window as any;let count=0;
    w.searchEvidenceBridge=async(p:any)=>{const index=++count;const r=await w.originalBridge(p);if(index===1)await new Promise(resolve=>w.releaseOld=resolve);return r};
    w.olderSearch=w.search();w.newerSearch=w.search("reject");
  });
  await page.waitForFunction(()=>(window as any).lastConnectionResult?.state==="not_applicable"&&typeof(window as any).releaseOld==="function");
  await page.evaluate(async()=>{const w=window as any;w.releaseOld();await w.olderSearch;w.searchEvidenceBridge=w.originalBridge});
  check("Older success cannot restore rejected output",await page.locator("[data-fact],.comparison").count()===0&&await page.evaluate(()=>(window as any).lastConnectionResult.state==="not_applicable"));
  // Clear the upfront choice to exercise candidate prompting after a stale error.
  await page.locator("#topic").selectOption("");await page.locator("#confirmed").check();
  await page.evaluate(()=>{
    const w=window as any;let count=0;
    w.searchEvidenceBridge=async(p:any)=>{if(++count===1){await new Promise(resolve=>w.releaseError=resolve);throw Error("delayed old error")}return w.originalBridge(p)};
    w.errorSearch=w.search();w.freshSearch=w.search();
  });
  await page.waitForSelector('[data-confirm-topic="sleep"]');
  await page.evaluate(async()=>{const w=window as any;w.releaseError();await w.errorSearch;w.searchEvidenceBridge=w.originalBridge});
  check("Stale error cannot clear newer prompt",await page.locator('[data-confirm-topic="sleep"]').count()===1&&!(await page.locator("#status").innerText()).includes("delayed old error"));
  await run("眠る時間の目安","sleep");await page.waitForSelector('[data-fact="sleep-guidance"]');
  await page.locator("#question").fill("ねんね用品の通販");
  check("Question edit clears upfront topic too",await page.locator("#topic").inputValue()===""&&await page.locator("[data-fact],.comparison").count()===0);
  await page.locator("#confirmed").check();await page.locator("#search").click();
  await page.waitForSelector('[data-confirm-topic="sleep"]');
  check("Old upfront topic does not confirm new question",await page.locator("[data-fact],.comparison").count()===0);
  await run("保育園の駐車場はどこ");await shot("no-candidate-no-confirmation");
  check("No candidates no confirmation burden",await page.locator("[data-confirm-topic]").count()===0);
  await run("離乳食をいつ始める？");
  await page.locator('[data-confirm-topic="feeding-start"]').click();
  await page.waitForSelector(".missing-fact");
  check("Missing explanation wording retained",await page.locator(".missing-fact").innerText()==="関連資料はありますが、分かりやすい説明は準備中です");
  check("Feeding confirmation only start logical unit",await page.locator('[data-unit="E01-S02"],[data-unit="E01-S04"]').count()===0);
  await shot("feeding-original-preparing");
  check("No browser script errors",errors.length===0);
  check("No external browser requests",externalRequests===0);
  check("Normal gate still excludes candidates",(await gate.normalControl()).results.length===0);
  const states=await pool.query("SELECT publication_status,manual_reviewed,reviewer_name FROM evidence_versions");
  check("Four versions remain unreviewed drafts",states.rows.length===4&&states.rows.every((r:any)=>r.publication_status==="draft"&&!r.manual_reviewed&&r.reviewer_name===null));
  check("Sources remain draft",(await pool.query("SELECT status,current_published_version_id FROM evidence_sources")).rows.every((r:any)=>r.status==="draft"&&r.current_published_version_id===null));
  sqlCalls=gate.getSqlCalls();
  check("Plan unchanged after testing",hash(fs.readFileSync(`${rootOut}/test-plan.json`))===seal.sha256);
}catch(e:any){failure={message:String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]"),stack:String(e.stack).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]")}}
finally{if(browser)await browser.close();if(pool)await pool.end();if(temp)fs.rmSync(temp,{recursive:true,force:true})}
const metrics=Object.fromEntries(["known","novel"].map(set=>{const c=cases.filter(c=>c.set===set);return[set,{cases:c.length,
  ...Object.fromEntries(plan.metrics.map((k:string)=>[k,c.reduce((n:number,c:any)=>n+Number(c.metrics[k]),0)])),
  upfrontTopicSelectionActions:c.reduce((n:number,c:any)=>n+c.metrics.upfrontTopicSelectionActions,0)}]}));
fs.writeFileSync(`${out}/verification.json`,JSON.stringify({result:failure?"FAILED":"PASSED",failure,checks,observations,cases,metrics,images,
  planSha256:seal.sha256,sqlCalls,externalRequests,modelApiCalls:0,normalApplicationStarted:false,httpServerStarted:false,
  existingDatabaseAccess:false,approvalsChanged:false,temporaryBrowserDirectoryRemoved:temp?!fs.existsSync(temp):true},null,2)+"\n",{flag:"wx"});
if(failure)throw Error("candidate relevance verification failed; see append-only attempt");