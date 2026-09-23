import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const out = "evidence-work/parent-reading-evaluation/display-refinement-01";
const v = JSON.parse(fs.readFileSync(`${out}/verification.json`, "utf8"));
assert.equal(v.result, "PASSED");
assert(v.cleanup.temporaryDirectoryRemoved && v.cleanup.browserClosed);
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const font = fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const license = fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt", "utf8");
const img = (p, alt) => `<img alt="${esc(alt)}" src="data:image/png;base64,${fs.readFileSync(p).toString("base64")}">`;
const report = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>非公開試作 — 表示整理と390px検証</title>
<style>@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font-family:JP,sans-serif;color:#20342a;max-width:960px;margin:auto;padding:24px;line-height:1.85}h1{font-size:26px}h2{font-size:21px;margin-top:32px;border-top:1px solid #bfd0c5;padding-top:18px}.notice{padding:16px;background:#eaf3ed;border-left:4px solid #397057}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #bfd0c5;text-align:left}img{display:block;width:390px;max-width:100%;height:auto;border:1px solid #bfd0c5;margin:18px auto}details{margin:16px 0}summary{cursor:pointer;font-weight:bold}pre{white-space:pre-wrap;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,390px),1fr));gap:18px}.small{font-size:13px}@media(max-width:600px){body{padding:12px}td,th{padding:6px;font-size:13px}}</style>
<h1>非公開試作の表示を整理しました</h1>
<p class="notice">固定データ・条件・承認状態は変更していません。追加モデルAPI送信0回。AI説明欄は保護者向けプレビューから取り除きました。</p>
<h2>表示順序</h2><ol><li>質問への短い結論</li><li>資料から説明できること</li><li>判断に欠かせない条件・限界</li><li>簡潔な出典</li><li>展開して読める原文・詳しい研究情報</li></ol>
<p>各画面にこの順番を一度だけ設け、共通表示器で参照中の事実を配置します。同じ出典の条件・限界は完全一致する文をまとめ、数値の説明は要約と結果の二重表示をやめました。研究の詳しい数値と原文は展開でき、原文照合・採用・公開状態とハッシュは「検証者向け詳細」に収めています。</p>
<h2>結論の扱い</h2><p><strong>P01：</strong>「保存した原文の範囲では昼寝を含むか確認できず、個別の充足判定はできない。」を冒頭に置きました。これは保存原文で確認できないという意味で、科学的に未解明という意味ではありません。睡眠資料の集計範囲未確認・個人判定禁止という既存項目に対応する限定的な表示規則です。</p>
<p>11時間と14時間は「11〜14時間」と一度だけ示し、対象と集計範囲の未確認を同じ枠に置きました。内部の数値・単位・測定対象データはそのままです。</p>
<p><strong>P04・P06・P10：</strong>短い結論は「編集見本（汎用的な質問回答ではありません）」と明示しています。共通の表示方針を示す見本であり、既存データから質問への答えを自動的に導く汎用機能は完成していません。質問別の回答本文データを追加していません。</p>
<h2>重複と表示量の比較</h2><table><thead><tr><th>問</th><th>初期表示の文字数<br>整理前 → 整理後</th><th>同一文の重複出現<br>整理前 → 整理後</th></tr></thead><tbody>
${v.comparisons.map(c=>`<tr><th>${c.caseId}</th><td>${c.before.visibleCharacters.toLocaleString()} → ${c.after.visibleCharacters.toLocaleString()}（${Math.round(100*(1-c.after.visibleCharacters/c.before.visibleCharacters))}%減）</td><td>${c.before.repeatedExactParagraphOccurrences} → ${c.after.repeatedExactParagraphOccurrences}</td></tr>`).join("")}
</tbody></table><p class="small">「文字数」は詳細を展開していない画面全体の表示文字。「重複」は10文字以上の段落・箇条書き・説明欄について、空白を整えた後に完全一致する文の余分な出現回数です。意味が似た別表現の重複までなくなったことを示す値ではありません。</p>
<p>重要な対象条件・除外条件・限界は表示されたままで、詳細欄へ移していません。P10では出典が異なる同一の注意事項など3件の完全一致が残ります。出典ごとの適用範囲を混同しないため保持しました。異なる言い回しの近い注意事項も一部残しています。</p>
<h2>390px幅の画面例</h2><p>全4問で結論が最初の844px高の画面内に収まり、横はみ出しがないことを確認しました。下の画像は実際のオフライン表示から保存したものです。</p>
<div class="grid">${v.images.map(i=>`<section><h3>${i.caseId} — 最初の画面</h3>${img(i.top,`${i.caseId}の390px幅の冒頭画面`)}<details><summary>条件・限界を含む画面全体</summary>${img(i.full,`${i.caseId}の画面全体`)}</details></section>`).join("")}</div>
<h2>検証と変更していない範囲</h2><ul><li>${v.checks.length}項目の表示・保持確認が通過。</li><li>固定データ、封印情報、過去の画面・検証記録はハッシュで不変を確認。</li><li>既存DB、資料承認、通常相談経路、本番公開を変更していません。</li><li>HTTPサーバーは起動せず、オフラインのローカルファイルだけで検証。</li><li>検証後に一時ディレクトリを削除し、ブラウザーを終了しました。</li><li>今回の確認は表示整理の検証であり、モデル回答の合格や意味検査の完成ではありません。</li></ul>
<details><summary>確認項目</summary><ol>${v.checks.map(c=>`<li>${esc(c.name)} — ${esc(c.result)}</li>`).join("")}</ol></details>
<details><summary>同梱フォントのライセンス</summary><pre>${esc(license)}</pre></details></html>`;
fs.writeFileSync(`${out}/display-report.html`, report, { flag: "wx" });
const files = [...fs.readdirSync(out).filter(p => !p.startsWith("verification-failed-")).map(p => `${out}/${p}`),
  ...["render-refined.mjs", "verify-refined-temporary.mjs", "package-refined-evidence.mjs"]
    .map(p => `prototypes/evidence-consultation/fact-display-pilot/${p}`)];
const entries = files.map(p => ({ path: p, sha256: createHash("sha256").update(fs.readFileSync(p)).digest("hex") }));
fs.writeFileSync(`${out}/delivery-manifest.json`, JSON.stringify({ entries, fixedCatalogModified: false,
  adoptionChanged: false, normalRouteChanged: false, productionChanged: false, newModelApiCalls: 0 }, null, 2) + "\n", { flag: "wx" });
console.log(`${out}/display-report.html`);