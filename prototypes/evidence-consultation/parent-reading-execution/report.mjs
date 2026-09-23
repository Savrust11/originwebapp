// Offline, append-only final report generator.
// Importing this module has no side effects. It uses local files only and never reads
// credentials, environment variables, a database, an application, or a workflow.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRunner, ROOT } from "./runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_REL = "evidence-work/parent-reading-evaluation/execution-01";
const BASE = path.join(ROOT, BASE_REL);
const PREFLIGHT = path.join(BASE, "preflight");
const RUN = path.join(BASE, "run");
const REPORT = path.join(BASE, "report");
const REVIEWS = path.join(BASE, "reviews");
const MODEL_IDS = Object.freeze(["P01", "P04", "P06", "P09", "P10"]);
const LOCAL_IDS = Object.freeze(["P02", "P03", "P05", "P07", "P08"]);
const ALL_IDS = Object.freeze([...MODEL_IDS, ...LOCAL_IDS].sort());
const DIMENSIONS = Object.freeze([
  "directness",
  "comprehensibility",
  "fidelity",
  "appropriateConfirmationWithholding",
]);
const PRICING_URL = "https://developers.openai.com/api/docs/models/gpt-5.6-luna";
const EXPECTED = Object.freeze({
  attempts: 5,
  newKnownCentiMicroUSD: 495080,
  cumulativeCentiMicroUSD: 37338590,
  historicalUnresolvedCentiMicroUSD: 551250,
  plannedReservationsCentiMicroUSD: 2675250,
  plannedReleaseCentiMicroUSD: 2180170,
  authorizationUnusedCentiMicroUSD: 4504920,
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const readBytes = file => fs.readFileSync(file);
const readText = file => readBytes(file).toString("utf8");
const readJson = file => JSON.parse(readText(file));
const money = centiMicroUSD => `$${(centiMicroUSD / 100000000).toFixed(8)}`;
const relative = file => path.relative(ROOT, file).split(path.sep).join("/");
const html = value => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const md = value => String(value ?? "").replaceAll("\\", "\\\\").replaceAll("|", "\\|");
const prose = value => typeof value === "string"
  ? value
  : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
const htmlProse = value => typeof value === "string"
  ? `<p class="preserve">${html(value)}</p>`
  : `<pre>${html(JSON.stringify(value, null, 2))}</pre>`;
const unique = values => [...new Set(values)];

function safeChild(parent, child) {
  assert(typeof child === "string" && child.length > 0 && !path.isAbsolute(child),
    `unsafe path: ${child}`);
  const result = path.resolve(parent, child);
  assert(result.startsWith(`${path.resolve(parent)}${path.sep}`), `path escape: ${child}`);
  return result;
}

function writeOnce(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function normalizeCases(document, reviewer) {
  assert(document && typeof document === "object" && !Array.isArray(document),
    `${reviewer}: review must be an object`);
  assert(document.bindings && typeof document.bindings === "object",
    `${reviewer}: bindings missing`);
  assert(/[a-f0-9]{64}/.test(JSON.stringify(document.bindings)),
    `${reviewer}: bindings contain no SHA-256 hash`);
  const cases = Array.isArray(document.cases)
    ? document.cases
    : document.cases && typeof document.cases === "object"
      ? Object.entries(document.cases).map(([caseId, value]) => ({ caseId, ...value }))
      : null;
  assert(cases?.length === 10, `${reviewer}: exactly ten cases required`);
  const seen = new Set();
  for (const item of cases) {
    assert(item && typeof item === "object" && !Array.isArray(item),
      `${reviewer}: invalid case`);
    for (const key of ["caseId", "lane", "verdict", "dimensions", "issues", "reasoning",
      "propositionBindings"])
      assert(Object.hasOwn(item, key), `${reviewer}:${item.caseId ?? "?"}: missing ${key}`);
    assert(ALL_IDS.includes(item.caseId) && !seen.has(item.caseId),
      `${reviewer}: duplicate or unknown case ${item.caseId}`);
    const expectedLane = MODEL_IDS.includes(item.caseId) ? "model" : "local";
    assert(item.lane === expectedLane || item.lane === `${expectedLane}-once`
      || item.lane === `${expectedLane}-noAPI`,
    `${reviewer}:${item.caseId}: lane mismatch`);
    assert(typeof item.verdict === "string" && item.verdict.trim(),
      `${reviewer}:${item.caseId}: verdict missing`);
    assert(item.dimensions && typeof item.dimensions === "object"
      && !Array.isArray(item.dimensions), `${reviewer}:${item.caseId}: dimensions invalid`);
    for (const dimension of DIMENSIONS) {
      const assessment = item.dimensions[dimension];
      assert(assessment && typeof assessment === "object" && !Array.isArray(assessment)
        && Number.isInteger(assessment.score)
        && assessment.score >= 0 && assessment.score <= 3
        && typeof assessment.reason === "string" && assessment.reason.trim(),
      `${reviewer}:${item.caseId}: ${dimension} must contain score 0-3 and reason`);
    }
    assert(Array.isArray(item.issues), `${reviewer}:${item.caseId}: issues must be an array`);
    assert(item.reasoning !== null && item.reasoning !== undefined,
      `${reviewer}:${item.caseId}: reasoning missing`);
    assert(item.propositionBindings && typeof item.propositionBindings === "object",
      `${reviewer}:${item.caseId}: propositionBindings invalid`);
    seen.add(item.caseId);
  }
  return new Map(cases.map(item => [item.caseId, item]));
}

export function validateReviewDocuments(reviewADocument, reviewBDocument) {
  return {
    reviewerA: normalizeCases(reviewADocument, "reviewer-a"),
    reviewerB: normalizeCases(reviewBDocument, "reviewer-b"),
  };
}

function verifyReviewBindings(document, reviewer) {
  assert(Array.isArray(document.bindings) && document.bindings.length > 0,
    `${reviewer}: bindings must be a nonempty array`);
  for (const declared of document.bindings) {
    assert(declared && typeof declared.path === "string"
      && /^[a-f0-9]{64}$/.test(declared.sha256), `${reviewer}: invalid file binding`);
    const file = safeChild(ROOT, declared.path);
    assert(sha256(readBytes(file)) === declared.sha256,
      `${reviewer}: bound file changed: ${declared.path}`);
  }
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    assert(!fs.lstatSync(file).isSymbolicLink(), `symlink forbidden: ${relative(file)}`);
    if (entry.isDirectory()) found.push(...listFiles(file));
    else if (entry.isFile()) found.push(file);
  }
  return found;
}

function binding(file, role) {
  const bytes = readBytes(file);
  return { path: relative(file), role, bytes: bytes.length, sha256: sha256(bytes) };
}

function issueText(issue) {
  if (typeof issue === "string") return issue;
  return JSON.stringify(issue, null, 2);
}

function reviewSummary(ids, casesA, casesB) {
  const consensus = {};
  const disagreements = [];
  const byReviewer = { A: {}, B: {} };
  const issueClassificationDifferences = [];
  for (const id of ids) {
    const a = casesA.get(id), b = casesB.get(id);
    byReviewer.A[a.verdict] = (byReviewer.A[a.verdict] ?? 0) + 1;
    byReviewer.B[b.verdict] = (byReviewer.B[b.verdict] ?? 0) + 1;
    if (a.verdict === b.verdict) consensus[a.verdict] = (consensus[a.verdict] ?? 0) + 1;
    else disagreements.push({ caseId: id, reviewerA: a.verdict, reviewerB: b.verdict });
    issueClassificationDifferences.push(...classificationDifferences(id, a, b));
  }
  return {
    caseCount: ids.length,
    consensusVerdictCounts: consensus,
    disagreementCount: disagreements.length,
    disagreements,
    issueClassificationDifferences,
    reviewerVerdictCountsKeptSeparate: byReviewer,
    note: "Scores are not averaged. Matching verdicts alone are counted as consensus.",
  };
}

function classificationDifferences(caseId, a, b) {
  const differences = [];
  const bByQuote = new Map(b.issues
    .filter(issue => issue && typeof issue === "object" && typeof issue.answerQuote === "string")
    .map(issue => [issue.answerQuote, issue]));
  for (const issueA of a.issues) {
    if (!issueA || typeof issueA !== "object" || typeof issueA.answerQuote !== "string") continue;
    const issueB = bByQuote.get(issueA.answerQuote);
    if (issueB && issueA.classification !== issueB.classification)
      differences.push({
        caseId,
        answerQuote: issueA.answerQuote,
        reviewerAClassification: issueA.classification,
        reviewerBClassification: issueB.classification,
        status: "判断差の記録・未解消",
      });
  }
  return differences;
}

function caseReview(id, casesA, casesB) {
  const a = casesA.get(id), b = casesB.get(id);
  return {
    displayVerdict: a.verdict === b.verdict ? a.verdict : "判定不一致・保留",
    consensus: a.verdict === b.verdict,
    judgmentDifferences: classificationDifferences(id, a, b),
    reviewerA: a,
    reviewerB: b,
  };
}

function sourceRefs(ids) {
  return ids.map(id => `SRC-${id}`);
}

function buildMarkdown(report) {
  const lines = [
    "# 保護者向け資料読解・隔離評価 最終レポート",
    "",
    "> **警告：これは保護者向け助言ではありません。失敗判定を受けた回答も改変せず含む、架空質問による隔離評価です。**",
    "",
    "本レポートの点数・判定は臨床承認、公開承認、採用承認ではありません。2件のレビューはAIによる別コンテキスト評価であり、異なるモデル系統の由来を示しません。人間・臨床家による承認はなく、Lunaによる自己採点でもありません。",
    "",
    `生成日時: ${report.generatedAt}`,
    "",
    "## 結論と範囲",
    "",
    `- 実行台帳: **closed=${report.execution.ledgerStatus.closed}**、通信 ${report.execution.ledgerStatus.newNetworkAttempts}/5。残り通信枠はありません。`,
    "- 通常ゲート: 静的コード保存確認のみ。DB-backed route は実行せず、通常アプリ・DB・workflow も起動していません。",
    "- モデル回答は訂正せず、そのまま掲載しています。local 5件は固定アプリ表示であり、モデル出力ではありません。",
    "- 査読者間の差は平均・多数決で消していません。不一致は「判定不一致・保留」です。",
    "",
    "## 集計（model 5件 / local 5件を分離）",
    "",
    "```json",
    JSON.stringify(report.aggregation, null, 2),
    "```",
    "",
    "## 会計と実行閉鎖",
    "",
    `- 今回の算定使用額: **${report.execution.accounting.newKnownUsd}**（請求書ではありません）`,
    `- 累積: **${report.execution.accounting.cumulativeUsd}**（既知分と過去未解決 ${report.execution.accounting.historicalUnresolvedUsd} を1回だけ含む。請求書ではありません）`,
    `- 当初計画予約: ${report.execution.accounting.originalPlannedReservationsUsd}`,
    `- 新規の残存予約: ${report.execution.accounting.newRemainingReservedUsd}`,
    `- 未使用計画予約の解放: ${report.execution.accounting.unusedPlannedReleaseUsd}`,
    `- 承認上限の未使用分: ${report.execution.accounting.authorizationCapUnusedUsd}（送信権限ではありません）`,
    `- 公開価格参照（リンクのみ。生成時取得なし）: ${PRICING_URL}`,
    "",
  ];
  for (const lane of report.lanes) {
    lines.push(`## ${lane.title}`, "");
    for (const item of lane.cases) {
      lines.push(`### ${item.caseId} — ${item.review.displayVerdict}`, "",
        `**質問**  \n${item.question}`, "",
        `**${item.lane === "model" ? "モデルの正確な保存回答（未訂正）" : "固定ローカル表示（モデル出力ではない）"}**  \n${item.answer ?? "（技術的に有効な保存回答なし）"}`,
        "");
      if (item.lane === "model")
        lines.push(`出典ID: ${item.citations.length ? item.citations.join(", ") : "なし"}`,
          `使用量: input ${item.usage?.input_tokens ?? "不明"}, output ${item.usage?.output_tokens ?? "不明"}, total ${item.usage?.total_tokens ?? "不明"} tokens / 算定額 ${item.costUsd}`,
          `技術状態: ${item.technicalState}`, "");
      if (item.review.judgmentDifferences.length)
        lines.push("**判断差の記録・未解消（同じ最終判定でも分類差を保持）**", "",
          "```json", JSON.stringify(item.review.judgmentDifferences, null, 2), "```", "");
      lines.push("**事前凍結の2基準**", "",
        `1. unconditional: ${item.criteria.unconditional.map(md).join(" / ")}`,
        `2. conditional: ${item.criteria.conditional.map(md).join(" / ")}`, "",
        "**Reviewer A（AI・別コンテキスト）**", "",
        `- verdict: ${item.review.reviewerA.verdict}`,
        ...DIMENSIONS.flatMap(key => [
          `- ${key}: **${item.review.reviewerA.dimensions[key].score}/3**`,
          `  - reason: ${item.review.reviewerA.dimensions[key].reason}`,
        ]),
        `- reasoning: ${prose(item.review.reviewerA.reasoning)}`,
        `- issues / issue quotes:\n${item.review.reviewerA.issues.length
          ? item.review.reviewerA.issues.map(value => `  - ${issueText(value)}`).join("\n")
          : "  - なし"}`,
        `- propositionBindings:\n${prose(item.review.reviewerA.propositionBindings)}`, "",
        "**Reviewer B（AI・別コンテキスト）**", "",
        `- verdict: ${item.review.reviewerB.verdict}`,
        ...DIMENSIONS.flatMap(key => [
          `- ${key}: **${item.review.reviewerB.dimensions[key].score}/3**`,
          `  - reason: ${item.review.reviewerB.dimensions[key].reason}`,
        ]),
        `- reasoning: ${prose(item.review.reviewerB.reasoning)}`,
        `- issues / issue quotes:\n${item.review.reviewerB.issues.length
          ? item.review.reviewerB.issues.map(value => `  - ${issueText(value)}`).join("\n")
          : "  - なし"}`,
        `- propositionBindings:\n${prose(item.review.reviewerB.propositionBindings)}`, "",
        `**完全原文参照:** ${sourceRefs(item.originalIds).join(", ")}`, "");
    }
  }
  lines.push("## 完全原文（重複排除付録）", "");
  for (const source of report.sourceAppendix)
    lines.push(`### SRC-${source.originalId}`, "",
      `- sourceId: ${source.sourceId}`,
      `- title: ${source.title}`,
      `- SHA-256: ${source.originalTextSha256}`, "",
      "```text", source.originalText, "```", "");
  lines.push("## 判断差の記録", "",
    report.reconciliation.present
      ? "任意の差分レジスターを「判断差の記録・未解消」として収録しました。第三レビューでも裁定でもありません。A/Bの原判定・点数・理由は上記のまま保持し、平均化・上書きしていません。"
      : "差分レジスターはありません。A/Bの相違を明示したまま未解消として保持しています。",
    "", report.reconciliation.present ? "```json" : "",
    report.reconciliation.present ? JSON.stringify(report.reconciliation.document, null, 2) : "",
    report.reconciliation.present ? "```" : "", "",
    "## 由来・制約", "",
    `- プロトコル: ${report.provenance.protocolPath}`,
    `- runner README: ${report.provenance.readmePath}`,
    "- 正常ゲートについての主張は pre-send-checks.json の静的確認に限定されます。",
    "- 価格URLは参照リンクであり、この生成処理は外部リソースを取得していません。",
    "");
  return `${lines.join("\n")}\n`;
}

function reviewHtml(label, review) {
  const issues = review.issues.length
    ? `<ul>${review.issues.map(value => `<li><pre>${html(issueText(value))}</pre></li>`).join("")}</ul>`
    : "<p>なし</p>";
  return `<section class="review"><h4>${label}（AI・別コンテキスト）</h4>
    <p><b>判定:</b> ${html(review.verdict)}</p>
    <div class="scores">${DIMENSIONS.map(key =>
      `<span>${html(key)} <b>${html(review.dimensions[key].score)}/3</b></span>`).join("")}</div>
    <dl class="dimension-reasons">${DIMENSIONS.map(key =>
      `<dt>${html(key)} — ${html(review.dimensions[key].score)}/3</dt><dd>${html(review.dimensions[key].reason)}</dd>`).join("")}</dl>
    <h5>理由</h5>${htmlProse(review.reasoning)}
    <h5>issues / issue quotes</h5>${issues}
    <details><summary>propositionBindings</summary>${htmlProse(review.propositionBindings)}</details>
  </section>`;
}

function buildHtml(report, fontBase64, license) {
  const laneHtml = report.lanes.map(lane => `<section><h2>${html(lane.title)}</h2>
    ${lane.cases.map(item => `<article class="case">
      <header><span class="id">${item.caseId}</span><span class="${item.review.consensus ? "ok" : "hold"}">${html(item.review.displayVerdict)}</span></header>
      <h3>質問</h3><p class="preserve">${html(item.question)}</p>
      <h3>${item.lane === "model" ? "モデルの正確な保存回答（未訂正）" : "固定ローカル表示（モデル出力ではない）"}</h3>
      <div class="answer preserve">${html(item.answer ?? "（技術的に有効な保存回答なし）")}</div>
      ${item.lane === "model" ? `<p class="meta">出典ID: ${html(item.citations.join(", ") || "なし")}<br>
        使用量: input ${html(item.usage?.input_tokens ?? "不明")} / output ${html(item.usage?.output_tokens ?? "不明")} /
        total ${html(item.usage?.total_tokens ?? "不明")} tokens ・ 算定額 ${html(item.costUsd)}<br>
        技術状態: ${html(item.technicalState)}</p>` : ""}
      ${item.review.judgmentDifferences.length ? `<aside class="warning"><b>判断差の記録・未解消（同じ最終判定でも分類差を保持）</b>
        <pre>${html(JSON.stringify(item.review.judgmentDifferences, null, 2))}</pre></aside>` : ""}
      <details><summary>事前凍結の2基準</summary><ol>
        <li><b>unconditional:</b><ul>${item.criteria.unconditional.map(value => `<li>${html(value)}</li>`).join("")}</ul></li>
        <li><b>conditional:</b><ul>${item.criteria.conditional.map(value => `<li>${html(value)}</li>`).join("")}</ul></li>
      </ol></details>
      <div class="reviews">${reviewHtml("Reviewer A", item.review.reviewerA)}${reviewHtml("Reviewer B", item.review.reviewerB)}</div>
      <details><summary>対応する完全原文（${item.originalIds.length}件）</summary>
        ${item.sources.map(source => `<section class="source"><h4>SRC-${html(source.originalId)} — ${html(source.title)}</h4>
          <p class="hash">SHA-256 ${html(source.originalTextSha256)}</p><pre>${html(source.originalText)}</pre></section>`).join("")}
      </details>
    </article>`).join("")}</section>`).join("");
  const reconciliation = report.reconciliation.present
    ? `<p>任意の差分レジスターを「判断差の記録・未解消」として収録しました。第三レビューでも裁定でもありません。A/Bの原判定は上書きしていません。</p>
       <details><summary>差分レジスター原文</summary><pre>${html(JSON.stringify(report.reconciliation.document, null, 2))}</pre></details>`
    : "<p>差分レジスターはありません。A/Bの相違を明示したまま未解消として保持しています。</p>";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>保護者向け資料読解・隔離評価 最終レポート</title>
<style>
@font-face{font-family:NotoJP;src:url(data:font/woff2;base64,${fontBase64}) format("woff2");font-display:block}
:root{color-scheme:light;--ink:#18212d;--muted:#536171;--line:#dce3e8;--paper:#fff;--soft:#f5f7f8;--warn:#8a250f}
*{box-sizing:border-box}body{margin:0;background:#eef1f3;color:var(--ink);font-family:NotoJP,sans-serif;line-height:1.75}
main{width:min(1120px,100%);margin:auto;background:var(--paper);padding:clamp(18px,4vw,58px)}
h1{font-size:clamp(1.7rem,5vw,3rem);line-height:1.25}h2{margin-top:3rem;border-bottom:2px solid var(--ink)}
h3{font-size:1rem;margin-bottom:.3rem;color:var(--muted)}a{color:#155b80;overflow-wrap:anywhere}
.warning{border:3px solid var(--warn);background:#fff2ed;color:#671b0b;padding:1rem;font-weight:bold}
.notice,.accounting{background:var(--soft);padding:1rem 1.3rem;border-left:5px solid #5c7280}.case{margin:2rem 0;padding:clamp(14px,3vw,30px);border:1px solid var(--line);border-radius:12px}
.case header{display:flex;justify-content:space-between;gap:1rem;align-items:center}.id{font-weight:bold;font-size:1.4rem}.ok,.hold{padding:.25rem .7rem;border-radius:99px;background:#e5f4ea}.hold{background:#fff0cf;color:#714900}
.answer{font-size:1.06rem;background:#f5f8fa;padding:1rem;border-radius:8px}.preserve,pre{white-space:pre-wrap;overflow-wrap:anywhere}
.meta,.hash{color:var(--muted);font-size:.88rem}.reviews{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1rem 0}.review{border:1px solid var(--line);padding:1rem;border-radius:8px}
.scores{display:flex;flex-wrap:wrap;gap:.4rem}.scores span{font-size:.78rem;background:var(--soft);padding:.25rem .4rem;border-radius:4px}
.dimension-reasons dt{font-weight:bold;margin-top:.65rem}.dimension-reasons dd{margin-left:0;color:var(--muted)}
details{margin:1rem 0;border-top:1px solid var(--line);padding-top:.7rem}summary{cursor:pointer;font-weight:bold}.source pre,.review pre{font:inherit;font-size:.88rem;background:var(--soft);padding:1rem}
footer{margin-top:4rem;color:var(--muted);font-size:.85rem}@media(max-width:720px){.reviews{grid-template-columns:1fr}.case header{align-items:flex-start;flex-direction:column}main{padding:16px}}
@media print{body{background:#fff}main{max-width:none}.case{break-inside:avoid}.reviews{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<h1>保護者向け資料読解・隔離評価<br>最終レポート</h1>
<p class="warning">これは保護者向け助言ではありません。失敗判定を受けた回答も改変せず含む、架空質問による隔離評価です。</p>
<div class="notice"><p>点数・判定は臨床承認、公開承認、採用承認ではありません。2件のレビューはAIによる別コンテキスト評価であり、異なるモデル系統の由来を示しません。人間・臨床家による承認はなく、Lunaによる自己採点でもありません。</p>
<p>モデル回答は未訂正です。local 5件は固定アプリ表示で、モデル出力ではありません。不一致は平均・投票で消さず「判定不一致・保留」としました。</p></div>
<h2>集計</h2><pre>${html(JSON.stringify(report.aggregation, null, 2))}</pre>
<h2>台帳閉鎖・会計</h2><div class="accounting"><ul>
<li>台帳: closed=${html(report.execution.ledgerStatus.closed)} / 通信 ${html(report.execution.ledgerStatus.newNetworkAttempts)}/5（残りなし）</li>
<li>今回: ${html(report.execution.accounting.newKnownUsd)} / 累積: ${html(report.execution.accounting.cumulativeUsd)}（いずれも算定値で請求書ではない）</li>
<li>過去未解決: ${html(report.execution.accounting.historicalUnresolvedUsd)}（累積に1回だけ算入）</li>
<li>当初計画予約 ${html(report.execution.accounting.originalPlannedReservationsUsd)} / 残存予約 ${html(report.execution.accounting.newRemainingReservedUsd)} / 未使用計画予約の解放 ${html(report.execution.accounting.unusedPlannedReleaseUsd)}</li>
<li>承認上限未使用 ${html(report.execution.accounting.authorizationCapUnusedUsd)}（送信権限ではない）</li></ul>
<p><a href="${PRICING_URL}">公式公開価格ページ</a>（参照リンクのみ。生成時の外部取得なし）</p></div>
<h2>通常ゲートの限定</h2><p>静的コード保存確認のみです。DB route、通常アプリ、DB、workflowは実行しておらず、公開・採用承認はありません。</p>
${laneHtml}
<h2>判断差の記録</h2>${reconciliation}
<h2>完全原文・重複排除索引</h2>
${report.sourceAppendix.map(source => `<details><summary>SRC-${html(source.originalId)} — ${html(source.title)}</summary>
<p class="hash">${html(source.sourceId)} / SHA-256 ${html(source.originalTextSha256)}</p><pre>${html(source.originalText)}</pre></details>`).join("")}
<footer><p>生成日時 ${html(report.generatedAt)} / protocol ${html(report.provenance.protocolPath)} / README ${html(report.provenance.readmePath)}</p>
<details><summary>埋め込みフォントライセンス (SIL Open Font License)</summary><pre>${html(license)}</pre></details></footer>
</main></body></html>`;
}

export async function generateFinalReport({ now = () => new Date().toISOString() } = {}) {
  const outputFiles = {
    json: path.join(REPORT, "final-results.json"),
    markdown: path.join(REPORT, "final-results.ja.md"),
    html: path.join(REPORT, "final-results.html"),
    manifest: path.join(REPORT, "delivery-manifest.json"),
  };
  for (const file of Object.values(outputFiles))
    assert(!fs.existsSync(file), `append-only output already exists: ${relative(file)}`);

  const reviewAFile = path.join(REVIEWS, "reviewer-a.json");
  const reviewBFile = path.join(REVIEWS, "reviewer-b.json");
  assert(fs.existsSync(reviewAFile) && fs.existsSync(reviewBFile),
    "both completed reviews are required");
  const reviewADocument = readJson(reviewAFile);
  const reviewBDocument = readJson(reviewBFile);
  const validatedReviews = validateReviewDocuments(reviewADocument, reviewBDocument);
  const casesA = validatedReviews.reviewerA;
  const casesB = validatedReviews.reviewerB;
  verifyReviewBindings(reviewADocument, "reviewer-a");
  verifyReviewBindings(reviewBDocument, "reviewer-b");

  // status() verifies the complete event hash chain, every sealed asset, preflight
  // bindings, authorization binding, and closure using file reads only.
  const ledgerStatus = await createRunner().status();
  assert(ledgerStatus.closed && !ledgerStatus.stopped
    && ledgerStatus.newNetworkAttempts === EXPECTED.attempts
    && ledgerStatus.nextCaseId === null, "ledger is not cleanly closed after five attempts");
  assert(ledgerStatus.accounting.newKnownCentiMicroUSD === EXPECTED.newKnownCentiMicroUSD
    && ledgerStatus.accounting.newUnresolvedCentiMicroUSD === 0
    && ledgerStatus.accounting.totalCentiMicroUSD === EXPECTED.cumulativeCentiMicroUSD
    && ledgerStatus.accounting.unresolvedCentiMicroUSD
      === EXPECTED.historicalUnresolvedCentiMicroUSD,
  "closed accounting differs from frozen expected totals");

  const protocolFile = path.join(PREFLIGHT, "protocol.json");
  const packetsFile = path.join(PREFLIGHT, "request-packets.json");
  const sourceFile = path.join(PREFLIGHT, "source-content.json");
  const displaysFile = path.join(PREFLIGHT, "local-displays.json");
  const checksFile = path.join(PREFLIGHT, "pre-send-checks.json");
  const pricingFile = path.join(PREFLIGHT, "official-luna-pricing.json");
  const readmeFile = path.join(HERE, "README.md");
  const protocol = readJson(protocolFile);
  const packets = readJson(packetsFile);
  const sourceContent = readJson(sourceFile);
  const displays = readJson(displaysFile);
  const checks = readJson(checksFile);
  const pricing = readJson(pricingFile);
  assert(pricing.url === PRICING_URL, "official pricing URL changed");
  assert(checks.normalGateCheck.kind === "static-code-preservation-check-not-live-route-execution"
    && checks.normalGateCheck.databaseAccess === false
    && checks.normalGateCheck.actualDatabaseGateExecuted === false,
  "normal-gate limitation changed");
  assert(checks.accounting.actualPlannedMaximumReservations
    === EXPECTED.plannedReservationsCentiMicroUSD, "planned reservations changed");

  const packetById = new Map(packets.packets.map(packet => [packet.caseId, packet]));
  const displayById = new Map(displays.displays.map(display => [display.caseId, display]));
  const originals = sourceContent.originals;
  const usedOriginalIds = [];
  const makeCase = (id, lane) => {
    const criteria = protocol.prospectiveEvaluation.caseCriteria[id];
    const originalIds = protocol.caseBindings[id].originalIds;
    assert(criteria?.unconditional && criteria?.conditional, `${id}: frozen criteria missing`);
    assert(originalIds.every(originalId => originals[originalId]), `${id}: source missing`);
    usedOriginalIds.push(...originalIds);
    let question, answer, citations = [], usage = null, costCentiMicroUSD = 0;
    let technicalState = "local-fixed-display", responseEvidence = null;
    if (lane === "model") {
      const packet = packetById.get(id);
      const payload = JSON.parse(packet.request.input.find(input => input.role === "user").content);
      const responseFile = path.join(RUN, `private/responses/${id}.json`);
      const response = readJson(responseFile);
      question = payload.question;
      answer = response.answer?.answer ?? null;
      citations = response.answer?.citations ?? [];
      usage = response.usage;
      costCentiMicroUSD = response.measured?.centiMicroUSD ?? 0;
      technicalState = response.technicalState;
      responseEvidence = {
        responsePath: relative(responseFile),
        responseSha256: sha256(readBytes(responseFile)),
        requestSha256: response.requestSha256,
        rawResponseSha256: response.rawResponseSha256,
        httpStatus: response.httpStatus,
        providerStatus: response.providerStatus,
        costAccounting: response.costAccounting,
        retainReservation: response.retainReservation,
        caseReasons: response.caseReasons,
        stopReasons: response.stopReasons,
      };
      assert(response.caseId === id && response.answer && typeof answer === "string",
        `${id}: exact safe answer unavailable`);
    } else {
      const display = displayById.get(id);
      question = display.question;
      answer = display.exactDisplayText;
      assert(display.route === "local-noAPI"
        && display.provenance === "application-added-not-model-generated",
      `${id}: local provenance changed`);
    }
    return {
      caseId: id,
      lane,
      route: lane === "model" ? "model-once" : "local-noAPI",
      question,
      answer,
      answerHandling: lane === "model"
        ? "verbatim-safe-response-not-corrected"
        : "fixed-local-template-not-model-output",
      citations,
      usage,
      costCentiMicroUSD,
      costUsd: money(costCentiMicroUSD),
      technicalState,
      responseEvidence,
      criteria: {
        unconditional: criteria.unconditional,
        conditional: criteria.conditional,
        sourceRefs: protocol.prospectiveEvaluation.criteriaSourceRefs[id],
      },
      originalIds,
      sources: originalIds.map(originalId => originals[originalId]),
      review: caseReview(id, casesA, casesB),
    };
  };
  const modelCases = MODEL_IDS.map(id => makeCase(id, "model"));
  const localCases = LOCAL_IDS.map(id => makeCase(id, "local"));
  assert(modelCases.reduce((sum, item) => sum + item.costCentiMicroUSD, 0)
    === EXPECTED.newKnownCentiMicroUSD, "per-case costs do not close to ledger");

  const reconciliationFile = path.join(REVIEWS, "reconciliation.json");
  const reconciliation = fs.existsSync(reconciliationFile)
    ? { present: true, path: relative(reconciliationFile), document: readJson(reconciliationFile) }
    : { present: false, path: null, document: null };
  const generatedAt = now();
  assert(!Number.isNaN(Date.parse(generatedAt)), "invalid generation timestamp");
  const report = {
    schemaVersion: 1,
    reportId: "parent-reading-execution-01-final-results",
    generatedAt,
    language: "ja",
    warning: "NOT parent advice. Contains answers that may have failed review.",
    approval: {
      clinicalApproved: false,
      humanApproved: false,
      publicationApproved: false,
      adoptionApproved: false,
      scoresAreClinicalApproval: false,
      lunaSelfGrading: false,
      reviewerProvenance: "two AI reviews in separate contexts; not evidence of different model-family provenance",
    },
    handling: {
      modelResponses: "verbatim and uncorrected",
      localDisplays: "application-added templates, not model outputs",
      disagreement: "same verdict is consensus; different verdict is 判定不一致・保留; no averaging or voting",
      sourceBoundary: protocol.sourceBoundary.wordingRule,
    },
    execution: {
      verification: "createRunner().status() pure local file verification of ledger chain, sealed assets, preflight bindings, authorization, and closure",
      ledgerStatus,
      communications: { used: 5, authorized: 5, remaining: 0, allSpent: true },
      accounting: {
        unit: "USD",
        qualification: "computed from recorded token usage and frozen public rates; not an invoice",
        newKnownCentiMicroUSD: EXPECTED.newKnownCentiMicroUSD,
        newKnownUsd: money(EXPECTED.newKnownCentiMicroUSD),
        cumulativeCentiMicroUSD: EXPECTED.cumulativeCentiMicroUSD,
        cumulativeUsd: money(EXPECTED.cumulativeCentiMicroUSD),
        historicalUnresolvedCentiMicroUSD: EXPECTED.historicalUnresolvedCentiMicroUSD,
        historicalUnresolvedUsd: money(EXPECTED.historicalUnresolvedCentiMicroUSD),
        originalPlannedReservationsCentiMicroUSD: EXPECTED.plannedReservationsCentiMicroUSD,
        originalPlannedReservationsUsd: money(EXPECTED.plannedReservationsCentiMicroUSD),
        newRemainingReservedCentiMicroUSD: 0,
        newRemainingReservedUsd: money(0),
        unusedPlannedReleaseCentiMicroUSD: EXPECTED.plannedReleaseCentiMicroUSD,
        unusedPlannedReleaseUsd: money(EXPECTED.plannedReleaseCentiMicroUSD),
        authorizationCapUnusedCentiMicroUSD: EXPECTED.authorizationUnusedCentiMicroUSD,
        authorizationCapUnusedUsd: money(EXPECTED.authorizationUnusedCentiMicroUSD),
        authorizationCapUnusedIsSendAuthority: false,
        officialPublicPricingUrl: PRICING_URL,
        generatorFetchedExternalResource: false,
      },
      normalGate: checks.normalGateCheck,
    },
    aggregation: {
      model: reviewSummary(MODEL_IDS, casesA, casesB),
      local: reviewSummary(LOCAL_IDS, casesA, casesB),
      scoresAveraged: false,
    },
    lanes: [
      { lane: "model", title: "Model 5件（gpt-5.6-luna、保存回答は未訂正）", cases: modelCases },
      { lane: "local", title: "Local 5件（固定表示、モデル出力ではない）", cases: localCases },
    ],
    sourceAppendix: unique(usedOriginalIds).sort().map(originalId => originals[originalId]),
    reviews: {
      reviewerA: { path: relative(reviewAFile), sha256: sha256(readBytes(reviewAFile)),
        declaredBindings: reviewADocument.bindings },
      reviewerB: { path: relative(reviewBFile), sha256: sha256(readBytes(reviewBFile)),
        declaredBindings: reviewBDocument.bindings },
    },
    reconciliation,
    provenance: {
      protocolPath: relative(protocolFile),
      protocolSha256: sha256(readBytes(protocolFile)),
      preflightManifestPath: relative(path.join(PREFLIGHT, "preflight-manifest.json")),
      readmePath: relative(readmeFile),
      readmeSha256: sha256(readBytes(readmeFile)),
      generatorPath: relative(fileURLToPath(import.meta.url)),
      generatorSha256: sha256(readBytes(fileURLToPath(import.meta.url))),
    },
  };

  const fontFile = path.join(HERE, "../fonts/NotoSansJP-japanese-400.woff2");
  const licenseFile = path.join(HERE, "../fonts/OFL-1.1.txt");
  const fontBase64 = readBytes(fontFile).toString("base64");
  const license = readText(licenseFile);
  const resultBytes = jsonBytes(report);
  const markdownBytes = Buffer.from(buildMarkdown(report));
  const htmlBytes = Buffer.from(buildHtml(report, fontBase64, license));
  const preflightManifest = readJson(path.join(PREFLIGHT, "preflight-manifest.json"));
  const preflightBoundFiles = preflightManifest.bindings.map(declared => {
    const file = safeChild(ROOT, declared.path);
    const item = binding(file, `preflight-bound:${declared.role}`);
    assert(item.sha256 === declared.sha256,
      `preflight declared binding changed: ${declared.path}`);
    return item;
  });

  // Inventory before writing includes every immutable preflight/run input and every
  // review. The three just-generated deliverables are added after their hashes are
  // known. delivery-manifest.json itself is intentionally excluded to avoid a cycle.
  const inventory = [
    ...listFiles(PREFLIGHT).map(file => binding(file, "preflight")),
    ...preflightBoundFiles,
    ...listFiles(RUN).filter(file => !Object.values(outputFiles).includes(file))
      .map(file => binding(file, "run")),
    ...listFiles(REVIEWS).map(file => binding(file, "review")),
    binding(fileURLToPath(import.meta.url), "generator"),
    binding(path.join(HERE, "runner.mjs"), "imported-runtime"),
    binding(path.join(HERE, "../model-comparison-v2/controls.mjs"), "imported-runtime"),
    binding(readmeFile, "documentation"),
    binding(fontFile, "embedded-asset"),
    binding(licenseFile, "embedded-license"),
  ];
  const byPath = new Map();
  for (const item of inventory) {
    const previous = byPath.get(item.path);
    assert(!previous || previous.sha256 === item.sha256, `inventory hash conflict: ${item.path}`);
    byPath.set(item.path, previous ?? item);
  }
  const deliveryBindings = [
    { path: relative(outputFiles.json), role: "deliverable", bytes: resultBytes.length,
      sha256: sha256(resultBytes) },
    { path: relative(outputFiles.markdown), role: "deliverable", bytes: markdownBytes.length,
      sha256: sha256(markdownBytes) },
    { path: relative(outputFiles.html), role: "deliverable", bytes: htmlBytes.length,
      sha256: sha256(htmlBytes) },
  ];
  const manifest = {
    schemaVersion: 1,
    manifestId: "parent-reading-execution-01-delivery",
    generatedAt,
    hashAlgorithm: "SHA-256",
    hashScope: "exact file bytes",
    appendOnly: true,
    selfExcludedToAvoidHashCycle: relative(outputFiles.manifest),
    ledgerClosureConfirmed: true,
    reviewBindings: report.reviews,
    reconciliationPresent: reconciliation.present,
    bindings: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    deliverables: deliveryBindings,
  };
  const manifestBytes = jsonBytes(manifest);

  writeOnce(outputFiles.json, resultBytes);
  writeOnce(outputFiles.markdown, markdownBytes);
  writeOnce(outputFiles.html, htmlBytes);
  writeOnce(outputFiles.manifest, manifestBytes);
  return {
    generated: Object.values(outputFiles).map(relative),
    modelUsage: modelCases.map(({ caseId, usage, costUsd }) => ({ caseId, usage, costUsd })),
    newKnownUsd: money(EXPECTED.newKnownCentiMicroUSD),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateFinalReport()
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`report generation failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}