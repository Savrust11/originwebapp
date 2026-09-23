import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../../..");
const out=path.join(root,"evidence-work/daily-conversations-07/preview");
const contentPath=path.join(root,"evidence-work/daily-conversations-07/content.json");
const originalDir=path.join(root,"prototypes/evidence-consultation/conversation-handoff-preview");
const originalPage=path.join(originalDir,"page.html");
const originalRuntime=path.join(originalDir,"runtime.mjs");
const fontPath=path.join(root,"prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2");
const expected={
  page:"32c37bb01cc32296bfbcf1c815c9afb02401973bb0fde9e17f52426307029215",
  runtime:"ca19697c0f7360afd11eee57d36d024e7e6f85df19abef257677d99c0c5bb310",
};
const sha=x=>createHash("sha256").update(x).digest("hex");
const read=file=>fs.readFileSync(file);
const exact=(text,anchor,replacement,label)=>{
  assert.equal(text.split(anchor).length-1,1,`${label}: expected exactly one frozen anchor`);
  return text.replace(anchor,replacement);
};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const json=x=>JSON.stringify(x).replace(/</g,"\\u003c");

if(!fs.existsSync(contentPath))throw Error(`Final authored content is not ready: ${contentPath}`);
const content=JSON.parse(fs.readFileSync(contentPath,"utf8"));
assert.equal(typeof content.label,"string");
assert.equal(content.label,"編集した会話見本・実モデル回答ではない");
assert(Array.isArray(content.scenes)&&content.scenes.length===10,"Exactly ten authored scenes are required");
const reviewKeys=["answersQuestion","actionable","questionsUseful","sourceFaithful","readable","humanPath"];
const ids=new Set();
for(const [index,scene] of content.scenes.entries()){
  assert(scene&&typeof scene==="object",`scene ${index+1}`);
  assert(typeof scene.id==="string"&&scene.id&&!ids.has(scene.id),`unique scene id ${index+1}`);ids.add(scene.id);
  assert(typeof scene.title==="string"&&scene.title,`scene title ${scene.id}`);
  assert(Array.isArray(scene.turns)&&scene.turns.length>=2,`scene turns ${scene.id}`);
  assert.equal(scene.turns[0].role,"user",`first turn is user: ${scene.id}`);
  assert.equal(scene.turns[1].role,"assistant",`first answer follows immediately: ${scene.id}`);
  for(const [turnIndex,turn] of scene.turns.entries()){
    assert(["user","assistant"].includes(turn.role),`turn role ${scene.id}/${turnIndex}`);
    assert(typeof turn.text==="string"&&turn.text.trim(),`turn text ${scene.id}/${turnIndex}`);
    assert(Array.isArray(turn.sourceRefs),`sourceRefs ${scene.id}/${turnIndex}`);
    assert(Array.isArray(turn.claimNotes),`claimNotes ${scene.id}/${turnIndex}`);
    for(const [noteIndex,note] of turn.claimNotes.entries()){
      assert(note&&typeof note==="object",`claimNote object ${scene.id}/${turnIndex}/${noteIndex}`);
      assert(["original_strategy","weiku_application","scope_limit","human_guidance"].includes(note.kind),`claimNote kind ${scene.id}/${turnIndex}/${noteIndex}`);
      assert(typeof note.text==="string"&&note.text,`claimNote text ${scene.id}/${turnIndex}/${noteIndex}`);
      assert(Array.isArray(note.sourceRefs),`claimNote sourceRefs ${scene.id}/${turnIndex}/${noteIndex}`);
    }
    if(turn.role==="assistant")assert((turn.text.match(/[？?]/g)||[]).length<=1,`at most one question: ${scene.id}/${turnIndex}`);
  }
  assert(Array.isArray(scene.sources),`sources ${scene.id}`);
  const sourceKeys=new Set(scene.sources.map(x=>x.key));
  assert.equal(sourceKeys.size,scene.sources.length,`unique source keys ${scene.id}`);
  for(const source of scene.sources){
    for(const key of ["key","unitId","sourceId","versionId","title","url","location","originalText","applicability","approvalNote"])
      assert(Object.hasOwn(source,key),`source.${key} ${scene.id}/${source.key}`);
    assert(Array.isArray(source.requiredContext),`requiredContext ${scene.id}/${source.key}`);
    if(source.sourceFields!==undefined){
      assert(source.sourceFields&&typeof source.sourceFields==="object"&&!Array.isArray(source.sourceFields),`sourceFields ${scene.id}/${source.key}`);
      for(const [fieldKey,field] of Object.entries(source.sourceFields)){
        assert(field&&typeof field==="object",`sourceField ${scene.id}/${source.key}/${fieldKey}`);
        for(const key of ["status","value","officialUrl","sourceSection","checkedAt","sourceUpdatedOn"])
          assert(Object.hasOwn(field,key),`sourceField.${key} ${scene.id}/${source.key}/${fieldKey}`);
        assert(typeof field.status==="string"&&typeof field.officialUrl==="string",`sourceField values ${scene.id}/${source.key}/${fieldKey}`);
      }
    }
  }
  for(const [turnIndex,turn] of scene.turns.entries())
    for(const ref of turn.sourceRefs)assert(sourceKeys.has(ref),`unknown source ref ${scene.id}/${turnIndex}/${ref}`);
  assert(scene.review&&typeof scene.review==="object",`review ${scene.id}`);
  assert.deepEqual(Object.keys(scene.review).sort(),[...reviewKeys].sort(),`six independent checks ${scene.id}`);
  for(const key of reviewKeys){
    assert(["pass","partial","fail","insufficient","not_applicable"].includes(scene.review[key]?.status),`review status ${scene.id}/${key}`);
    assert(typeof scene.review[key].note==="string"&&scene.review[key].note,`review note ${scene.id}/${key}`);
  }
  assert(Array.isArray(scene.gaps),`gaps ${scene.id}`);
}
if(process.argv.includes("--validate-only")){
  console.log("PASS: content schema is compatible; ten scenes; variable turn counts accepted; no outputs built.");
  process.exit(0);
}

