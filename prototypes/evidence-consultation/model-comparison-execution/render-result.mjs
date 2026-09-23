// Offline reporting only. Never imports execution code, credentials, or network clients.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const run = "evidence-work/model-comparison-runs/reading-comparison-01";
const prep = "evidence-work/model-comparison-preparation/reading-comparison-01";
const provenance = new Map();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function read(path) {
  const bytes = readFileSync(resolve(root, path));
  provenance.set(path, { path, bytes: bytes.length, sha256: sha(bytes) });
  return bytes.toString("utf8");
}
const json = path => JSON.parse(read(path));
function checkHash(path, expected) {
  read(path);
  assert.equal(provenance.get(path).sha256, expected, `Hash mismatch: ${path}`);
}
const final = json(`${run}/unmasked/final.json`);
const response = json(`${run}/private/responses/C-K10/X.json`);
const review = json(`${run}/private/reviews/C-K10/X.json`);
read(`${run}/AUTHORIZATION.md`);
const authorization = json(`${run}/private/authorization.json`);
const pricing = json(`${run}/preflight/current-pricing.json`);
const cases = json(`${prep}/cases.json`);
const order = json(`${prep}/execution-order.json`);
const policy = json(`${prep}/comparison-policy.json`);
const freeze = json(`${prep}/final-freeze.json`);
const packets = json(`${prep}/request-packets.json`);

assert.equal(final.summary.closed, true);
assert.equal(final.summary.stopped, true);
assert.equal(final.attempted.length, 1);
assert.equal(final.unexecuted.length, 23);
assert.equal(final.summary.newTransmissions, 1);
assert.equal(final.summary.cumulativeTransmissions, 20);
assert.equal(final.attempted[0].model, "gpt-5.6-luna");
assert.equal(final.attempted[0].caseId, "C-K10");
assert.deepEqual(response.stopReasons, ["unexpected_cache_configuration"]);
assert.equal(response.httpStatus, 200);
assert.equal(response.status, "completed");
assert.equal(response.incompleteReason, null);
assert.equal(response.elapsedMs, 11206);
assert.equal(response.technicalState, "technical-invalid");
assert.equal(response.measured, null);
assert.equal(response.answer, null);
assert.equal(Object.hasOwn(response, "prompt_cache_options"), false);
checkHash(`${prep}/final-freeze.json`, authorization.preparedFreezeSha256);
for (const binding of [...freeze.files, ...authorization.codeBindings]) checkHash(binding.path, binding.sha256);
for (const binding of authorization.pricingBindings) checkHash(`${run}/${binding.path}`, binding.sha256);
checkHash(`${run}/private/mapping.json`, authorization.mappingSha256);
checkHash(`${run}/private/responses/C-K10/X.json`, final.attempted[0].result.responseSha256);
checkHash(`${run}/private/reviews/C-K10/X.json`, final.attempted[0].review.reviewSha256);
checkHash(`${run}/blind/C-K10/X/packet.json`, review.blindPacketSha256);
assert.equal(review.blindPacketSha256, final.attempted[0].result.blindPacketSha256);
assert.equal(review.contextIsolation.freshContext, true);
assert.equal(review.contextIsolation.modelIdentityKnown, false);
assert.equal(review.contextIsolation.priorAnswersSeen, false);
assert.equal(review.reviewerType, "AI");
assert.equal(review.layers.appDisplay.verdict, "pass");
for (const [key, value] of Object.entries(review.layers)) {
  if (key !== "appDisplay") assert.equal(value.verdict, "not-assessable");
}
for (const item of [...review.criteria, ...review.questionCoverage, ...review.readability]) {
  assert.equal(item.verdict, "not-assessable");
}
const events = [];
let previousSha256 = null;
for (const name of readdirSync(resolve(root, `${run}/private/events`)).filter(n => /^\d{6}\.json$/.test(n)).sort()) {
  const path = `${run}/private/events/${name}`;
  const event = json(path);
  assert.equal(event.previousSha256, previousSha256, `Event chain: ${name}`);
  assert.equal(event.sequence, events.length + 1);
  for (const asset of event.assets) checkHash(`${run}/${asset.path}`, asset.sha256);
  previousSha256 = provenance.get(path).sha256;
  events.push({ ...event, path, sha256: previousSha256 });
}
assert.equal(events.length, 7);
const reviewEvent = events.find(e => e.type === "review-accepted");
const unmaskEvent = events.find(e => e.type === "unmasked");
assert.ok(reviewEvent.at < final.closedAt && final.closedAt <= unmaskEvent.at);
assert.equal(reviewEvent.data.reviewSha256, final.attempted[0].review.reviewSha256);
assert.deepEqual(order.attempts.slice(1).map(a => [a.caseId, a.model]),
  final.unexecuted.map(a => [a.caseId, a.model]));
for (const packet of packets.requests) {
  const stripped = packet.requests.map(({ model, ...rest }) => rest);
  assert.equal(stripped.length, 2);
  assert.deepEqual(stripped[0], stripped[1], `Unmatched inputs: ${packet.caseId}`);
}

