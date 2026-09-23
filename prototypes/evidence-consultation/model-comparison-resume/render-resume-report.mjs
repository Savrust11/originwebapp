// Offline-only final reporting. Reads sealed local evidence and writes only the
// continuation report artifacts; it has no network, provider, database, or app imports.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const run = "evidence-work/model-comparison-runs/reading-comparison-01-resume";
const oldRun = "evidence-work/model-comparison-runs/reading-comparison-01";
const prep = "evidence-work/model-comparison-preparation/reading-comparison-01";
const provenance = new Map();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const scalarSha = value => sha(JSON.stringify(value));
const read = path => {
  const bytes = readFileSync(resolve(root, path));
  provenance.set(path, { path, bytes: bytes.length, sha256: sha(bytes) });
  return bytes.toString("utf8");
};
const json = path => JSON.parse(read(path));
const check = (path, expected) => {
  read(path);
  assert.equal(provenance.get(path).sha256, expected, `hash mismatch: ${path}`);
};
const money = centiMicroUSD => ({
  centiMicroUSD,
  microUSD: centiMicroUSD / 100,
  USD: centiMicroUSD / 100000000,
});

const final = json(`${run}/unmasked/final.json`);
const response = json(`${run}/private/results/C-H06/Y.json`);
const review = json(`${run}/private/reviews/C-H06/Y.json`);
const authorization = json(`${run}/private/authorization.json`);
const preflight = json(`${run}/preflight.json`);
const casesFile = json(`${prep}/cases.json`);
const priorReport = json(`${oldRun}/report.json`);
const pricing = json(`${oldRun}/preflight/current-pricing.json`);
const oldQ10 = json(`${oldRun}/private/responses/C-K10/X.json`);

assert.equal(final.comparisonId, "reading-comparison-01-resume");
assert.equal(final.attempted.length, 1);
assert.equal(final.unexecuted.length, 21);
assert.equal(final.excludedCase, "C-K10");
assert.deepEqual(final.eligiblePairs, []);
assert.equal(response.httpStatus, 200);
assert.equal(response.technicalState, "technical-invalid");
assert.deepEqual(response.stopReasons, [
  "undocumented_response_field", "unknown_control_value", "unknown_output_field",
]);
assert.equal(response.answer, null);
assert.ok(oldQ10.outputText.length > 0, "Q10 saved answer must exist");
assert.equal(oldQ10.answer, null, "Q10 remains technically excluded");
assert.equal(preflight.exclusionReason.includes("saved Q10 answer exists"), true);
assert.equal(preflight.plannedTransmissions, 22);
assert.equal(authorization.limits.newMaxTransmissions, 23);
assert.equal(authorization.limits.cumulativeMaxTransmissions, 43);

for (const binding of authorization.bindings) check(binding.path, binding.sha256);
check(`${run}/private/mapping.json`, authorization.mappingSha256);
check(`${run}/private/results/C-H06/Y.json`, final.attempted[0].result.responseSha256);
check(`${run}/blind/C-H06/Y/packet.json`, review.blindPacketSha256);
check(`${run}/private/reviews/C-H06/Y.json`, "07b97155403698aae54d2c7894f611cfd52341fae4845a7a371c55d926ccec95");
check(`${run}/unmasked/final.json`, "04fb18c1a95a9a46fec5345cc2ebdb1b1e9da6992424ac8356b4b9ed5c0d8685");