const pageSource=read(originalPage);
const runtimeSource=read(originalRuntime);
assert.equal(sha(pageSource),expected.page,"Frozen preview page changed");
assert.equal(sha(runtimeSource),expected.runtime,"Frozen preview runtime changed");
const originalText=pageSource.toString("utf8");
const baseStyle=originalText.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert(baseStyle,"Frozen preview style anchor missing");
const font=read(fontPath).toString("base64");
const parentScenes=content.scenes.map(scene=>({
  id:scene.id,title:scene.title,
  turns:scene.turns.map(turn=>({role:turn.role,text:turn.text,sourceRefs:turn.sourceRefs})),
  sources:scene.sources.map(({key,title,url,location,applicability,requiredContext,sourceFields})=>({
    key,title,url,location,applicability,hasRequiredContext:requiredContext.length>0,
    originalStrategies:[...new Set(scene.turns.flatMap(turn=>turn.claimNotes)
      .filter(note=>note.kind==="original_strategy"&&note.sourceRefs.includes(key)).map(note=>note.text))],
    weikuApplications:[...new Set(scene.turns.flatMap(turn=>turn.claimNotes)
      .filter(note=>note.kind==="weiku_application"&&note.sourceRefs.includes(key)).map(note=>note.text))],
    publicFacts:Object.entries(sourceFields??{}).map(([fieldKey,field])=>({
      fieldKey,status:field.status,value:field.value,officialUrl:field.officialUrl,
      sourceSection:field.sourceSection,checkedAt:field.checkedAt,sourceUpdatedOn:field.sourceUpdatedOn,
      unknownReason:field.unknownReason??null,
    })),
  })),
}));