const usage = response.usage;
assert.equal(usage.input_tokens, 2599);
assert.equal(usage.output_tokens, 1122);
assert.equal(usage.total_tokens, usage.input_tokens + usage.output_tokens);
assert.equal(usage.output_tokens_details.reasoning_tokens, 162);
assert.equal(usage.input_tokens_details.cached_tokens, 0);
assert.equal(usage.input_tokens_details.cache_write_tokens, 0);
assert.ok(usage.output_tokens < pricing.settings.max_output_tokens);
// Integer centi-microUSD avoids floating-point currency accumulation.
const lunaRates = pricing.models["gpt-5.6-luna"];
const tokenCentiMicroUSD = usage.input_tokens * Math.round(lunaRates.input * 100)
  + usage.output_tokens * Math.round(lunaRates.output * 100);
const historicalCentiMicroUSD = authorization.limits.historicalCostCentiMicroUSD;
const cumulativeTokenCentiMicroUSD = historicalCentiMicroUSD + tokenCentiMicroUSD;
const reservedCentiMicroUSD = final.summary.unknownAttemptReserveCentiMicroUSD;
assert.equal(tokenCentiMicroUSD, 186620);
assert.equal(cumulativeTokenCentiMicroUSD, 2774520);
assert.equal(reservedCentiMicroUSD, 551250);
assert.equal(final.summary.knownCostCentiMicroUSD, historicalCentiMicroUSD);
assert.equal(final.summary.accountedAndReservedCentiMicroUSD, historicalCentiMicroUSD + reservedCentiMicroUSD);
assert.equal(final.summary.accountedAndReservedCentiMicroUSD, 3139150);
assert.equal(final.summary.untransmittedPairReserveCentiMicroUSD, 0);
assert.equal(authorization.limits.newTransmissions, 24);
assert.equal(authorization.limits.cumulativeTransmissions, 43);
const money = n => ({ centiMicroUSD: n, microUSD: n / 100, USD: n / 100000000 });
const caseResults = order.pairs.map((pair, index) => {
  const original = cases.cases.find(c => c.caseId === pair.caseId);
  assert.ok(original);
  const first = pair.caseId === "C-K10";
  return {
    order: index + 1, ...original, modelOrder: pair.modelOrder,
    commonRequestSha256: packets.requests.find(p => p.caseId === pair.caseId).commonRequestSha256,
    models: {
      "gpt-5.6-luna": {
        status: first ? "technical-not-assessable" : "not-executed",
        transmissions: first ? 1 : 0,
        technicalState: first ? response.technicalState : null,
        semanticVerdict: first ? "not-assessable" : null,
        readabilityVerdict: first ? "not-assessable" : null,
        appDisplay: first ? { verdict: "pass", scope: "static-template-only-not-model-pass" } : null,
      },
      "gpt-5.6-sol": {
        status: first ? "not-sent" : "not-executed", transmissions: 0,
        technicalState: null, semanticVerdict: null, readabilityVerdict: null, appDisplay: null,
      },
    },
    evaluablePair: false,
    pairedOutcome: null,
    reason: first ? "local-verifier-stop; no valid semantic comparison" : "global-stop-before-transmission",
  };
});
const laneResults = ["known", "author-created-holdout"].map(lane => {
  const rows = caseResults.filter(c => c.lane === lane);
  assert.equal(rows.length, 6);
  return {
    lane, plannedCases: rows.length, plannedTransmissions: rows.length * 2,
    actualTransmissions: lane === "known" ? 1 : 0,
    unexecutedTransmissions: lane === "known" ? 11 : 12,
    technicallyExcludedResponses: lane === "known" ? 1 : 0,
    wholePairsNotExecuted: lane === "known" ? 5 : 6,
    completedEvaluablePairs: 0, modelComparison: "not-assessable",
    pairedMeaningOutcomes: { solOnlyPass: null, lunaOnlyPass: null, bothPass: null, bothFail: null },
    majorMeaningErrors: { status: "not-assessed", count: null },
    omittedConditions: { status: "not-assessed", count: null },
    readability: { status: "not-assessable", pass: null, minor: null, major: null },
    caseIds: rows.map(c => c.caseId),
  };
});
const report = {
  schemaVersion: 1, comparisonId: final.comparisonId,
  status: "stopped-not-completed", closed: true, closedAt: final.closedAt,
  reportBasis: "offline derivation after sealed AI review and unmasking; no new scoring or API calls",
  recommendation: {
    action: "HOLD", target: "model-change", winner: null,
    candidate: "gpt-5.6-sol", candidateEntitlement: "untested",
    reason: "比較可能な完了ペアは0。候補への変更を支持する比較結果がない。",
    automaticNextExecution: false,
  },
  transmissions: {
    prior: 19, new: 1, cumulative: 20, authorizedNewMaximum: 24, authorizedCumulativeMaximum: 43,
    requestedUnexecuted: 23, firstPairUnsent: 1, remainingWholePairsUnsent: 11,
    completedEvaluablePairs: 0, retries: 0, fallbacks: 0,
    additionalAllowanceFromOldUnusedSlot: 0, externalEvaluatorAPICalls: 0,
    providerPreflightAPICalls: 0,
    unusedCapacityIsNotPermissionToResume: true,
  },
  stop: {
    reason: "unexpected_cache_configuration",
    classification: "local-verifier-stop-not-model-quality-or-availability-failure",
    responseHttpStatus: response.httpStatus, responseStatus: response.status,
    validator: 'body.prompt_cache_options !== undefined && JSON.stringify(body.prompt_cache_options) !== \'{"mode":"explicit"}\'',
    comparisonScope: "entire returned prompt_cache_options object, not entire HTTP response",
    exactReturnedCacheConfigurationPersisted: false,
    exactReturnedCacheConfiguration: null,
    rawResponsePersisted: false, rawResponseSha256: response.rawResponseSha256,
    rootCause: "undetermined",
    uncertainty: "追加フィールド・順序・既定値など無害な表現差か、実際の非互換設定かは保存資料から判別不能。いずれも観測した差として主張しない。",
    providerFailureEstablished: false, cacheChargesEstablished: false,
    technicalState: response.technicalState, costAccounting: response.costAccounting,
  },
  modelUsage: [
    {
      model: response.model, transmissions: 1, httpStatus: 200, responseStatus: "completed",
      inputTokens: usage.input_tokens, outputTokensIncludingReasoning: usage.output_tokens,
      reasoningTokensIncludedNotAdditional: usage.output_tokens_details.reasoning_tokens,
      totalTokens: usage.total_tokens, cacheReadTokens: 0, cacheWriteTokens: 0,
      elapsedMs: response.elapsedMs, latencyScope: "single-observed-request-not-comparative-statistic",
      outputCap: 1500, outputCapReached: false, incompleteReason: null,
      tokenOnlyCost: money(tokenCentiMicroUSD), validatedLedgerMeasuredCost: null,
      semanticAssessment: "not-assessable",
    },
    {
      model: "gpt-5.6-sol", transmissions: 0, httpStatus: null, responseStatus: "not-sent",
      inputTokens: null, outputTokensIncludingReasoning: null, reasoningTokensIncludedNotAdditional: null,
      totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null, elapsedMs: null,
      outputCap: 1500, outputCapReached: null, incompleteReason: null,
      tokenOnlyCost: null, validatedLedgerMeasuredCost: null,
      semanticAssessment: "not-executed", entitlement: "untested",
    },
  ],
  costs: {
    scope: "OpenAI token arithmetic only; excludes Replit work/evaluation; not an invoice total",
    formulaMicroUSD: "2599 * 0.2 + 1122 * 1.2 = 1866.2",
    newTokenOnly: money(tokenCentiMicroUSD),
    cumulativeTokenDerived: money(cumulativeTokenCentiMicroUSD),
    ledger: {
      previousKnown: money(historicalCentiMicroUSD),
      currentUnknownAttemptReservation: money(reservedCentiMicroUSD),
      untransmittedPairReservation: money(0),
      accountedAndReserved: money(final.summary.accountedAndReservedCentiMicroUSD),
      budget: money(authorization.limits.budgetCentiMicroUSD),
      unchanged: true,
    },
    controlValidationUnresolved: true,
    tokenArithmeticDoesNotResolveValidationOrReplaceReservation: true,
    invoiceTotal: null,
  },
  methods: {
    authorizationPath: `${run}/AUTHORIZATION.md`, limits: authorization.limits,
    preparedFreezeSha256: authorization.preparedFreezeSha256,
    frozenFiles: freeze.files,
    frozenExecutionCodeBindings: authorization.codeBindings,
    matchedRequestsVerifiedOffline: true, allowedRequestDifference: ["model"],
    design: policy.design, generationOrder: policy.generationOrder,
    modelPayloadExcludes: cases.modelPayloadExcludes,
    pricing, requestsAreFrozenNotResent: true,
    guards: {
      endpoint: authorization.endpoint, concurrency: 1, retries: 0, fallback: false,
      reserveBothRequestsBeforePair: true,
      reservationBasis: pricing.estimates.actualAdmissionRule,
      localBoundsNotInvoiceGuarantee: true, preserveFullOriginals: true,
      noPurchases: true, noNewConnections: true, noAutoFundingChanges: true,
      noDBChanges: true, noAppChanges: true, noPublicationOrGateChanges: true,
    },
  },
  review: {
    path: `${run}/private/reviews/C-K10/X.json`,
    sha256: final.attempted[0].review.reviewSha256,
    blindPacketSha256: review.blindPacketSha256,
    acceptedAt: reviewEvent.at, unmaskedAt: unmaskEvent.at,
    sealedBeforeModelCostUsageTimingDisclosure: true,
    anonymousPacketsReviewed: ["C-K10/X"], separateFreshContext: true,
    judgment: review, appDisplayPassScope: "static-template-only-not-model-pass",
    continueMeans: "review acknowledgment only; does not clear global-stop or authorize transmission",
    noNewSemanticScoringInReport: true,
    majorMeaningErrors: { status: "not-assessed", count: null },
    omittedConditions: { status: "not-assessed", count: null },
  },
  lanes: laneResults, cases: caseResults, unexecuted: final.unexecuted,
  attempted: final.attempted,
  timingChain: [
    { type: "pricing-verified", at: pricing.verifiedAt, path: `${run}/preflight/current-pricing.json` },
    { type: "authorized", at: authorization.authorizedAt, path: `${run}/private/authorization.json` },
    ...events.map(({ sequence, type, at, path, sha256, previousSha256 }) =>
      ({ sequence, type, at, path, sha256, previousSha256 })),
  ],
  constraints: {
    holdoutQualification: cases.holdoutQualification,
    statisticalSuperiority: "not-assessed", generalization: "not-assessed",
    clinicalQuality: "not-assessed", adoptionApproval: "not-granted", publicationApproval: "not-granted",
    modelAvailabilityComparison: "not-assessed", historicalAnswersAreMatchedComparators: false,
    noTieOrWinnerFromZeroEvaluablePairs: true, noMeaningErrorZeroOrFailClaim: true,
    nextExecution: "not automatic; requires explicit authorization and separately frozen/reviewed controls",
  },
  provenance: [...provenance.values()].sort((a, b) => a.path.localeCompare(b.path)),
  offlineValidation: {
    frozenHashes: true, codeBindingHashes: true, eventHashChain: true,
    reviewAndPacketHashes: true, matchedInputs: true, currencyArithmetic: true,
    questionCount: 12, knownCount: 6, holdoutCount: 6,
    noNetworkOrBrowserUsed: true,
  },
};
assert.equal(report.cases.length, 12);
assert.equal(laneResults.reduce((n, lane) => n + lane.unexecutedTransmissions, 0), 23);

