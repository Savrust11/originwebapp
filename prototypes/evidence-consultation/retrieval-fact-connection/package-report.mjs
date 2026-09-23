// Package saved verification only; never starts a service or accesses a DB.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const dir = "evidence-work/parent-reading-evaluation/retrieval-fact-connection-01";
const read = name => JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"));
const v = read("verification.json"), cleanup = read("runtime-cleanup.json");
assert.equal(v.result,"PASSED");
assert.equal(cleanup.ownedRunnerExitCode,0);
assert.equal(cleanup.afterExitCheck.remainingEphemeralPostgresDirectories.length,0);
assert.equal(cleanup.afterExitCheck.remainingRetrievalFactUiDirectories.length,0);
const baseline=read("preservation-baseline.json");
const sha=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
for(const e of baseline.entries)assert.equal(sha(e.path),e.sha256,`protected file changed: ${e.path}`);
const h=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const font=fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const fontLicense=fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt","utf8");
const image=(name,label)=>{
  const img=v.images.find(i=>i.name===name);
  assert(img,`missing screen: ${name}`);
  assert.equal(sha(img.path),img.sha256);
  return `<figure><figcaption>${h(label)}</figcaption><img alt="${h(label)}" src="data:image/png;base64,${fs.readFileSync(img.path).toString("base64")}"></figure>`;
};
const caseNotes={
  "sleep-wording-one":["睡眠時間の目安を知りたい","20か月","事実データを表示"],
  "sleep-wording-two":["睡眠の長さについて資料を見たい","20か月","同じ事実データを表示"],
  "known-sleep-lexical-miss":["ねんねはどれくらい","20か月","検索語彙の取りこぼし。睡眠資料は存在する"],
  "age-unentered":["睡眠時間の目安","年齢未入力","年齢は未確認のまま。一般的な資料情報のみ、時間比較は保留"],
  "age-outside-sleep-fact":["睡眠時間","40か月","3〜5歳の資料単位を検索。1〜2歳の事実データを流用せず、事実データなしを表示"],
  "multiple-children":["睡眠時間","20か月・48か月","子どもごとに分離"],
  "children-and-caregiver":["睡眠時間","子ども2人＋保護者","3グループに分離。保護者に子どもの年齢を流用しない"],
  "caregiver-source-without-fact":["保護者の睡眠","保護者","原文は検索できるが事実データなし"],
  "out-of-retained-corpus-feeding":["離乳食を始める時期","20か月","検索は語彙不一致。別途確認した今回の保存資料範囲にも対応資料なし"],
  "interaction-information":["親子のやりとりと育児支援","48か月","研究情報を表示。研究集団の平均年齢を個人の年齢条件に変換しない"],
};
const table=Object.entries(caseNotes).map(([id,[q,age,note]])=>{
  const c=v.cases.find(x=>x.name===id);assert(c,`missing case ${id}`);
  return `<tr><td>${h(q)}</td><td>${h(age)}</td><td>${h(note)}<br><small>実結果：${h(c.result.groups.map(g=>`${g.state} [${g.items.map(i=>i.unitId).join(", ")}]`).join(" / "))}</small></td></tr>`;
}).join("");
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>入力条件から根拠検索・事実表示への接続確認</title><style>
@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font:15px/1.85 JP,sans-serif;color:#243b30;max-width:1080px;margin:auto;padding:22px;overflow-wrap:anywhere}h1{font-size:26px;line-height:1.5}h2{font-size:21px;margin-top:32px;border-top:1px solid #bdcfc3;padding-top:18px}h3{font-size:17px}.notice{background:#e7f1e9;border-left:4px solid #397451;padding:16px}.screens{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.screens>div{min-width:0}figure{margin:16px 0}figcaption{font-weight:bold;margin:10px 0}img{display:block;width:390px;max-width:100%;height:auto;border:1px solid #c3d1c9;margin:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bacfc1;padding:9px;text-align:left;vertical-align:top}small{font-size:12px;color:#52695d}details{margin:18px 0}summary{cursor:pointer;font-weight:bold}pre{white-space:pre-wrap}code{font-size:12px}a{color:#1b6444}@media(max-width:700px){body{padding:12px}.screens{grid-template-columns:1fr}td,th{font-size:12px;padding:6px}}</style>
<h1>入力条件から根拠検索・事実表示への接続確認</h1>
<p class="notice"><strong>非公開・隔離評価で完了。</strong>表示は「資料から確認できる情報」です。AI回答・個別の健康判定ではありません。追加モデルAPI送信0回、通常経路・既存DB・資料承認・本番公開は変更していません。</p>
<h2>実装前に確認し、再利用した箇所</h2>
<ul><li>既存の相談入力契約・対象者の分離・入力検証：<code>contract.ts / flow.ts</code></li>
<li>既存の条件確認と検索処理：<code>service.mts → server/evidence/search.ts</code>。既存の語彙・概念・対象条件の処理を再利用。</li>
<li>既存の事実データ照合：<code>fact-display-pilot/projection.mjs</code> と保存済み事実カタログ。</li>
<li>既存の共通表示器：<code>fact-display-pilot/render.mjs</code> の <code>factHtml</code>。元ファイルを変更せず、読込時に既存関数を公開するだけで再利用。</li>
<li>睡眠の数値比較：前回の <code>p01-aggregation-addendum/model.mjs</code> と、別出典として保存した議事録の検証済み関連付け。</li></ul>
<p>新規部分は、隔離評価用の接続、検索結果と事実データの対応付け、および既存入力契約に沿う最小の確認画面です。条件入力は既存の契約・検証・対象別処理を再利用していますが、既存React画面部品そのものは接続していません。通常サーバーを起動しない確認用フォームを置いています。ケースIDや質問文の完全一致による切り替え、質問別の回答カードは追加していません。</p>
<h2>入力から結果までの画面例</h2>
<p>相談文・対象・年齢を入力して検索します。相談文から年齢・診断・家族関係を補いません。検索された資料に関係する条件だけを追加確認し、睡眠時間は比較する場合にだけ明示入力します。以下は架空の確認用入力です。</p>
<div class="screens"><div>${image("input-sleep","1. 相談文と対象年齢を入力")}</div><div>${image("sleep-conditions-detail","2. 必要な睡眠条件を明示入力")}${image("numeric-comparison-detail","3. 算術・数値比較・健康判断を分離")}${image("common-fact-top-detail","4. 検索された事実データを既存表示器で表示")}</div></div>
<details><summary>検索直後：睡眠時間は空欄、比較は保留</summary>${image("result-before-sleep-conditions","追加条件を入力する前")}</details>
<details><summary>検索結果と既存共通表示器の全体</summary>${image("result-explicit-comparison","検索結果に対応する事実データの表示")}</details>
<details><summary>親子の相互作用に関する別の相談</summary>${image("result-interactions","同じ検索・表示経路で研究情報を表示")}</details>
<h2>実際につながった部分</h2>
<ol><li>自由な相談文と明示した対象・年齢を、既存の入力検証・対象別グループ化へ渡す。</li>
<li>既存検索を実行。回答を事前に用意した検索結果ではなく、一時DBで実際のSQLと既存語彙検索を動かす。</li>
<li>検索された出典・版・原文区画・必須文脈・論理的な資料単位を照合し、対応する事実データだけを共通表示器へ渡す。</li>
<li>対応する事実データがなければ「ありません」と表示し、原文と必要な文脈・引用先を保持する。</li>
<li>対象者ごとの追加条件で再検索する。相談文・年齢・対象が変われば、古い確認情報と結果を無効化する。</li></ol>
<p>睡眠時間の比較では、対象年齢、夜と昼寝の時間、同じ1日分、実睡眠、1日分の完全性、昼寝を含むこと、追加根拠との関連付けを確認します。不足・不適合・リンク解除時は比較を保留します。範囲内という結果から、十分・健康・受診不要は導きません。</p>
<h2>言い換え・条件不足・複数対象の実結果</h2>
<table><thead><tr><th>入力</th><th>明示条件</th><th>結果と意味</th></tr></thead><tbody>${table}</tbody></table>
<details><summary>年齢未入力の画面</summary>${image("result-age-unentered","年齢を推測せず、比較を保留")}</details>
<details><summary>複数の相談対象の画面</summary>${image("result-multiple-targets","子ども2人と保護者を別グループで表示")}</details>
<h2>検索の取りこぼしと資料不足の区別</h2>
<ul><li><strong>検索の取りこぼし：</strong>「ねんねはどれくらい」は語彙不一致でした。一方、同じ睡眠の意図を「睡眠時間」「睡眠の長さ」と入力すると資料が検索できました。資料がないのではなく、既存の語彙検索の限界です。今回は辞書を足して結果を改善したようには見せていません。</li>
<li><strong>事実データの未準備：</strong>3〜5歳や保護者の睡眠資料は存在し検索できましたが、対応する事実データがありません。これは検索失敗や資料不存在とは別です。1〜2歳のデータを流用していません。</li>
<li><strong>今回の保存資料の範囲外：</strong>離乳食の質問は語彙不一致です。それとは別に、今回のE02・E03・E04の保存対象範囲を確認し、睡眠・親子への介入・スクリーン関連に限られ、離乳食の開始時期の資料は収録していないと記録しました。自動検索結果だけから資料不存在を断定せず、科学全体で資料がないとも述べません。</li>
<li><strong>対象条件の不一致：</strong>年齢や明示された条件によって結果が変わる場合もあります。単に0件であることを、資料不足と同一視しません。</li></ul>
<div class="screens"><div>${image("result-search-gap","検索語彙の取りこぼし")}</div><div>${image("result-source-without-fact","資料は検索できたが事実データなし")}</div></div>
<details><summary>今回の保存範囲外の相談</summary>${image("result-out-of-retained-scope","検索では語彙不一致と表示。資料範囲の判断は別途記録")}</details>
<h2>未接続・今回の対象外</h2>
<ul><li><strong>通常の相談画面・公開経路・既存DB：</strong>意図的に未接続。一時環境の接続を通常経路へ登録していません。</li>
<li><strong>意味検索、自由文からの条件抽出、事実データの自動作成、AI回答：</strong>未実装・未接続。既存の語彙検索と準備済み事実データの範囲に限定しています。</li>
<li><strong>資料の正式採用・公開承認：</strong>未実施。未承認資料の隔離評価の成功を、正式承認として扱いません。</li>
<li><strong>終了後に使える常設検索画面：</strong>残していません。画面例は保存済みの検証記録です。一時接続がない状態では検索できないと明示します。</li></ul>
<h2>隔離と検証結果</h2>
<p>既存の所有確認付き一時DB起動・終了処理を再利用し、実行時だけ通常アプリの起動部分を今回の検証へ置き換えました。新しく作った専用DBでのみ、未承認・テスト限定・許可した出典の検索を可能にしています。資料を公開済みや人間レビュー済みに書き換えていません。通常の検索処理では同じ未承認資料が取得できないことを、前後で確認しました。</p>
<ul><li>${v.checks.length}項目の検証、${v.cases.length}件の条件別確認が通過。</li>
<li>既存${baseline.entries.length}ファイルの保存内容が一致。通常処理・資料・過去の回答や採点に変更なし。</li>
<li>モデルAPI送信0、ブラウザーからの外部要求0。既存DBへの接続なし。</li>
<li>一時DBの所有プロセスは正常終了。一時DBと画面用ディレクトリは削除済み。検証ブラウザーも終了。</li>
<li>通常アプリやHTTPサーバーをこの検証のために起動していません。</li></ul>
<details><summary>検証で見つけて修正した接続上の問題</summary><p>最初の隔離検索は、通常検索の「有効な資料のみ」という条件が残り、未承認の下書き資料を取得できませんでした。資料の状態を変更するのではなく、隔離評価の接続だけで下書き・テスト限定の出典を指定するよう修正しました。失敗記録は別保存しています。通常検索の承認条件は変更していません。</p></details>
<details><summary>同梱フォントのライセンス</summary><pre>${h(fontLicense)}</pre></details></html>`;
fs.writeFileSync(path.join(dir,"connection-report.html"),html,{flag:"wx"});
const files=[];
function walk(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){const p=path.join(folder,e.name);if(e.isDirectory())walk(p);else files.push(p)}}
walk(dir);walk("prototypes/evidence-consultation/retrieval-fact-connection");
fs.writeFileSync(path.join(dir,"delivery-manifest.json"),JSON.stringify({
  files:files.map(p=>({path:p,sha256:sha(p)})),protectedFilesUnchanged:baseline.entries.length,
  newModelApiCalls:0,approvalsChanged:false,existingDatabaseAccess:false,
  cleanupVerified:true,reportKind:"static saved evidence, not a running consultation service"
},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({report:path.join(dir,"connection-report.html"),checks:v.checks.length,cases:v.cases.length,protectedFiles:baseline.entries.length}));