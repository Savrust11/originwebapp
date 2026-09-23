#!/usr/bin/env node
// Read-only report renderer for the new six-case run. Missing results remain
// visibly pending; this renderer never invents an answer or verdict.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASE_IDS, RUN_ID, digest } from "./display.mjs";
import {
  BASELINE_SPEND_MICRO_USD, CUMULATIVE_TRANSMISSION_CEILING,
  summarizeAccounting,
} from "./accounting.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const base = path.join(root, "evidence-work/general-audience-evaluation", RUN_ID);
const prep = path.join(base, "preparation");
const results = path.join(base, "results");
const appDisplays = path.join(base, "app-displays");
const reviews = path.join(base, "reviews");
const output = path.join(base, "general-audience-results.html");
const h = value => String(value ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const read = file => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};
const safeUrl = value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};
const money = value => Number.isSafeInteger(value)
  ? `$${(value / 1_000_000).toFixed(6)} (${value.toLocaleString("ja-JP")} µUSD)`
  : "未確定";
export function accountingPresentation(ledger) {
  const summary = ledger ? summarizeAccounting(ledger) : {
    cumulativeTransmissions: 13,
    knownCostMicroUSD: BASELINE_SPEND_MICRO_USD,
    usageKnown: true,
    reservedUnknownMicroUSD: 0,
    displayMeasuredTotalMicroUSD: BASELINE_SPEND_MICRO_USD,
  };
  return {
    ...summary,
    transmissionLabel:
      `${summary.cumulativeTransmissions} / ${CUMULATIVE_TRANSMISSION_CEILING}通信`,
    measuredTotalLabel: summary.displayMeasuredTotalMicroUSD === null
      ? "利用量未確定・総額算出停止"
      : money(summary.displayMeasuredTotalMicroUSD),
  };
}
const idOf = item => item?.caseId ?? item?.case_id;
const baseIdOf = item => item?.baseCaseId ?? item?.base_case_id;
const readPayload = preparedCase => {
  const direct = preparedCase?.payload;
  if (direct && typeof direct === "object") return direct;
  for (const item of preparedCase?.request?.input ?? []) {
    if (typeof item?.content !== "string") continue;
    try {
      const parsed = JSON.parse(item.content);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return null;
};
const originalsOf = (preparedCase, payload) =>
  preparedCase?.originalEvidence ?? preparedCase?.original_evidence
  ?? payload?.original_evidence ?? payload?.originalEvidence ?? [];
const catalogValue = value => value?.catalog ?? value ?? {};
const reviewVerdict = (review, key) => review?.[key] ?? null;
const verdictLabel = value => value === "pass" ? "合格"
  : value === "fail" || value === "stop" ? "不合格" : "評価待ち";
const verdictClass = value => value === "pass" ? "pass"
  : value === "fail" || value === "stop" ? "fail" : "pending";
const list = values => `<ul>${(values ?? []).map(value => `<li>${h(
  typeof value === "string" ? value : JSON.stringify(value))}</li>`).join("")
  || "<li>記録なし</li>"}</ul>`;

function priorRows() {
  const ledger = read(path.join(root, "evidence-work/model-evaluation/api-call-ledger.json"));
  const map = new Map();
  for (const entry of ledger?.entries ?? []) if (entry.caseId) map.set(entry.caseId, entry);
  return map;
}
function currentLedger() {
  for (const name of ["run-ledger.json", "ledger.json"]) {
    const value = read(path.join(base, name));
    if (value) return value;
  }
  return null;
}
function sourceMetadata(catalog, id) {
  return catalog?.[id] ?? {};
}
function renderOriginals(row, catalog) {
  if (!Array.isArray(row.originals) || !row.originals.length)
    return '<p class="missing">送信前原文はまだ準備されていません。</p>';
  return row.originals.map((original, index) => {
    const id = original.original_id ?? original.originalId ?? original.id;
    const text = original.original_text ?? original.originalText ?? original.text;
    const meta = sourceMetadata(catalog, id);
    const url = safeUrl(meta.url);
    return `<article class="source" id="${h(row.caseId)}-source-${h(id)}">
      <h4>原文${index + 1}：<code>${h(id)}</code></h4>
      <dl><div><dt>資料</dt><dd>${h(meta.title ?? original.title ?? "未記録")}</dd></div>
      <div><dt>版</dt><dd>${h(meta.version ?? original.version ?? "未記録")}</dd></div>
      <div><dt>該当箇所</dt><dd>${h(meta.locator ?? original.locator ?? "未記録")}</dd></div>
      <div><dt>URL</dt><dd>${url ? `<a href="${h(url)}">${h(url)}</a>` : "未記録"}</dd></div></dl>
      <pre class="original">${h(text ?? "原文未記録")}</pre></article>`;
  }).join("");
}
function block(block, caseId) {
  const supports = block.supports.map(support =>
    `<a href="#source-${h(caseId)}-${h(support.originalId)}-${support.quoteStart}-${support.quoteEnd}"><code>${h(
      support.originalId)}:${support.quoteStart}-${support.quoteEnd}</code></a>`)
    .join("、");
  return `<li data-condition-block="${h(block.id)}"><strong>${h(block.text)}</strong>
    <small>${h(block.kind)} / ${h(block.tier)} / 支持原文：${supports}</small></li>`;
}
function sourceSupports(supports, caseId) {
  return (supports ?? []).map(support => `<article class="source-support"
    id="source-${h(caseId)}-${h(support.originalId)}-${support.quoteStart}-${support.quoteEnd}"
    data-original-id="${h(support.originalId)}" data-quote-start="${support.quoteStart}"
    data-quote-end="${support.quoteEnd}">
    <h4>${h(support.title)}</h4><dl><div><dt>原文ID</dt><dd><code>${h(support.originalId)}</code></dd></div>
    <div><dt>版</dt><dd>${h(support.version)}</dd></div><div><dt>該当箇所</dt><dd>${h(support.locator)}</dd></div>
    <div><dt>SHA-256</dt><dd><code>${h(support.originalTextSha256)}</code></dd></div></dl>
    <blockquote>${h(support.quote)}</blockquote></article>`).join("");
}
function displayClaims(row) {
  const display = row.display;
  if (!display?.rawAnswer)
    return `<p class="missing">モデル回答またはアプリ表示は未作成です。状態：${h(
      display?.noAnswerReason ?? responseState(row))}</p>`;
  return `<div class="claim-list">${display.appDisplay.claims.map(claim =>
    `<article class="claim" data-section="${h(claim.section)}" data-index="${claim.index}">
      <p class="claim-type">${h(claim.section)} ${claim.index + 1}</p><p>${h(claim.text)}</p>
      <aside class="conditions"><h4>アプリが隣接表示する必須条件・限界</h4>
      <ul>${claim.blocks.map(item => block(item, row.caseId)).join("")}</ul>
      <p class="caution">この表示は本文の意味を訂正・合格保証しません。</p></aside></article>`).join("")}</div>
    <details class="research-details"><summary>質問に応じて必須の詳しい研究情報</summary>
      <ul>${display.appDisplay.researchDetails.map(item => block(item, row.caseId)).join("")
        || "<li>このケースで別に分類された詳細はありません。</li>"}</ul></details>
    <details><summary>任意の背景情報</summary><ul>${display.appDisplay.optionalBackground.map(item => block(item, row.caseId)).join("")
      || "<li>任意情報なし</li>"}</ul></details>
    <details class="support-details"><summary>アプリ表示を支える原文・版・該当箇所</summary>
      ${sourceSupports(display.appDisplay.sourceSupports, row.caseId)}</details>`;
}
function resultUsage(result) {
  const usage = result?.usage;
  return usage ? `input ${h(usage.input_tokens)} / output ${h(usage.output_tokens)}
    （reasoning ${h(usage.output_tokens_details?.reasoning_tokens)}）` : "未確定";
}
function responseState(row) {
  if (row.result) return row.result.status
    ?? "応答状態未確定（送信記録あり）";
  if (row.entry) return `送信台帳あり・結果未保存（${row.entry.state ?? "状態未記録"}）`;
  return "未送信（台帳エントリなし）";
}
function caseCard(row, catalog) {
  const body = reviewVerdict(row.review, "bodyVerdict");
  const app = reviewVerdict(row.review, "appVerdict");
  const screen = reviewVerdict(row.review, "screenVerdict");
  return `<article class="case" id="${h(row.caseId)}">
    <header class="case-head"><div><p class="eyebrow">${h(row.caseId)} / ${h(row.baseCaseId)}</p>
      <h2>${h(row.question ?? "質問準備待ち")}</h2></div>
      <span class="badge ${verdictClass(screen)}">画面全体：${verdictLabel(screen)}</span></header>
    <section class="past"><strong>過去のモデル単体判定（変更なし）：</strong>
      <span class="badge ${verdictClass(row.priorVerdict)}">${verdictLabel(row.priorVerdict)}</span>
      <small>新しいケースの判定とは別記録です。</small></section>
    <div class="layers"><section class="panel raw-panel"><h3>モデルの生回答</h3>
      <pre class="raw-answer">${h(row.result?.outputText ?? (row.entry
        ? "送信台帳はありますが結果未保存です（回答を推測しません）"
        : "未送信（台帳エントリなし。回答を推測しません）"))}</pre>
      <p>応答状態：${h(responseState(row))} ／ 利用量：${resultUsage(row.result)}
      ／ 計算費用：${money(row.result?.measuredMicroUSD)}</p></section>
      <section class="panel app-panel"><h3>アプリが補った表示</h3>
      ${displayClaims(row)}${list(row.display?.notices)}</section></div>
    <section class="grades"><h3>層別の判定</h3><div class="grade-grid">
      <div><span class="badge ${verdictClass(body)}">本文単体：${verdictLabel(body)}</span>
        <p>出典カードとは独立して、数値・否定・不確実性・矛盾を原文と比較。</p></div>
      <div><span class="badge ${verdictClass(app)}">アプリ表示：${verdictLabel(app)}</span>
        <p>必須条件、支持原文、版・箇所、本文への隣接を検査。</p></div>
      <div><span class="badge ${verdictClass(screen)}">画面全体：${verdictLabel(screen)}</span>
        <p>本文と表示の両方が合格し、矛盾がない場合だけ合格。</p></div></div>
      <p><strong>評価者：</strong>${h(row.review?.checkedBy ?? "AI評価待ち")}
      ${row.review ? "（AIによる原文比較。人による採用審査・臨床評価ではありません）" : ""}</p>
      <h4>総合所見</h4>${list(row.review?.findings)}
      <div class="compare"><div><h4>過去の問題が再発したか</h4>${list(row.review?.recurrence)}</div>
      <div><h4>新たに発生した問題</h4>${list(row.review?.newIssues)}</div></div></section>
    <details class="originals"><summary>実際に送信した対応原文</summary>${renderOriginals(row, catalog)}</details>
    <details><summary>送信前に固定した期待要点・禁止事項・採点基準</summary>
      <h4>必須の期待要点</h4>${list(row.rubric?.adoptedClassification?.mandatory?.body)}
      <h4>質問に応じて必須の期待要点</h4>${list(row.rubric?.adoptedClassification?.conditional)}
      <h4>禁止事項</h4>${list(row.rubric?.forbiddenContent)}
      <h4>採点基準</h4><pre>${h(JSON.stringify(row.rubric ?? {}, null, 2))}</pre></details>
    <details><summary>受信結果・表示・レビューのraw JSON</summary>
      <h4>result</h4><pre>${h(JSON.stringify(row.result, null, 2))}</pre>
      <h4>app display</h4><pre>${h(JSON.stringify(row.display, null, 2))}</pre>
      <h4>review</h4><pre>${h(JSON.stringify(row.review, null, 2))}</pre></details></article>`;
}

function main() {
  const prepared = read(path.join(prep, "prepared-package.json")) ?? { requests: [] };
  const catalog = catalogValue(read(path.join(prep, "catalog.json")));
  const rubric = read(path.join(prep, "rubric.json")) ?? {};
  const requests = new Map((prepared.requests ?? []).map(item => [idOf(item), item]));
  const old = priorRows();
  const ledger = currentLedger();
  const entries = new Map((ledger?.entries ?? []).map(entry => [entry.caseId, entry]));
  const rows = CASE_IDS.map(caseId => {
    const preparedCase = requests.get(caseId);
    const baseCaseId = baseIdOf(preparedCase) ?? caseId.slice(2);
    const payload = readPayload(preparedCase);
    const result = read(path.join(results, `${caseId}.json`));
    const display = read(path.join(appDisplays, `${caseId}.json`));
    const review = read(path.join(reviews, `${caseId}.json`))
      ?? entries.get(caseId)?.review ?? null;
    if (display && result) {
      const bytes = fs.readFileSync(path.join(results, `${caseId}.json`));
      if (display.responseFileSha256 !== digest(bytes))
        throw new Error(`REPORT_RESPONSE_DISPLAY_BINDING_CHANGED:${caseId}`);
    }
    const prior = old.get(baseCaseId);
    return { caseId, baseCaseId, preparedCase, payload, entry: entries.get(caseId) ?? null,
      question: preparedCase?.question ?? payload?.question,
      originals: originalsOf(preparedCase, payload), result, display, review,
      rubric: rubric.cases?.[caseId], priorVerdict: prior?.review?.verdict ?? null };
  });
  const accounting = accountingPresentation(ledger);
  const bodyPass = rows.filter(row => row.review?.bodyVerdict === "pass").map(row => row.caseId);
  const appPass = rows.filter(row => row.review?.appVerdict === "pass").map(row => row.caseId);
  const screenPass = rows.filter(row => row.review?.screenVerdict === "pass").map(row => row.caseId);
  const pending = rows.filter(row => !row.review).map(row => row.caseId);
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>新しい一般向け表示方式・6ケース再評価</title>
    <style>
    :root{--ink:#17312b;--muted:#5a6d67;--paper:#fff;--wash:#f1f5f1;--line:#cbd8ce;
      --accent:#145b4b;--good:#17633e;--bad:#982e3d;--warn:#845300;font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif}
    *{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);line-height:1.7}
    main{max-width:1480px;margin:auto;padding:clamp(16px,3vw,42px)}h1,h2,h3,h4{line-height:1.35}
    h1{font-size:clamp(2rem,4vw,3.4rem);margin:.2em 0}.eyebrow{font-size:.75rem;letter-spacing:.13em;
      color:var(--accent);font-weight:800;text-transform:uppercase}.lede,small,.note{color:var(--muted)}
    .boundary,.summary,.case,.frozen{background:var(--paper);border:1px solid var(--line);border-radius:13px;
      padding:clamp(16px,2.4vw,28px);margin:20px 0}.boundary{border-left:7px solid var(--warn)}
    .stats,.grade-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
    .stat,.grade-grid>div{background:var(--wash);padding:12px;border-radius:7px}.stat strong{display:block;font-size:1.1rem}
    .case-head{display:flex;justify-content:space-between;gap:14px;align-items:start;border-bottom:2px solid var(--ink)}
    .badge{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:4px 11px;font-weight:800;white-space:nowrap}
    .pass{color:var(--good)}.fail,.missing{color:var(--bad)}.pending{color:var(--warn)}
    .past{padding:12px;background:#fff8e8;margin:14px 0}.past small{display:block}
    .layers{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}.panel{border:1px solid var(--line);
      border-radius:8px;padding:16px;min-width:0}.raw-answer,.original{white-space:pre-wrap;overflow-wrap:anywhere;
      word-break:break-word;background:#eef5f1;padding:14px;font:12px/1.6 ui-monospace,monospace}
    .claim{padding:13px;background:#f8faf7;margin:12px 0}.claim-type{font-size:.75rem;text-transform:uppercase;
      color:var(--muted);font-weight:800}.conditions{border:2px solid var(--accent);background:#edf7f2;padding:12px}
    .conditions h4{margin:0}.conditions small,.source-support small{display:block}.caution{font-size:.8rem;color:var(--bad)}
    .source-support,.source{border-bottom:1px solid var(--line);padding:12px 0}.source-support dl,.source dl{display:grid;
      grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px}.source-support dl div,.source dl div{background:var(--wash);padding:8px}
    dt{font-weight:750}dd{margin:0;overflow-wrap:anywhere}blockquote{white-space:pre-wrap;border-left:4px solid var(--line);
      margin:10px 0;padding:10px;overflow-wrap:anywhere}.grades{border-top:2px solid var(--line);margin-top:18px;padding-top:15px}
    .compare{display:grid;grid-template-columns:1fr 1fr;gap:14px}.compare>div{background:var(--wash);padding:10px}
    details{margin:14px 0;border-top:1px solid var(--line);padding-top:12px}summary{cursor:pointer;font-weight:800}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:var(--wash);padding:12px;max-height:650px;overflow:auto}
    .table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:850px}th,td{padding:10px;
      border:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--wash)}
    nav ul{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}nav a{border:1px solid var(--line);padding:5px 10px;border-radius:5px}
    a{color:#075f82;overflow-wrap:anywhere}code,li{overflow-wrap:anywhere;word-break:break-word}
    @media(max-width:820px){.layers,.compare{grid-template-columns:1fr}.case-head{flex-direction:column}.badge{white-space:normal}}
    @media print{body{background:#fff}main{max-width:none;padding:0}.case{break-inside:avoid}.layers{grid-template-columns:1fr 1fr}details>*{display:block!important}}
    </style></head><body><main>
    <header><p class="eyebrow">general audience evaluation / ${RUN_ID}</p>
      <h1>本文と条件表示を分けて採点する<br>6ケース再評価</h1>
      <p class="lede">同じモデルに一般的な読解規則を与え、モデル本文、アプリの確認済み条件表示、画面全体を別々に評価します。</p></header>
    <section class="boundary"><h2>この評価の境界</h2><ul>
      <li>過去の試験結果・生回答・原文・費用・評価基準・不合格判定は変更しません。</li>
      <li>確認済み条件カードはモデル本文ではなく、本文の誤りや矛盾を合格にしません。</li>
      <li>今回採用した必須／質問に応じて必須／任意の分類は新ケースだけに適用し、過去を再採点しません。</li>
      <li>採点者はAIによる原文比較（${REVIEWER_TEXT}）。人による採用審査・臨床評価とは異なります。</li>
      <li>個別助言は無効です。対象適合を自由記述から推測せず、アプリ表示と矛盾する個別化は不合格です。</li>
    </ul></section>
    <section class="summary"><h2>実行状況</h2><div class="stats">
      <div class="stat"><strong>${h(accounting.transmissionLabel)}</strong><small>20回目は使用禁止</small></div>
      <div class="stat" id="accounting-total" data-usage-known="${accounting.usageKnown}">
        <strong>${h(accounting.measuredTotalLabel)}</strong>
        <small>累計計算費用（既知額 ${h(money(accounting.knownCostMicroUSD))}；
        利用量未確定分の予約上限 ${h(money(accounting.reservedUnknownMicroUSD))}）</small></div>
      <div class="stat"><strong>$1.000000</strong><small>累計運用予算・同時実行1・再試行0</small></div>
      <div class="stat"><strong>${h(pending.join("、") || "なし")}</strong><small>評価待ち</small></div>
      <div class="stat"><strong>${h(bodyPass.join("、") || "なし")}</strong><small>本文単体 合格</small></div>
      <div class="stat"><strong>${h(appPass.join("、") || "なし")}</strong><small>アプリ表示 合格</small></div>
      <div class="stat"><strong>${h(screenPass.join("、") || "なし")}</strong><small>画面全体 合格</small></div>
    </div><p class="note">利用量が未確定の通信を0円として補いません。請求確定額ではなく、保存されたusageによる運用計算です。</p></section>
    <nav><h2>ケース</h2><ul>${rows.map(row => `<li><a href="#${h(row.caseId)}">${h(row.caseId)}</a></li>`).join("")}
      <li><a href="#frozen">送信前固定資料</a></li></ul></nav>
    ${rows.map(row => caseCard(row, catalog)).join("\n")}
    <section class="frozen" id="frozen"><h2>送信前に固定した資料</h2>
      <p>質問、期待要点、禁止事項、使用原文、三層の採点基準です。モデル入力には採点表・人が編集した模範回答を含めません。</p>
      <details><summary>prepared-package.json</summary><pre>${h(JSON.stringify(prepared, null, 2))}</pre></details>
      <details><summary>rubric.json</summary><pre>${h(JSON.stringify(rubric, null, 2))}</pre></details></section>
    <footer><p>本レポートは保存済み評価成果物のみを表示する自己完結HTMLです。外部リソースを読み込みません。</p></footer>
    </main></body></html>`;
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(output, html);
  console.log(path.relative(root, output));
}
const REVIEWER_TEXT = "agent-source-comparison-not-clinical-review";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();