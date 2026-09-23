import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../../..");
const catalogPath=path.join(root,"evidence-work/regional-support-09/data/catalog.json");
const out=path.join(root,"evidence-work/regional-support-09/preview");
const frozenDir=path.join(root,"prototypes/evidence-consultation/conversation-handoff-preview");
const frozenRuntime=path.join(frozenDir,"runtime.mjs");
const frozenPage=path.join(frozenDir,"page.html");
const fontPath=path.join(root,"prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2");
const expected={
  page:"32c37bb01cc32296bfbcf1c815c9afb02401973bb0fde9e17f52426307029215",
  runtime:"ca19697c0f7360afd11eee57d36d024e7e6f85df19abef257677d99c0c5bb310",
};
const sha=x=>createHash("sha256").update(x).digest("hex");
const esc=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const json=x=>JSON.stringify(x).replace(/</g,"\\u003c");
const exact=(text,anchor,replacement,label)=>{
  assert.equal(text.split(anchor).length-1,1,`${label}: expected one frozen anchor`);
  return text.replace(anchor,replacement);
};
const purposes={
  care:"子どもを預けたい",
  help:"家事・育児を手伝ってほしい",
  consult:"誰かに相談したい",
  place:"親子で行ける場所を探したい",
};
const purposeIds=Object.keys(purposes);

