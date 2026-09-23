import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
export const here=path.dirname(fileURLToPath(import.meta.url));
export const root=path.resolve(here,"../../..");
export const out=path.join(root,"evidence-work/parent-reading-evaluation/conversation-editorial-preview-01");
const hash=x=>createHash("sha256").update(x).digest("hex");
const sourcePath="evidence-work/v0.2/E02.json";
const bytes=fs.readFileSync(path.join(root,sourcePath));
const corpus=JSON.parse(bytes);
// Explicit editorial selections only. No search, extraction, model, or applicability engine.
const ids=["E02-F-S01-S02-SHARED","E02-F-S03"];
const fragments=ids.map(id=>{
  const f=corpus.fragments.find(f=>f.id===id);
  assert(f && hash(f.original_text)===f.text_sha256);
  return {sourceId:f.source_id,originalId:f.id,quote:f.original_text,location:f.locator,quoteSha256:f.text_sha256};
});
const label="編集した会話見本・実際のAI回答ではない";
const scenes=[
  {title:"短く答える",subtitle:"4歳の睡眠時間",source:0,
    messages:[
      {role:"parent",text:"4歳です。睡眠時間の目安を短く知りたいです。"},
      {role:"answer",text:"4歳の睡眠時間の目安は10〜13時間です。厚生労働省のガイドが、3〜5歳児について米国睡眠医学会（AASM）の推奨として紹介しています。",note:"年齢帯の一般的な目安であり、この子の健康状態を判断した回答ではありません。"}
    ],mapping:"4歳は原文の3〜5歳児に含まれる。10〜13時間と推奨主体のみを要約。夜間だけの時間と表現せず、未引用の昼寝単位情報は加えない。"},
  {title:"ひとつだけ確かめる",subtitle:"生後2週・親子の睡眠",source:1,
    messages:[
      {role:"parent",text:"生後2週です。親子で細切れにしか眠れず、睡眠のことで相談したいです。"},
      {role:"answer",text:"生まれたばかりの赤ちゃんは、数時間おきに寝たり起きたりを繰り返します。授乳や夜泣きへの対応で、養育者の睡眠も細切れになるとガイドに記されています。",question:"まず相談したいのは、赤ちゃんの睡眠ですか、それともあなた自身の睡眠ですか？"},
      {role:"parent",text:"まずは私自身の睡眠についてです。"},
      {role:"answer",text:"あなた自身の睡眠を確保することも大切です。ガイドでは、養育者の睡眠の確保は心身の健康を守るために重要とされています。",note:"この原文だけから、あなたに必要な時間や具体的な対応方法までは決められません。"}
    ],mapping:"生後2週は編集上の新生児の架空設定。一般説明は新生児と養育者を別の対象として保持。確認は相談対象の区別に必要な1問のみ。年齢の聞き直し、健康条件の推定、追加質問なし。"},
  {title:"人に相談する道筋",subtitle:"2歳・個別の心配",source:0,
    messages:[
      {role:"parent",text:"2歳です。睡眠が短い気がして心配です。病気なのか、どう対応すればよいのか知りたいです。"},
      {role:"answer",text:"2歳の睡眠時間の一般的な目安は11〜14時間です。ただ、この目安だけで病気かどうかや、この子への対応は判断できません。",note:"厚生労働省のガイドが、1〜2歳児について米国睡眠医学会（AASM）の推奨として紹介している範囲です。"},
      {role:"guidance",text:"人に相談するときの伝え方",support:"育児相談員には「2歳の子の睡眠が心配です。家庭での睡眠や育児の困りごとを一緒に整理したいです」と伝える例があります。生活や育児の相談を整理する支援と、医療上の個別判断は別です。",medical:"医療者には「睡眠が短いと感じて心配です。病気の可能性や、この子に必要な対応について相談したいです」と伝える例があります。病気の判断や個別の医療対応は医療者に相談する領域です。",emergency:"この見本は緊急相談には対応していません。緊急時はこの会話とは別に、医療の緊急対応の経路を利用してください。"}
    ],mapping:"11〜14時間は原文の1〜2歳児に限定。診断の結論は出さない。相談先の役割・伝え方・緊急時の分離は編集上の運用案内であり、引用原文に記載された臨床推奨ではない。実在する連絡先、予約、送信、共有は設けない。"}
];
const trace={status:"編集上の出典照合。臨床レビュー・資料採用・公開承認ではない。",sourcePath,sourceFileSha256:hash(bytes),sourceTitle:corpus.sources[0].title,sourceUrl:corpus.sources[0].url,originalDocumentSha256:corpus.sources[0].source_sha256,documentHashMeaning:"保存済み台帳の原資料ハッシュ。今回PDFを再取得・再検証していない。",attribution:corpus.sources[0].license.attribution,fragments,scenes:scenes.map((s,i)=>({scene:i+1,originalId:fragments[s.source].originalId,mapping:s.mapping})),boundary:"既存DB・通常ルート・家族記録・承認・公開・モデルAPIには接続しない。固定文はこの独立見本だけに存在する。"};
fs.mkdirSync(out,{recursive:true});
const font=fs.readFileSync(path.join(root,"prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2"));
let html=fs.readFileSync(path.join(here,"page.html"),"utf8");
const safeJson=x=>JSON.stringify(x).replace(/</g,"\\u003c");
html=html.replace("FONT_BASE64",font.toString("base64")).replace("SCENES_JSON",safeJson(scenes)).replace("TRACE_JSON",safeJson(trace)).replaceAll("GLOBAL_LABEL",label);
fs.writeFileSync(path.join(out,"index.html"),html);
fs.writeFileSync(path.join(out,"source-grounding.json"),JSON.stringify(trace,null,2)+"\n");
const escape=x=>String(x).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
fs.writeFileSync(path.join(out,"source-grounding-report.html"),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"><title>出典照合・編集境界</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font.toString("base64")})}body{font-family:Local,sans-serif;max-width:850px;margin:40px auto;padding:20px;line-height:1.9;color:#302c3a}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f0f8;padding:20px}</style><h1>3つの会話見本 — 出典照合</h1><p>${label}</p><p>保存済み原文2断片を人手で選んで要約。自動抽出・モデル生成ではありません。エンジニアリング検証は臨床的妥当性や資料採用の承認を意味しません。</p><p>ブラウザ検証結果とスクリーンショットは verify.mjs の実行後に verification-report.html にまとめます。未実行の検証を合格と表示しません。</p><pre>${escape(JSON.stringify(trace,null,2))}</pre></html>`);
console.log("Built independent static editorial sample and source-grounding report.");