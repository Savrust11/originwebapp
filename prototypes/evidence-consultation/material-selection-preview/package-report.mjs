import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {out,hash,verifyPreservation} from "./preservation.mjs";
const attempt="attempt-04",dir=`${out}/${attempt}`;
const v=JSON.parse(fs.readFileSync(`${dir}/verification.json`));
const lifecycle=JSON.parse(fs.readFileSync(`${out}/live-lifecycle-smoke-02.json`));
assert.equal(v.result,"PASSED");assert(lifecycle.ready&&lifecycle.ownerCleanupComplete&&lifecycle.exitCode===0&&lifecycle.closed.closed);
assert(fs.readFileSync("/tmp/material-selection-attempt-04.log","utf8").includes("ephemeral cleanup: complete"));
const protectedFiles=verifyPreservation();
const remaining=fs.readdirSync("/tmp").filter(n=>n.startsWith("material-selection-ui-")||n.startsWith("weiku-ephemeral-"));
assert.equal(remaining.length,0);
fs.writeFileSync(`${dir}/runtime-cleanup.json`,JSON.stringify({ownedRunnerExitCode:0,ownerCleanupMessage:"ephemeral cleanup: complete",
  protectedFiles,changedFiles:[],remainingPreviewDirectories:remaining,
  headfulLifecyclePassed:true,gracefulStopExitCode:0,normalApplicationStarted:false,httpServerStarted:false,
  existingDatabaseAccess:false,modelApiCalls:0,approvalsChanged:false},null,2)+"\n",{flag:"wx"});
fs.writeFileSync(`${out}/latest-success.json`,JSON.stringify({attempt,verification:`${dir}/verification.json`,cleanup:`${dir}/runtime-cleanup.json`,
  headfulLifecycle:`${out}/live-lifecycle-smoke-02.json`},null,2)+"\n",{flag:"wx"});