const events = [];
let previous = null;
for (const name of readdirSync(resolve(root, `${run}/private/events`)).filter(n => /^\d{6}\.json$/.test(n)).sort()) {
  const path = `${run}/private/events/${name}`;
  const event = json(path);
  assert.equal(event.sequence, events.length + 1);
  assert.equal(event.previousSha256, previous);
  for (const asset of event.assets) check(`${run}/${asset.path}`, asset.sha256);
  previous = provenance.get(path).sha256;
  events.push({ ...event, path, sha256: previous });
}
assert.equal(events.length, 7);
const transmissionEvent = events.find(e => e.type === "transmission-reserved");
const responseEvent = events.find(e => e.type === "response-recorded");
const reviewEvent = events.find(e => e.type === "review-accepted");
const unmaskEvent = events.find(e => e.type === "unmasked");
assert.ok(reviewEvent.at < unmaskEvent.at, "review must be sealed before unmask");
const eventIntervalMs = Date.parse(responseEvent.at) - Date.parse(transmissionEvent.at);
assert.equal(eventIntervalMs, 23844);

// Resolve only ordinary public field names and known literal values. Arbitrary
// object contents remain hash/type-only.
const hashes = {
  retention24h: "4188eb3ff678e0100eafc3e0acf06399df8df616f9d9986626f0ad78df70aa0c",
  billingName: "0c95c7ece1ce1a9750275ef1c6d7ad6b278f70d66592207783ffe7d58474cc01",
  billingObject: "8a5759fcf5a63f8942ea3a9602c0db85f45212bd56001d11d5aa82c23b5a03b8",
  frequencyName: "1d960da63cffa014381b9d944f50426629360d93473750a655dff922e8730f67",
  presenceName: "c5e68f01ab8b81a9a5dabb7fadb004dd02463b3b88af40913985e06c022de6b0",
  unknownObjectName: "cf1ba06d805d943d77a99efe9bcb7409e701e6aba621b85ce9973f936c915d7a",
  unknownObjectValue: "ccf063822ed5396938e33e942ea0f6d5c8c44e99d00a84e553b2540056aea6e0",
  descriptionName: "c9046f7a37ad0ea7cee73355984fa5428982f8b37c8f7bcec91f7ac71a7cd104",
  contentName: "ed7002b439e9ac845f22357d822bac1444730fbdb6016d3ec9432297b9ec9f73",
  encryptedContentName: "275e51039ef9a0a4e8f7cfe6e1401e4fd90b882be8f50cae1c1e1990edc4574c",
  phaseName: "02195b8e989603e4dfb45352b902e8dc34bff40bb228f3c26e56a6ddebdb85ad",
};
assert.equal(scalarSha("24h"), hashes.retention24h);
assert.equal(sha("billing"), hashes.billingName);
assert.equal(sha("frequency_penalty"), hashes.frequencyName);
assert.equal(sha("presence_penalty"), hashes.presenceName);
assert.equal(sha("description"), hashes.descriptionName);
assert.equal(sha("content"), hashes.contentName);
assert.equal(sha("encrypted_content"), hashes.encryptedContentName);
assert.equal(sha("phase"), hashes.phaseName);
assert.equal(scalarSha(0), "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9");
assert.equal(scalarSha(null), "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b");
assert.equal(scalarSha([]), "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
assert.equal(scalarSha("final_answer"), "c2259d492611627a36a6d28028c7dbf1e55f4c2c4e4e39a84a74cdf987bfcb37");

const field = name => response.controls.fields.find(item => item.field === name);
assert.equal(field("prompt_cache_options.mode").returned.value, "explicit");
assert.equal(field("prompt_cache_options.ttl").returned.value, "30m");
assert.equal(field("prompt_cache_options.prewarm").returned.presence, "omitted");
assert.equal(field("prompt_cache_breakpoints.count").requested.value, 0);
assert.equal(field("prompt_cache_retention").returned.sha256, hashes.retention24h);
assert.equal(field("temperature").returned.value, 1);
assert.equal(field("top_p").returned.value, 0.98);
assert.equal(response.usage.input_tokens_details.cached_tokens, 0);
assert.equal(response.usage.input_tokens_details.cache_write_tokens, 0);
assert.equal(response.usage.total_tokens, response.usage.input_tokens + response.usage.output_tokens);

const testSource = read("prototypes/evidence-consultation/model-comparison-resume/offline.test.mjs");
const testCount = (testSource.match(/^test\(/gm) || []).length;
assert.equal(testCount, 26);

const caseOrder = ["C-K10", "C-H06", "C-K09", "C-H03", "C-K05", "C-H01",
  "C-K11", "C-H04", "C-K06", "C-H02", "C-K08", "C-H05"];
const caseRows = caseOrder.map((caseId, index) => {
  const item = casesFile.cases.find(c => c.caseId === caseId);
  assert.ok(item);
  if (caseId === "C-K10") return {
    order: index + 1, caseId, lane: item.lane, question: item.question,
    luna: "保存回答あり・control証拠欠落で除外", sol: "未送信・今後も再送しない",
    pair: "Q10をcontrol理由だけで除外",
  };
  if (caseId === "C-H06") return {
    order: index + 1, caseId, lane: item.lane, question: item.question,
    luna: "mate未送信", sol: "新規1応答・技術除外",
    pair: "未完成（意味評価不能）",
  };
  return {
    order: index + 1, caseId, lane: item.lane, question: item.question,
    luna: "未送信", sol: "未送信", pair: "未開始",
  };
});
assert.equal(caseRows.length, 12);
assert.equal(caseRows.filter(c => c.pair === "未開始").length, 10);

const known = 2587900;
const oldReserve = 551250;
const newReserve = 10398500;
const accounted = known + oldReserve + newReserve;
const budget = 100000000;
const remaining = budget - accounted;
assert.equal(accounted, final.accounting.totalCentiMicroUSD);
assert.equal(accounted, 13537650);
assert.equal(remaining, 86462350);
const rates = pricing.models["gpt-5.6-sol"];
const tokenDerivedCentiMicroUSD = response.usage.input_tokens * Math.round(rates.input * 100)
  + response.usage.output_tokens * Math.round(rates.output * 100);
assert.equal(tokenDerivedCentiMicroUSD, 3416400);

const report = {
  schemaVersion: 1,
  comparisonId: final.comparisonId,
  status: "closed-stopped-not-completed",
  recommendation: {
    action: "HOLD",
    winner: null,
    modelSemanticFailure: false,
    reason: "比較可能な完了ペアが0組であり、モデル選定・勝者判定を行わない。",
  },
  coreTruth: {
    q10: {
      savedLunaAnswerExists: true,
      excludedSolelyForMissingReturnedCacheControlEvidence: true,
      resendEitherMember: false,
      authorizationOrBudgetFailure: false,
    },
    repair: {
      fieldBasedControlsReplacedWholeObjectEquality: true,
      requested: { cacheMode: "explicit", ttl: "omitted (documented default 30m)", prewarm: "omitted (documented default false)", breakpoints: 0 },
      returned: { cacheMode: "explicit", ttl: "30m", prewarm: "omitted", cacheReadTokens: 0, cacheWriteTokens: 0 },
      requestedSettingsPassed: true,
      completeRealProviderCompatibilityEstablished: false,
    },
  },
  transmissions: {
    historicBeforeOriginalRun: 19,
    oldQ10Luna: 1,
    continuationSol: 1,
    cumulative: 21,
    cumulativeMaximum: 43,
    continuationMaximum: 23,
    continuationUsed: 1,
    continuationRemaining: 22,
    plannedContinuationUnsent: 21,
    currentCeilingCapacityBeyondFrozenPlan: 1,
    legacyUnusedSlotAdded: 0,
    q10ExcludedTransmissions: 2,
    cH06LunaMateUnsent: 1,
    otherPairsNotStarted: 10,
    completedPairs: 0,
    retries: 0,
    modelAPICallsDuringRepairTests: 0,
    finalContinuationModelAPICalls: 1,
  },
  stop: {
    requiredBecauseUnknownSemantics: true,
    reasons: response.stopReasons,
    notReasons: ["authorization_missing", "budget_depleted"],
    providerBadResponseClaim: false,
    responseHttpStatus: 200,
    responseStatus: null,
    preciseLatencyMs: null,
    eventIntervalMs,
    eventIntervalScope: "transmission-reservedからresponse-recordedまでのイベント間隔。精密な応答レイテンシではない。",
  },
  metadataAudit: {
    safeResolved: [
      { field: "prompt_cache_retention", value: "24h", valueSha256: hashes.retention24h, effect: "unknown_control_value; 停止" },
      { field: "frequency_penalty", value: 0, effect: "未文書化応答フィールド; 停止" },
      { field: "presence_penalty", value: 0, effect: "未文書化応答フィールド; 停止" },
      { field: "text.format.description", value: null, effect: "未文書化出力形式フィールド; 停止" },
      { field: "reasoning.content", value: [], effect: "未文書化出力フィールド; 停止" },
      { field: "reasoning.encrypted_content", value: "string (value hash retained)", effect: "未文書化出力フィールド; 停止" },
      { field: "message.phase", value: "final_answer", effect: "未文書化出力フィールド; 停止" },
    ],
    unresolved: [
      { field: "billing", nameSha256: hashes.billingName, type: "object", valueSha256: hashes.billingObject, exactObject: "UNKNOWN" },
      { field: "UNKNOWN", nameSha256: hashes.unknownObjectName, type: "object", valueSha256: hashes.unknownObjectValue, exactObject: "UNKNOWN" },
    ],
    chargeRelatedValidation: "full safe unknown configurationがないためbilling objectの意味・課金影響を検証不能",
    privacy: "任意の未知名・未知値はsecretや相談本文を含み得るためraw保存せず、hash/typeのみ保持。",
    broaderSchemaNeed: "課金以外の通常metadataにもschema coverage拡張が必要。",
  },
  usage: {
    model: "gpt-5.6-sol",
    observed: response.usage,
    outputIncludesReasoningTokens: true,
    tokenDerivedSubtotal: money(tokenDerivedCentiMicroUSD),
    tokenFormulaMicroUSD: "2581 × 4 + 1192 × 20 = 34164",
    settledBilling: null,
    note: "観測tokenからの別建て算術であり、確定請求・台帳実費ではない。",
  },
  costs: {
    knownHistorical: money(known),
    oldQ10UnknownReserve: money(oldReserve),
    continuationUnknownReserve: money(newReserve),
    knownPlusReserves: money(accounted),
    remainingBudgetAccounting: money(remaining),
    budget: money(budget),
    doubleCountedOldTokenDerived1866_2MicroUSD: false,
    newUsageDerivedAddedToLedger: false,
    remainingBudgetIsNotAuthorityToIgnoreUnknowns: true,
  },
  offlineTests: {
    passed: 26,
    sourceCaseCount: testCount,
    networkOrProviderCalls: 0,
    coverage: [
      "無害な追加・null・omission", "重要差分", "未知名・未知値・課金診断",
      "pair sampling invariant", "費用・予約", "lock・再開・レビューschema・seal",
    ],
    limitation: "合成fixtureによるオフライン試験。実provider応答との完全互換性は主張しない。",
  },
  review: {
    reviewerType: "AI",
    anonymous: true,
    freshContext: review.contextIsolation.freshContext,
    modelIdentityKnownAtReview: review.contextIsolation.modelIdentityKnown,
    priorAnswersSeen: review.contextIsolation.priorAnswersSeen,
    sealedBeforeUnmask: true,
    reviewAcceptedAt: reviewEvent.at,
    unmaskedAt: unmaskEvent.at,
    reviewSha256: provenance.get(`${run}/private/reviews/C-H06/Y.json`).sha256,
    blindPacketSha256: review.blindPacketSha256,
    bodyMeaning: "not-assessable",
    wholeScreenMeaning: "not-assessable",
    japaneseQuality: "not-assessable",
    appDisplay: "pass (static template only)",
    appDisplayScope: "モデル本文・画面全体・実アプリ動作のpassではない",
    priorReviewAlsoSealedBeforeUnmask: priorReport.review.sealedBeforeModelCostUsageTimingDisclosure,
  },
  scenarios: [
    { scenario: "安全な既定展開", handling: "mode=explicit、ttl省略/30m、prewarm省略/falseをfield単位で許容。breakpoint 0とcache read/write 0を別確認。" },
    { scenario: "実設定の不一致", handling: "model/tier/background/tools/reasoning/output cap/truncation/format等の重要差は技術除外し停止。" },
    { scenario: "未知の名前・値・出力", handling: "rawを記録せずhash/typeを保持し、意味を推測せずfail closedで停止。" },
  ],
  cases: caseRows,
  documentation: preflight.documentation.map(d => ({ path: d.path, sha256: d.sha256, sourceURL: d.sourceURL ?? null })),
  sourceURLs: pricing.sourceURLs,
  provenance: [...provenance.values()].sort((a, b) => a.path.localeCompare(b.path)),
  constraints: {
    noClinicalAuthority: true,
    noPublicationAuthority: true,
    noAdoptionAuthority: true,
    noNormalGateChange: true,
    noUserDatabaseChange: true,
    noApprovalRequest: true,
    noRawAnswerIncluded: true,
  },
  validation: {
    eventHashChain: true,
    sourceHashes: true,
    counts: true,
    currency: true,
    localHashLiteralResolution: true,
    html: null,
  },
};

assert.equal(report.transmissions.cumulative, 20 + 1);
assert.equal(report.transmissions.continuationRemaining, 23 - 1);
assert.equal(report.transmissions.cH06LunaMateUnsent + report.transmissions.otherPairsNotStarted * 2, 21);
assert.equal(report.transmissions.plannedContinuationUnsent, final.unexecuted.length);
assert.equal(report.transmissions.continuationRemaining - report.transmissions.plannedContinuationUnsent, 1);
assert.equal(report.costs.knownPlusReserves.USD, 0.1353765);
assert.equal(report.costs.remainingBudgetAccounting.USD, 0.8646235);
assert.equal(report.review.bodyMeaning, "not-assessable");
assert.equal(report.recommendation.winner, null);

const esc = value => String(value).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const code = value => `<code>${esc(value)}</code>`;
const row = cells => `<tr>${cells.map((cell, i) => i === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join("")}</tr>`;
const table = (caption, headers, rows) => `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table><caption>${esc(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
const html = `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'">
<title>Luna / Sol 比較再開 — 停止・閉鎖報告</title>
<style>
:root{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;color:#18333b;background:#f3f6f4;line-height:1.75}*{box-sizing:border-box}body{margin:0}
a{color:#075d73;text-underline-offset:.2em}.skip{position:absolute;top:-5rem;left:1rem;background:#fff;padding:.8rem}.skip:focus{top:1rem}
header{background:#173f47;color:#fff;padding:3rem max(1rem,calc((100vw - 1100px)/2))}header p{color:#d9e9e8}h1{font-size:clamp(1.8rem,5vw,2.8rem);line-height:1.35;margin:.4rem 0}
.badge{display:inline-block;border:1px solid #f0cd80;border-radius:2rem;padding:.2rem .8rem;color:#ffe8b7}.eyebrow{letter-spacing:.1em;font-size:.8rem}
main{max-width:1140px;margin:auto;padding:1.3rem 1rem 4rem}nav{display:flex;flex-wrap:wrap;gap:.6rem 1.3rem;margin:0 0 1.2rem}
section{background:#fff;border:1px solid #d5e0dd;border-radius:12px;margin:1rem 0;padding:1.6rem}h2{font-size:1.4rem;margin-top:0}h3{font-size:1.08rem;margin:1.5rem 0 .4rem}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem}.metric{background:#edf6f4;border-radius:8px;padding:1rem}.metric strong{display:block;font-size:1.7rem;color:#14565d}
.notice{background:#fff5df;border-left:4px solid #a2670c;padding:.9rem 1rem;margin:1rem 0}.muted{font-size:.9rem;color:#566a70}
.table-wrap{overflow-x:auto;border:1px solid #d8e1df;border-radius:7px;margin:1rem 0}table{border-collapse:collapse;width:100%;font-size:.91rem}caption{text-align:left;font-weight:700;background:#edf3f2;padding:.7rem}
th,td{text-align:left;vertical-align:top;padding:.7rem;border-top:1px solid #d8e1df}thead th{background:#f8faf9;white-space:nowrap}.cases td:nth-child(3){min-width:320px}
code{font-family:ui-monospace,monospace;font-size:.86em;overflow-wrap:anywhere}.hash{display:block;background:#edf3f2;padding:.6rem;overflow-wrap:anywhere}
ul{padding-left:1.3rem}footer{color:#566a70;font-size:.88rem;padding:1rem}
@media(max-width:680px){header{padding:2rem 1rem}main{padding:.8rem .55rem 3rem}section{padding:1rem}.metrics{grid-template-columns:1fr}th,td{padding:.6rem}}
@media print{body{background:#fff}header{background:#fff;color:#18333b;padding:1rem}header p{color:#18333b}nav,.skip{display:none}main{max-width:none;padding:0}section{border-color:#aaa}.table-wrap{overflow:visible}table{font-size:8.5pt}}
</style></head><body>
<a class="skip" href="#main">本文へ移動</a>
<header><div class="eyebrow">READING COMPARISON 01 · RESUME · CLOSED</div>
<h1>モデル比較の修復再開<br>停止・閉鎖報告</h1><span class="badge">HOLD · 勝者なし</span>
<p>field単位の制御検証で1応答を受けた後、未知field/value/outputの意味を推測せず停止しました。</p></header>
<main id="main"><nav aria-label="目次"><a href="#conclusion">結論</a><a href="#repair">修復と停止</a><a href="#usage">利用量・費用</a><a href="#cases">12問</a><a href="#review">匿名レビュー</a><a href="#methods">方法・証拠</a></nav>
<section id="conclusion"><h2>結論：モデル選定は HOLD</h2>
<p><strong>比較可能な完了ペアは0組です。勝者、モデルの意味上の失敗、提供元の不良応答を認定しません。</strong></p>
<div class="metrics"><div class="metric"><strong>21 / 43</strong>累計送信</div><div class="metric"><strong>1 / 23</strong>再開分の実施</div><div class="metric"><strong>22</strong>再開分の残り</div></div>
<p>内訳は過去19＋旧Q10 Luna 1＋今回C-H06 Sol 1。旧枠の未使用1回は追加していません。許可上限までの残り22回のうち、凍結計画の未送信はC-H06 Luna mate 1回＋未開始10組の20回＝21回です。差の1回は今回上限内の未計画容量で、旧枠由来でも実行権限でもありません。</p>
<div class="notice">停止は<strong>許可不足でも予算枯渇でもなく、未知の意味を安全側で止める要件</strong>によります。残予算は未知項目を無視する権限になりません。</div>
<p>Q10はLunaの保存回答が存在しますが、返却cache設定の証拠が残っていないため、<strong>controlだけを理由に除外</strong>しました。本文欠落が理由ではなく、Q10の両側を再送しません。</p></section>

<section id="repair"><h2>修復できたこと／今回止めたこと</h2>
<p>旧検証器のcache object全体JSON一致を、field単位のallowlistへ置換しました。実送信では ${code("mode=explicit")}、${code("ttl=30m")}、${code("prewarm omitted（既定false）")}、明示breakpoint 0、cache read/write 0を確認し、この既知の既定展開は通過しました。</p>
<p>一方、${code("prompt_cache_retention=24h")}、未知の応答object、未知の出力fieldがあり、${code("undocumented_response_field")}・${code("unknown_control_value")}・${code("unknown_output_field")} で停止しました。実provider応答との完全互換性が確認できたとは主張しません。</p>
${table("既知の安全ケースと停止ケース", ["シナリオ", "扱い"], report.scenarios.map(s => row([esc(s.scenario), esc(s.handling)])).join(""))}
<h3>hashから安全に照合できた通常名・既知literal</h3>
${table("応答metadata/outputのfield監査", ["field", "観測", "扱い"], report.metadataAudit.safeResolved.map(x => row([code(x.field), esc(x.value), esc(x.effect)])).join(""))}
<p><strong>未解決：</strong>${code("billing")} objectはname SHA ${code(hashes.billingName)}、value SHA ${code(hashes.billingObject)}。もう1つの応答objectはname SHA ${code(hashes.unknownObjectName)}、value SHA ${code(hashes.unknownObjectValue)}。いずれも完全なobjectは <strong>UNKNOWN</strong> で、名前・値を推測しません。</p>
<p>特にfull safe unknown configurationがないため、billing objectの意味やcharge関連の影響を検証できません。課金以外の通常metadataにもschema coverageの拡張が必要です。</p>
<p class="muted">任意の未知値はsecret・相談本文を含み得るためrawを記録せず、hash/typeを保持しました。reasoningのencrypted_contentも値は表示しません。</p>
<p>HTTP statusは200。ただし保存recordにresponse status/response clockがないため、completedや精密レイテンシを補いません。送信予約から応答保存までのイベント間隔は <strong>${eventIntervalMs.toLocaleString("ja-JP")} ms</strong> であり、精密な応答時間ではありません。</p></section>

<section id="usage"><h2>観測利用量と費用</h2>
${table("今回のSol 1応答：観測usage", ["入力", "出力（推論内数）", "合計", "cache read/write", "台帳状態"],
  row(["2,581", "1,192（485）", "3,773", "0 / 0", "費用未知・予約保持"]))}
<p>出力1,192には推論485が含まれ、重ねて加算しません。token単価だけの別算術は ${code("2581×4 + 1192×20 = 34164 microUSD")}、<strong>$0.034164</strong>。これは観測usage由来の小計で、確定請求でもsettled billingでもなく、台帳へ追加しません。</p>
${table("運用台帳（USD）", ["区分", "値", "意味"],
  row(["過去の既知", "$0.025879", "25,879 microUSD"]) +
  row(["旧Q10予約", "$0.0055125", "5,512.5 microUSD"]) +
  row(["今回の予約", "$0.103985", "103,985 microUSD"]) +
  row(["既知＋予約", "$0.1353765", "二重加算なし"]) +
  row(["予算上の残り", "$0.8646235", "$1.00 − $0.1353765"]))}
<p class="muted">旧token-only 1,866.2 microUSDを再加算せず、今回のusage由来小計も予約と二重加算しません。予約は請求額ではありません。</p></section>

<section id="cases"><h2>凍結12ケースの現在地</h2>
<p>Q10を除外、C-H06はSolのみ新規技術除外でLuna mate未送信、他10組は未開始です。完了ペアは0です。</p>
<div class="cases">${table("既知6＋新規6の短い状態表", ["順／ID", "群", "質問", "Luna", "Sol", "組"],
  caseRows.map(c => row([`${c.order}<br>${code(c.caseId)}`, c.lane === "known" ? "既知" : "新規", esc(c.question), esc(c.luna), esc(c.sol), esc(c.pair)])).join(""))}</div>
<p>技術除外された回答本文はこの報告に再掲しません。意味上の失敗・成功を推論しないためです。</p></section>

<section id="review"><h2>匿名AIレビューの範囲</h2>
<p>C-H06/Yの匿名packetをfresh contextのAIが確認し、レビューを ${code(reviewEvent.at)} に保存・hash固定した後、${code(unmaskEvent.at)} にモデル対応を開示しました。モデル識別、過去回答はレビュー時に未提示です。</p>
<p>技術除外のため、本文の意味、質問網羅、画面全体、日本語品質はいずれも ${code("not-assessable")}。共通appDisplayだけが ${code("pass")} ですが、<strong>静的テンプレート単独</strong>の判定であり、モデル本文・画面全体・実アプリ動作のpassではありません。</p>
<p>匿名AI判定であり、人間の独立評価を代替しません。旧Q10レビューも開示前固定済みです。</p>
<span class="hash">review SHA-256: ${esc(report.review.reviewSha256)}</span>
<span class="hash">blind packet SHA-256: ${esc(report.review.blindPacketSha256)}</span></section>

<section id="methods"><h2>方法・試験・証拠</h2>
<p>オフライン合成fixtureの<strong>26ケース</strong>で、無害な追加/null/omission、重要差分、未知名・値、pair sampling invariant、費用・予約、lock・再開・レビュー・sealを確認しました。修復試験中のmodel APIは0、最後の実送信だけ1です。文書閲覧は公開資料の参照であり、model API通信とは区別します。</p>
<div class="notice">26試験のpassはローカル検証ロジックの証拠であり、実provider応答との完全互換性の証明ではありません。</div>
<h3>公開資料の参照URL</h3><ul>${[...pricing.sourceURLs, ...preflight.documentation.flatMap(d => d.sourceURL ? [d.sourceURL] : [])].map(url => `<li>${code(url)}</li>`).join("")}</ul>
<p>資料・コード・イベント・packet・review・finalのSHA-256とイベントchainをローカルで再検証しました。数、通貨、既知literalのJSON SHA、HTML内部構造も生成時にassertしています。</p>
<p><strong>権限の限界：</strong>臨床判断、公開・採用承認、通常gate、ユーザーDBを変更していません。追加承認の依頼も行いません。</p></section>
<footer>自己完結型の静的報告 · 外部画像／script／font／通信なし · raw回答本文なし</footer>
</main></body></html>`;

assert.ok(html.startsWith("<!doctype html>"));
assert.ok(html.includes('<html lang="ja">'));
assert.ok(html.includes('name="viewport"'));
assert.equal((html.match(/<table>/g) || []).length, (html.match(/<\/table>/g) || []).length);
assert.equal((html.match(/<table>/g) || []).length, (html.match(/<caption>/g) || []).length);
assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length);
assert.ok(!/<(?:script|link|img|iframe|object|embed|form|video|audio)\b/i.test(html));
assert.ok(!/\s(?:src|srcset|action|poster|on[a-z]+)\s*=/i.test(html));
assert.ok(!/@import\b|url\s*\(/i.test(html));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length);
for (const match of html.matchAll(/\shref="([^"]+)"/g)) {
  assert.ok(match[1].startsWith("#"));
  assert.ok(ids.includes(match[1].slice(1)));
}
for (const item of caseRows) assert.ok(html.includes(esc(item.question)));
assert.ok(!html.includes(oldQ10.outputText));
assert.ok(!html.includes(response.outputText));
report.validation.html = {
  selfContained: true,
  responsiveViewport: true,
  noExternalResourcesOrScripts: true,
  uniqueInternalAnchors: true,
  tablesCaptioned: true,
  allTwelveCaseQuestionsPresent: true,
  rawAnswersAbsent: true,
};

const outputJson = `${JSON.stringify(report, null, 2)}\n`;
assert.deepEqual(JSON.parse(outputJson), report);
writeFileSync(resolve(root, `${run}/report.json`), outputJson);
writeFileSync(resolve(root, `${run}/comparison-resume-result.html`), html);
console.log(JSON.stringify({
  status: report.status,
  files: [`${run}/report.json`, `${run}/comparison-resume-result.html`],
  validated: report.validation,
}, null, 2));