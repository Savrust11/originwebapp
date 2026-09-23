import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {scenes,disclosure,providerDisclosure,handoffGuide,earlyHandoffGuide} from "./scenes.mjs";
export const here=path.dirname(fileURLToPath(import.meta.url));
export const root=path.resolve(here,"../../..");
export const out=path.join(root,"evidence-work/parent-reading-evaluation/conversation-handoff-preview-01");
const hash=b=>createHash("sha256").update(b).digest("hex");
const old=path.join(root,"prototypes/evidence-consultation/conversation-editorial-preview-02");
const protectedFiles=[
 "evidence-work/v0.2/E02.json",
 "evidence-work/parent-reading-evaluation/p01-aggregation-addendum-01/minutes-source.json",
 "evidence-work/parent-reading-evaluation/conversation-editorial-preview-02/source-check/aasm-preschool-original-check.json",
 "evidence-work/parent-reading-evaluation/conversation-editorial-preview-02/index.html",
 "docs/evidence-consultation-prototype.md","docs/privacy-consultations.md","docs/supporter-se-handoff.md",
 ...fs.readdirSync(old).filter(f=>fs.statSync(path.join(old,f)).isFile()).map(f=>"prototypes/evidence-consultation/conversation-editorial-preview-02/"+f)
];
fs.mkdirSync(out,{recursive:true});
const manifest=Object.fromEntries(protectedFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const manifestPath=path.join(out,"preserved-source-hashes.json");
if(fs.existsSync(manifestPath))assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath,"utf8")),manifest,"Readonly historical/source files changed");
else fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
const font=fs.readFileSync(path.join(root,"prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
const escape=x=>String(x).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const json=x=>JSON.stringify(x).replace(/</g,"\\u003c");
// Reviewer-only evidence gaps must never be embedded in the parent preview.
const userScenes=scenes.map(({missingEvidence,needsChecking,...s})=>s);
const page=fs.readFileSync(path.join(here,"page.html"),"utf8").replace("FONT_BASE64",font).replace("SCENES_JSON",json(userScenes)).replace("GUIDE_JSON",json(handoffGuide)).replace("EARLY_GUIDE_JSON",json(earlyHandoffGuide));
fs.writeFileSync(path.join(out,"index.html"),page);
const shell=(title,body)=>`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"><title>${title}</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}body{font:15px/1.9 Local,sans-serif;color:#302b3c;max-width:900px;padding:24px;margin:auto;background:#faf8fc}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#614380}section{border-top:1px solid #ddd;padding-top:16px}</style></head><body><h1>${title}</h1><p>${disclosure}／${providerDisclosure}</p>${body}</body></html>`;
const links=`<p><a href="index.html">親向け見本</a> · <a href="spec.html">相談仕様</a> · <a href="spec.md">仕様原文</a> · <a href="transcript.txt">全文TXT</a> · <a href="transcript.json">全文JSON</a> · <a href="reviewer.html">レビュー</a></p><p>履歴・変更なし：<a href="../conversation-editorial-preview-02/index.html">旧コンパクト見本</a> · <a href="../../../docs/evidence-consultation-prototype.md">技術仕様</a> · <a href="../../../docs/privacy-consultations.md">プライバシー</a> · <a href="../../../docs/supporter-se-handoff.md">サポーター引渡し</a></p>`;
const spec=fs.readFileSync(path.join(here,"spec.md"),"utf8");
fs.writeFileSync(path.join(out,"spec.md"),spec);
fs.writeFileSync(path.join(out,"spec.html"),shell("We育 相談仕様",links+"<pre>"+escape(spec)+"</pre>"));
const operating="目的は状況を具体的に理解して一緒に考えること。人への引き継ぎは本人が希望した時だけ。この見本での候補は架空・未契約。実運用では資格・0〜6歳家庭への支援経験・実際の範囲を確認する。相談全文や複数人への自動共有はせず、外部紹介は提携や情報共有を意味しない。内部の育児支援と外部の医療判断を区別する。";
const confirmation={
 button:"宛先と4項目を確認する（送信なし）",
 unconfirmed:"未確認です。変更後は宛先と4項目を再確認してください。",
 confirmed:"宛先と4項目を見本として確認しました。送信・共有・予約は行っていません。",
 fields:"困りごと／確認した状況／試したこと／本人の希望",
 scope:"宛先候補と4項目だけ。相談全文は対象外。編集・宛先・提供状態の変更で確認を解除。",
 states:["未契約の候補：受付・予約・送信なし","担当不在の場合：日時・予約未確定、架空状態","受付状況未確認の場合：相談可能とは案内しない、架空状態"]
};
const transcript={disclosure,providerDisclosure,handoffGuide,earlyHandoffGuide,operating,scenes:userScenes.map(s=>({...s,endpoint:s.handoffAt===null?"会話の続きを考える場面。自動引き継ぎなし。人への希望ボタンでのみ要約を開く。":"本人の人への相談希望で引き継ぎを表示。追加質問なし。",correctedSummary:{...(s.handoffAt===null?s.earlySummaries.at(-1).summary:s.summary),[s.correction.field]:s.correction.text}})),confirmation};
fs.writeFileSync(path.join(out,"transcript.json"),JSON.stringify(transcript,null,2)+"\n");
const summaryText=x=>Object.entries(x).map(([k,v])=>k+"："+v).join("\n");
const text=disclosure+"／"+providerDisclosure+"\n\n"+scenes.map((s,i)=>`${i+1}．${s.title}（${s.turns.length}往復）\n\n`+s.turns.map(([p,a],j)=>`${j+1}往復\n保護者：${p}\n回答見本：${a}`).join("\n\n")+"\n\n"+(s.handoffAt===null?"この場面は自動引き継ぎなし。続きは未作成。以下は人への相談希望ボタンを押した場合だけの要約初期値。\n":"本人が人への相談を希望したため、以下の要約をその場で表示。\n")+"宛先候補："+s.recipient+"\n"+summaryText(s.handoffAt===null?s.earlySummaries.at(-1).summary:s.summary)+"\n\n本人の修正発言見本："+s.correction.parent+"\n反映後の応答："+s.correction.answer+"\n変更後の"+s.correction.field+"："+s.correction.text+"\n他の3項目と宛先は変更なし。変更後は再確認。\n").join("\n")+"\n引き継ぎの操作説明\n"+handoffGuide+"\n"+earlyHandoffGuide+"\n"+operating+"\n"+summaryText(confirmation)+"\n\n全段階の本人希望ボタンによる要約（人手で編集した固定文）\n"+scenes.map(s=>s.title+"\n"+s.earlySummaries.map(x=>`${x.visiblePairs}往復表示時\n宛先候補：${x.recipient}\n`+summaryText(x.summary)).join("\n\n")).join("\n\n")+"\n";
fs.writeFileSync(path.join(out,"transcript.txt"),text);
const claims=scenes.map((s,i)=>({scene:i+1,title:s.title,pairs:s.turns.length,handoffAt:s.handoffAt,turns:s.turns.map((_,j)=>({pair:j+1,classification:"架空本人発言の傾聴・具体的場面の確認・整理。本人希望時のみ担当範囲の運用案内。",clinicalClaim:false,source:"表示済み本人発言とユーザー指定の編集方針。育児介入の効果主張なし。"})),summarySource:"各段階の明示された本人発言と、見本の人への希望ボタンのみ。推測や未来の事実なし。",missingEvidence:s.missingEvidence,needsChecking:s.needsChecking}));
fs.writeFileSync(path.join(out,"source-claim-map.json"),JSON.stringify({status:"編集対応表。臨床レビュー・採用・公開承認ではない。",claims,sourcePolicy:"E02等は履歴保全照合のみ。既存原資料を変更せず、新規取得なし。根拠不足を科学的に不明とは言い換えない。",manifest:"preserved-source-hashes.json"},null,2)+"\n");
fs.writeFileSync(path.join(out,"reviewer.html"),shell("編集レビュー・出典対応",links+`<section><h2>会話の目的と構成</h2><p>${escape(operating)}</p><p>睡眠6往復：一時預かりを調べた後の障壁を確認し、条件と連絡手段を分けて整理する。本人が利用までの支援を希望した最後だけ候補を示す。食事4往復：作り直しまでのやりとりを聞き、本人の人への希望と不安に共感し、その場で追加質問なしに要約を開く。支度5往復：止まる場所と直近の発言を聞き、具体的な場面と本人の焦りを整理して会話を続ける方向。職種提案・自動引き継ぎはない。</p><p>質問順を揃えず、試したことを機械的に尋ねず、気持ちと実務の二択で誘導しない。傾聴や状況の整理を科学的効果の主張と区別する。資格・自動共有の説明は会話本文で反復しない。</p></section><section><h2>各場面の不足資料と確認事項（親向け画面には非搭載）</h2><pre>${escape(JSON.stringify(claims,null,2))}</pre><p>不足資料を埋めるための取得や新規の具体策は今回行っていません。臨床推奨・効果の保証はありません。</p></section><section><h2>本人の希望による引き継ぎ</h2><p>${escape(earlyHandoffGuide)} ${escape(handoffGuide)}</p><p>全段階のスナップショットは手動編集。支度の最終発言後にもボタンから開ける。職種未提案なら宛先未定。未知の試したこと等は未確認。未来の修正例は読了まで見せない。修正・宛先・状態の変更で再確認。全履歴は対象外、送信なし。</p><p>表示の不在・受付未確認も架空状態比較で、相談可能性を示さない。人を希望した後の追加AI会話を条件にしない。見本末尾は「編集見本の続きは未作成・ここまで」で、実際の相談終了やAI自由入力を意味しない。</p></section><section><h2>検証・隔離境界</h2><p>既存の所有者認可・記録非探索の仕様を保持。file-only、独立HOME、オフライン、60分、固定終了ボタン、保存なし。旧コンパクト見本と原資料は変更しない。検証は臨床的妥当性や公開の承認ではない。</p><p><a href="preserved-source-hashes.json">保全SHA-256</a> · <a href="source-claim-map.json">対応表JSON</a> · <a href="verification.json">検証結果</a></p><p>検証は最新ビルドに対して実行が必要。主な画面記録は scene-N-WIDTH-endpoint.png と handoff-defaults.png（編集前）で、状態変更用テスト画像とは区別する。</p></section>`));
console.log("Built isolated conversational preview/spec/transcripts/reviewer. Runtime and launcher unchanged; browser not started.");