const extraStyle=`
#picker-wrap{margin:12px 0 16px}#picker-wrap label{font-size:12px;margin:0 0 4px}
#scene-picker{min-height:44px}.turn{margin-bottom:14px}.turn.user .bubble{background:#eee8f5;margin-left:25px}
.turn.assistant .bubble{border-left:3px solid #9c85b9}.source{border-top:1px solid #e4ddec;padding-top:10px;margin-top:10px}
.source blockquote{margin:8px 0;padding:10px;background:#fff;border-left:3px solid #b5a3ca;white-space:pre-wrap}
.context{background:#f5f0f8;padding:9px;margin:8px 0}.counter{font-size:12px;color:#665d73}
@media(max-width:420px){#panel h2{font-size:16px}.turn .bubble{padding:11px 12px}}
`;
const page=`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>We育｜日常の育児相談10例</title>
<style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}${baseStyle}${extraStyle}</style></head><body>
<main><header><h1>We育 <span style="font-weight:normal">相談の見本</span></h1><span class="label">${esc(content.label)}<br>保存・送信なし</span></header>
<div id="picker-wrap"><label for="scene-picker">会話見本を切り替える</label><select id="scene-picker" aria-label="会話見本"></select></div>
<section id="panel" aria-live="polite"></section>
<details id="evidence"><summary>根拠を見る</summary><div id="sources"></div></details>
</main><footer class="footer"><span>${esc(content.label)}<br>保存・送信なし</span><button id="end">見本を終了</button></footer>
<script>"use strict";
const scenes=${json(parentScenes)};let selected=0,visible=2,ended=false;
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined&&text!==null)el.textContent=text;if(cls)el.className=cls;return el};
function renderSources(scene){
 const root=$("sources");root.replaceChildren();
 for(const source of scene.sources){
  const item=node("section",null,"source"),h=node("h3",source.title),loc=node("p","掲載箇所："+source.location,"muted");
  const scope=node("p","使える範囲："+source.applicability);
  item.append(h,loc,scope,node("strong","原資料の具体策（We育による短い整理）"));
  const strategies=node("ul");for(const point of source.originalStrategies)strategies.append(node("li",point));item.append(strategies);
  if(source.weikuApplications.length){
   item.append(node("strong","この会話でのWe育の日常応用"));
   const applications=node("ul");for(const point of source.weikuApplications)applications.append(node("li",point));item.append(applications);
  }else item.append(node("p","この区分では日常例を追加せず、原資料の具体策の範囲で回答しています。","muted"));
  if(source.publicFacts.length){
   const facts=node("div",null,"context");facts.append(node("strong","公的制度事実（公式ページの項目をWe育が独自整理・原文引用ではない）"));
   const labels={support:"相談できる内容",application:"相談方法",contact:"問合せ先"};
   for(const fact of source.publicFacts){
    const factBlock=node("div");factBlock.append(node("p",(labels[fact.fieldKey]||fact.fieldKey)+"："+(fact.value||fact.unknownReason||"未確認")));
    factBlock.append(node("p","掲載箇所："+fact.sourceSection+"／確認日："+fact.checkedAt+(fact.sourceUpdatedOn?"／公式更新日："+fact.sourceUpdatedOn:""),"muted"));
    if(/^https:\\/\\//.test(fact.officialUrl)){const factLink=node("a","この制度事実の公式ページ");factLink.href=fact.officialUrl;factLink.rel="noreferrer";factLink.target="_blank";factBlock.append(factLink)}
    facts.append(factBlock);
   }
   item.append(facts);
  }
  if(source.hasRequiredContext)item.append(node("p","必須文脈も合わせて参照しています。原文は検証者向け表示に記録しています。","muted"));
  if(/^https:\\/\\//.test(source.url)){const link=node("a","原資料を開く");link.href=source.url;link.rel="noreferrer";link.target="_blank";item.append(link)}
  root.append(item);
 }
 if(!scene.sources.length)root.append(node("p","この会話で具体策を支える収録資料はありません。"));
}
function render(){
 const scene=scenes[selected],panel=$("panel");panel.replaceChildren(node("h2",(selected+1)+"．"+scene.title));
 for(const turn of scene.turns.slice(0,visible)){
  const article=node("article",null,"turn "+turn.role),who=node("p",turn.role==="user"?"保護者の相談見本":"We育の回答見本","who"),bubble=node("div",null,"bubble");
  bubble.append(node("p",turn.text));article.append(who,bubble);panel.append(article);
 }
 if(visible<scene.turns.length){const next=node("button","次の会話を見る","primary");next.id="next";next.onclick=()=>{visible=Math.min(visible+2,scene.turns.length);render()};panel.append(next)}
 else panel.append(node("p","この編集見本はここまでです。","muted"));
 panel.append(node("p",Math.ceil(visible/2)+" / "+Math.ceil(scene.turns.length/2)+" 往復","counter"));
 renderSources(scene);
}
for(const [index,scene] of scenes.entries()){const option=node("option",(index+1)+"．"+scene.title);option.value=String(index);$("scene-picker").append(option)}
$("scene-picker").onchange=()=>{selected=Number($("scene-picker").value);visible=2;$("evidence").open=false;render();scrollTo(0,0)};
function end(reason){if(ended)return;ended=true;document.querySelector("main").replaceChildren(node("h1","見本を終了しました"),node("p","保存・送信はしていません。"));document.querySelector("footer").remove();if(typeof window.endEditorialPreview==="function")window.endEditorialPreview(reason)}
$("end").onclick=()=>end("button");const expiry=setTimeout(()=>end("ttl"),3600000);render();
</script></body></html>`;

fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"index.html"),page);
fs.writeFileSync(path.join(out,"transcript.json"),JSON.stringify(content,null,2)+"\n");
const text=[content.label,...content.scenes.map((scene,index)=>[
  `${index+1}．${scene.title}`,
  ...scene.turns.map(turn=>`${turn.role==="user"?"保護者":"We育"}：${turn.text}`),
  `参照区分：${scene.sources.map(x=>`${x.title}（${x.location}）`).join("／")||"具体策を支える収録資料なし"}`,
  `残る不足：${scene.gaps.join("／")||"なし"}`,
].join("\n"))].join("\n\n");
fs.writeFileSync(path.join(out,"transcript.txt"),text+"\n");