const esc = value => String(value).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const code = text => `<code>${esc(text)}</code>`;
const laneName = lane => lane === "known" ? "既知" : "新規";
const verdictName = verdict => verdict === "not-assessable" ? "評価不能" : verdict === "pass" ? "pass（表示単独）" : verdict;
const layerNames = {
  bodyMeaning: "本文の意味", bodyQuestionCoverage: "本文の質問応答",
  bodyAttributionPresence: "本文の帰属", bodyCompleteness: "本文の網羅性",
  appDisplay: "共通アプリ表示（静的テンプレート）",
  wholeScreenMeaning: "画面全体の意味", surfaceQuality: "画面全体の表現品質",
};
const table = (caption, headers, body) => `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table><caption>${esc(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
const row = cells => `<tr>${cells.map((c, i) => i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`).join("")}</tr>`;
const eventNames = {
  "pricing-verified": "公式料金・設定資料の確認", authorized: "今回の実行許可",
  initialized: "初期化", "pair-reserved": "最初のペアを予約",
  "transmission-reserved": "Luna 送信を予約（新規1／累計20）",
  "response-recorded": "HTTP 200・completed 応答を保存",
  "global-stop": "ローカル検証で全体停止",
  "review-accepted": "匿名AI判定を保存・hash固定",
  unmasked: "モデル対応を開示・閉鎖",
};
const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Luna / Sol 比較試験 — 停止・未完了の最終報告</title>
<style>
:root{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;color:#172d37;background:#f3f6f5;line-height:1.8;font-size:16px}
*{box-sizing:border-box}body{margin:0}a{color:#155c76;text-underline-offset:.22em}a:focus-visible,summary:focus-visible,.table-wrap:focus-visible{outline:3px solid #a86000;outline-offset:4px}
.skip{position:absolute;left:1rem;top:-6rem;background:#fff;padding:1rem;z-index:2}.skip:focus{top:1rem}
header{background:#153b42;color:#fff;padding:3.2rem max(1.2rem,calc((100vw - 1120px)/2))}
header p{color:#d7e8e8}h1{font-size:clamp(1.7rem,4vw,2.7rem);line-height:1.4;margin:.6rem 0}
.eyebrow{font-size:.8rem;letter-spacing:.1em}.badge{display:inline-block;padding:.2rem .75rem;border:1px solid #efd59f;border-radius:2rem;color:#fff0cf;font-size:.85rem}
main{max-width:1160px;margin:auto;padding:1.5rem 1.2rem 4rem}nav{display:flex;gap:.7rem 1.4rem;flex-wrap:wrap;margin:0 0 1.5rem}
section{background:#fff;padding:1.8rem;border:1px solid #d5e0df;border-radius:12px;margin:1.2rem 0;scroll-margin-top:1rem}
h2{font-size:1.4rem;margin:0 0 1rem}h3{font-size:1.1rem;margin:1.4rem 0 .5rem}p{margin:.6rem 0}ul,ol{padding-left:1.4rem}
.lead{font-size:1.1rem}.notice{background:#fff6e4;border-left:4px solid #9a6414;padding:1rem 1.2rem;margin:1.2rem 0}
.muted{color:#51656d;font-size:.9rem}.metrics,.lanes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.metric,.lane{background:#f1f7f6;padding:1rem;border-radius:8px}.metric strong{display:block;font-size:1.9rem;line-height:1.3;color:#174f54}
.lanes{grid-template-columns:repeat(2,minmax(0,1fr))}.lane h3{margin-top:0}
.table-wrap{overflow-x:auto;margin:1rem 0;border:1px solid #d7e2e0;border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:.92rem}caption{text-align:left;font-weight:700;padding:.7rem 1rem;background:#edf4f3}
th,td{padding:.75rem;vertical-align:top;text-align:left;border-top:1px solid #d7e2e0}thead th{background:#f7f9f9;white-space:nowrap}tbody th{font-weight:600}
.cases td:nth-child(3){min-width:260px}.cases td:nth-child(4),.cases td:nth-child(5){min-width:130px}
code{font-family:ui-monospace,monospace;font-size:.86em;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem;background:#f5f7f7;padding:1rem;max-height:38rem;overflow:auto}
details{border:1px solid #d5e0df;padding:1rem;border-radius:8px;margin:1rem 0}summary{cursor:pointer;font-weight:650}
.hash{display:block;padding:.8rem;background:#edf4f3;overflow-wrap:anywhere}.files li{margin:.6rem 0}
footer{font-size:.9rem;color:#51656d;padding:1rem}.tag{font-size:.8rem;padding:.1rem .4rem;border-radius:4px;background:#edf2f2;white-space:nowrap}
@media(max-width:650px){header{padding:2rem 1.2rem}section{padding:1.1rem}.metrics,.lanes{grid-template-columns:1fr}.metric strong{font-size:1.6rem}th,td{padding:.65rem}main{padding:1rem .7rem}}
@media print{body{background:#fff}header{background:#fff;color:#172d37;padding:1rem}header p{color:#172d37}.badge{color:#172d37;border-color:#172d37}nav,.skip{display:none}main{max-width:none;padding:0}section{break-inside:auto;border:1px solid #bbb}.table-wrap{overflow:visible}table{font-size:9pt}.metrics,.lanes{display:block}.metric,.lane{margin:.4rem 0}pre{max-height:none}}
</style>
</head>
<body>
<a href="#main" class="skip">本文へ移動</a>
<header>
<div class="eyebrow">READING COMPARISON 01 · CLOSED</div>
<h1>Luna / Sol 比較試験<br>停止・未完了の最終報告</h1>
<span class="badge">stopped-not-completed</span>
<p>既知6問＋新規6問の凍結比較計画。最初の応答後にローカル検証が停止し、比較は成立していません。</p>
<p class="eyebrow">閉鎖 ${esc(final.closedAt)} · 時刻はすべて UTC</p>
</header>
<main id="main">
<nav aria-label="報告内の目次">
<a href="#conclusion">結論</a><a href="#stop">停止の意味</a><a href="#usage">利用量・費用</a>
<a href="#cases">12問の実行状況</a><a href="#review">判定の範囲</a><a href="#methods">方法・制御</a><a href="#provenance">追跡資料</a>
</nav>
<section id="conclusion">
<h2>結論：モデル変更は HOLD</h2>
<p class="lead"><strong>勝者・同点とも判定しません。</strong>比較可能な完了ペアが0組のため、候補 Sol への変更を支持する比較結果はありません。</p>
<div class="metrics">
<div class="metric"><strong>0 / 12 組</strong>評価可能な完了ペア</div>
<div class="metric"><strong>1 / 24 回</strong>今回の送信数／許可上限</div>
<div class="metric"><strong>23 回</strong>予定されたが送信していない分</div>
</div>
<p>送信したのは <strong>C-K10 の Luna 1回のみ</strong>。累計は過去19回＋今回1回＝<strong>20回（上限43回）</strong>です。最初の組の Sol は未送信、残り11組は両モデルとも未送信。再試行0、フォールバック0です。</p>
<div class="notice"><strong>ローカル検証器による停止です。</strong>モデルの意味品質の不合格、提供元の障害、モデルの利用不可を示す結果ではありません。Sol の利用権限・応答可否は未検証です。</div>
<p>今回の実行は閉鎖済みです。未使用枠23回は再開許可ではなく、次の実行は自動ではありません。再実行を検討する場合も、検証仕様の別途検討・凍結と明示的な実行許可が必要です。</p>
</section>
<section id="stop">
<h2>何が起き、何が分からないか</h2>
<p>Luna は <strong>HTTP 200 / status=completed</strong> を返し、その後、ローカルの ${code("unexpected_cache_configuration")} が全体停止を起こしました。保存上の技術状態は ${code("technical-invalid")} です。</p>
<p>検証器は、応答内の ${code("prompt_cache_options")} がある場合、その<strong>オブジェクト全体</strong>を ${code("JSON.stringify")} して、${code('{"mode":"explicit"}')} と厳密一致するか検査しています。応答本文全体の一致検査ではありません。</p>
<pre>${esc(report.stop.validator)}</pre>
<p><strong>返されたキャッシュ設定オブジェクトそのものは保存されていません。</strong>生応答も hash のみで、再構成できません。無害な追加フィールド・キー順序・既定値などの表現差だったのか、実際の非互換設定だったのかは判別不能です。これらは可能性の例であり、観測された差として断定しません。</p>
<p>観測されたキャッシュ read / write token はともに0です。キャッシュ課金の発生や提供元の設定異常・障害は立証されていません。トークン利用量は読めても、設定検証は未解決のため台帳では今回の費用を既知扱いにしていません。</p>
<p>出力は上限1,500 tokenに対して1,122 token（推論162を内包）。<strong>上限到達なし</strong>、${code("incompleteReason=null")}。出力上限や未完了を停止原因としません。</p>
</section>
<section id="usage">
<h2>利用量と費用：算術と台帳を分ける</h2>
${table("今回のモデル別観測値（Sol の n/a は未送信・未観測）",
  ["モデル", "送信", "入力", "出力（推論内数）", "cache read / write", "応答時間", "状態"],
  row(["Luna", "1", "2,599", "1,122（162）", "0 / 0", "11,206 ms", "HTTP 200・completed<br>ローカル技術除外"]) +
  row(["Sol", "0", "n/a", "n/a", "n/a", "n/a（0 msではない）", "未送信・権限未検証"]))}
<p class="muted">出力1,122に推論162を重ねて加算しません。総token数は3,721。時間は1回の観測値で、モデル間の速度比較や平均値ではありません。</p>
${table("費用の異なる二つの読み方（USD）", ["区分", "値", "意味"],
  row(["今回の token-only 算術", "$0.0018662", "2,599 × 0.2 ＋ 1,122 × 1.2 ＝ 1,866.2 microUSD"]) +
  row(["累計 token-derived 算術", "$0.0277452", "過去 $0.025879 ＋ 今回 $0.0018662"]) +
  row(["台帳：過去の既知費用", "$0.025879", "今回の応答はここへ加算せず、従来値を維持"]) +
  row(["台帳：今回の未知試行の予約", "$0.0055125", "設定検証未解決のため保持。実費の確定値ではない"]) +
  row(["台帳：既知＋予約", "$0.0313915", "$0.025879 ＋ $0.0055125。未送信分のペア予約残高は $0"]) +
  row(["累計運用予算", "$1.00", "過去分込み。請求額の保証ではない"]))}
<div class="notice">token-only 算術は<strong>請求総額ではありません</strong>。設定検証を解決せず、予約を解除せず、台帳を置き換えません。今回の推定実費と予約を二重加算もしません。対象は本試験の OpenAI token利用量で、Replitの作業・評価料金は含みません。</div>
</section>
<section id="cases">
<h2>既知6問と新規6問を独立に集計</h2>
<div class="lanes">
${laneResults.map(lane => `<article class="lane"><h3>${laneName(lane.lane)}6問${lane.lane === "known" ? "：回帰確認" : "：作成者 holdout"}</h3>
<p>送信 ${lane.actualTransmissions} / 12回、未送信 ${lane.unexecutedTransmissions}回。<br>比較可能ペア <strong>0 / 6組</strong>。</p>
<p>${lane.lane === "known" ? "C-K10 の Luna は技術上の評価不能、Sol は未送信。他5組は両側未実行。" : "6組すべて両側未実行。新規質問に対するモデル応答はありません。"}</p>
<p>意味・質問応答・読みやすさの比較：評価不能。重大な意味誤り・条件省略：未評価。</p></article>`).join("")}
</div>
<p>Solのみ合格／Lunaのみ合格／両方合格／両方不合格の分布は、いずれの群でも算出不能です。0件として優劣や同点を作りません。静的表示の pass をモデル得点に加算しません。</p>
<p class="muted">${esc(cases.holdoutQualification)} 作成者は過去の誤りを知っており、新規質問の成績を既知問題と混ぜません。過去回答も今回の対照回答の代わりにしません。</p>
<div class="cases">
${table("凍結された12問・予定順（質問文は準備資料の原文）", ["順／ID", "群", "質問", "Luna", "Sol"],
  caseResults.map(c => row([
    `${c.order}<br>${code(c.caseId)}`, laneName(c.lane), esc(c.question),
    c.caseId === "C-K10" ? "技術上の評価不能<br><span class=\"tag\">technical-not-assessable</span>" : "未実行",
    c.caseId === "C-K10" ? "未送信（全体停止）" : "未実行",
  ])).join(""))}
</div>
<p>上表の「未実行」は回答失敗ではなく、送信自体がなかったことを示します。予定24送信から実施1送信を引いた23送信の内訳は ${code("report.json → unexecuted")} に保存しています。</p>
</section>
<section id="review">
<h2>匿名AIレビュー：評価できた範囲だけを示す</h2>
<p>別の新しい文脈のAI評価者が、匿名の <strong>C-K10 / X の1 packetのみ</strong>を見て判定しました。モデル対応・利用量・費用・時間・過去回答は伏せ、判定を保存してhash固定した後に開示しています。追加の外部評価モデルAPIは使っていません。</p>
<p>技術除外のため、匿名packetの回答欄は「技術的に有効な完了回答なし」のマーカーでした。保存された元の出力を、この報告で改めて意味採点してはいません。</p>
${table("固定済み判定：本文と共通表示を混同しない", ["層", "判定", "範囲・理由"],
  Object.entries(review.layers).map(([key, value]) => row([esc(layerNames[key]), verdictName(value.verdict), esc(value.reason)])).join(""))}
${table("日本語の読みやすさ：固定済み4軸", ["軸", "判定", "理由"],
  review.readability.map(item => row([esc(item.dimension), "評価不能", esc(item.reason)])).join(""))}
<div class="notice"><strong>appDisplay の pass は、共通の静的テンプレート単独への盲検AI判定です。</strong>モデルの合格、本文と表示の整合、画面全体の合格、通常アプリの動作確認を意味しません。</div>
<p>全7 criterion と質問応答の全4要素も ${code("not-assessable")} です。重大な意味誤り、条件・限界の欠落は<strong>未評価</strong>であり、「誤り0件」でも「不合格」でもありません。帰属・網羅性も良否を認定しません。</p>
<p>判定の ${code('decision="continue"')} はレビュー実施の確認だけです。全体停止を解除せず、次の通信を許可しません。</p>
<h3>開示前に固定したレビュー SHA-256</h3>
<code class="hash">${esc(report.review.sha256)}</code>
<p class="muted">AI評価に限ります。文体などから推測できる可能性まで排除した完全盲検を保証するものではありません。</p>
<details><summary>技術除外された元の出力を参照する（比較・意味採点の対象外）</summary>
<p>以下は保存された ${code("outputText")} の参照表示です。技術上の適格性や意味品質を認定せず、固定済み判定を変更しません。個別の医療・育児助言として用いないでください。</p>
<pre>${esc(response.outputText)}</pre></details>
</section>
<section id="methods">
<h2>方法・事前確認・ガード</h2>
<ul>
<li>同一の凍結質問、完全原文、生成規則、応答schema、共通表示を用い、各モデル各問1回の計画。準備済みのリクエストは ${code("model")} 以外が一致することをオフラインで検証しました。実際の対送信は成立していません。</li>
<li>モデル入力にはrubric・正解例・過去回答・過去判定・アプリ表示文を含めません。出典・条件・限界を予算都合で削りません。</li>
<li>${code("service_tier=default")}、${code("reasoning.effort=medium")}、${code("max_output_tokens=1500")}（推論込み）。同じmediumでも等しい計算量とは限らず、各モデルの最大性能比較ではありません。</li>
<li>${code('prompt_cache_options={"mode":"explicit"}')}、明示breakpointは0、期待cache read/writeは0。${code("tools=[]")}、${code("store=false")}、${code("background=false")}、${code("truncation=disabled")}。</li>
<li>送信先は既存の ${code(pricing.endpoint)} のみ。同時通信1、自動再試行0、代替モデルへの切替0。生成前に各ペア双方を予約し、結果不明・会計不明・設定異常等では全体停止します。</li>
<li>予約は完全UTF-8 payloadのbyte数＋入力overhead 2,048 tokenをcache-write単価で、出力上限を出力単価で見積もる運用上の保守枠。提供元のtoken上限・請求保証ではありません。予算不足なら原文を短縮せず残りの組を減らします。</li>
<li>今回の許可上限は新規24・累計43・過去費用込み$1。旧枠の未使用1回を追加しません。モデル一覧・token計数の確認APIは0、追加の購入・接続・自動入金変更はありません。</li>
<li>原文・rubric・コードbinding・台帳・既存の判定・通常相談ゲートは変更していません。本報告生成はファイル読取りと報告出力だけで、API・ネットワーク・DB・アプリ変更なし。</li>
</ul>
<h3>送信前の料金確認</h3>
<p>${esc(pricing.verifiedAt)} に公式公開文書のみで確認。公開文書閲覧は生成API送信ではありません。本報告作成時は再取得していません。</p>
${table("記録された単価：USD / 100万token（同値：microUSD / token）", ["モデル", "通常入力", "cache read", "cache write", "出力"],
  Object.entries(pricing.models).map(([model, rates]) => row([esc(model), rates.input, rates.cachedInput, rates.cacheWrite, rates.output])).join(""))}
<p>cache writeは通常入力の1.25倍、cache readは0.1倍。breakpointなしではキャッシュ利用・書込みをしないという公式説明を基にした設定ですが、返却設定の同一性検証は未解決です。Solの単価は少なくとも2026-11-21までのプロモーション表記に基づきます。</p>
<ul class="files">${pricing.sourceURLs.map(url => `<li>${code(url)}</li>`).join("")}</ul>
<p class="muted">URLは確認元の記録で、ページから外部読込みは行いません。長文追加料金対象の272K tokenを大幅に下回る入力として予約byte上限を検査する計画です。</p>
</section>
<section id="provenance">
<h2>時間順序と証拠の追跡</h2>
${table("UTCの記録順序（イベントはSHA-256チェーンを検証済み）", ["時刻", "出来事"],
  report.timingChain.map(e => row([code(e.at), esc(eventNames[e.type] ?? e.type)])).join(""))}
<p>レビュー固定 ${code(reviewEvent.at)} → final閉鎖 ${code(final.closedAt)} → 開示イベント ${code(unmaskEvent.at)}。レビューhashと匿名packetのhashは、最終記録と一致します。</p>
<p>匿名packet SHA-256：<code class="hash">${esc(review.blindPacketSha256)}</code></p>
<p>生応答 SHA-256（生応答そのものは未保存）：<code class="hash">${esc(response.rawResponseSha256)}</code></p>
<h3>ファイル参照（workspace相対パス）</h3>
<p>このHTMLは単独閲覧用です。以下は自動読込みのないプレーンな参照先です。数値・全23未送信・12質問・元判定・hash一覧は ${code(`${run}/report.json`)} に収録しています。</p>
<ul class="files">${[
  `${run}/report.json`, `${run}/unmasked/final.json`, `${run}/private/responses/C-K10/X.json`,
  `${run}/private/reviews/C-K10/X.json`, `${run}/blind/C-K10/X/packet.json`,
  `${run}/AUTHORIZATION.md`, `${run}/private/authorization.json`,
  `${run}/preflight/current-pricing.json`, `${run}/private/events/000001.json … 000007.json`,
  `${prep}/cases.json`, `${prep}/execution-order.json`, `${prep}/final-freeze.json`,
  `${prep}/request-packets.json`, `${prep}/comparison-policy.json`,
  "prototypes/evidence-consultation/model-comparison-execution/controls.mjs",
].map(path => `<li>${code(path)}</li>`).join("")}</ul>
<details><summary>主要証拠のSHA-256を表示</summary>
${table("主要ファイルのバイト列hash", ["ファイル", "SHA-256"], [
  `${run}/unmasked/final.json`, `${run}/private/responses/C-K10/X.json`,
  `${run}/private/reviews/C-K10/X.json`, `${run}/AUTHORIZATION.md`,
  `${run}/preflight/current-pricing.json`, `${prep}/cases.json`, `${prep}/execution-order.json`,
  `${prep}/final-freeze.json`,
].map(path => row([code(path), code(provenance.get(path).sha256)])).join(""))}
</details>
<h3>適用限界と次の判断</h3>
<p>新規6問も既存資料を用いた作成者問題で、独立した未見資料群ではありません。統計的優越、育児相談全体への一般化、臨床品質、採用・公開の適否は評価していません。採用承認・本番公開承認・通常ゲートの変更は一切ありません。</p>
<p><strong>HOLD：モデル変更を保留。</strong>検証器が停止した理由の確定に必要な返却設定は残っていないため、この報告だけで正常・異常のどちらかに補完しません。今回の閉鎖を維持し、次の実行は自動開始しません。</p>
</section>
<footer>静的・自己完結型の最終報告 · 外部assets／script／自動通信なし · 固定済み判定の転記とオフライン算術のみ</footer>
</main>
</body>
</html>
`;

// Offline structural/resource checks; no browser and no application process.
assert.ok(html.startsWith("<!doctype html>"));
assert.ok(html.includes('<html lang="ja">'));
assert.ok(html.includes('name="viewport"'));
assert.equal((html.match(/<table>/g) || []).length, (html.match(/<caption>/g) || []).length);
assert.equal((html.match(/<table>/g) || []).length, (html.match(/<\/table>/g) || []).length);
assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length);
assert.ok(!/<(?:script|link|img|iframe|object|embed|form|video|audio)\b/i.test(html));
assert.ok(!/\s(?:src|srcset|action|poster|on[a-z]+)\s*=/i.test(html));
assert.ok(!/@import\b|url\s*\(/i.test(html));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length);
for (const match of html.matchAll(/\shref="([^"]+)"/g)) {
  assert.ok(match[1].startsWith("#"));
  assert.ok(ids.includes(match[1].slice(1)));
}
for (const item of caseResults) assert.ok(html.includes(esc(item.question)));
assert.ok(html.includes(report.review.sha256));
report.offlineValidation.html = {
  languageAndViewport: true, uniqueIdsAndInternalAnchors: true,
  tablesCaptioned: true, noExternalResourcesOrScripts: true,
  twelveExactQuestionTextsPresent: true, browserUsed: false,
};
const outputJson = `${JSON.stringify(report, null, 2)}\n`;
assert.deepEqual(JSON.parse(outputJson), report);
writeFileSync(resolve(root, `${run}/report.json`), outputJson);
writeFileSync(resolve(root, `${run}/comparison-result.html`), html);
console.log(JSON.stringify({
  status: report.status,
  files: [`${run}/report.json`, `${run}/comparison-result.html`],
  validated: report.offlineValidation,
}, null, 2));