if(!fs.existsSync(catalogPath))throw Error(`Final catalog is not ready: ${catalogPath}`);
const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
assert(typeof catalog.checkedAt==="string"&&catalog.checkedAt,"catalog.checkedAt");
assert(Array.isArray(catalog.municipalities)&&catalog.municipalities.length===6,"exactly six municipalities");
assert(Array.isArray(catalog.services),"services");
assert(Array.isArray(catalog.gaps),"gaps");
const municipalityIds=new Set();
for(const municipality of catalog.municipalities){
  for(const key of ["id","label","prefecture","municipality","officialEntryUrl","entryCheckedAt"])
    assert(typeof municipality[key]==="string"&&municipality[key],`municipality.${key}`);
  assert(!municipalityIds.has(municipality.id),`unique municipality ${municipality.id}`);
  assert(/^https:\/\//.test(municipality.officialEntryUrl),`municipality official URL ${municipality.id}`);
  municipalityIds.add(municipality.id);
}
const serviceIds=new Set();
for(const service of catalog.services){
  for(const key of ["id","municipalityId","name","summary","eligibility","fees","reductions","application","contact","officialUrl","checkedAt"])
    assert(Object.hasOwn(service,key),`service.${key} ${service.id??"unknown"}`);
  assert(typeof service.id==="string"&&service.id&&!serviceIds.has(service.id),`unique service id ${service.id}`);
  serviceIds.add(service.id);
  assert(municipalityIds.has(service.municipalityId),`known municipality ${service.id}`);
  assert(Array.isArray(service.purposes)&&service.purposes.length>0,`purposes ${service.id}`);
  assert.equal(new Set(service.purposes).size,service.purposes.length,`unique purposes ${service.id}`);
  for(const purpose of service.purposes)assert(purposeIds.includes(purpose),`purpose ${service.id}/${purpose}`);
  assert(/^https:\/\//.test(service.officialUrl),`official URL ${service.id}`);
  assert(Array.isArray(service.phones),`phones ${service.id}`);
  for(const phone of service.phones){
    assert(typeof phone.label==="string"&&phone.label,`phone label ${service.id}`);
    assert(typeof phone.number==="string"&&/^[0-9()+ -]+$/.test(phone.number),`phone number ${service.id}`);
  }
  assert(service.sourceRef&&typeof service.sourceRef.path==="string"&&typeof service.sourceRef.id==="string",`sourceRef ${service.id}`);
  assert(service.fields&&typeof service.fields==="object"&&!Array.isArray(service.fields),`fields ${service.id}`);
  assert(Array.isArray(service.warnings),`warnings ${service.id}`);
}
if(process.argv.includes("--validate-only")){
  console.log(`PASS: catalog compatible (${catalog.services.length} services / 6 municipalities)`);
  process.exit(0);
}

const frozenPageBytes=fs.readFileSync(frozenPage);
const frozenRuntimeBytes=fs.readFileSync(frozenRuntime);
assert.equal(sha(frozenPageBytes),expected.page,"Frozen preview page changed");
assert.equal(sha(frozenRuntimeBytes),expected.runtime,"Frozen preview runtime changed");
const baseStyle=frozenPageBytes.toString("utf8").match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert(baseStyle,"Frozen preview style anchor missing");
const font=fs.readFileSync(fontPath).toString("base64");
const publicCatalog={
  checkedAt:catalog.checkedAt,
  municipalities:catalog.municipalities.map(({id,label,prefecture,municipality,officialEntryUrl,entryCheckedAt})=>({id,label,prefecture,municipality,officialEntryUrl,entryCheckedAt})),
  services:catalog.services.map(({id,municipalityId,purposes,name,summary,eligibility,fees,reductions,application,contact,officialUrl,checkedAt,sourceUpdatedOn,phones,warnings})=>({
    id,municipalityId,purposes,name,summary,eligibility,fees,reductions,application,contact,officialUrl,checkedAt,sourceUpdatedOn:sourceUpdatedOn??null,phones,warnings,
  })),
};
const style=`
:root{--ink:#2f2940;--muted:#685f75;--line:#ded7e8;--soft:#f6f2f9;--brand:#6f4b91;--brand2:#ede4f4;--ok:#e8f4ed}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:#faf9fb;font:15px/1.65 Local,sans-serif}
button,select,a{font:inherit}button,select{min-height:44px;border-radius:10px;border:1px solid #b8acc8;background:#fff;color:var(--ink);padding:10px 13px}
button{cursor:pointer}.primary{display:inline-block;background:var(--brand);color:#fff;border-color:var(--brand);padding:10px 13px;border-radius:10px;text-decoration:none}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #d3bdea;outline-offset:2px}
a{color:#5e397e;overflow-wrap:anywhere}.shell{max-width:880px;margin:auto;min-height:100vh;background:#fff;padding:18px 20px 70px}
header{display:flex;justify-content:space-between;gap:12px;align-items:start;border-bottom:1px solid var(--line);padding-bottom:12px}.brand{font-size:20px;font-weight:700}.badge{font-size:12px;background:var(--brand2);padding:4px 8px;border-radius:99px}
h1{font-size:26px;line-height:1.35;margin:22px 0 8px}h2{font-size:21px}h3{font-size:17px}.lead{font-size:16px;color:var(--muted);max-width:610px}
.home-card,.panel,.card{border:1px solid var(--line);border-radius:14px;padding:16px;background:#fff}.home-card{margin:22px 0;background:var(--soft)}
.stepper{display:flex;gap:8px;margin:18px 0;flex-wrap:wrap}.step{font-size:12px;padding:5px 9px;border-radius:20px;background:#eeeaf2}.step.on{background:var(--brand);color:#fff}
.field{display:grid;gap:5px;margin:14px 0}.field label{font-weight:700}.purposes{display:grid;grid-template-columns:1fr 1fr;gap:10px}.purpose{text-align:left;min-height:60px}.purpose[aria-pressed=true]{background:var(--brand);color:#fff}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.cards{display:grid;gap:12px;margin:15px 0}.card h3{margin:0 0 5px}.meta,.muted{color:var(--muted);font-size:13px}.facts{display:grid;grid-template-columns:150px 1fr;border-top:1px solid var(--line)}.facts dt,.facts dd{margin:0;padding:11px 4px;border-bottom:1px solid var(--line)}.facts dt{font-weight:700}
.notice{background:#fff7dc;border-left:4px solid #d6a930;padding:10px 12px;margin:12px 0}.save-note{background:var(--ok);padding:9px 11px;border-radius:9px;font-size:13px}.empty{padding:20px;background:var(--soft);border-radius:12px}
.back{border:0;background:transparent;text-decoration:underline;padding-left:0}.hidden{display:none!important}.saved-list{margin-top:22px;border-top:1px solid var(--line);padding-top:12px}
.footer{max-width:880px;margin:auto;background:#fff;border-top:1px solid var(--line);padding:12px 16px;font-size:12px;text-align:center}
@media(max-width:560px){.shell{padding:14px 14px 75px}.purposes{grid-template-columns:1fr}h1{font-size:23px}.facts{grid-template-columns:1fr}.facts dt{padding-bottom:0;border-bottom:0}.facts dd{padding-top:2px}.actions>*{flex:1 1 140px;text-align:center}}
`;
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>We育｜地域の子育て支援</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}${style}</style></head><body>
<main class="shell"><header><div class="brand">We育</div><span class="badge">非公開の操作プレビュー</span></header><div id="app"></div></main><div class="footer">予約・申込は行いません。自治体窓口はWe育の相談員とは別です。 <button id="end-preview">プレビューを終了</button></div>
<script>"use strict";
const catalog=${json(publicCatalog)},purposeLabels=${json(purposes)};
const app=document.getElementById("app"),saved=new Set();let view="home",municipalityId="",purpose="",selectedId="";
const displayText=value=>String(value).replaceAll("～","から");
const n=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined&&text!==null)x.textContent=displayText(text);if(cls)x.className=cls;return x};
const municipality=()=>catalog.municipalities.find(x=>x.id===municipalityId);
const areaLabel=x=>x.prefecture+" "+x.label;
const matching=()=>catalog.services.filter(x=>x.municipalityId===municipalityId&&x.purposes.includes(purpose));
const field=(label,value)=>{const dt=n("dt",label),dd=n("dd",value||"未確認");return[dt,dd]};
function shell(title,step=0){app.replaceChildren();if(view!=="home"){const back=n("button","← 戻る","back");back.id="back";back.onclick=()=>{if(view==="detail"){view="list";selectedId=""}else if(view==="list"){view="select"}else view="home";render()};app.append(back)}
 app.append(n("h1",title));if(step){const steps=n("div",null,"stepper");["市区町村","目的","一覧・詳細"].forEach((x,i)=>steps.append(n("span",(i+1)+"．"+x,"step "+(i<step?"on":""))));app.append(steps)}}
