// Packages static evidence only, after the owned temporary environment is gone.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const out = "evidence-work/parent-reading-evaluation/fact-display-pilot-01";
const v = JSON.parse(fs.readFileSync(`${out}/verification.json`, "utf8"));
assert.equal(v.result, "PASSED");
assert.equal(v.cleanup.ownedTemporaryDirectoryRemoved, true);
assert.equal(v.cleanup.browserClosed, true);
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const font = fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const license = fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt", "utf8");
const rows = [
  ["P01", "睡眠時間は11〜14時間と保持し、集計範囲は未確認。夜間＋昼寝との充足比較・判定を生成する機能はありません。"],
  ["P04", "成長・発達・行動に影響し得る診断状態という特定の除外条件を保持。利用上の制限と研究の除外条件を分離しました。"],
  ["P06", "研究の一般結果を表示し、父親や特定講座への効果・適合を判定する機能はありません。父子や講座への保証不能も限界として表示します。"],
  ["P10", "質問者の続柄を推測せず、研究対象と平均年齢の条件を保持。共通の事実を別々に並べ、二介入の合成結果や相乗効果を作る機能はありません。"]
];
const report = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>出典単位の共通表示 — オフライン検証結果</title>
<style>@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font-family:JP,sans-serif;max-width:960px;margin:auto;padding:24px;color:#24342d;line-height:1.9}h1{font-size:27px}h2{font-size:21px;border-top:1px solid #ccd8d0;padding-top:20px;margin-top:32px}.notice{padding:18px;background:#edf3ef;border-left:4px solid #53836b}table{border-collapse:collapse;width:100%}th,td{padding:12px;border:1px solid #ccd8d0;text-align:left;vertical-align:top}img{display:block;width:390px;max-width:100%;height:auto;margin:16px auto;border:1px solid #cbd8d0}summary{cursor:pointer;font-weight:bold}details{margin:20px 0}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}.limit{padding:18px;background:#fff5df}.small{font-size:13px}</style>
<h1>出典単位の共通表示 — 検証結果とスマートフォン画面</h1>
<div class="notice"><strong>AI説明は未接続。追加モデルAPI送信0回。</strong><br>公開サーバーを立てず、ローカルの一時ディレクトリとオフラインブラウザーで検証しました。検証後、一時ディレクトリを削除しブラウザーを終了しました。この資料は保存した画面と検証記録です。</div>
<h2>最小実装</h2><p>既存の sources / fragments / units と必須文脈を再利用し、5つの出典単位の事実を1つの共通表示器で表示します。4問は参照する事実IDだけを切り替え、質問別の回答本文を生成しません。質問からの自動検索・適合判断も行いません。</p>
<p>一般説明、対象条件、限界、出典を同じまとまりに置き、条件・限界は折り畳まず表示します。数値だけを取り出す表示機能はありません。発行元と推奨主体を分け、原文一致・採用状態・公開状態・科学的確実性の評価も区別します。</p>
<p>画面には「確認済みデータから組み立てた表示」と明記しています。ここでの確認は原文との照合であり、人による採用承認や科学的・臨床的な保証ではありません。固定文の作成・原文照合はReplit Agentによるもので、人による確認は未実施です。</p>
<h2>固定表示で防げた範囲</h2><table><thead><tr><th>保存質問</th><th>今回の固定経路の境界</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join("")}</tbody></table>
<h2>意味上の問題は解決済みではありません</h2><div class="limit">
<p>意味上は不適切な保証文へ固定説明を変える負例を試しました。<strong>構造検査だけでは通過しました。</strong>その後の固定データのハッシュ照合では変更を拒否しましたが、これは意味を理解した検出ではありません。誤った内容を再び確認済みとして固定すれば、この保護では防げません。</p>
<p>初期投影にも、睡眠時間を昼寝込みの24時間合計と補う誤りがあり、保存原文へ戻して未確認へ修正しました。また、既存の編集上の利用制限を研究の除外条件と混同しないよう分離しました。事実データへの写し方にも誤りの余地があります。</p>
<p>将来AI自由文を接続すれば、暗黙の個別推奨、属性の補完、条件の省略、因果・相乗効果の追加等は引き続き問題になります。今回の型・ハッシュ検査や別AIによる確認だけでは保証できません。今回の成功を、過去のモデル回答の合格や意味検査の完成とは扱いません。</p></div>
<h2>検証と片付け</h2><ul><li>オフライン確認 ${v.checks.length}項目が通過。</li><li>390px幅で4問を切り替え、横はみ出しなし。同じ事実は質問が変わっても本文・条件・限界が同一。</li><li>条件・限界・必須原文の欠落、数値や年齢条件などの変更を拒否する負例を確認。</li><li>外部ページリクエスト0。AI説明欄は無効・未接続。</li><li>保護対象 ${v.protectedFilesUnchanged}ファイルの変更なし。過去の回答・採点と閉鎖済み送信枠を維持。</li><li>一時ディレクトリ削除済み、ブラウザー終了済み。検証用サーバーは起動していません。</li><li>既存DB・資料承認・通常相談経路・本番公開は変更していません。</li></ul>
<h2>スマートフォン画面例</h2><p>以下は実際に共通表示器で組み立てた画面の保存画像です。実モデルの回答ではありません。元画像は横390pxで、縮小せず縦に読むことができます。</p>
${v.images.map(i=>`<details ${i.caseId === "P01" ? "open" : ""}><summary>${i.caseId} — スマートフォン画面全体</summary><img alt="${i.caseId}のオフライン固定表示" src="data:image/png;base64,${fs.readFileSync(i.path).toString("base64")}"></details>`).join("")}
<details><summary>確認項目の詳細</summary><ol>${v.checks.map(c=>`<li>${esc(c.name)} — ${esc(c.result)}<br><span class="small">${esc(c.scope)}</span></li>`).join("")}</ol></details>
<details><summary>フォントのライセンス</summary><pre>${esc(license)}</pre></details></html>`;
fs.writeFileSync(`${out}/pilot-report.html`, report, { flag: "wx" });
const dirs = [out, "prototypes/evidence-consultation/fact-display-pilot"];
const entries = dirs.flatMap(dir => fs.readdirSync(dir).filter(n => !n.endsWith("manifest.json")).map(n => `${dir}/${n}`))
  .filter(p => fs.statSync(p).isFile()).map(p => ({
    path: p, sha256: createHash("sha256").update(fs.readFileSync(p)).digest("hex")
  }));
fs.writeFileSync(`${out}/delivery-manifest.json`, JSON.stringify({ schemaVersion: 1, entries,
  environmentRemoved: true, containsRunnableService: false, sourceCodeAndEvidenceRetained: true }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ report: `${out}/pilot-report.html`, bindings: entries.length }));