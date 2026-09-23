import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
const out=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../evidence-work/parent-reading-evaluation/conversation-editorial-preview-02");
const html=fs.readFileSync(path.join(out,"index.html"),"utf8");
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
assert(!/<textarea|<input|レビュー担当|下書き|drafts|quoteSha256|sourceFileSha256|originalId/.test(html));
assert.equal(html.split("編集見本・AI未接続").length,2);
const scenes=JSON.parse(fs.readFileSync(path.join(out,"transcript.json")));
assert.equal(scenes.length,3);
assert.equal(scenes[0].messages.length,2);assert.equal(scenes[1].messages.length,4);assert.equal(scenes[2].messages.length,3);
for(const scene of scenes)for(const m of scene.messages)for(const key of ["text","note","question","support","medical","emergency","editorial"])if(m[key])assert(html.includes(m[key]),"Transcript text missing from user HTML: "+key);
assert(scenes[0].messages[1].text.includes("昼寝を含めて24時間あたり10〜13時間"));
assert(scenes[2].messages[1].text.includes("昼寝を含む1日（24時間）の合計で11〜14時間"));
for(const scene of scenes.slice(0,2))for(const m of scene.messages){
 assert(!m.note,"No unnecessary caveat in numeric-only or own-sleep scene");
 assert(!/判断できません|決められません/.test(m.text));
}
assert(scenes[2].messages[1].note.includes("病気かどうか"));
assert(scenes[2].messages[2].emergency&&scenes[2].messages[2].medical&&scenes[2].messages[2].support);
console.log("Static syntax, transcript and boundaries passed. Browser/viewport checks have NOT run.");