function renderHome(){shell("地域の子育て支援");app.append(n("p","AIと会話しなくても、制度・施設・相談窓口を探せます。","lead"));const box=n("section",null,"home-card");box.append(n("h2","地域の支援を探す"),n("p","市区町村と目的を選び、利用方法や公式案内を確認します。"));const start=n("button","地域の支援を探す","primary");start.id="start";start.onclick=()=>{view="select";render()};box.append(start);app.append(box);renderSaved()}
function renderSelect(){shell("地域と目的を選ぶ",1);const area=n("div",null,"field"),lab=n("label","1．市区町村");lab.htmlFor="municipality";const sel=n("select");sel.id="municipality";sel.append(new Option("選んでください",""));for(const x of catalog.municipalities)sel.append(new Option(areaLabel(x),x.id));sel.value=municipalityId;sel.onchange=()=>{municipalityId=sel.value;purpose="";selectedId="";render()};area.append(lab,sel);app.append(area);
 if(municipalityId){app.append(n("h2","2．目的を選ぶ"));const grid=n("div",null,"purposes");for(const [id,label] of Object.entries(purposeLabels)){const b=n("button",label,"purpose");b.dataset.purpose=id;b.setAttribute("aria-pressed",String(purpose===id));b.onclick=()=>{purpose=id;selectedId="";view="list";render()};grid.append(b)}app.append(grid)}
 const demo=n("details");demo.innerHTML="<summary>AI相談から開く遷移の見本</summary><p class='muted'>将来は市区町村と目的だけを引き継ぎます。相談全文は渡しません。今回はモデルに接続していません。</p>";app.append(demo);renderSaved()}
function renderList(){const m=municipality();shell(areaLabel(m)+"の支援",3);const change=n("button","地域・目的を変更","back");change.onclick=()=>{view="select";render()};app.append(change,n("p","目的："+purposeLabels[purpose],"lead"));const rows=matching(),cards=n("div",null,"cards");
 if(!rows.length){const empty=n("section",null,"empty");empty.append(n("h2","このアプリでは、まだ詳しい情報を掲載していません"),n("p",areaLabel(m)+"に支援がないという意味ではありません。"));const link=n("a","自治体の公式入口を見る");link.href=m.officialEntryUrl;link.target="_blank";link.rel="noreferrer";link.dataset.external="municipality";empty.append(link,n("p","入口の確認日："+m.entryCheckedAt,"muted"));cards.append(empty)}
 for(const s of rows){const card=n("article",null,"card");card.dataset.serviceId=s.id;card.append(n("h3",s.name),n("p",s.summary));const ul=n("ul");ul.append(n("li","主な対象："+(s.eligibility||"未確認")),n("li","料金："+(s.fees||"未確認")));card.append(ul);const detail=n("button","詳細を見る","primary");detail.onclick=()=>{selectedId=s.id;view="detail";render()};card.append(detail);cards.append(card)}app.append(cards);renderSaved()}
