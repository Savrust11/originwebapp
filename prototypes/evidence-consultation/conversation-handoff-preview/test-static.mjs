import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {scenes,disclosure,providerDisclosure,earlyHandoffGuide} from "./scenes.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const out=path.join(root,"evidence-work/parent-reading-evaluation/conversation-handoff-preview-01");
assert.deepEqual(scenes.map(s=>s.turns.length),[6,4,5]);
const fields=["困りごと","確認した状況","試したこと","本人の希望"];
for(const s of scenes){
 assert(s.turns.length>=4&&s.turns.length<=6);
 for(const [p,a] of s.turns){
  assert(p&&a);assert((a.match(/[？?]/g)||[]).length<=1,"one question per answer");
  assert(!/試したことはありますか|どちらを優先/.test(a),"no mechanical tried/binary question");
  assert(!/資格|自動共有|未契約/.test(a),"operating details outside replies");
 }
 assert.deepEqual(Object.keys(s.summary),fields);
 assert(s.summary[s.correction.field]!==s.correction.text);
 assert.equal(s.earlySummaries.length,s.turns.length);
 s.earlySummaries.forEach((snapshot,index)=>{
  assert.equal(snapshot.visiblePairs,index+1);assert.deepEqual(Object.keys(snapshot.summary),fields);
  assert(snapshot.summary["本人の希望"].includes("人への相談を希望（操作見本）"));
  assert.equal(snapshot.recipient,s.proposedAt!==null&&index+1>=s.proposedAt?s.recipient:"宛先はまだ決めない");
  if(index<2||s.id==="relation")assert.equal(snapshot.summary["試したこと"],"未確認");
 });
 assert(s.missingEvidence&&s.needsChecking);
}
assert.equal(scenes[0].handoffAt,6);
assert(scenes[0].turns[2][1].includes("利用に進めず"));
assert.equal(scenes[1].handoffAt,4);
assert(scenes[1].turns.at(-1)[0].includes("もう人に相談したい"));
assert(!scenes[1].turns.at(-1)[1].includes("？"));
assert(scenes[1].turns.at(-1)[1].includes("不安ですよね"));
assert.equal(scenes[2].handoffAt,null);assert.equal(scenes[2].proposedAt,null);
assert(!/保育士|心理相談|要約を|引き継ぎ/.test(scenes[2].turns.flat().join("")));
const page=fs.readFileSync(path.join(out,"index.html"),"utf8");
assert(page.includes(disclosure)&&page.includes(providerDisclosure)&&page.includes(earlyHandoffGuide));
assert(!/FONT_BASE64|SCENES_JSON|GUIDE_JSON/.test(page));
assert(!/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|sendBeacon/.test(page));
assert(!/reviewer\.html|source-claim-map|preserved-source-hashes|missingEvidence|needsChecking|<iframe|<form/.test(page));
for(const s of scenes)assert(!page.includes(s.missingEvidence));
assert(page.includes("connect-src 'none'"));
assert(page.includes("編集見本の続きは未作成・ここまで"));
const transcript=JSON.parse(fs.readFileSync(path.join(out,"transcript.json"),"utf8"));
for(let i=0;i<3;i++){
 assert.deepEqual(transcript.scenes[i].turns,scenes[i].turns);
 assert.deepEqual(transcript.scenes[i].summary,scenes[i].summary);
 assert.deepEqual(transcript.scenes[i].earlySummaries,scenes[i].earlySummaries);
}
const claims=JSON.parse(fs.readFileSync(path.join(out,"source-claim-map.json"),"utf8"));
assert(claims.claims.every(x=>x.missingEvidence&&x.needsChecking));
for(const [file,hash] of Object.entries(JSON.parse(fs.readFileSync(path.join(out,"preserved-source-hashes.json"),"utf8")))){
 assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex"),hash,file);
}
console.log("PASS: 6/4/5 pairs; requested-only handoff; food immediate/no extra question; all-stage authored snapshots; transcript parity; reviewer-only evidence gaps; readonly hashes.");