const h=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const font=fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const license=fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt","utf8");
const image=(name,title)=>{const i=v.images.find(i=>i.name===name);assert.equal(hash(i.path),i.sha256);return`<figure><figcaption>${h(title)}</figcaption><img alt="${h(title)}" src="data:image/png;base64,${fs.readFileSync(i.path).toString("base64")}"></figure>`};
const start='env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC node --import ./prototypes/evidence-consultation/material-selection-preview/register-live.mjs --import tsx tests/run-ephemeral-tests.mjs material-selection-live';
const stop='env -i PATH="$PATH" node prototypes/evidence-consultation/material-selection-preview/stop-preview.mjs';
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>非公開プレビュー：資料の選択と睡眠時間の比較</title><style>
@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font:15px/1.85 JP,sans-serif;max-width:1040px;padding:22px;margin:auto;color:#253c2e;overflow-wrap:anywhere}h1{font-size:26px;line-height:1.5}h2{font-size:21px;border-top:1px solid #cad9ce;padding-top:18px;margin-top:28px}.notice{background:#e9f2ec;border-left:4px solid #356848;padding:15px}.warning{background:#fff1db;padding:15px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pair>div{min-width:0}img{width:390px;max-width:100%;height:auto;display:block;margin:12px auto;border:1px solid #c8d5cc}figure{margin:18px 0}figcaption{font-weight:bold}pre{white-space:pre-wrap;background:#f0f4f1;padding:14px;font-size:12px}details{margin:18px 0}summary{cursor:pointer;font-weight:bold}li{margin:7px 0}@media(max-width:700px){.pair{grid-template-columns:1fr}body{padding:12px}}</style>
<h1>非公開プレビュー：資料の選択と睡眠時間の比較</h1>
<p class="notice"><strong>架空の相談だけを入力してください。実在の個人情報や健康情報は入力しないでください。</strong><br>既存DB・通常相談経路とは分離した一時環境です。資料は未承認のままです。追加モデルAPI送信はありません。</p>
<h2>変更した操作</h2><ol><li><strong>資料を選ぶ：</strong>候補の話題を一か所で選びます。「睡眠についての資料を表示しています」と明示し、元の質問への回答成立とは扱いません。資料の選択だけでは個別の算術・比較を実行しません。</li><li><strong>比べる：</strong>「入力した睡眠時間を目安と比べる」を押したときだけ、明示入力と集計条件を確認します。すでに入力した年齢・時間を重複して尋ねません。複数の子どもがいる場合は、押した子どもの分だけ比較します。</li><li><strong>変更する：</strong>睡眠の値や集計条件を変更すると古い比較を消し、資料の選択は保持します。相談文・対象・年齢が変われば、古い選択と結果を解除します。</li></ol>
<h2>自分で試す場所</h2><p>Replitワークスペース内の<strong>VNC画面</strong>を使います。公開の開発URL・HTTPサーバー・外部noVNCは使いません。ワークフロー名は<strong>資料操作プレビュー</strong>です。起動済みでなければ、そのワークフローを開始してください。</p>
<p class="warning">VNCはワークスペースのアクセス権を境界とします。権限のある共同作業者からも見える場合があるため、個人の秘密相談用ではありません。このレポート自体は画面記録で、入力できる検索画面ではありません。</p>
<h2>短い操作手順</h2><ol><li>架空の相談文、対象、年齢を入力します。最初から表示する資料を選んでも構いません。</li><li>入力内容を確認して「資料を検索」。必要な場合だけ、一つの選択欄から話題を選び「選んだ資料を表示」。「該当しない」「言い直す」も使えます。</li><li>睡眠を比較したい場合だけ、夜・昼寝の実睡眠時間と未確認の条件を入力し、比較ボタンを押します。入力しただけでは比較しません。</li><li>結果に示す年齢・夜・昼寝・合計・同じ1日・実睡眠・記録の完全性・昼寝込み・出典関連付けを確認します。元の相談への回答や健康判断とは別です。</li><li>終了するときは「プレビューを終了」。起動から60分でも自動終了します。</li></ol>
<h2>操作の画面記録</h2><div class="pair"><div>${image("single-material-chooser","1．複数の候補も一つの資料選択欄にまとめる")}</div><div>${image("edited-comparison-withheld","2．入力を変えた後は、比較ボタンを押すまで保留")}</div></div>
<div class="pair"><div>${image("comparison-result-detail","3．別操作として実行した数値比較")}</div><div>${image("comparison-input-detail","4．比較に使った入力と集計条件")}</div></div>
<details><summary>資料を表示した段階の全体画面（個別比較なし）</summary>${image("materials-without-comparison","資料表示と個別比較の分離")}</details>
<details><summary>デスクトップ画面</summary>${image("desktop-materials","最初に選んだ資料をそのまま表示")}</details>
<h2>起動・終了方法</h2><p>起動（プロジェクトルート、VNCワークフロー）：</p><pre>${h(start)}</pre><p>通常終了は画面の「プレビューを終了」、または次のコマンドです。</p><pre>${h(stop)}</pre>
<p>終了時にブラウザー・接続プール・一時ディレクトリを片付け、その後、元の所有者プロセスが一時PostgreSQLを削除します。ワークフローの停止ボタンでも終了できますが、中断として記録されるため、画面または上記コマンドでの終了を推奨します。終了後に再起動すると、入力のない新しいセッションになります。同時に複数起動しないでください。</p>
<h2>今回の検証範囲</h2><ul><li>既存の既知5例・新規7例を再利用。資料選択だけでは比較しない、という操作変更を期待値の差分として記録しました。</li><li>${v.checks.length}項目を確認、${v.sqlCalls}回の既存SQL実行。話題選択、個別比較、兄弟の比較分離、入力変更、古い応答、終了処理を重点確認。</li><li>実際にheadful Chromiumを起動し、非公開VNC向けのファイル画面が操作できることを確認。別の所有済み一時環境で起動→正常終了→DB削除を実測。</li><li>ブラウザー終了処理が例外を返しても、接続プール終了と一時ディレクトリ削除を飛ばさないことを確認。</li><li>既存${protectedFiles}ファイルはハッシュ一致。新しい辞書・分類器・資料・事実データなし。モデルAPI、既存DB、通常経路、承認、本番公開の変更なし。</li></ul>
<p>資料選択の関連性や、元の質問への回答として十分かを自動判定する機能ではありません。利用者が別の資料を選んでも、それを「質問に回答できた」とは扱いません。別操作の比較も、明示した架空の入力値と目安との比較に限ります。</p>
<p>相談文や入力値はライブプレビューのファイル記録に保存しません。起動・終了の状態だけを記録します。検証実行と起動終了の確認に使った一時環境は片付け済みです。利用者用セッションの起動状態はワークフロー／ready・closed記録で確認してください。</p>
<details><summary>同梱フォントのライセンス</summary><pre>${h(license)}</pre></details></html>`;
fs.writeFileSync(`${out}/material-selection-report.html`,html,{flag:"wx"});
const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p)}}
walk(out);walk("prototypes/evidence-consultation/material-selection-preview");
fs.writeFileSync(`${out}/delivery-manifest.json`,JSON.stringify({entries:files.map(p=>({path:p,sha256:hash(p)})),protectedFiles,
  newModelApiCalls:0,newDictionary:false,newFacts:false,headfulLifecycleVerified:true,livePreviewStartedByParent:false},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({report:`${out}/material-selection-report.html`,checks:v.checks.length,protectedFiles,headfulLifecycleVerified:true}));