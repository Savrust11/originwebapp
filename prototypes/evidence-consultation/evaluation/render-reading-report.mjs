#!/usr/bin/env node

/**
 * Offline renderer for the isolated source-reading evaluation.
 *
 * This file deliberately has no transport, database, secret, or runner code. It
 * reads only workspace-local evaluation artifacts and writes one self-contained
 * HTML report.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "../../..");
const evaluationDirectory = path.join(workspaceRoot, "evidence-work/model-evaluation");
const ledgerPath = path.join(evaluationDirectory, "api-call-ledger.json");
const payloadsPath = path.join(evaluationDirectory, "local-token-payloads.json");
const outputPath = path.join(evaluationDirectory, "isolated-reading-results.html");
const expectedCaseIds = Array.from({ length: 11 }, (_, index) =>
  `Q${String(index + 1).padStart(2, "0")}`);

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const present = (value) =>
  value !== undefined && value !== null && value !== "";

const textOrMissing = (value, label = "データなし（0ではありません）") =>
  present(value) ? escapeHtml(value) : `<span class="missing">${escapeHtml(label)}</span>`;

const integerOrMissing = (value) =>
  Number.isSafeInteger(value) && value >= 0
    ? escapeHtml(value.toLocaleString("ja-JP"))
    : '<span class="missing">欠測（0ではありません）</span>';

const readJson = async (filePath) => {
  try {
    return { value: JSON.parse(await readFile(filePath, "utf8")), error: null };
  } catch (error) {
    const message = error?.code === "ENOENT"
      ? "ファイルがありません"
      : `読み込みまたはJSON解析に失敗: ${error instanceof Error ? error.message : String(error)}`;
    return { value: null, error: message };
  }
};

const responsePathInsideWorkspace = (relativePath) => {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
};

const parseSentUserContent = (requestRecord) => {
  const input = requestRecord?.request?.input;
  if (!Array.isArray(input)) return { value: null, error: "request.input がありません" };
  const userPart = input.find((item) => item?.role === "user");
  if (!present(userPart?.content)) return { value: null, error: "送信済み user content がありません" };
  if (typeof userPart.content !== "string") {
    return { value: null, error: "送信済み user content が文字列ではありません" };
  }
  try {
    const parsed = JSON.parse(userPart.content);
    return isObject(parsed)
      ? { value: parsed, error: null }
      : { value: null, error: "送信済み user content がJSON objectではありません" };
  } catch (error) {
    return {
      value: null,
      error: `送信済み user content のJSON解析に失敗: ${
        error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const formatMicroUsd = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    return '<span class="missing">欠測（$0ではありません）</span>';
  }
  return `${escapeHtml(`$${(value / 1_000_000).toFixed(6)}`)}
    <span class="subtle">（${escapeHtml(value.toLocaleString("ja-JP"))} µUSD）</span>`;
};

const rawValue = (value) => {
  if (!present(value)) return '<span class="missing">データなし</span>';
  if (typeof value === "string") return escapeHtml(value);
  return escapeHtml(JSON.stringify(value));
};

const renderDefinitionRows = (rows) => rows.map(([term, description]) =>
  `<div class="datum"><dt>${escapeHtml(term)}</dt><dd>${description}</dd></div>`).join("");

const usageValue = (usage, camelName, snakeName) =>
  usage?.[camelName] ?? usage?.[snakeName];

const nestedUsageValue = (usage, parentCamel, parentSnake, childCamel, childSnake) => {
  const parent = usage?.[parentCamel] ?? usage?.[parentSnake];
  return parent?.[childCamel] ?? parent?.[childSnake];
};

const renderUsage = (response) => {
  const usage = isObject(response?.usage) ? response.usage : null;
  const inputTokens = usageValue(usage, "inputTokens", "input_tokens");
  const outputTokens = usageValue(usage, "outputTokens", "output_tokens");
  const totalTokens = usageValue(usage, "totalTokens", "total_tokens");
  const reasoningTokens = nestedUsageValue(
    usage, "outputTokensDetails", "output_tokens_details", "reasoningTokens", "reasoning_tokens");
  const cachedTokens = nestedUsageValue(
    usage, "inputTokensDetails", "input_tokens_details", "cachedTokens", "cached_tokens");
  const cacheWriteTokens = nestedUsageValue(
    usage, "inputTokensDetails", "input_tokens_details", "cacheWriteTokens", "cache_write_tokens");
  return `<dl class="data-grid">${renderDefinitionRows([
    ["入力 tokens", integerOrMissing(inputTokens)],
    ["出力 tokens", integerOrMissing(outputTokens)],
    ["cache write tokens", integerOrMissing(cacheWriteTokens)],
    ["cached read tokens", integerOrMissing(cachedTokens)],
    ["reasoning tokens（出力内数）", integerOrMissing(reasoningTokens)],
    ["total tokens", integerOrMissing(totalTokens)],
  ])}</dl>
  <p class="subtle">公式usageフィールドをそのまま集計表示しています。reasoning tokens は
    output tokens の内数であり、加算しません。cache write / cached read も input tokens の内数です。
    reasoning は使用量のみ表示し、内容は表示しません。</p>`;
};

const calculateExactMicroUsd = (response) => {
  const usage = isObject(response?.usage) ? response.usage : null;
  const input = usageValue(usage, "inputTokens", "input_tokens");
  const output = usageValue(usage, "outputTokens", "output_tokens");
  const cacheWrite = nestedUsageValue(
    usage, "inputTokensDetails", "input_tokens_details", "cacheWriteTokens", "cache_write_tokens");
  const cachedRead = nestedUsageValue(
    usage, "inputTokensDetails", "input_tokens_details", "cachedTokens", "cached_tokens");
  if (![input, output, cacheWrite, cachedRead].every((value) =>
    Number.isSafeInteger(value) && value >= 0) || cacheWrite + cachedRead > input) return null;
  const uncached = input - cacheWrite - cachedRead;
  // µUSD/token: uncached .2, cache write .25, cached read .02, output 1.2.
  return uncached * 0.2 + cacheWrite * 0.25 + cachedRead * 0.02 + output * 1.2;
};

const formatExactMicroUsd = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${escapeHtml(`$${(value / 1_000_000).toFixed(7)}`)}
       <span class="subtle">（${escapeHtml(value.toFixed(1))} µUSD、切り上げ前）</span>`
    : '<span class="missing">算出不能（$0ではありません）</span>';

const renderEstimate = (generation) => {
  const estimate = generation?.estimate;
  return `<dl class="data-grid">${renderDefinitionRows([
    ["ローカルJSON tokens", integerOrMissing(estimate?.localJsonTokens)],
    ["推定入力 tokens", integerOrMissing(estimate?.estimatedInputTokens)],
    ["出力上限 tokens", integerOrMissing(estimate?.outputCapTokens)],
    ["推定費用", formatMicroUsd(estimate?.estimatedMicroUSD)],
  ])}</dl>`;
};

const renderReview = (generation) => {
  const review = generation?.review;
  if (!isObject(review)) {
    return `<section class="review not-reviewed" aria-label="批判的エージェントレビュー">
      <h4>批判的エージェントレビュー</h4>
      <p class="missing">未レビューです。欠落、条件、例外、根拠のない主張がないことを意味しません。</p>
    </section>`;
  }
  const validVerdict = review.verdict === "acceptable" || review.verdict === "stop";
  const validChecker =
    review.checkedBy === "agent-source-comparison-not-clinical-review";
  const findings = Array.isArray(review.findings) ? review.findings : null;
  return `<section class="review ${review.verdict === "stop" ? "review-stop" : ""}"
      aria-label="批判的エージェントレビュー">
    <h4>批判的エージェントレビュー：欠落・条件・例外・根拠のない主張</h4>
    <dl class="data-grid">${renderDefinitionRows([
      ["判定", validVerdict ? `<strong>${escapeHtml(review.verdict)}</strong>`
        : '<span class="missing">不正または欠測</span>'],
      ["確認者区分", validChecker ? escapeHtml(review.checkedBy)
        : '<span class="missing">所定の確認者区分が欠測または不一致</span>'],
    ])}</dl>
    ${findings === null
      ? '<p class="missing">findings が欠測しています。</p>'
      : findings.length === 0
        ? '<p>記録された指摘はありません（臨床レビュー済みという意味ではありません）。</p>'
        : `<ul>${findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>`}
    <p class="subtle">これは資料原文とのエージェント比較であり、臨床レビューではありません。</p>
  </section>`;
};

const renderAutomatedChecks = (response) => {
  const checks = response?.automatedChecks;
  if (!isObject(checks)) {
    return '<p class="missing">自動チェック結果は欠測しています。</p>';
  }
  const issues = Array.isArray(checks.issues) ? checks.issues : null;
  return `<p><strong>passed:</strong> ${
    typeof checks.passed === "boolean"
      ? escapeHtml(String(checks.passed))
      : '<span class="missing">欠測</span>'
  }</p>
  ${issues === null
    ? '<p class="missing">issues は欠測しています。</p>'
    : issues.length === 0
      ? "<p>記録された自動チェック issue はありません。</p>"
      : `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`}
  <p class="subtle">自動チェック通過は、資料忠実性や臨床的妥当性の人手確認を代替しません。</p>`;
};

const renderCitations = (sentContent) => {
  const context = sentContent?.source_context;
  const citations = Array.isArray(context?.citations) ? context.citations : null;
  if (citations === null) {
    return '<p class="missing">送信コンテキストの citations が欠測しています。</p>';
  }
  if (citations.length === 0) {
    return '<p class="missing">送信コンテキストの citations は空です。</p>';
  }
  return citations.map((citation, index) => `<article class="citation">
    <h5>必須抜粋 ${index + 1}: ${textOrMissing(citation?.section_id)}</h5>
    <dl class="citation-meta">${renderDefinitionRows([
      ["source_id", textOrMissing(citation?.source_id)],
      ["version", textOrMissing(citation?.version)],
      ["revision_date", textOrMissing(citation?.revision_date)],
      ["version_of_record_date", textOrMissing(citation?.version_of_record_date)],
      ["section_id", textOrMissing(citation?.section_id)],
      ["locator", textOrMissing(citation?.locator)],
      ["source_annotation", textOrMissing(citation?.source_annotation)],
    ])}</dl>
    ${present(citation?.original_text)
      ? `<pre class="source-text">${escapeHtml(citation.original_text)}</pre>`
      : '<p class="missing">original_text が欠測しています（空文ではありません）。</p>'}
  </article>`).join("");
};

const renderSourceNotes = (sentContent) => {
  const notes = sentContent?.source_context?.source_notes;
  if (!Array.isArray(notes)) {
    return '<p class="missing">source_notes が欠測しています。</p>';
  }
  if (notes.length === 0) return "<p>送信された source_notes は空です。</p>";
  return notes.map((note, index) => `<details>
    <summary>送信された資料注記 ${index + 1}${present(note?.unit_id)
      ? ` — ${escapeHtml(note.unit_id)}` : ""}</summary>
    <pre class="structured">${escapeHtml(JSON.stringify(note, null, 2))}</pre>
  </details>`).join("");
};

const loadResponse = async (generation) => {
  if (!generation) return { value: null, error: "このケースの generation ledger entry がありません" };
  const resolved = responsePathInsideWorkspace(generation.responseFile);
  if (!resolved) {
    return {
      value: null,
      error: "responseFile が欠測、絶対パス、またはワークスペース外を指しています",
    };
  }
  return readJson(resolved);
};

const statusLabel = (caseId, generation, response, responseError) => {
  if (!generation) return ["未実行", "status-missing"];
  if (responseError) return ["応答データ欠測／読込不能", "status-incomplete"];
  if (!isObject(response)) return ["応答データ不正", "status-incomplete"];
  if (generation.state === "stopped" && response.caseId === caseId
    && response.status === "completed" && isObject(response.answer)) {
    return ["出典照合で停止（回答は完結）", "status-stopped"];
  }
  if (response.caseId !== caseId || response.status !== "completed"
    || !isObject(response.answer)) {
    return ["未完了応答（完成回答ではない）", "status-incomplete"];
  }
  return ["完成回答あり", "status-complete"];
};

const renderAnswerCitations = (response) => {
  if (!isObject(response?.answer)) {
    return '<p class="missing">parsed answer がないため、回答内 citations を表示できません。</p>';
  }
  if (!Array.isArray(response.answer.citations)) {
    return '<p class="missing">回答内 citations が欠測または不正です。</p>';
  }
  return `<pre class="answer-citations">${escapeHtml(
    JSON.stringify(response.answer.citations, null, 2))}</pre>`;
};

const renderCase = ({ caseId, requestRecord, sent, generation, responseResult }) => {
  if (!generation) {
    return `<article class="case-card" id="${escapeHtml(caseId)}">
      <h2>${escapeHtml(caseId)} — 未送信・未評価</h2>
      <p>停止条件を適用したため、この問は送信していません。回答・利用実績・読解品質の評価はありません。</p>
      <h3>準備済みの質問（未送信）</h3>
      <p>${escapeHtml(sent.value?.question ?? "質問データなし")}</p></article>`;
  }
  const response = responseResult.value;
  const [completionLabel, completionClass] =
    statusLabel(caseId, generation, response, responseResult.error);
  const question = sent.value?.question;
  const responseCaseMismatch = response && response.caseId !== caseId;
  const modelOutput = typeof response?.outputText === "string"
    ? `<pre class="model-output">${escapeHtml(
      typeof response.answer?.answer_ja === "string" ? response.answer.answer_ja : response.outputText)}</pre>
      <details><summary>受信したJSONテキストをそのまま表示</summary>
      <pre class="answer-citations">${escapeHtml(response.outputText)}</pre></details>`
    : '<p class="missing">outputText が欠測しています。完成した回答が空だったとは扱いません。</p>';

  return `<article class="case-card" id="${escapeHtml(caseId)}">
    <header class="case-header">
      <div><p class="eyebrow">ケース</p><h2>${escapeHtml(caseId)}</h2></div>
      <span class="status ${completionClass}">${escapeHtml(completionLabel)}</span>
    </header>
    <section aria-labelledby="${escapeHtml(caseId)}-question">
      <h3 id="${escapeHtml(caseId)}-question">送信された質問</h3>
      ${present(question)
        ? `<p class="question">${escapeHtml(question)}</p>`
        : `<p class="missing">${escapeHtml(sent.error ?? "question が欠測しています。")}</p>`}
    </section>

    <div class="comparison">
      <section class="compare-panel answer-panel" aria-labelledby="${escapeHtml(caseId)}-answer">
        <h3 id="${escapeHtml(caseId)}-answer">モデル応答（verbatim）</h3>
        ${generation ? "" : '<p class="missing">API生成は記録されていません。</p>'}
        ${responseResult.error ? `<p class="missing">${escapeHtml(responseResult.error)}</p>` : ""}
        ${responseCaseMismatch
          ? '<p class="error">応答内 caseId が一致しないため、この表示を完成回答として採用できません。</p>'
          : ""}
        ${response ? modelOutput : ""}
        ${response ? `<h4>回答が返した citations（raw JSON）</h4>
          <p class="subtle">モデル回答側の値です。送信原文の識別子と一致するとは限りません。</p>
          ${renderAnswerCitations(response)}` : ""}
        ${response && (response.status !== "completed" || !isObject(response.answer))
          ? '<p class="warning"><strong>重要:</strong> status が completed でないか、answer が null／不正です。上の不完全な outputText を保存表示しており、完成回答とはみなしません。</p>'
          : ""}
      </section>
      <section class="compare-panel sources-panel" aria-labelledby="${escapeHtml(caseId)}-sources">
        <h3 id="${escapeHtml(caseId)}-sources">送信された必須原文（完全表示）</h3>
        ${sent.value ? renderCitations(sent.value) : `<p class="missing">${escapeHtml(sent.error)}</p>`}
        <h4>送信された資料条件・注記（原文ではありません）</h4>
        <p class="subtle">以下は source_notes です。上の original_text と区別し、
          引用原文や独立した出典として扱いません。</p>
        ${sent.value ? renderSourceNotes(sent.value) : '<p class="missing">注記を表示できません。</p>'}
      </section>
    </div>

    ${renderReview(generation)}

    <section class="technical" aria-label="技術ステータス">
      <h3>技術ステータスと会計</h3>
      <dl class="data-grid">${renderDefinitionRows([
        ["ledger sequence", integerOrMissing(generation?.sequence)],
        ["ledger state", textOrMissing(generation?.state)],
        ["HTTP status", integerOrMissing(generation?.httpStatus)],
        ["response status", textOrMissing(response?.status)],
        ["model", textOrMissing(response?.model)],
        ["service tier", textOrMissing(response?.serviceTier)],
        ["stop reasons", Array.isArray(response?.stopReasons)
          ? response.stopReasons.length
            ? `<ul>${response.stopReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
            : "記録なし"
          : '<span class="missing">欠測</span>'],
        ["実測計算費用", formatMicroUsd(response?.measuredMicroUSD ?? generation?.measuredMicroUSD)],
        ["切り上げ前の算術値", formatExactMicroUsd(calculateExactMicroUsd(response))],
      ])}</dl>
      <p class="subtle">実測計算費用は各API呼出しごとに 1 µUSD 単位で上方切り上げした値です。
        料金表とusageからの計算であり、請求書の保証ではありません。</p>
      <h4>使用量</h4>
      ${renderUsage(response)}
      <h4>送信前見積り</h4>
      ${renderEstimate(generation)}
      <h4>自動チェック</h4>
      ${renderAutomatedChecks(response)}
    </section>
  </article>`;
};

const main = async () => {
  const [ledgerResult, payloadsResult] = await Promise.all([
    readJson(ledgerPath),
    readJson(payloadsPath),
  ]);
  const ledger = isObject(ledgerResult.value) ? ledgerResult.value : {};
  const payloads = isObject(payloadsResult.value) ? payloadsResult.value : {};
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const requests = Array.isArray(payloads.requests) ? payloads.requests : [];
  const generationEntries = entries.filter((entry) =>
    isObject(entry) && (entry.kind === "generation" || present(entry.caseId)));
  const generationByCase = new Map();
  for (const entry of generationEntries) {
    if (present(entry.caseId)) generationByCase.set(entry.caseId, entry);
  }
  const requestByCase = new Map(requests.map((record) => [record?.case_id, record]));

  const caseRows = await Promise.all(expectedCaseIds.map(async (caseId) => {
    const requestRecord = requestByCase.get(caseId);
    const sent = parseSentUserContent(requestRecord);
    const generation = generationByCase.get(caseId);
    return {
      caseId,
      requestRecord,
      sent,
      generation,
      responseResult: await loadResponse(generation),
    };
  }));

  const unexecuted = expectedCaseIds.filter((caseId) => !generationByCase.has(caseId));
  const apiLimit = ledger.limits?.maxApiTransmissions;
  const operationalBudget = ledger.limits?.operationalModelBudgetMicroUSD;
  const estimatedCosts = generationEntries.map((entry) => entry?.estimate?.estimatedMicroUSD);
  const allEstimatesKnown = estimatedCosts.every((value) =>
    Number.isSafeInteger(value) && value >= 0);
  const estimatedTotal = allEstimatesKnown
    ? estimatedCosts.reduce((sum, value) => sum + value, 0)
    : null;
  const measuredCosts = generationEntries.map((entry) => entry?.measuredMicroUSD);
  const measuredKnown = measuredCosts.filter((value) =>
    Number.isSafeInteger(value) && value >= 0);
  const allMeasuredKnown =
    generationEntries.length > 0 && measuredKnown.length === generationEntries.length;
  const measuredTotal = measuredKnown.reduce((sum, value) => sum + value, 0);
  const exactCosts = caseRows
    .filter((row) => row.generation)
    .map((row) => calculateExactMicroUsd(row.responseResult.value));
  const allExactCostsKnown = exactCosts.length === generationEntries.length
    && exactCosts.every((value) => typeof value === "number" && Number.isFinite(value));
  const exactCostTotal = allExactCostsKnown
    ? exactCosts.reduce((sum, value) => sum + value, 0)
    : null;
  const stoppedCaseIds = generationEntries
    .filter((entry) => entry.state === "stopped")
    .map((entry) => entry.caseId)
    .filter(present);
  const untestedEnglishCases = caseRows.filter((row) => {
    if (row.generation || !row.sent.value) return false;
    const citations = row.sent.value?.source_context?.citations;
    return Array.isArray(citations) && citations.some((citation) =>
      citation?.source_id === "E03" || citation?.source_id === "E04");
  }).map((row) => row.caseId);
  const schemaWarning = ledger.schemaVersion === 2
    ? ""
    : `<p class="warning"><strong>ledger schema 警告:</strong> 期待値は schemaVersion 2 ですが、
      現在値は ${textOrMissing(ledger.schemaVersion)} です。旧または不完全な ledger を結果として
      読み替えず、存在する記録だけを表示しています。</p>`;
  const apiLimitText = Number.isSafeInteger(apiLimit)
    ? `${integerOrMissing(entries.length)} / ${integerOrMissing(apiLimit)} 回（過去の metadata 1回を含む）`
    : `${integerOrMissing(entries.length)} 回使用、上限は欠測（20回と推測しません）`;
  const budgetText = Number.isSafeInteger(operationalBudget)
    ? `${formatMicroUsd(operationalBudget)}（運用予算）`
    : '<span class="missing">欠測（期待契約は $1.000000 / 1,000,000 µUSD）</span>';
  const estimatedRemainder =
    allEstimatesKnown && Number.isSafeInteger(operationalBudget)
      ? operationalBudget - estimatedTotal
      : null;
  const haltedText = ledger.halted === true
    ? `<strong class="halted">停止済み</strong>${
      stoppedCaseIds.length
        ? ` — ${escapeHtml(stoppedCaseIds.join("、"))} の出典照合不一致後、追加生成なし`
        : " — ledger は halted=true。停止ケースIDは欠測"
    }`
    : ledger.halted === false
      ? "ledger halted=false"
      : '<span class="missing">ledger.halted が欠測</span>';

  const generatedAt = new Date().toISOString();
  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>隔離読解評価レポート</title>
  <style>
    :root { color-scheme: light; --ink:#17202a; --muted:#58636f; --line:#cbd3da;
      --paper:#fff; --wash:#f4f6f7; --accent:#174a67; --warn:#7a4c00; --bad:#8a2530;
      --good:#1f6548; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--wash); color:var(--ink); line-height:1.65; }
    main { width:min(1500px, 100%); margin:auto; padding:clamp(16px, 3vw, 44px); }
    h1,h2,h3,h4,h5 { line-height:1.3; margin-top:0; }
    h1 { font-size:clamp(1.8rem, 4vw, 3rem); margin-bottom:.35rem; }
    h2 { font-size:1.65rem; margin:0; }
    h3 { font-size:1.15rem; }
    h4 { margin:1.2rem 0 .55rem; }
    h5 { font-size:1rem; margin-bottom:.55rem; }
    .lede,.subtle { color:var(--muted); }
    .subtle { font-size:.9rem; }
    .eyebrow { color:var(--accent); text-transform:uppercase; letter-spacing:.12em;
      font-size:.75rem; font-weight:700; margin:0; }
    .notice,.summary,.case-card { background:var(--paper); border:1px solid var(--line);
      border-radius:10px; padding:clamp(16px, 2.5vw, 28px); margin:20px 0; }
    .notice { border-left:6px solid var(--warn); }
    .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; }
    .summary-item { padding:14px; background:var(--wash); border-radius:6px; }
    .summary-item strong { display:block; }
    .case-header { display:flex; align-items:center; justify-content:space-between; gap:14px;
      padding-bottom:14px; border-bottom:2px solid var(--ink); }
    .status { border:1px solid currentColor; border-radius:999px; padding:4px 10px;
      font-weight:700; font-size:.85rem; }
    .status-complete { color:var(--good); }
    .status-stopped { color:var(--bad); background:#fff0f1; }
    .status-incomplete { color:var(--bad); }
    .status-missing { color:var(--muted); }
    .halted { color:var(--bad); }
    .question { font-size:1.08rem; }
    .comparison { display:grid; grid-template-columns:minmax(0, .9fr) minmax(0, 1.1fr);
      gap:18px; align-items:start; }
    .compare-panel { min-width:0; border:1px solid var(--line); border-radius:8px;
      padding:16px; background:#fff; }
    .answer-panel { position:sticky; top:10px; }
    .sources-panel { background:#f9fafb; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; margin:.6rem 0;
      font:inherit; }
    .model-output { padding:14px; background:#f1f6f9; border-left:4px solid var(--accent); }
    .answer-citations { padding:12px; background:#fff7e6; border:1px solid #dfc894;
      font-family:ui-monospace, "SFMono-Regular", Consolas, monospace; font-size:.82rem; }
    .source-text { padding:14px; background:#fff; border:1px solid var(--line); }
    .structured { font-family:ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size:.82rem; background:#fff; padding:12px; }
    .citation { margin:0 0 20px; padding-bottom:16px; border-bottom:1px solid var(--line); }
    .citation:last-of-type { border-bottom:0; }
    dl { margin:0; }
    .datum { display:grid; grid-template-columns:minmax(9rem, 30%) 1fr; gap:10px;
      border-top:1px solid var(--line); padding:6px 0; }
    dt { font-weight:700; color:#35414c; }
    dd { margin:0; min-width:0; overflow-wrap:anywhere; }
    dd ul { margin:0; padding-left:1.2rem; }
    .review,.technical { border-top:2px solid var(--line); margin-top:22px; padding-top:18px; }
    .review-stop { border-color:var(--bad); }
    .not-reviewed { border-left:5px solid var(--warn); padding-left:14px; }
    .missing { color:var(--bad); font-weight:650; }
    .warning { color:var(--warn); background:#fff7e6; padding:10px; border-radius:4px; }
    .error { color:var(--bad); background:#fff0f1; padding:10px; border-radius:4px; }
    details { margin:.6rem 0; }
    summary { cursor:pointer; font-weight:700; }
    nav ul { display:flex; flex-wrap:wrap; gap:8px; list-style:none; padding:0; }
    nav a { display:inline-block; padding:5px 10px; border:1px solid var(--line);
      border-radius:4px; color:var(--accent); }
    footer { color:var(--muted); padding:24px 0; font-size:.9rem; }
    @media (max-width: 800px) {
      .comparison { grid-template-columns:1fr; }
      .answer-panel { position:static; }
      .datum { grid-template-columns:1fr; gap:0; }
      .case-header { align-items:flex-start; flex-direction:column; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow">offline / isolated source reading</p>
    <h1>隔離読解評価レポート</h1>
    <p class="lede">モデル出力と、実際に送信した必須原文を並べて比較するための記録です。</p>
  </header>

  <section class="notice" aria-label="重要な制約">
    <h2>重要な制約</h2>
    <ul>
      <li>資料はドラフト／未承認です。採用済み、公開済み、または日本での適用確認済みとは扱いません。</li>
      <li>これは資料読解の技術評価であり、医療上の助言、診断、治療提案、臨床レビュー、臨床導入の承認ではありません。</li>
      <li>費用は記録された使用量または送信前見積りによる計算で、請求額を保証しません。</li>
      <li>reasoning の内容および識別可能なモデル応答IDは表示しません。</li>
    </ul>
    ${schemaWarning}
    ${ledgerResult.error ? `<p class="error">ledger: ${escapeHtml(ledgerResult.error)}</p>` : ""}
    ${payloadsResult.error ? `<p class="error">payloads: ${escapeHtml(payloadsResult.error)}</p>` : ""}
  </section>

  <section class="summary" aria-labelledby="summary-title">
    <h2 id="summary-title">実行・予算サマリー</h2>
    <div class="summary-grid">
      <div class="summary-item"><strong>API累計</strong>${apiLimitText}</div>
      <div class="summary-item"><strong>運用モデル予算</strong>${budgetText}</div>
      <div class="summary-item"><strong>generation 見積り合計</strong>
        ${allEstimatesKnown ? formatMicroUsd(estimatedTotal)
          : '<span class="missing">一部欠測（$0ではありません）</span>'}</div>
      <div class="summary-item"><strong>見積り残額</strong>
        ${Number.isSafeInteger(estimatedRemainder) ? formatMicroUsd(estimatedRemainder)
          : '<span class="missing">算出不能（$0ではありません）</span>'}</div>
      <div class="summary-item"><strong>実測計算費用合計</strong>
        ${allMeasuredKnown ? formatMicroUsd(measuredTotal)
          : `${measuredKnown.length ? `${formatMicroUsd(measuredTotal)}（判明分のみ）` : ""}
             <span class="missing">全件合計は欠測（$0ではありません）</span>`}</div>
      <div class="summary-item"><strong>切り上げ前の正確な算術合計</strong>
        ${formatExactMicroUsd(exactCostTotal)}</div>
      <div class="summary-item"><strong>利用実績を反映した運用予算残額</strong>
        ${allMeasuredKnown && Number.isSafeInteger(operationalBudget)
          ? formatMicroUsd(operationalBudget - measuredTotal) : "未確定"}
        <p class="subtle">残額があっても停止条件を優先します。</p></div>
      <div class="summary-item"><strong>runner状態</strong>${haltedText}</div>
      <div class="summary-item"><strong>未実行 Q01–Q11</strong>
        ${unexecuted.length ? escapeHtml(unexecuted.join("、")) : "なし"}</div>
      <div class="summary-item"><strong>英語資料 E03/E04 の未テストケース</strong>
        ${untestedEnglishCases.length
          ? escapeHtml(untestedEnglishCases.join("、"))
          : "該当する未実行ケースなし"}</div>
    </div>
    <p class="subtle">API上限は ledger 値を表示します。schemaVersion 2 の契約値は全20回で、過去の
      metadata 1回も累計に含みます。実測計算費用合計は各呼出しを1 µUSD単位で上方切り上げした合計、
      切り上げ前の算術合計はusage内訳に uncached入力 $0.20/百万、cache write $0.25/百万、
      cached read $0.02/百万、出力 $1.20/百万の率を適用した値です。reasoning は出力の内数です。
      いずれも請求額の保証ではありません。
      欠測値を0として補完していません。</p>
  </section>

  <nav aria-label="ケース目次">
    <h2>ケース</h2>
    <ul>${expectedCaseIds.map((caseId) =>
      `<li><a href="#${escapeHtml(caseId)}">${escapeHtml(caseId)}</a></li>`).join("")}</ul>
  </nav>

  ${caseRows.map(renderCase).join("\n")}

  <footer>
    <p>生成日時: ${escapeHtml(generatedAt)}。ローカルファイルのみを読み込んだ自己完結HTMLです。</p>
  </footer>
</main>
</body>
</html>`;

  await mkdir(evaluationDirectory, { recursive: true });
  await writeFile(outputPath, html, "utf8");
  process.stdout.write(`${path.relative(workspaceRoot, outputPath)}\n`);
};

await main();