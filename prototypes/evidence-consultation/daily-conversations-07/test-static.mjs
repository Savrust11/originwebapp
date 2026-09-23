import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const out=path.join(root,"evidence-work/daily-conversations-07/preview");
const content=JSON.parse(fs.readFileSync(path.join(root,"evidence-work/daily-conversations-07/content.json"),"utf8"));
const page=fs.readFileSync(path.join(out,"index.html"),"utf8");
const reviewer=fs.readFileSync(path.join(out,"reviewer.html"),"utf8");
const transcript=JSON.parse(fs.readFileSync(path.join(out,"transcript.json"),"utf8"));
const receipt=JSON.parse(fs.readFileSync(path.join(out,"adapter-receipt.json"),"utf8"));
const escaped=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
assert.equal(content.scenes.length,10);
assert.deepEqual(transcript,content);
assert(page.includes(content.label)&&page.includes("根拠を見る"));
assert(page.includes("connect-src 'none'")&&page.includes("form-action 'none'"));
assert(!/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon/.test(page));
for(const scene of content.scenes){
  assert(page.includes(scene.title));
  assert(page.includes(scene.turns[0].text)&&page.includes(scene.turns[1].text));
  for(const source of scene.sources){
    if(source.originalText.length>80)assert(!page.includes(source.originalText),`original text leaked: ${scene.id}/${source.key}`);
    assert(!page.includes(source.unitId)&&!page.includes(source.versionId),`internal id leaked: ${scene.id}/${source.key}`);
    assert(reviewer.includes(source.unitId)&&reviewer.includes(source.versionId)&&reviewer.includes(escaped(source.originalText)));
    for(const context of source.requiredContext)assert(!page.includes(context.text)&&reviewer.includes(escaped(context.text)));
    if(source.sourceFields){
      assert(page.includes("公的制度事実")&&page.includes("原文引用ではない"));
      for(const field of Object.values(source.sourceFields)){
        assert(page.includes(field.value??field.unknownReason));
        assert(page.includes(field.sourceSection)&&page.includes(field.checkedAt));
        assert(reviewer.includes(escaped(field.value??field.unknownReason)));
      }
    }
  }
  for(const key of ["answersQuestion","actionable","questionsUseful","sourceFaithful","readable","humanPath"])
    assert(reviewer.includes(scene.review[key].note));
}
assert(!page.includes("approvalNote")&&!page.includes("claimNotes"));
assert(!page.includes('"originalText"')&&!page.includes('"requiredContext"'));
assert(!reviewer.includes("[object Object]"));
assert.equal(receipt.status,"checked_isolated_adapter");
for(const [relative,expected] of Object.entries(receipt.frozenInputs))
  assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root,relative))).digest("hex"),expected,relative);
console.log("PASS: contract, ten scenes, first Q+A, evidence separation, no network/storage APIs, frozen hashes.");