const reviewerSections=content.scenes.map((scene,index)=>`<section><h2>${index+1}．${esc(scene.title)}</h2>
<h3>6項目の個別確認</h3><dl>${reviewKeys.map(key=>`<dt>${esc(key)}：${esc(scene.review[key].status)}</dt><dd>${esc(scene.review[key].note)}</dd>`).join("")}</dl>
<h3>参照区分・内部対応</h3>${scene.sources.map(source=>`<article><h4>${esc(source.title)}</h4><p>unitId: ${esc(source.unitId)}<br>sourceId: ${esc(source.sourceId)}<br>versionId: ${esc(source.versionId)}<br>掲載箇所: ${esc(source.location)}</p><p>承認状態: ${esc(source.approvalNote)}</p><h5>照合用原文（親向け画面には非表示）</h5><blockquote>${esc(source.originalText)}</blockquote>${source.requiredContext.map(context=>`<h5>必須文脈</h5><blockquote>${esc(context.text)}</blockquote><p>${esc(context.location)}／${esc(context.url)}</p>`).join("")}${source.sourceFields?`<h5>公的制度事実（公式ページからの項目別独自整理・原文引用ではない）</h5><dl>${Object.entries(source.sourceFields).map(([fieldKey,field])=>`<dt>${esc(fieldKey)}／${esc(field.status)}</dt><dd>${esc(field.value??field.unknownReason??"未確認")}<br>掲載箇所: ${esc(field.sourceSection)}／確認日: ${esc(field.checkedAt)}／公式更新日: ${esc(field.sourceUpdatedOn??"未確認")}<br><a href="${esc(field.officialUrl)}">公式ページ</a></dd>`).join("")}</dl>`:""}</article>`).join("")||"<p>なし</p>"}
<h3>原資料の具体策とWe育の応用</h3><ol>${scene.turns.filter(x=>x.role==="assistant").map(turn=>`<li>${turn.claimNotes.length?turn.claimNotes.map(note=>`<strong>${esc({original_strategy:"原資料の具体策",weiku_application:"We育の日常応用",scope_limit:"範囲・不足",human_guidance:"人への相談案内"}[note.kind])}</strong>：${esc(note.text)}<br><small>note sourceRefs: ${note.sourceRefs.map(esc).join(", ")||"なし"}</small>`).join("<br>"):"新たな具体策なし"}<br><small>turn sourceRefs: ${turn.sourceRefs.map(esc).join(", ")||"なし"}</small></li>`).join("")}</ol>
<h3>残る不足</h3>${scene.gaps.length?`<ul>${scene.gaps.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"<p>記録された不足なし</p>"}</section>`).join("");
const reviewer=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><title>検証者向けレビュー</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}body{font:15px/1.8 Local,sans-serif;max-width:900px;margin:auto;padding:24px;color:#302b3c}section{border-top:1px solid #ddd;padding:14px 0}dt{font-weight:bold}dd{margin-bottom:8px}small{overflow-wrap:anywhere}</style></head><body><h1>検証者向けレビュー</h1><p>${esc(content.label)}。原文照合・承認状態・内部ID・主張対応は親向け会話から分離しています。モデル品質や実利用者による使いやすさの評価ではありません。</p>${reviewerSections}</body></html>`;
fs.writeFileSync(path.join(out,"reviewer.html"),reviewer);

let adaptedRuntime=runtimeSource.toString("utf8");
adaptedRuntime=exact(adaptedRuntime,
  'export const out=path.resolve(here,"../../../evidence-work/parent-reading-evaluation/conversation-handoff-preview-01");',
  'export const out=path.resolve(here,".");',
  "runtime output");
fs.writeFileSync(path.join(out,"adapted-runtime.mjs"),adaptedRuntime);
const receipt={
  status:"checked_isolated_adapter",
  generatedAt:new Date().toISOString(),
  frozenInputs:{
    "prototypes/evidence-consultation/conversation-handoff-preview/page.html":expected.page,
    "prototypes/evidence-consultation/conversation-handoff-preview/runtime.mjs":expected.runtime,
  },
  adaptation:{
    page:"Reused the checked frozen preview CSS and interaction pattern; replaced authored scene payload and removed handoff controls.",
    runtime:"Exactly one checked output-path anchor changed; offline/file-only/temp-HOME/TTL/cleanup behavior otherwise byte-derived from frozen runtime.",
  },
  outputSha256:{index:sha(Buffer.from(page)),runtime:sha(Buffer.from(adaptedRuntime)),content:sha(read(contentPath))},
  normalRouteChanged:false,databaseUsed:false,modelApiUsed:false,publicationChanged:false,
};
fs.writeFileSync(path.join(out,"adapter-receipt.json"),JSON.stringify(receipt,null,2)+"\n");
console.log("Built ten-scene private offline preview and separate reviewer view.");