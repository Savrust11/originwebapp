import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const [attemptArg,ownerLogArg,ownerExitCode]=process.argv.slice(2);
assert(attemptArg,"usage: package-report.mjs ATTEMPT_DIRECTORY [OWNER_LOG OWNER_EXIT_CODE]");
const root=path.resolve("evidence-work/parent-reading-evaluation/material-input-preview-01");
const attempt=path.resolve(attemptArg);
assert(attempt.startsWith(root+path.sep),"report must consume a successor attempt");
const results=JSON.parse(fs.readFileSync(path.join(attempt,"results.json"),"utf8"));
const sha=s=>createHash("sha256").update(s).digest("hex");
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const images=fs.readdirSync(attempt).filter(f=>f.endsWith(".png")).map(name=>{
  const bytes=fs.readFileSync(path.join(attempt,name));
  return{name,sha256:sha(bytes),data:bytes.toString("base64")};
});
assert(images.length,"no actual screenshots; refusing a screenshot report without execution");
const resultBytes=fs.readFileSync(path.join(attempt,"results.json"));
let owner={provided:false,completeMarker:false,reportedExitCode:null,logSha256:null};
if(ownerLogArg){
  assert(ownerExitCode!==undefined,"owner exit code must be provided explicitly");
  const bytes=fs.readFileSync(ownerLogArg),text=bytes.toString("utf8");
  owner={provided:true,completeMarker:/^ephemeral cleanup: complete\s*$/m.test(text),reportedExitCode:Number(ownerExitCode),logSha256:sha(bytes)};
}
const childClosed=results.cleanupStatus?.browserClosed&&results.cleanupStatus?.poolEnded&&results.cleanupStatus?.browserDirectoryRemoved;
const complete=results.result==="PASSED"&&childClosed&&owner.completeMarker&&owner.reportedExitCode===0;
const font=fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const labels={"blank-years-month8.png":"歳が空欄・月8：0歳とは扱わず歳入力を促す","0y8m.png":"明示0歳8か月：比較対象外","1y8m.png":"明示1歳8か月：資料表示と比較入力を分離","unknown.png":"年齢不明：具体的な比較不可理由","11m.png":"下限直前11か月","12m.png":"下限12か月","35m.png":"上限直前35か月","36m.png":"上限36か月：比較対象外","end-button.png":"実際の終了ボタン","ending.png":"終了ブリッジ到達後"};
Object.assign(labels,{"explicit-comparison.png":"明示操作後の比較画面","comparison-result-detail.png":"比較結果：入力した睡眠時間の合計","comparison-input-detail.png":"比較に使った入力と確認条件"});
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src data:;font-src data:;style-src 'unsafe-inline';base-uri 'none'">
<title>資料入力プレビュー：実行報告</title><style>@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font:15px/1.8 JP,sans-serif;color:#243b30;max-width:1000px;margin:24px auto;padding:16px}h1{font-size:26px}section,figure{border:1px solid #b8cdbd;padding:18px;margin:20px 0}img{max-width:100%;height:auto}code{overflow-wrap:anywhere}summary{cursor:pointer}.status{background:#edf4ef;padding:16px}</style>
<h1>資料入力プレビュー：限定修正と実行証跡</h1>
<p class="status">${complete?"検証と管理対象の終了を確認":"未完了または失敗：以下の実測結果を確認してください"}</p>
<p>この資料は実際の results.json と保存済み画面だけから生成しました。今回の添付画像は確認できていません。未閲覧のスクリーンショットに一致したとは主張せず、説明された入力状態を再現しています。</p>
<section><h2>範囲</h2><p>非公開・架空入力限定。通常アプリ経路、既存DB、モデル・外部API・追加通信は使いません。新しい資料、辞書、事実、採用、承認、公開を追加しません。元資料と過去報告は変更せず、狭い検査付きアダプターで再利用します。</p>
<p>資料の選択は元の相談への回答でも個別比較でもありません。比較は別ボタンを押した場合のみで、兄弟は明示した対象だけです。編集や遅い応答で古い比較を復活させません。</p>
<p>同じ1日・実睡眠・完全な記録・昼寝込みという4種類の確認はそれぞれ一度だけ必要です。議事録の関連付けはユーザー確認から外し、保存済みの原文・出典の同一性・対象条件をシステムが照合します。元資料だけの未確認と、補足議事録の集計範囲確認を区別します。</p></section>
<section><h2>実測結果</h2><p>検証：${esc(results.result)}／headful：${esc(results.headful)}／保存検査：${esc(results.preservedFiles)}ファイル</p>
${results.failure?`<p>失敗：${esc(results.failure.message)}</p>`:""}
<ol>${results.checks.map(c=>`<li>${esc(c)}</li>`).join("")}</ol>
<p>子プロセスのブラウザ・プール・一時ディレクトリ終了：${childClosed?"確認済み":"未確認"}</p>
<p>所有者ランナーの削除完了ログ：${owner.completeMarker?"確認済み":"未確認"}。操作者から渡された終了コード：${esc(owner.reportedExitCode??"未提供")}。</p>
<p>子の終了だけで一時DB削除済みとは判定しません。外側ログと終了コードが未提供の場合、この報告は未完了扱いです。</p></section>
<section><h2>操作案内</h2><p>年齢欄は歳と月を分けます。空欄の歳を0と補いません。対象外・不明年齢では比較入力へ誘導しません。対象の資料を選択してから、必要な場合だけ睡眠記録を入力し比較ボタンを押します。出典名とリンクは利用者向け、識別子・版・承認状態は閉じた確認担当者向け詳細です。</p><p>架空入力だけで操作し、終わるときは画面上部の「プレビューを終了」を押してください。維持プレビューは60分で自動終了します。公開URLはありません。</p></section>
<h2>実際の保存画面</h2>${images.map(i=>`<figure><figcaption>${esc(labels[i.name]||i.name)}</figcaption><img alt="${esc(labels[i.name]||i.name)}" src="data:image/png;base64,${i.data}"><details><summary>証跡ハッシュ</summary><code>${i.sha256}</code></details></figure>`).join("")}
<details><summary>確認担当者向け実行来歴</summary><p>入力結果 SHA-256：<code>${sha(resultBytes)}</code></p><p>所有者ログ SHA-256：<code>${esc(owner.logSha256??"未提供")}</code></p><p>結果ディレクトリ：${esc(path.relative(process.cwd(),attempt))}</p></details></html>`;
const dest=path.join(attempt,"report-ja.html");fs.writeFileSync(dest,html,{flag:"wx"});
fs.writeFileSync(path.join(attempt,"report-manifest.json"),JSON.stringify({complete,resultsSha256:sha(resultBytes),reportSha256:sha(html),owner,images:images.map(({name,sha256})=>({name,sha256}))},null,2),{flag:"wx"});
console.log(dest);