function renderDetail(){const s=catalog.services.find(x=>x.id===selectedId),m=municipality();shell(s.name,3);app.append(n("p",s.summary,"lead"));const dl=n("dl",null,"facts");for(const [k,v] of [["市区町村",areaLabel(m)],["目的",s.purposes.map(x=>purposeLabels[x]).join("／")],["主な対象",s.eligibility],["料金",s.fees],["減免",s.reductions],["利用方法",s.application],["連絡先",s.contact],["情報確認日",s.checkedAt],["公式更新日",s.sourceUpdatedOn||"未確認"]])dl.append(...field(k,v));app.append(dl);
 for(const warning of s.warnings)app.append(n("p",warning,"notice"));const actions=n("div",null,"actions");const official=n("a","公式案内を見る","primary");official.href=s.officialUrl;official.target="_blank";official.rel="noreferrer";official.dataset.external="service";actions.append(official);
 for(const phone of s.phones){const a=n("a","電話する："+phone.label);a.href="tel:"+phone.number.replace(/[^0-9+]/g,"");a.dataset.phone="true";actions.append(a)}
 const save=n("button",saved.has(s.id)?"保存を解除":"保存する");save.id="save";save.onclick=()=>{saved.has(s.id)?saved.delete(s.id):saved.add(s.id);render()};actions.append(save);app.append(actions,n("p","保存はこの画面を開いている間だけです。再読込・タブを閉じると消えます。","save-note"));renderSaved()}
function renderSaved(){const box=n("section",null,"saved-list");box.append(n("h2","保存した支援"));if(!saved.size)box.append(n("p","保存した支援はありません。","muted"));for(const id of saved){const s=catalog.services.find(x=>x.id===id),m=catalog.municipalities.find(x=>x.id===s.municipalityId);const p=n("p",areaLabel(m)+"｜"+s.name);p.dataset.savedId=id;box.append(p)}app.append(box)}
function render(){if(view==="home")renderHome();else if(view==="select")renderSelect();else if(view==="list")renderList();else renderDetail()}
window.openFromConsultation=input=>{if(!input||!catalog.municipalities.some(x=>x.id===input.municipalityId)||!Object.hasOwn(purposeLabels,input.purpose))return false;municipalityId=input.municipalityId;purpose=input.purpose;selectedId="";view="list";render();return true};
document.getElementById("end-preview").onclick=()=>{if(typeof window.endRegionalPreview==="function")window.endRegionalPreview("button");else document.body.replaceChildren(n("main","プレビューを終了しました。","shell"))};
render();
</script></body></html>`;

fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"index.html"),html);
let adapted=frozenRuntimeBytes.toString("utf8");
adapted=exact(adapted,'export const out=path.resolve(here,"../../../evidence-work/parent-reading-evaluation/conversation-handoff-preview-01");','export const out=path.resolve(here,".");',"runtime output");
fs.writeFileSync(path.join(out,"adapted-runtime.mjs"),adapted);
const reviewer=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>検証者向け｜地域支援</title><style>body{font:15px/1.7 sans-serif;max-width:950px;margin:auto;padding:24px}article{border-top:1px solid #ccc;padding:12px 0}code{overflow-wrap:anywhere}dt{font-weight:bold}</style></head><body><h1>検証者向け詳細</h1><p>利用者画面から分離した出典・採用状態の記録です。非公開試作であり、通常経路・DB・公開状態を変更していません。</p><p>カタログ状態: ${esc(catalog.status??"未設定")}／形式: ${esc(catalog.format??"未設定")}</p><p>デジタル庁の子育て支援制度レジストリ連携は今後の検討事項。今回は接続していません。</p>${catalog.services.map(s=>`<article><h2>${esc(s.name)}</h2><p>id: <code>${esc(s.id)}</code><br>source path: <code>${esc(s.sourceRef.path)}</code><br>source id: <code>${esc(s.sourceRef.id)}</code><br>sourceId: <code>${esc(s.sourceRef.sourceId??"未設定")}</code><br>versionId: <code>${esc(s.sourceRef.versionId??"未設定")}</code><br>originalSha256: <code>${esc(s.sourceRef.originalSha256??"未設定")}</code></p><p>確認日: ${esc(s.checkedAt)}／公式更新日: ${esc(s.sourceUpdatedOn??"未確認")}／URL: ${esc(s.officialUrl)}</p><h3>検証用項目</h3><dl>${Object.entries(s.fields).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==="object"?JSON.stringify(v):v)}</dd>`).join("")}</dl><h3>注意</h3><ul>${s.warnings.map(x=>`<li>${esc(x)}</li>`).join("")||"<li>記録なし</li>"}</ul></article>`).join("")}<h2>未確認・不足</h2><ul>${catalog.gaps.map(x=>`<li>${esc(typeof x==="string"?x:JSON.stringify(x))}</li>`).join("")}</ul></body></html>`;
fs.writeFileSync(path.join(out,"reviewer.html"),reviewer);
fs.writeFileSync(path.join(out,"displayed-services.json"),JSON.stringify({checkedAt:catalog.checkedAt,municipalities:catalog.municipalities,services:catalog.services.map(s=>({id:s.id,municipalityId:s.municipalityId,purposes:s.purposes,name:s.name,summary:s.summary,eligibility:s.eligibility,fees:s.fees,officialUrl:s.officialUrl,checkedAt:s.checkedAt})),gaps:catalog.gaps},null,2)+"\n");
const report=`# 地域の子育て支援：非公開操作プレビュー

