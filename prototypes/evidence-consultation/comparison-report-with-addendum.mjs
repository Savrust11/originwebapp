#!/usr/bin/env node
/**
 * Post-run supplemental report generator.
 *
 * PREPARATION STATE: importing does nothing. Executing refuses to read any
 * supplemental packet, plan, mapping, diagnostic, or review until all three
 * fixed review paths exist. It never sends requests and never reads env/DB/API.
 * Original report.json and comparison-report-v2.html are hash-bound before and
 * after the two append-only outputs are exclusively created.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateReview } from "./model-comparison-execution/controls.mjs";

const ROOT = process.cwd();
const RUN_REL = "evidence-work/model-comparison-runs/reading-comparison-02";
const RUN = path.join(ROOT, RUN_REL);
const SUP = path.join(RUN, "supplemental");
const ORIGINAL_JSON = path.join(RUN, "report.json");
const ORIGINAL_HTML = path.join(RUN, "comparison-report-v2.html");
const OUTPUT_JSON = path.join(RUN, "report-with-addendum.json");
const OUTPUT_HTML = path.join(RUN, "comparison-report-with-addendum.html");
const PLAN = path.join(SUP, "plan.json");
const MAPPING = path.join(SUP, "private/mapping.json");
const DIAGNOSTIC = path.join(RUN, "newrun/post-run-diagnostics/validate-answer-identity-regex-20260918.json");
const ITEMS = [
  { caseId: "C-H04", label: "X" },
  { caseId: "C-H04", label: "Y" },
  { caseId: "C-K08", label: "X" },
].map(item => ({
  ...item,
  review: path.join(SUP, "reviews", `${item.caseId}-${item.label}.json`),
  packet: path.join(SUP, "blind", item.caseId, item.label, "packet.json"),
}));
const MODELS = ["gpt-5.6-sol", "gpt-5.6-luna"];
const SHORT = { "gpt-5.6-sol": "Sol", "gpt-5.6-luna": "Luna" };
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const bytes = file => fs.readFileSync(file);
const json = file => JSON.parse(bytes(file).toString("utf8"));
const assert = (value, message) => { if (!value) throw new Error(message); };
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const usd = value => `$${(value / 100000000).toFixed(8)}`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const text = (value, max = 700) => typeof value === "string"
  ? value.replace(/\s+/g, " ").trim().slice(0, max) : null;

function supplementalGate() {
  // Do not inspect even plan/mapping/packets while any independent review is
  // absent. Existence is checked without opening the files.
  const missing = ITEMS.filter(item => !fs.existsSync(item.review)).map(item => path.relative(ROOT, item.review));
  assert(missing.length === 0, `PREPARED_NOT_RENDERED: all3fixed gate waiting for ${missing.join(", ")}`);
  for (const item of ITEMS) {
    assert(fs.lstatSync(item.review).isFile(), "supplemental_review_not_file");
    assert(fs.existsSync(item.packet) && fs.lstatSync(item.packet).isFile(), "supplemental_packet_missing");
  }
}

function assertNoSymlink(file) {
  for (let cursor = file; cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "symlink_forbidden");
    if (cursor === ROOT) break;
  }
}

function containsHashAndIdentity(plan, packetHash, item) {
  const serialized = JSON.stringify(plan);
  return serialized.includes(packetHash) && serialized.includes(item.caseId) && serialized.includes(item.label);
}

function verdict(review, layer) {
  const value = review?.layers?.[layer]?.verdict;
  return typeof value === "string" ? value : "not-recorded";
}

function excerptAt(source, needle, max = 420) {
  const index = source.indexOf(needle);
  if (index < 0) return null;
  const start = Math.max(0, index - Math.max(0, max - needle.length) / 2);
  return source.slice(Math.floor(start), Math.floor(start) + max).replace(/\s+/g, " ").trim();
}

function illustration(packet, review) {
  const reasons = [
    review?.layers?.bodyMeaning?.reason,
    review?.layers?.bodyQuestionCoverage?.reason,
    review?.layers?.wholeScreenMeaning?.reason,
    ...(review?.criteria ?? []).filter(row => row.verdict !== "pass").map(row => row.reason),
  ].filter(Boolean);
  const needles = reasons.flatMap(reason => [...reason.matchAll(/「([^」]{2,})」/g)].map(match => match[1]))
    .sort((a, b) => b.length - a.length);
  const answerObject = packet.answer?.content ?? packet.answer?.answer ?? packet.answer ?? packet.response?.answer ?? {};
  const answerTexts = [
    ...(answerObject.explanations ?? []), ...(answerObject.limitations ?? []), answerObject.abstention,
  ].map(row => row?.text).filter(Boolean);
  let answerQuote = null;
  for (const needle of needles) {
    const found = answerTexts.find(value => value.includes(needle));
    if (found) { answerQuote = excerptAt(found, needle); break; }
  }
  if (!answerQuote && answerTexts.length) answerQuote = text(answerTexts[0], 420);
  const originals = packet.originalEvidence ?? [];
  let sourceQuote = null, sourceOriginalId = null;
  for (const needle of needles) {
    const found = originals.find(row => row.original_text?.includes(needle));
    if (found) {
      sourceQuote = excerptAt(found.original_text, needle);
      sourceOriginalId = found.original_id;
      break;
    }
  }
  if (!sourceQuote && originals.length) {
    sourceQuote = text(originals[0].original_text, 420);
    sourceOriginalId = originals[0].original_id;
  }
  return { answerQuote, sourceQuote, sourceOriginalId, frozenVerdictReasons: reasons.map(value => text(value)),
    purpose: "supplemental frozen review illustration only; no generator rescoring" };
}

function mappingModel(mapping, caseId, label, original) {
  const candidates = [
    mapping?.mapping?.[caseId], mapping?.[caseId],
    mapping?.labels?.[caseId], mapping?.supplementalMapping?.[caseId],
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (MODELS.includes(candidate[label])) return candidate[label];
    for (const model of MODELS) if (candidate[model] === label) return model;
  }
  const entry = mapping?.entries?.[`blind/${caseId}/${label}/packet.json`];
  if (typeof entry?.sourceBlindPacketSha256 === "string") {
    const source = original?.attempts?.find(attempt =>
      attempt.caseId === caseId && attempt.integrity?.blindPacketSha256 === entry.sourceBlindPacketSha256);
    if (MODELS.includes(source?.model)) return source.model;
  }
  throw new Error(`supplemental_mapping_missing:${caseId}:${label}`);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function metrics(attempts) {
  return Object.fromEntries(MODELS.map(model => {
    const rows = attempts.filter(row => row.model === model);
    const elapsed = rows.map(row => row.elapsedMs).filter(Number.isFinite);
    const costs = rows.map(row => row.usage?.centiMicroUSD).filter(Number.isSafeInteger);
    return [SHORT[model], {
      attempts: rows.length,
      elapsedObserved: elapsed.length,
      elapsedMedianMs: median(elapsed),
      elapsedRangeMs: elapsed.length ? [Math.min(...elapsed), Math.max(...elapsed)] : null,
      elapsedMeanMs: elapsed.length ? elapsed.reduce((a, b) => a + b, 0) / elapsed.length : null,
      computedTokenFeeCentiMicroUSD: costs.reduce((a, b) => a + b, 0),
      computedTokenFeeUSD: usd(costs.reduce((a, b) => a + b, 0)),
      meanComputedTokenFeeCentiMicroUSD: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      usage: {
        input: rows.reduce((n, row) => n + (row.usage?.input ?? 0), 0),
        output: rows.reduce((n, row) => n + (row.usage?.output ?? 0), 0),
        reasoning: rows.reduce((n, row) => n + (row.usage?.reasoning ?? 0), 0),
        read: rows.reduce((n, row) => n + (row.usage?.read ?? 0), 0),
        write: rows.reduce((n, row) => n + (row.usage?.write ?? 0), 0),
      },
    }];
  }));
}

function render(report) {
  const original = report.originalFrozenAnalysis;
  const rows = report.supplemental.items.map(item => `<tr><td>${esc(item.caseId)}</td><td>${esc(item.label)}</td>
    <td>${esc(SHORT[item.model])}</td><td>${esc(item.layers.bodyMeaning)}</td><td>${esc(item.layers.bodyQuestionCoverage)}</td>
    <td>${esc(item.layers.appDisplay)}</td><td>${esc(item.layers.wholeScreenMeaning)}</td></tr>`).join("");
  const details = report.supplemental.items.map(item => `<details><summary>${esc(item.caseId)} ${esc(item.label)} / ${esc(SHORT[item.model])}</summary>
    <p><b>packet:</b> <code>${esc(item.packetSha256)}</code><br><b>review:</b> <code>${esc(item.reviewSha256)}</code></p>
    <p><b>回答引用</b></p><blockquote>${esc(item.illustration.answerQuote ?? "記録なし")}</blockquote>
    <p><b>原文引用 ${esc(item.illustration.sourceOriginalId ?? "")}</b></p><blockquote>${esc(item.illustration.sourceQuote ?? "記録なし")}</blockquote>
    <p><b>固定review理由</b></p><ul>${item.illustration.frozenVerdictReasons.map(reason => `<li>${esc(reason)}</li>`).join("")}</ul>
    <p class="note">新しい独立採点の表示であり、旧primaryの再採点・統合ではない。</p></details>`).join("");
  const originalTable = lane => `<pre>${esc(JSON.stringify(original[lane].primary, null, 2))}</pre>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>モデル比較レポート・追補</title><style>
:root{--ink:#17252d;--muted:#52636d;--line:#c8d3d9;--wash:#f1f6f7;--accent:#075985}*{box-sizing:border-box}
body{margin:0;background:var(--wash);color:var(--ink);font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;line-height:1.65}
main{max-width:1180px;margin:auto;background:#fff;padding:clamp(18px,4vw,52px)}h1,h2{line-height:1.3}.banner{border-left:5px solid var(--accent);background:#e9f5fa;padding:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card,details{border:1px solid var(--line);padding:14px;border-radius:8px;margin:10px 0}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:8px;text-align:left}th{background:#e8f0f3}
blockquote{border-left:3px solid var(--line);margin:8px 0;padding:4px 12px}.note{color:var(--muted)}code,pre{white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:600px){main{padding:14px}}@media print{body{background:#fff;font-size:10pt}main{max-width:none;padding:0}details{break-inside:avoid}details>*{display:block!important}}
</style></head><body><main><p class="note">append-only post-unmask supplement / ${esc(report.generatedAt)}</p>
<h1>モデル比較レポート：技術訂正と独立追補</h1>
<div class="banner"><b>訂正見出し:</b> provider上の実状態は <b>20 completed + 1 incomplete</b>。original local validatorの状態はaccepted 17 + identity-regex false-positive 3 + real JSON truncation 1であり、completion rateではない。送信数・usage・費用・elapsedは変更しない。</div>
<h2>分母を分離</h2><div class="grid"><div class="card">全新規call: <b>21</b><br>paired attempts: <b>20</b><br>累積: <b>42</b></div>
<div class="card">旧formal eligible primary: <b>8 pair</b><br>known 4 / new 4（固定）</div>
<div class="card">supplement: H04 pair + K08 Luna single<br>旧primaryへ非統合</div></div>
<p>H04両側とK08 Lunaは、public source ID <code>E03-C-RISK-OF-BIAS</code>中の文字列がidentity regexの<code>SK-O</code>に一致したlocal false positive。JSON/schema/citations/provider completionは構造的に確認され、内容採点前のplan hashに拘束された。K08 Solだけがprovider incomplete / max_output_tokens / JSON truncationの実不完了。</p>
<h2>旧primary（無変更）</h2><div class="grid"><section><h3>known</h3>${originalTable("known")}</section><section><h3>new</h3>${originalTable("new")}</section></div>
<p>追補を9 pairのprespecified比較とは呼ばず、旧primary分母・勝敗へ合算しない。post-hoc weightやoverall winnerなし。</p>
<h2>旧記録に残る意味failと条件省略</h2>
<p>bodyMeaning failは2回答（formal eligibleのH05 Luna 1件、reference-onlyのH06 Luna 1件）。真の条件省略はK05両回答の帰属2件で、bodyCompleteness=missing / bodyQuestionCoverage=pass / wholeScreenMeaning=passを変更しない。</p>
${report.preservedContentFindings.map(item => `<section class="card"><h3>${esc(item.caseId)} / ${esc(SHORT[item.model])} — ${esc(item.kind)}</h3>
<p><b>回答:</b></p><blockquote>${esc(item.answerQuote)}</blockquote><p><b>原文:</b></p><blockquote>${esc(item.sourceQuote)}</blockquote>
<p><b>固定理由:</b> ${esc(item.reason)}</p></section>`).join("")}
<h2>補足的な独立内容採点</h2><div class="scroll"><table><tr><th>case</th><th>label</th><th>model</th><th>bodyMeaning</th><th>coverage</th><th>app</th><th>whole screen</th></tr>${rows}</table></div>${details}
<p>3 reviewerはいずれもpost-unmask supplement用のfresh independent context。packetではmodel identityを伏せ、固定reviewをpacket SHA-256へbind。generatorは既存validateReviewをそのまま使用し、grade/packetを書き換えていない。</p>
<h2>技術・時間・費用</h2><p>all21: <code>${esc(JSON.stringify(report.unchangedOperationalSummary.all21ByModel))}</code></p>
<p>paired20: <code>${esc(JSON.stringify(report.unchangedOperationalSummary.paired20ByModel))}</code></p>
<p>Sol all10 elapsed median <b>34.003s</b> / Luna all11 median <b>9.233s</b>。観測elapsedであり内部provider latencyの推測ではない。17 acceptedはrateや品質比較ではない。</p>
<p>closed total: ${report.accounting.closedTotalCentiMicroUSD} centiMicroUSD (${esc(usd(report.accounting.closedTotalCentiMicroUSD))})。A/B global stop 0。H06 Solはcompletion proof未証明のreference-only、H06 Luna body failも旧記録のまま。</p>
<h2>provenance</h2><ul><li>plan SHA-256: <code>${esc(report.supplemental.planSha256)}</code></li><li>diagnostic SHA-256: <code>${esc(report.supplemental.diagnosticSha256)}</code></li>
<li>original report SHA-256: <code>${esc(report.originalBindings.reportJson.sha256)}</code></li><li>original HTML SHA-256: <code>${esc(report.originalBindings.reportHtml.sha256)}</code></li></ul>
<p class="note">臨床的・一般的・統計的優越、採用・公開承認を示さない。外部script/font/networkなし。DB/API/env/old snapshot変更なし。</p>
</main></body></html>`;
}

function main() {
  supplementalGate();
  [ORIGINAL_JSON, ORIGINAL_HTML, PLAN, MAPPING, DIAGNOSTIC, ...ITEMS.flatMap(item => [item.review, item.packet])]
    .forEach(assertNoSymlink);
  const outputsExist = fs.existsSync(OUTPUT_JSON) || fs.existsSync(OUTPUT_HTML);
  if (outputsExist) {
    assert(fs.existsSync(OUTPUT_JSON) && fs.existsSync(OUTPUT_HTML), "partial_addendum_outputs_exist");
    assert(json(OUTPUT_JSON)?.reportId === "reading-comparison-02-post-run-addendum"
      && bytes(OUTPUT_HTML).toString("utf8").includes("<title>モデル比較レポート・追補</title>"),
    "refuse_to_replace_non_generator_addendum");
  }

  const originalJsonBytes = bytes(ORIGINAL_JSON), originalHtmlBytes = bytes(ORIGINAL_HTML);
  const originalHashes = { report: sha256(originalJsonBytes), html: sha256(originalHtmlBytes) };
  const original = JSON.parse(originalJsonBytes.toString("utf8"));
  const planBytes = bytes(PLAN), plan = JSON.parse(planBytes.toString("utf8"));
  const diagnosticBytes = bytes(DIAGNOSTIC), diagnostic = JSON.parse(diagnosticBytes.toString("utf8"));
  const mapping = json(MAPPING);

  assert(original.denominators?.eligiblePairs === 8 && original.denominators?.knownEligiblePairs === 4
    && original.denominators?.newEligiblePairs === 4, "original_primary_denominator_changed");
  assert(original.denominators?.allPairedAttempts === 20 && original.denominators?.newCalls === 21
    && original.denominators?.cumulativeCalls === 42, "original_operational_denominator_changed");
  assert(original.technicalSummary?.states?.["completed-schema"] === 17
    && original.technicalSummary?.states?.["technical-invalid"] === 4, "original_validator_record_changed");

  const supplemental = ITEMS.map(item => {
    const packetBytes = bytes(item.packet), packet = JSON.parse(packetBytes.toString("utf8"));
    const reviewBytes = bytes(item.review), review = JSON.parse(reviewBytes.toString("utf8"));
    const packetHash = sha256(packetBytes);
    assert(packet.caseId === item.caseId && packet.label === item.label, "supplemental_packet_identity");
    assert(containsHashAndIdentity(plan, packetHash, item), "packet_not_bound_by_pregrading_plan");
    validateReview(review, packet, packetHash); // unchanged frozen validator
    assert(review.contextIsolation?.freshContext === true && review.contextIsolation?.modelIdentityKnown === false
      && review.contextIsolation?.priorAnswersSeen === false, "supplemental_context_not_independent_blind");
    return {
      caseId: item.caseId, label: item.label, model: mappingModel(mapping, item.caseId, item.label, original),
      packetPath: path.relative(RUN, item.packet), packetSha256: packetHash,
      reviewPath: path.relative(RUN, item.review), reviewSha256: sha256(reviewBytes),
      planBoundBeforeGrading: true, validatedWithUnchangedValidateReview: true,
      layers: Object.fromEntries(["bodyMeaning", "bodyQuestionCoverage", "bodyAttributionPresence",
        "bodyCompleteness", "appDisplay", "wholeScreenMeaning", "surfaceQuality"].map(layer => [layer, verdict(review, layer)])),
      readability: Object.fromEntries((review.readability ?? []).map(row => [row.dimension, row.verdict])),
      illustration: illustration(packet, review),
    };
  });
  assert(supplemental.filter(item => item.caseId === "C-H04").length === 2
    && supplemental.filter(item => item.caseId === "C-K08").length === 1, "supplement_scope_changed");

  const pairedAttempts = original.attempts.filter(row => row.caseId !== "C-H06");
  const all21ByModel = metrics(original.attempts), paired20ByModel = metrics(pairedAttempts);
  const actualCompleted = original.attempts.filter(row => row.providerStatus === "completed").length;
  const actualIncomplete = original.attempts.filter(row => row.providerStatus === "incomplete").length;
  assert(actualCompleted === 20 && actualIncomplete === 1, "actual_provider_completion_changed");
  assert(all21ByModel.Sol.elapsedMedianMs === 34003 && all21ByModel.Luna.elapsedMedianMs === 9233,
    "observed_elapsed_median_changed");
  const report = {
    ...original,
    schemaVersion: 3,
    reportId: "reading-comparison-02-post-run-addendum",
    generatedAt: new Date().toISOString(),
    status: "append-only-supplement-after-three-fixed-independent-reviews",
    originalValidatorTechnicalSummary: original.technicalSummary,
    technicalSummary: {
      actualProviderCompleted: actualCompleted,
      actualProviderIncomplete: actualIncomplete,
      originalLocalValidatorStates: {
        accepted: 17,
        identityRegexFalsePositive: 3,
        independentJsonTruncation: 1,
      },
      actualIncompleteCase: "C-K08/gpt-5.6-sol",
      originalAttemptTechnicalStateFieldsPreservedAsHistoricalValidatorOutputs: true,
      noModelQualityFailureCountInferredFromValidatorStates: true,
      globalStopABCount: 0,
    },
    originalBindings: {
      reportJson: { path: `${RUN_REL}/report.json`, sha256: originalHashes.report, bytes: originalJsonBytes.length },
      reportHtml: { path: `${RUN_REL}/comparison-report-v2.html`, sha256: originalHashes.html, bytes: originalHtmlBytes.length },
      preservedUnmodified: true,
    },
    correctedTechnicalHeadline: {
      actualProviderCompleted: 20,
      actualProviderIncomplete: 1,
      originalValidatorAccepted: 17,
      localIdentityFalsePositives: 3,
      realIncomplete: 1,
      falsePositiveToken: "SK-O",
      publicSourceId: "E03-C-RISK-OF-BIAS",
      affected: ["C-H04/X", "C-H04/Y", "C-K08/X"],
      interpretation: "three local-validator false positives, not three model-quality failures",
      k08Sol: "provider incomplete; max_output_tokens; JSON truncation; sole real incomplete",
      acceptedIsNotCompletionRate: true,
      rootCauseDiagnostic: diagnostic.summary ?? diagnostic.findings ?? "bound diagnostic; see hash/path",
    },
    originalFrozenAnalysis: original.analysis,
    originalPrimaryPreserved: {
      eligiblePairs: 8, knownPairs: 4, newPairs: 4,
      mergedWithSupplement: false, retroRescored: false, overallWinnerAdded: false,
    },
    preservedContentFindings: original.attempts
      .filter(attempt => attempt.grading?.evidenceIllustration)
      .map(attempt => ({
        caseId: attempt.caseId, model: attempt.model,
        kind: attempt.grading.evidenceIllustration.kind,
        answerQuote: attempt.grading.evidenceIllustration.answerQuote,
        sourceQuote: attempt.grading.evidenceIllustration.sourceQuote,
        reason: attempt.grading.evidenceIllustration.verdictReasons?.[0] ?? "frozen review reason unavailable",
        originalVerdicts: {
          bodyMeaning: attempt.grading.axes.bodyMeaning,
          bodyQuestionCoverage: attempt.grading.axes.bodyQuestionCoverage,
          bodyCompleteness: attempt.grading.axes.bodyCompleteness,
          wholeScreenMeaning: attempt.grading.axes.wholeScreenMeaning,
        },
      })),
    supplemental: {
      status: "separate-post-unmask-independent-content-grading",
      planPath: path.relative(RUN, PLAN), planSha256: sha256(planBytes),
      diagnosticPath: path.relative(RUN, DIAGNOSTIC), diagnosticSha256: sha256(diagnosticBytes),
      packetCount: 3, reviewCount: 3, items: supplemental,
      method: "structural recovery fixed and hash-bound before grading; fresh randomized blind packets; three fresh independent reviews",
      neverMergedIntoOriginalPrimary: true,
      notPrespecifiedNinePairs: true,
    },
    unchangedOperationalSummary: {
      all21ByModel, paired20ByModel,
      comparisonMeaning: "means/medians/costs are descriptive operational observations, not quality rates",
      actualElapsedHeadline: { SolAll10MedianSeconds: 34.003, LunaAll11MedianSeconds: 9.233 },
      sendsUnchanged: true, runtimeUnchanged: true, usageUnchanged: true, costUnchanged: true,
    },
    accounting: original.accounting,
    preservation: {
      h06Sol: "reference-only; completion proof remains unproven",
      h06Luna: "body fail remains recorded separately",
      originalReviewsRewritten: 0, supplementalReviewsRewritten: 0, packetsRewritten: 0,
      apiCalls: 0, environmentReads: 0, databaseAccesses: 0, oldSnapshotChanges: 0,
    },
  };
  const html = render(report);
  const jsonTarget = outputsExist ? `${OUTPUT_JSON}.tmp-${process.pid}` : OUTPUT_JSON;
  const htmlTarget = outputsExist ? `${OUTPUT_HTML}.tmp-${process.pid}` : OUTPUT_HTML;
  fs.writeFileSync(jsonTarget, encode(report), { flag: "wx", mode: 0o644 });
  try {
    fs.writeFileSync(htmlTarget, html, { flag: "wx", mode: 0o644 });
    if (outputsExist) {
      fs.renameSync(jsonTarget, OUTPUT_JSON);
      fs.renameSync(htmlTarget, OUTPUT_HTML);
    }
  } catch (error) {
    if (fs.existsSync(jsonTarget)) fs.unlinkSync(jsonTarget);
    if (fs.existsSync(htmlTarget)) fs.unlinkSync(htmlTarget);
    throw error;
  }
  assert(sha256(bytes(ORIGINAL_JSON)) === originalHashes.report
    && sha256(bytes(ORIGINAL_HTML)) === originalHashes.html, "original_reports_changed");
  process.stdout.write(`GENERATED ${path.relative(ROOT, OUTPUT_JSON)} and ${path.relative(ROOT, OUTPUT_HTML)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}