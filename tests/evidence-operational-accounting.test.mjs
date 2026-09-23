import test from "node:test";
import assert from "node:assert/strict";
import { estimate, admit, measureUsage, checkResponse, MODEL } from "../prototypes/evidence-consultation/evaluation/operational-accounting.mjs";
const ledger = () => ({schemaVersion:2,purpose:"cumulative-provider-api-transmissions-not-per-run",
  limits:{maxApiTransmissions:20,operationalModelBudgetMicroUSD:1e6,maxGenerationAttempts:11,maxConcurrency:1,maxRetries:0},
  entries:[{sequence:1,kind:"model_metadata",httpStatus:200,path:"/v1/models/gpt-5.6-luna"}],halted:false});
const usage = {input_tokens:1000,output_tokens:500,total_tokens:1500,
  input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:100}};
test("first estimate is 3800 microUSD with abundant operational headroom",()=>{
  const p=estimate(1398);assert.equal(p.estimatedMicroUSD,3800);assert.equal(admit(ledger(),"Q01",p).remainingMicroUSD,1e6);
});
test("8000 is not a fixed input ceiling and observed deltas are not reused as constants",()=>{
  assert.equal(estimate(9000).estimatedInputTokens,18000);
  assert.equal(estimate(7000,[{estimate:{localJsonTokens:1000},usage:{input_tokens:9000}}]).estimatedInputTokens,23000);
});
test("reasoning not double counted and cache write replaces ordinary input",()=>{
  assert.equal(measureUsage(usage).microUSD,800);
  assert.equal(measureUsage({...usage,input_tokens_details:{cached_tokens:100,cache_write_tokens:200}}).microUSD,792);
});
test("missing or inconsistent usage is not silently zero",()=>{
  for(const u of [null,{}, {...usage,input_tokens_details:{cached_tokens:0}},
    {...usage,total_tokens:1499}, {...usage,output_tokens_details:{reasoning_tokens:501}}])
    assert.throws(()=>measureUsage(u));
});
test("no subsequent generation without completed and reviewed previous result",()=>{
  const l=ledger();l.entries.push({sequence:2,kind:"generation",state:"completed",measuredMicroUSD:800});
  assert.throws(()=>admit(l,"Q02",estimate(2000)));
  l.entries[1].review={verdict:"acceptable"};assert.doesNotThrow(()=>admit(l,"Q02",estimate(2000)));
  assert.throws(()=>admit(l,"Q01",estimate(2000)));
  l.halted=true;assert.throws(()=>admit(l,"Q02",estimate(2000)));
});
test("unknown outcomes, exhausted headroom and changed limits stop",()=>{
  const l=ledger();l.entries.push({sequence:2,kind:"generation",state:"outcome_unknown",review:{verdict:"acceptable"},measuredMicroUSD:900000});
  assert.throws(()=>admit(l,"Q02",estimate(2000)));l.entries[1].state="completed";
  l.entries[1].measuredMicroUSD=990000;assert.throws(()=>admit(l,"Q02",estimate(2000)));
  l.limits.maxApiTransmissions=21;assert.throws(()=>admit(l,"Q02",estimate(2000)));
});
test("eleven generations and twenty cumulative transmissions cannot be exceeded",()=>{
  const l=ledger();
  for(let i=0;i<11;i++) l.entries.push({sequence:i+2,kind:"generation",state:"completed",
    measuredMicroUSD:1000,review:{verdict:"acceptable"}});
  assert.throws(()=>admit(l,"Q12",estimate(2000)),/generation_limit/);
  while(l.entries.length<20) l.entries.push({...l.entries.at(-1),sequence:l.entries.length+1});
  assert.throws(()=>admit(l,"Q12",estimate(2000)),/transmission_limit/);
});
test("incomplete/unknown model or tier/cost excess/citation mismatch require stop",()=>{
  const source={source_id:"E01",version:"v",section_id:"s",locator:"p"};
  const body={model:MODEL,service_tier:"default",status:"completed",usage,output:[{type:"message",status:"completed",
    content:[{type:"output_text",text:JSON.stringify({answer_ja:"資料の説明",abstained:false,citations:[source]})}]}]};
  const run=b=>checkResponse(b,{citations:[source]},estimate(1398));
  assert.equal(run(body).automatedChecks.passed,true);
  for(const b of [{...body,status:"incomplete"},{...body,model:"other"},{...body,service_tier:"priority"},
    {...body,usage:{...usage,input_tokens:100000,total_tokens:100500}}])
    assert.equal(run(b).automatedChecks.passed,false);
  assert.equal(checkResponse(body,{citations:[]},estimate(1398)).automatedChecks.passed,false);
});
test("an editorial unit identifier cannot masquerade as an original section citation",()=>{
  const original={source_id:"E02",version:"v",section_id:"E02-C-REFERENCE-5",locator:"p"};
  const body={model:MODEL,service_tier:"default",status:"completed",usage,output:[{type:"message",status:"completed",
    content:[{type:"output_text",text:JSON.stringify({answer_ja:"説明",abstained:false,
      citations:[{...original,section_id:"E02-S01",locator:"source_notes editorial_notes"}]})}]}]};
  const checked=checkResponse(body,{citations:[original]},estimate(1246));
  assert(checked.stopReasons.includes("answer_schema_or_citation_mismatch"));
  assert.equal(checked.measuredMicroUSD,800);
  assert.equal(checked.answer.citations[0].section_id,"E02-S01");
});