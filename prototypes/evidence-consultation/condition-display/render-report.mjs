import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outputDirectory, verifyHistory } from "./history-integrity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(outputDirectory, "display-evaluation.json"), "utf8"));
const css = fs.readFileSync(path.join(here, "report.css"), "utf8");
const h = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const list = items => `<ul>${items.map(item => `<li>${h(item)}</li>`).join("")}</ul>`;
const kind = { population: "対象・年齢", eligibility: "採択・適用条件", exclusion: "除外条件",
  limitation: "重要な限界", numericMeaning: "数値・結論の意味", researchDetail: "研究情報" };
const sourceKey = (caseId, support) =>
  `source-${caseId}-${support.originalId}-${support.quoteStart}`;
const references = (caseId, block) => `<span class="source-ref">${block.supports.map(support =>
  `<a class="source-link" href="#${h(sourceKey(caseId, support))}">${h(support.originalId)} · 出典・版・該当箇所</a>`).join(" ／ ")}</span>`;
const blockList = (caseId, blocks) => `<ul>${blocks.map(block => `<li data-block-id="${h(block.id)}">
  <span class="kind">${h(kind[block.kind])}</span><br>${h(block.text)}${references(caseId, block)}</li>`).join("")}</ul>`;
function sourcePanel(row) {
  const sources = new Map();
  for (const block of row.conditionCase.blocks) for (const support of block.supports)
    sources.set(sourceKey(row.caseId, support), support);
  return `<details class="source-detail"><summary>出典を確認する（原文・版・該当箇所）</summary>
    ${[...sources].map(([key, support]) => `<section class="source" id="${h(key)}">
      <strong>${h(support.title)}</strong><dl>
      <dt>原文ID</dt><dd>${h(support.originalId)}</dd><dt>版</dt><dd>${h(support.version)}</dd>
      <dt>該当箇所</dt><dd>${h(support.locator)}</dd>
      <dt>資料URL</dt><dd><a href="${h(support.url)}" rel="noreferrer noopener" target="_blank">${h(support.url)}</a></dd>
      <dt>原文SHA-256</dt><dd><code>${h(support.originalTextSha256)}</code></dd>
      <dt>引用範囲</dt><dd>UTF-16 ${support.quoteStart}–${support.quoteEnd}</dd></dl>
      <blockquote>${h(support.quote)}</blockquote></section>`).join("")}</details>`;
}
function samplePanel(row) {
  const { caseId, sample, conditionCase } = row;
  if (!sample.evaluation.conditionIntegrityPassed || !sample.evaluation.bodyReviewPassed
    || sample.evaluation.displayStatus !== "fictional-example")
    throw new Error(`FICTIONAL_EXAMPLE_NOT_VERIFIED:${caseId}`);
  const details = conditionCase.blocks.filter(block => block.tier === "conditional");
  const optional = conditionCase.blocks.filter(block => block.tier === "optional");
  return `<article class="case-panel" id="example-${caseId}" data-case="${caseId}" ${caseId === "Q11" ? "" : "hidden"}>
    <div class="case-top"><div class="case-title"><p class="eyebrow">${caseId} / 架空の質問</p><h2>${h(row.title)}</h2></div>
      <span class="badge warn">公開・個別助言には使用不可</span></div>
    <div class="controls"><label>確認状態の画面例
      <select class="applicability"><option value="unknown">条件が未確認</option><option value="mismatched">条件が不適合</option><option value="matched">条件が一致（仮定）</option></select>
      </label><label>表示する内容<select class="display-mode">
      <option value="background">研究背景の説明例</option><option value="individual">この親子への個別助言</option></select></label></div>
    <div class="gate-state" role="status">対象条件は未確認です。必要な確認が終わるまで、個別助言は表示しません。</div>
    <div class="blocked-answer" hidden><h3>個別助言を停止しています</h3>
      <p>対象条件の確認、既存のゲート、資料の採用・公開承認を通過していません。条件欄を付けるだけでは本文を表示できません。</p>
      <p class="muted">このオフライン試作では、「一致」を選んでも個別助言を開放しません。</p></div>
    <div class="background-content"><div class="sample-layout"><div class="sample-main">
    ${sample.evaluation.adjacentClaims.map(claim => `<section class="body-conditions" data-claim-id="${h(claim.id)}">
      <div class="short-body"><p class="eyebrow">短い本文 · 原文に照合した編集例（モデル出力ではありません）</p><p>${h(claim.text)}</p></div>
      <div class="condition-list"><h3>この説明の対象条件・限界 <span class="badge">常に表示</span></h3>
        ${blockList(caseId, claim.blocks)}</div></section>`).join("")}
      ${row.serviceNotices.map(text => `<p class="service-notice">${h(text)}</p>`).join("")}
      <details class="research-detail"><summary>詳しい研究情報 <small>必要な質問では必須</small></summary>
      ${details.length ? blockList(caseId, details) : "<p>この例では、別に折りたたむ統計詳細はありません。結論を左右する情報は上の条件・限界欄に保持しています。</p>"}</details>
      ${optional.length ? `<details><summary>補助的な背景情報 <small>判断が変わらない場合のみ任意</small></summary>${blockList(caseId, optional)}</details>` : ""}
      ${sourcePanel(row)}</div>
      <aside class="side-note"><h3>表示を分ける理由</h3><p><strong>短い本文</strong><br>結論と不確実性を簡潔に。</p>
      <p><strong>対象条件・限界</strong><br>モデルに再生成させず、確認済みデータを隣接表示。</p>
      <p><strong>詳しい研究情報</strong><br>質問が数値を求めるときは省略不可。詳細を閉じても重要な意味は残します。</p>
      <p><strong>出典</strong><br>原文・版・箇所・引用範囲まで確認できます。</p>
      <p>これは画面構成の例であり、保存済み不合格回答を修正した結果ではありません。</p></aside></div></div></article>`;
}
const historicalLabel = row => row.historical.verdict === "pass" ? "合格（当時のまま）" : "不合格（保持）";
function savedPanel(row) {
  const defects = [...row.bodyReview.unsupportedClaims, ...row.bodyReview.contradictions];
  return `<article class="history-row" id="history-${row.caseId}">
    <h3>${row.caseId} <span class="badge ${row.historical.verdict === "pass" ? "" : "fail"}">${historicalLabel(row)}</span>
      <span class="badge warn">検証用のみ・完成回答ではありません</span></h3>
    <p>モデル単体の判定・生回答は変更なし。今回の条件表示の検証とは別記録です。
      保存済み計算費用：$${(row.historical.measuredMicroUSD / 1e6).toFixed(6)}。</p>
    <div class="review-note"><strong>本文に残る問題</strong>${defects.length ? list(defects)
      : "<p>今回の未支持・矛盾の照合で、新たな重大な本文問題は検出していません。ただし条件の欠落や過去の不合格を取り消す意味ではありません。</p>"}
      ${list(row.bodyReview.findings)}</div>
    <details><summary>モデルが省略した条件と、アプリが保持する情報</summary>
      ${list(row.bodyReview.omittedConditions)}
      <div class="condition-list">${blockList(row.caseId, row.conditionCase.blocks)}</div></details>
    <details class="saved-body"><summary>保存済み本文と隣接条件を見る（不合格回答を含む検証専用）</summary>
      ${row.savedEvaluation.adjacentClaims.map(claim => `<section class="original-claim">
        <span class="kind">変更していないモデル本文 · ${h(claim.id)}</span><p>${h(claim.text)}</p>
        <div class="historical-conditions"><strong>アプリ側の確認済み条件（本文の問題を修正しません）</strong>
          ${blockList(row.caseId, claim.blocks)}</div></section>`).join("")}</details>
    <details><summary>モデル生回答（verbatim JSON）・当時のレビュー</summary>
      <pre class="raw-answer">${h(row.historical.outputText)}</pre><pre>${h(JSON.stringify(row.historical.review, null, 2))}</pre>
      <p>原結果：<code>${h(row.historical.responseFile)}</code><br>SHA-256：<code>${h(row.historical.responseFileSha256)}</code></p></details>
    <details><summary>今回の表示検証記録（過去の判定とは別）</summary>
      <pre>${h(JSON.stringify({ conditionIntegrityPassed: row.savedEvaluation.conditionIntegrityPassed,
        bodySupportReview: row.bodyReview, displayStatus: row.savedEvaluation.displayStatus,
        userReady: false, blockingReasons: row.savedEvaluation.blockingReasons }, null, 2))}</pre></details></article>`;
}
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>本文と条件を分けて保持する — オフライン表示検証</title><style>${css}</style></head><body><main>
<header class="hero"><p class="eyebrow">EVIDENCE DISPLAY / OFFLINE PROTOTYPE</p>
<h1>短い説明でも、<br>大切な条件は省略しない。</h1>
<p>本文と、対象・除外条件・限界を別々に確認する表示方式です。原文に照合した構造化データだけを使い、自由記述から条件を推測しません。</p>
<div class="status-line"><span class="badge">架空データ・通信なし</span><span class="badge warn">評価基準は今後の提案・未採用</span>
<span class="badge warn">利用者向けの完成回答ではありません</span></div></header>
<div class="metrics"><div class="metric"><small>今回の追加API送信</small><strong>0 回</strong></div>
<div class="metric"><small>既存の累計通信</small><strong>13 / 20 回</strong></div>
<div class="metric"><small>累計の計算費用</small><strong>$0.017093</strong></div>
<div class="metric"><small>運用予算（変更なし）</small><strong>$1</strong></div></div>
<section class="section" id="examples"><h2>架空データの画面例</h2>
<p class="muted">新たなモデル生成ではなく、原文と照合して編集した説明例です。下部の保存済み回答とは別物です。</p>
<nav class="tabs" aria-label="画面例のケース">${data.cases.map(row =>
  `<button type="button" role="tab" aria-selected="${row.caseId === "Q11"}" aria-controls="example-${row.caseId}" data-case-button="${row.caseId}">${row.caseId}</button>`).join("")}</nav>