確認日：${catalog.checkedAt}

## 表示対象

${catalog.municipalities.map(m=>`- ${m.prefecture} ${m.label}（公式入口確認日 ${m.entryCheckedAt}）`).join("\n")}

## 今回表示した支援（${catalog.services.length}件）

${catalog.municipalities.map(m=>`### ${m.prefecture} ${m.label}

${catalog.services.filter(s=>s.municipalityId===m.id).map(s=>`- ${s.name}｜${s.purposes.map(p=>purposes[p]).join("／")}｜料金：${s.fees||"未確認"}｜確認日：${s.checkedAt}`).join("\n")}`).join("\n\n")}

## 確認できなかった情報・限界

${catalog.gaps.map(x=>`- ${typeof x==="string"?x:JSON.stringify(x)}`).join("\n")}

- 空き、個別の利用資格、予約・申込成立は保証していません。
- 0件表示は、その地域に支援がないという意味ではありません。確認済みの自治体公式入口を表示します。
- 電話番号を確認できた支援だけに電話操作を表示します。検証中に電話・予約・申込は実行していません。
- 保存はブラウザーのメモリー内だけで、再読込またはタブを閉じると消えます。既存DBには保存していません。
- 自治体窓口とWe育の契約相談員は別です。
- AI遷移見本が引き継ぐのは市区町村IDと目的だけで、相談全文は渡しません。モデル接続はありません。
- デジタル庁の子育て支援制度レジストリ連携は今後の検討事項で、今回は接続していません。

## 実施範囲

通常アプリ、既存DB、通常相談経路、正式採用・公開状態、本番公開は変更していません。外部AI送信もありません。
`;
fs.writeFileSync(path.join(out,"report.md"),report);
fs.writeFileSync(path.join(out,"adapter-receipt.json"),JSON.stringify({
  status:"checked_isolated_adapter",generatedAt:new Date().toISOString(),
  frozenInputs:{[path.relative(root,frozenPage)]:expected.page,[path.relative(root,frozenRuntime)]:expected.runtime},
  adaptation:{page:"Reused frozen private-preview visual conventions; new regional-support interaction is isolated.",runtime:"Exactly one checked output-path anchor changed; file-only/offline/temp-HOME/TTL/cleanup preserved."},
  hashes:{catalog:sha(fs.readFileSync(catalogPath)),index:sha(Buffer.from(html)),runtime:sha(Buffer.from(adapted))},
  sharedData:"One service record is filtered by multiple purpose IDs and is also the future AI handoff target; no duplicate per-purpose or chat entity.",
  registryIntegration:{status:"future_consideration_not_connected",provider:"デジタル庁 子育て支援制度レジストリ"},
  normalRouteChanged:false,databaseUsed:false,modelApiUsed:false,publicationChanged:false,
},null,2)+"\n");
console.log(`Built offline regional-support preview: ${catalog.services.length} services`);