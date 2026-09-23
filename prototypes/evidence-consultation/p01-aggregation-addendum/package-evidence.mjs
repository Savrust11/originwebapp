// Static report only; the browser and owned temporary root are already closed.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const out = "evidence-work/parent-reading-evaluation/p01-aggregation-addendum-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const v = read(`${out}/verification.json`);
const source = read(`${out}/minutes-source.json`);
const cdc = read(`${out}/cross-check-only/cdc-check.json`);
const rights = read(`${out}/rights-check.json`);
assert.equal(v.result, "PASSED");
assert(v.cleanup.temporaryRootRemoved && v.cleanup.browserClosed);
const oldCatalog = read("evidence-work/parent-reading-evaluation/fact-display-pilot-01/fact-catalog.json");
const oldReference = oldCatalog.facts.find(f => f.id === "sleep-guidance").supports
  .find(s => s.originalId === "E02-C-REFERENCE-5").quote;
for (const citation of [oldReference, cdc.reference2Quote]) {
  for (const part of ["Paruthi S", "Brooks LJ", "Recommended amount of sleep for pediatric populations",
    "American Academy of Sleep Medicine", "2016", "785", "786"]) assert(citation.includes(part));
}
const esc = x => String(x).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const font = fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const license = fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt", "utf8");
const image = id => {
  const p = v.images.find(i => i.id === id).path;
  return `<img alt="${esc(id)}の390px表示" src="data:image/png;base64,${fs.readFileSync(p).toString("base64")}">`;
};
const old = v.displayed.find(d => d.id === "old-top");
const added = v.displayed.find(d => d.id === "new-top");
const links = d => d.citations.map(c => `<p><a href="${esc(c.url)}">${esc(c.title)}</a><br><small>${esc(c.url)}</small></p>`).join("");
const q = source.fragments.find(f => f.id === "MINUTES-Q-1TO2-NAPS");
const a = source.fragments.find(f => f.id === "MINUTES-A-1TO2-NAPS");
const tests = [
  ["旧資料のみ", "old-top"], ["関連付け後", "new-top"],
  ["関連付けを解除", "detached"], ["夜間のみ", "night-only"],
  ["年齢未確認", "unknown-age"], ["異なる日", "different-days"], ["寝床にいた時間", "time-in-bed"]
];
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>P01 集計範囲の追補 — 新旧表示・原文と検証</title>
<style>@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font-family:JP,sans-serif;color:#21372c;line-height:1.8;max-width:1000px;margin:auto;padding:24px;overflow-wrap:anywhere}h1{font-size:26px}h2{font-size:21px;border-top:1px solid #bacfc1;padding-top:18px;margin-top:30px}h3{font-size:17px}.notice{padding:17px;background:#e8f2eb;border-left:4px solid #377154}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pair>section{min-width:0}blockquote{margin:12px 0;padding:16px;background:#f0f4f1;white-space:pre-wrap}img{display:block;width:390px;max-width:100%;height:auto;margin:14px auto;border:1px solid #bacfc1}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bacfc1;padding:10px;text-align:left;vertical-align:top}summary{cursor:pointer;font-weight:bold}details{margin:16px 0}a{color:#175940}pre{white-space:pre-wrap}small{font-size:12px}@media(max-width:700px){body{padding:12px}.pair{grid-template-columns:1fr}td,th{font-size:13px;padding:6px}}</style>
<h1>P01：資料の集計範囲を追補した非公開編集見本</h1>
<p class="notice">追加モデルAPI送信は0回。既存E02は上書きせず、議事録を別出典として関連付けました。以下は固定データによる編集見本で、AI回答ではありません。原文との照合は、正式採用・公開承認ではありません。</p>
<h2>追加した根拠と限定範囲</h2>
<p><a href="${esc(source.url)}">${esc(source.title)}</a>。開催日：2023年12月21日。発言者：内村座長、駒田構成員（途中に栗山構成員の指名発言）。</p>
<p>該当箇所は「６～20ページについて」の質疑応答、「こども版」15ページ左下の図を確認する一連の発言です。<strong>15ページは審議中のガイド案のページ</strong>であり、議事録のページ番号ではありません。</p>
<blockquote>${esc(q.text)}</blockquote><blockquote>${esc(a.text)}</blockquote>
<p><strong>ガイド案の策定過程の議事録</strong>であり、最終ガイド本文や独立した効果研究とは区別します。今回の利用範囲は、1〜2歳の11〜14時間に昼寝を含むという集計範囲の説明だけです。</p>
<p>前段の事務局説明では、こどもの推奨時間について米国の睡眠学会の推奨値を参考にしていると説明されています。前後の質疑には3〜5歳・小学生・昼寝量・個人差の話がありますが、これらを今回の目安や新たな推奨として取り込みません。質問中の「昼寝の２時間」も、P01の昼寝1時間を置き換える根拠には使いません。</p>
<details><summary>前後を含む一連の原文</summary><blockquote>${esc(source.fragments.find(f => f.role === "context").text)}</blockquote></details>
<h2>新旧表示と引用先</h2>
<div class="pair"><section><h3>旧資料のみ：集計範囲は未確認</h3><p>${esc(old.conclusion)}</p><p><strong>算術：</strong>${esc(old.arithmetic)}</p><p><strong>比較：</strong>${esc(old.comparison)}</p>${links(old)}${image("old-top")}<details><summary>旧表示の全体</summary>${image("old-full")}</details></section>
<section><h3>議事録を関連付けた場合</h3><p>${esc(added.conclusion)}</p><p><strong>算術：</strong>${esc(added.arithmetic)}</p><p><strong>比較：</strong>${esc(added.comparison)}</p>${links(added)}${image("new-top")}<details><summary>新表示の全体</summary>${image("new-full")}</details></section></div>
<p>夜10時間＋昼寝1時間が<strong>同じ1日分の実際の睡眠時間を漏れなく表すなら</strong>、概数の合計は約11時間で、時間数として11〜14時間の範囲内です。この条件は確認済みの個人情報ではなく、固定例の仮定です。記録日の定義や実睡眠かどうかを質問文から自動推測していません。</p>
<p class="notice">足し算と数値範囲の比較は、睡眠が十分・健康上問題がない・受診不要という判断とは別です。個別の健康判断はすべて「評価していない」のままです。</p>
<h2>境界条件と取り外しの検証</h2><table><thead><tr><th>状態</th><th>画面に出た比較結果</th></tr></thead><tbody>${tests.map(([label,id])=>{
  const d=v.displayed.find(x=>x.id===id);
  return `<tr><th>${label}</th><td>${esc(d.comparison)}</td></tr>`;
}).join("")}</tbody></table>
<p>リンク解除時は、結論・比較・引用先・議事録原文欄を再構築し、以前の昼寝込みの説明や引用先が残らないことを確認しました。追加資料ファイルを除去した一時コピーでは、表示の再生成を停止しました。既存E02のみの表示は比較保留です。</p>
<p>このほか、対象年齢の上下限、単位混在、負数・非数値、不完全な1日、24時間を超える合計、範囲外の数値でも健康判断を行わないことを確認しました。概数の境界比較はあくまで入力した値についてのもので、実際の正確な睡眠時間を確定しません。</p>
<details><summary>解除・不適合な入力の画面例</summary>${["detached","night-only","unknown-age","different-days","time-in-bed"].map(id=>`<h3>${esc(tests.find(t=>t[1]===id)[0])}</h3>${image(id)}`).join("")}</details>
<h2>利用条件の確認</h2><ul>
<li><a href="${esc(rights.termsUrl)}">厚生労働省の利用規約・重要情報</a>、<a href="${esc(rights.licenseUrl)}">PDL1.0</a>、<a href="${esc(rights.exceptionsUrl)}">適用外コンテンツの別紙</a>を確認しました。</li>
<li>${esc(rights.checks.individualNotice)} 別紙にも対象議事録の記載は見つかりませんでした。直接取得したHTMLでも指定2発言の文字を照合しました。</li>
<li>第三者権利の例外と個別法令の制約は維持されます。表示がないことをもって第三者の権利不存在や包括的許諾を保証するものではありません。</li>
<li>図表・画像・ロゴ・外部添付資料は取り込んでいません。画面例はこの試作自身のスクリーンショットです。</li></ul>
<p>${esc(source.attribution)}</p><p>${esc(source.processingNotice)}</p>
<h2>CDCは照合のみ・独立研究には数えない</h2><p><a href="${esc(cdc.url)}">CDC — About Sleep</a>の「Getting enough sleep」表の1〜2歳の行と参考文献2を確認しました。</p>
<blockquote>${esc(cdc.rowQuote)}</blockquote><blockquote>${esc(cdc.reference2Quote)}</blockquote>
<p>参考文献2は、E02の引用文献5と同じParuthiらのAASM小児睡眠時間コンセンサス（2016年、785–786頁）です。CDC本文は検索用データ・表示用の根拠集合に追加せず、URL・短い照合記録だけを別保存しました。同じAASM推奨に基づく情報を独立した複数研究として数えていません。独立した効果研究の追加は0件です。</p>
<h2>保存と片付け</h2><ul><li>原文の連続文脈・発言者・日付・該当箇所・取得時刻・ハッシュ、編集メモと利用条件を別項目で保存。</li><li>表示・保存整合性など${v.checks.length}項目と計算境界テストが通過。保護対象${v.protectedFilesUnchanged}ファイルの変更なし。</li><li>正式採用・公開承認は変更なし。過去モデルの回答・採点も変更なし。</li><li>既存DB、通常相談経路、本番公開への変更なし。</li><li>ブラウザー検証中の外部リクエスト0。資料取得後はオフラインの一時環境で検証。</li><li>一時ディレクトリを削除し、ブラウザーを終了。検証用HTTPサーバーは起動していません。</li></ul>
<p>今回の結果は狭い条件付き編集見本の検証です。自由文の意味検査や科学的・臨床的な承認の完成を意味しません。</p>
<details><summary>同梱フォントのライセンス</summary><pre>${esc(license)}</pre></details></html>`;
if (fs.existsSync(`${out}/comparison-report.html`)) {
  assert.equal(fs.readFileSync(`${out}/comparison-report.html`, "utf8"), html, "existing report differs; do not overwrite");
} else {
  fs.writeFileSync(`${out}/comparison-report.html`, html, { flag: "wx" });
}
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p); else if (!entry.name.startsWith("verification-failed-")) files.push(p);
  }
}
walk(out);
walk("prototypes/evidence-consultation/p01-aggregation-addendum");
const manifest = { entries: files.map(p => ({ path: p, sha256: createHash("sha256").update(fs.readFileSync(p)).digest("hex") })),
  adoptionApproved: false, publicationApproved: false, modelApiCalls: 0,
  sourceAccess: "Specified public textual webpages and the linked license-exceptions page only; no source media.",
  temporaryEnvironmentRemoved: true };
fs.writeFileSync(`${out}/delivery-manifest.json`, JSON.stringify(manifest,null,2)+"\n", { flag:"wx" });
console.log(JSON.stringify({ report: `${out}/comparison-report.html`, files: files.length }));