${data.cases.map(samplePanel).join("")}</section>
<section class="section" id="outcomes"><h2>保存済みQ05〜Q11で確かめたこと</h2>
<p>条件を確実に保持できるかと、本文に未支持・矛盾が残るかを分けています。<strong>当時のモデル採点は一切変更していません。</strong></p>
<div class="table-wrap"><table><thead><tr><th>ケース</th><th>モデル単体の過去判定</th><th>アプリが保持する情報</th><th>本文の問題・注意点</th></tr></thead><tbody>
${data.cases.map(row => `<tr><th><a href="#history-${row.caseId}">${row.caseId}</a></th><td>${historicalLabel(row)}</td>
<td>${row.savedEvaluation.conditionIntegrityPassed ? "原文対応・隣接表示を検証済み" : "検証不合格"}<br>${h(row.conditionCase.blocks.filter(block => block.tier === "mandatory").map(block => kind[block.kind]).filter((value, index, all) => all.indexOf(value) === index).join("・"))}</td>
<td>${h([...row.bodyReview.unsupportedClaims, ...row.bodyReview.contradictions].join("／") || "今回の本文照合で重大な未支持・矛盾は未検出。省略条件・過去判定・未承認状態は別途保持。")}</td></tr>`).join("")}
</tbody></table></div><p class="service-notice">条件表示の検証成功は、モデル単体の合格、個人への適用、資料採用・公開の承認を意味しません。</p>
${data.cases.map(savedPanel).join("")}
<details><summary>さらに前のQ05初回評価も変更せず保持</summary>
<p>判定：${h(data.originalQ05.review.verdict)}。計算費用：$${(data.originalQ05.measuredMicroUSD / 1e6).toFixed(6)}。今回の表示方式で再採点していません。</p>
<pre>${h(data.originalQ05.rawResult.outputText)}</pre></details></section>
<section class="section" id="proposal"><p class="eyebrow">PROPOSAL / 今後の一般向け回答のみ</p><h2>評価項目を3種類に分ける案</h2>
<p>数値の要否は、回答を見る前に質問に応じて固定します。詳細数値を折りたたんでも、結論を左右する意味は落としません。</p>
<div class="proposal-grid">${data.proposal.layers.map(layer => `<article class="proposal-card"><h3>${h(layer.label)}</h3>
<p>${h(layer.rule)}</p>${list(layer.items)}</article>`).join("")}</div>
<p class="review-note">数値を求めた過去の設問の採点は緩めません。この案は未採用であり、過去のrubric・不合格判定の変更には使いません。</p></section>
<section class="section"><h2>検証の境界と未解決事項</h2>
<div class="verify">${data.preservation.protectedFiles}件の既存ファイルをハッシュ照合。Q05〜Q11の生回答・判定・原文・費用、既存ゲートは変更なし。追加API送信0。</div>
<ul><li>未確認・不適合時の個別助言は停止。架空の「一致」でも既存ゲートや承認を解除しません。</li>
<li>本文・条件データが変わると、ハッシュに結び付けた意味照合記録は無効になります。未知の文章の矛盾を網羅的に自動検出する仕組みではありません。</li>
<li>Q06の「合計」、Q09の尺度利用割合、Q10の個人年齢範囲への推測は、条件表示では修正されません。</li>
<li>AASM本文の収録・権利条件、日本への適用、資料採用・公開承認、実利用者への適用は未解決です。</li>
<li>通常相談経路・既存DB・実利用者情報・本番公開は変更していません。元の不合格回答は検証専用です。</li></ul></section>
<footer>計算費用は保存済み利用量に基づくもので、請求確定額ではありません。画面は外部リソース不要の自己完結HTMLです。</footer>
</main><script>
const caseButtons=[...document.querySelectorAll('[data-case-button]')];
function activate(id){caseButtons.forEach(b=>b.setAttribute('aria-selected',String(b.dataset.caseButton===id)));
document.querySelectorAll('.case-panel').forEach(p=>p.hidden=p.dataset.case!==id);}
caseButtons.forEach(b=>b.addEventListener('click',()=>activate(b.dataset.caseButton)));
document.querySelectorAll('.case-panel').forEach(panel=>{
const applicability=panel.querySelector('.applicability'),mode=panel.querySelector('.display-mode');
function update(){const individual=mode.value==='individual';
panel.querySelector('.background-content').hidden=individual;panel.querySelector('.blocked-answer').hidden=!individual;
const messages={unknown:'対象条件は未確認です。必要な確認が終わるまで、個別助言は表示しません。',
mismatched:'対象条件が不適合です。この研究を根拠にした個別助言は表示しません。',
matched:'条件が一致するという架空の仮定でも、既存ゲートと採用・公開承認は未通過です。個別助言は表示しません。'};
panel.querySelector('.gate-state').textContent=messages[applicability.value];}
applicability.addEventListener('change',update);mode.addEventListener('change',update);update();});
document.querySelectorAll('.source-link').forEach(link=>link.addEventListener('click',event=>{
event.preventDefault();const target=document.getElementById(link.hash.slice(1));if(!target)return;
const panel=target.closest('.case-panel');if(panel)activate(panel.dataset.case);
let ancestor=target.parentElement;while(ancestor){if(ancestor.tagName==='DETAILS')ancestor.open=true;ancestor=ancestor.parentElement;}
if(panel){panel.querySelector('.display-mode').value='background';panel.querySelector('.display-mode').dispatchEvent(new Event('change'));}
target.scrollIntoView({behavior:'smooth',block:'start'});}));
</script></body></html>`;
verifyHistory();
fs.writeFileSync(path.join(outputDirectory, "conditions-and-body.html"), html);
console.log("evidence-work/condition-display-offline/conditions-and-body.html");