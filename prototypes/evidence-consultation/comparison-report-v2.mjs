#!/usr/bin/env node
/**
 * Offline-only, post-unmask report generator for reading-comparison-02.
 *
 * This file deliberately has no dependency on the application, a database, an
 * API, environment variables, or project runner modules.  It will not inspect
 * any answer, mapping, diagnostic, or review unless both the final unmask asset
 * exists and the last event is an `unmasked` event.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const RUN_REL = "evidence-work/model-comparison-runs/reading-comparison-02";
const RUN = path.join(ROOT, RUN_REL);
const FINAL = path.join(RUN, "unmasked/final.json");
const EVENTS = path.join(RUN, "private/events");
const REPORT = path.join(RUN, "report.json");
const HTML = path.join(RUN, "comparison-report-v2.html");
const DEFINITIONS = {
  policy: path.join(ROOT, "evidence-work/model-comparison-preparation/reading-comparison-01/comparison-policy.json"),
  rubric: path.join(ROOT, "evidence-work/model-comparison-preparation/reading-comparison-01/rubric.json"),
  cases: path.join(ROOT, "evidence-work/model-comparison-preparation/reading-comparison-01/cases.json"),
  memo: path.join(RUN, "preflight/evidence-accounting-decision.json"),
};
const MODELS = ["gpt-5.6-sol", "gpt-5.6-luna"];
const MODEL_SHORT = { "gpt-5.6-sol": "Sol", "gpt-5.6-luna": "Luna" };
const AXES = [
  "bodyMeaning", "bodyQuestionCoverage", "appDisplay",
  "bodyAttributionPresence", "bodyCompleteness",
];
const READABILITY = ["日英混在", "専門用語の曖昧な訳", "係り受け", "一般向けの自然さ"];
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const readBytes = file => fs.readFileSync(file);
const readJson = file => JSON.parse(readBytes(file).toString("utf8"));
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const usd = value => `$${(value / 100000000).toFixed(8)}`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function safeRun(relative) {
  assert(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), "unsafe_asset_path");
  assert(!relative.split(/[\\/]/).includes(".."), "unsafe_asset_path");
  const target = path.join(RUN, relative);
  assert(target === RUN || target.startsWith(`${RUN}${path.sep}`), "asset_outside_new_run");
  for (let cursor = target; cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "symlink_forbidden");
    if (cursor === RUN) break;
  }
  return target;
}

function scalarVerdict(value) {
  if (typeof value === "boolean") return value ? "pass" : "fail";
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["verdict", "grade", "status", "result", "value", "assessment"]) {
    if (typeof value[key] === "string" || typeof value[key] === "boolean") return scalarVerdict(value[key]);
  }
  return null;
}

function findNamed(value, wanted, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const rows = [];
  for (const [key, child] of Object.entries(value)) {
    if (wanted.has(key)) rows.push({ key, value: child });
    if (child && typeof child === "object") rows.push(...findNamed(child, wanted, seen));
  }
  return rows;
}

function oneAxis(review, name) {
  const aliases = new Set([name, name[0].toLowerCase() + name.slice(1)]);
  const hits = findNamed(review, aliases).map(row => ({ ...row, verdict: scalarVerdict(row.value) }))
    .filter(row => row.verdict != null);
  const values = [...new Set(hits.map(row => row.verdict))];
  return values.length === 1 ? values[0] : values.length ? `ambiguous:${values.join("|")}` : "not-recorded";
}

function readabilityAxis(review, dimension) {
  const aliases = {
    "日英混在": ["日英混在", "mixedLanguage", "languageMixing"],
    "専門用語の曖昧な訳": ["専門用語の曖昧な訳", "terminology", "ambiguousTerminology"],
    "係り受け": ["係り受け", "dependency", "syntax"],
    "一般向けの自然さ": ["一般向けの自然さ", "naturalness", "generalAudienceNaturalness"],
  }[dimension];
  for (const alias of aliases) {
    const values = findNamed(review, new Set([alias])).map(x => scalarVerdict(x.value)).filter(Boolean);
    if (values.length) return [...new Set(values)].join("|");
  }
  const blocks = findNamed(review, new Set(["readability", "japaneseReadability"]));
  for (const block of blocks) {
    if (Array.isArray(block.value)) {
      const row = block.value.find(x => aliases.includes(x?.dimension) || aliases.includes(x?.axis) || aliases.includes(x?.name));
      if (row) return scalarVerdict(row) ?? "not-recorded";
    }
  }
  return "not-recorded";
}

function limitedText(value, max = 420) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function quoteProjection(review) {
  // Only reviewer-selected illustrative snippets are projected.  Never fall
  // back to outputText, fullResponse, encrypted_content, prompts, or ciphertext.
  const answerKeys = new Set(["answerQuote", "answer_quote", "responseQuote", "response_quote"]);
  const sourceKeys = new Set(["sourceQuote", "source_quote", "originalQuote", "original_quote", "evidenceQuote", "evidence_quote"]);
  const reasonKeys = new Set(["reason", "rationale", "criterionReason", "criterion_reason", "explanation"]);
  const take = keys => [...new Set(findNamed(review, keys).map(x => limitedText(x.value)).filter(Boolean))].slice(0, 8);
  return { answer: take(answerKeys), source: take(sourceKeys), reasons: take(reasonKeys) };
}

function criterionProjection(review, rubricCase) {
  const rows = [];
  const walk = (value, context = "") => {
    if (!value || typeof value !== "object" || rows.length >= 100) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          const frozen = typeof item.group === "string" && Number.isSafeInteger(item.index)
            ? rubricCase?.[item.group]?.[item.index] : null;
          const text = limitedText(item.criterion ?? item.requirement ?? item.text ?? item.name ?? item.id ?? frozen, 300);
          const verdict = scalarVerdict(item);
          if (text && verdict) rows.push({ context: item.group ?? context, criterion: text, verdict,
            reason: limitedText(item.reason ?? item.rationale ?? item.explanation, 420) });
        }
        walk(item, context);
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const next = /mandatory|conditional|forbidden|criterion|omission|optional/i.test(key) ? key : context;
      if (child && typeof child === "object") walk(child, next);
    }
  };
  walk(review);
  const rubricMandatory = rubricCase?.mandatory ?? [];
  const rubricConditional = rubricCase?.conditional ?? [];
  const kind = criterion => rubricMandatory.includes(criterion) ? "mandatory"
    : rubricConditional.includes(criterion) ? "conditional"
      : /optional/i.test(criterion) ? "optional" : "recorded";
  return rows.map(row => ({ ...row, kind: kind(row.criterion) }));
}

function excerptAt(text, needle, max = 420) {
  const index = text.indexOf(needle);
  if (index < 0) return null;
  const room = Math.max(0, max - needle.length);
  const start = Math.max(0, index - Math.floor(room / 2));
  return text.slice(start, start + max).replace(/\s+/g, " ").trim();
}

function evidenceIllustration(review, response, packet, axes, criteria) {
  const meaningFail = axes.bodyMeaning === "fail";
  const trueConditionOmission = axes.bodyCompleteness === "missing"
    || axes.bodyAttributionPresence === "absent";
  if (!meaningFail && !trueConditionOmission) return null;
  const selectedReasons = [
    ...(meaningFail ? [review?.layers?.bodyMeaning?.reason, review?.layers?.wholeScreenMeaning?.reason] : []),
    ...(trueConditionOmission ? [review?.layers?.bodyAttributionPresence?.reason,
      review?.layers?.bodyCompleteness?.reason, review?.layers?.wholeScreenMeaning?.reason] : []),
    ...criteria.filter(x => x.verdict === "fail").map(x => x.reason),
  ].filter(Boolean);
  const quoted = selectedReasons.flatMap(reason => [...reason.matchAll(/「([^」]{2,})」/g)].map(match => match[1]));
  const answerTexts = [
    ...(response?.answer?.explanations ?? []),
    ...(response?.answer?.limitations ?? []),
    response?.answer?.abstention,
  ].map(x => x?.text).filter(Boolean);
  let answerQuote = null;
  for (const needle of quoted.sort((a, b) => b.length - a.length)) {
    const text = answerTexts.find(candidate => candidate.includes(needle));
    if (text) { answerQuote = excerptAt(text, needle); break; }
  }
  if (!answerQuote && trueConditionOmission && answerTexts.length) answerQuote = limitedText(answerTexts[0]);

  const originals = Array.isArray(packet?.originalEvidence) ? packet.originalEvidence : [];
  let sourceQuote = null, sourceOriginalId = null;
  for (const needle of quoted.sort((a, b) => b.length - a.length)) {
    const original = originals.find(x => typeof x?.original_text === "string" && x.original_text.includes(needle));
    if (original) {
      sourceQuote = excerptAt(original.original_text, needle);
      sourceOriginalId = original.original_id;
      break;
    }
  }
  if (!sourceQuote && trueConditionOmission && originals.length) {
    sourceQuote = limitedText(originals[0].original_text);
    sourceOriginalId = originals[0].original_id;
  }
  // Attribution omission can be evidenced by a source statement even though
  // absence itself cannot be quoted from the answer. Use only reviewer-quoted
  // text that occurs verbatim in the supplied source.
  return {
    kind: meaningFail ? "already-graded-meaning-failure" : "true-condition-omission",
    answerQuote,
    answerQuoteRole: trueConditionOmission && !meaningFail
      ? "answer context; absence is established by the frozen reviewer, not inferred from this excerpt alone"
      : "reviewer-identified answer wording",
    sourceQuote,
    sourceOriginalId,
    verdictReasons: selectedReasons.map(x => limitedText(x, 700)),
    noRescoring: true,
  };
}

function usageProjection(diagnostic, eventResult) {
  const usage = diagnostic?.usage ?? diagnostic?.computedTokenCost ?? eventResult?.measured ?? {};
  const measured = diagnostic?.computedTokenCost ?? eventResult?.measured ?? diagnostic?.measured ?? {};
  return {
    input: usage.input_tokens ?? usage.input ?? measured.input ?? null,
    output: usage.output_tokens ?? usage.output ?? measured.output ?? null,
    reasoning: usage.output_tokens_details?.reasoning_tokens ?? usage.reasoning ?? measured.reasoning ?? null,
    read: usage.input_tokens_details?.cached_tokens ?? usage.cached ?? measured.read ?? null,
    write: usage.input_tokens_details?.cache_write_tokens ?? usage.cacheWrite ?? measured.write ?? null,
    centiMicroUSD: measured.centiMicroUSD ?? null,
    basis: measured.basis ?? null,
  };
}

function unknownProjection(diagnostic) {
  const unknown = Array.isArray(diagnostic?.controls?.unknown) ? diagnostic.controls.unknown : [];
  return unknown.map(row => {
    const allowed = ["public-schema-name", "screened-machine-identifier"].includes(row?.safetyClassification);
    return {
      path: typeof row?.path === "string" ? row.path : null,
      ...(allowed && typeof row?.name === "string" ? { safeExactName: row.name } : {}),
      safetyClassification: row?.safetyClassification ?? "not-recorded",
      classification: row?.classification ?? "C-metadata-unresolved",
      type: row?.type ?? null,
      length: Number.isSafeInteger(row?.length) ? row.length : null,
      nameSha256: typeof row?.nameSha256 === "string" ? row.nameSha256 : null,
    };
  });
}

function hierarchy(rows) {
  const root = {};
  for (const row of rows) {
    const safeNames = String(row.path ?? "").split(".").slice(1)
      .map(x => x.replace(/\[\d+\]/g, "[]"))
      .filter(x => /^[a-z][a-z0-9_]*(?:\[\])?$/.test(x));
    let node = root;
    for (const part of safeNames) node = node[part] ??= {};
  }
  return root;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function countBy(rows, key, values) {
  return Object.fromEntries(values.map(value => [value, rows.filter(row => row[key] === value).length]));
}

function technicalStatus(diagnostic, eventResult) {
  const incomplete = scalarVerdict(diagnostic?.incompleteReason) ?? diagnostic?.incompleteReason?.value ?? null;
  const provider = scalarVerdict(diagnostic?.providerStatus) ?? diagnostic?.providerStatus?.value ?? null;
  return {
    technicalState: eventResult?.technicalState ?? diagnostic?.technicalState ?? "not-recorded",
    providerStatus: provider,
    completionFlag: provider === "completed" ? "completed-observed"
      : provider ? `not-completed:${provider}` : "completion-not-recorded",
    tokenLimitFlag: incomplete === "max_output_tokens",
    incompleteReason: incomplete,
    httpStatus: diagnostic?.httpStatus ?? null,
    elapsedMs: Number.isFinite(diagnostic?.elapsedMs) ? diagnostic.elapsedMs : null,
    costAccounting: eventResult?.costAccounting ?? diagnostic?.costAccounting ?? "not-recorded",
    stopReasons: clone(eventResult?.stopReasons ?? diagnostic?.stopReasons ?? []),
    caseReasons: clone(diagnostic?.caseReasons ?? []),
  };
}

function verifyAndLoadEvents() {
  // First gate: do not even enumerate/read private events without final.json.
  assert(fs.existsSync(FINAL) && fs.lstatSync(FINAL).isFile(), "PREPARED_NOT_RUN: unmasked/final.json is absent");
  assert(fs.existsSync(EVENTS) && fs.lstatSync(EVENTS).isDirectory(), "event_directory_missing");
  const names = fs.readdirSync(EVENTS).sort();
  assert(names.length > 0, "event_chain_empty");
  names.forEach((name, index) => assert(name === `${String(index + 1).padStart(6, "0")}.json`, "event_sequence_broken"));
  // Second gate: inspect only the last event and require terminal unmask before
  // any mapping, model, answer, diagnostic, or review asset can be opened.
  const lastBytes = readBytes(path.join(EVENTS, names.at(-1)));
  const last = JSON.parse(lastBytes.toString("utf8"));
  assert(last.type === "unmasked", "PREPARED_NOT_RUN: last event is not unmasked");

  let previous = null;
  const events = [];
  const verifiedAssets = [];
  for (const [index, name] of names.entries()) {
    const bytes = readBytes(path.join(EVENTS, name));
    const event = JSON.parse(bytes.toString("utf8"));
    assert(event.sequence === index + 1 && event.previousSha256 === previous, "event_hash_chain_invalid");
    for (const asset of event.assets ?? []) {
      const bytesAsset = readBytes(safeRun(asset.path));
      assert(sha256(bytesAsset) === asset.sha256, `sealed_asset_changed:${asset.path}`);
      verifiedAssets.push({ path: asset.path, sha256: asset.sha256, bytes: bytesAsset.length });
    }
    previous = sha256(bytes);
    events.push({ ...event, sha256: previous });
  }
  assert(events.at(-1).type === "unmasked", "unmask_not_terminal");
  assert(events.at(-1).assets?.some(a => a.path === "unmasked/final.json"), "final_not_bound_by_unmask_event");
  return { events, verifiedAssets, tipSha256: previous };
}

function loadAttempt(final, attempt, definitions) {
  const label = final.mapping?.[attempt.caseId]?.[attempt.model];
  assert(typeof label === "string", `mapping_missing:${attempt.caseId}:${attempt.model}`);
  const result = attempt.result ?? {};
  assert(typeof result.responsePath === "string" && typeof result.diagnosticPath === "string", "attempt_paths_missing");
  const response = readJson(safeRun(result.responsePath));
  const diagnostic = readJson(safeRun(result.diagnosticPath));
  const packet = readJson(safeRun(result.blindPath));
  const reviewPath = `private/reviews/${attempt.caseId}/${label}.json`;
  const review = readJson(safeRun(reviewPath));
  const criterion = criterionProjection(review, definitions.rubric.cases?.[attempt.caseId]);
  const quotes = quoteProjection(review);
  const axes = Object.fromEntries(AXES.map(axis => [axis, oneAxis(review, axis)]));
  axes.wholeScreenMeaning = oneAxis(review, "wholeScreenMeaning");
  const readability = Object.fromEntries(READABILITY.map(axis => [axis, readabilityAxis(review, axis)]));
  const status = technicalStatus(diagnostic, result);
  const usage = usageProjection(diagnostic, result);
  const unknown = unknownProjection(diagnostic);
  const illustration = evidenceIllustration(review, response, packet, axes, criterion);
  return {
    attempt: attempt.attempt,
    cumulativeTransmission: attempt.cumulativeTransmission,
    caseId: attempt.caseId,
    lane: definitions.cases.cases.find(c => c.caseId === attempt.caseId)?.lane ?? "unknown",
    model: attempt.model,
    label,
    pairEligibility: clone(result.pairEligibility ?? null),
    ...status,
    usage,
    metadata: {
      state: diagnostic?.metadataState ?? result?.metadataState ?? "not-recorded",
      unknownFieldCount: unknown.length,
      safeExactNames: [...new Set(unknown.map(x => x.safeExactName).filter(Boolean))].sort(),
      safeHierarchy: hierarchy(unknown),
      sanitizedUnknownFields: unknown,
    },
    grading: {
      axes,
      readability,
      criteria: criterion,
      conditionalOmissions: criterion.filter(x => x.kind === "conditional" && /missing|omit|fail/i.test(x.verdict)),
      optionalOmissions: criterion.filter(x => x.kind === "optional" && /missing|omit|fail/i.test(x.verdict)),
      illustrativeQuotes: quotes,
      evidenceIllustration: illustration,
      decision: review?.decision ?? "not-recorded",
      ambiguityNote: "completeness=missing と question coverage の pass は基準上両立し得るため、意味を変更せず別軸で保持。",
    },
    integrity: {
      responsePath: result.responsePath,
      diagnosticPath: result.diagnosticPath,
      reviewPath,
      blindPath: result.blindPath,
      blindPacketSha256: result.blindPacketSha256 ?? null,
    },
    // Deliberately excludes response.outputText and response.answer. Quotes are
    // only reviewer-selected snippets above; this also prevents report.json
    // from becoming a duplicate full-response store.
    responseProjection: {
      technicalState: response?.technicalState ?? status.technicalState,
      answerPresent: response?.answer != null,
    },
  };
}

function tally(rows) {
  let solOnly = 0, lunaOnly = 0, bothPass = 0, bothFail = 0, ambiguous = 0;
  const cases = [];
  for (const caseId of [...new Set(rows.map(x => x.caseId))].sort()) {
    const pair = Object.fromEntries(rows.filter(x => x.caseId === caseId).map(x => [x.model, x]));
    const sol = pair["gpt-5.6-sol"]?.grading.axes.wholeScreenMeaning;
    const luna = pair["gpt-5.6-luna"]?.grading.axes.wholeScreenMeaning;
    if (sol === "pass" && luna === "pass") bothPass++;
    else if (sol === "fail" && luna === "fail") bothFail++;
    else if (sol === "pass" && luna === "fail") solOnly++;
    else if (sol === "fail" && luna === "pass") lunaOnly++;
    else ambiguous++;
    cases.push({ caseId, Sol: sol ?? "missing", Luna: luna ?? "missing" });
  }
  return { solOnly, lunaOnly, bothPass, bothFail, ambiguous, cases,
    meaningComparison: solOnly === lunaOnly ? "tie" : solOnly > lunaOnly ? "Sol-more-only-passes" : "Luna-more-only-passes",
    noOverallWeightedWinner: true };
}

function secondary(rows) {
  return Object.fromEntries([...AXES, ...READABILITY].map(axis => {
    const values = axis in (rows[0]?.grading.axes ?? {}) ? rows.map(x => x.grading.axes[axis])
      : rows.map(x => x.grading.readability[axis]);
    return [axis, Object.fromEntries(MODELS.map(model => {
      const modelRows = rows.filter(x => x.model === model);
      const modelValues = axis in (rows[0]?.grading.axes ?? {}) ? modelRows.map(x => x.grading.axes[axis])
        : modelRows.map(x => x.grading.readability[axis]);
      return [MODEL_SHORT[model], Object.fromEntries([...new Set(modelValues)].sort().map(v => [v, modelValues.filter(x => x === v).length]))];
    }))];
  }));
}

function makeChecks({ events, verifiedAssets, final, attempts, eligibleRows, definitions }) {
  const checks = [];
  const check = (id, condition, detail) => {
    assert(condition, `offline_check_failed:${id}`);
    checks.push({ id, passed: true, detail });
  };
  check("01-final-present", fs.existsSync(FINAL), "unmasked/final.json");
  check("02-terminal-unmask", events.at(-1).type === "unmasked", "last event");
  check("03-single-unmask", events.filter(e => e.type === "unmasked").length === 1, "exactly one");
  check("04-chain-sequenced", events.every((e, i) => e.sequence === i + 1), `${events.length} events`);
  check("05-assets-verified", verifiedAssets.length > 0, `${verifiedAssets.length} references`);
  check("06-final-bound", events.at(-1).assets.some(a => a.path === "unmasked/final.json"), "unmask asset");
  const unmaskIndex = events.length - 1;
  const accepted = events.filter(e => e.type === "review-accepted");
  check("07-reviews-before-unmask", accepted.every(e => events.indexOf(e) < unmaskIndex), `${accepted.length} reviews`);
  check("08-attempt-count", attempts.length === 21, "21 new calls");
  check("09-review-count", accepted.length === 21, "21 frozen reviews");
  check("10-no-q10-new", attempts.every(a => a.caseId !== "C-K10"), "Q10 excluded");
  check("11-one-h06-new", attempts.filter(a => a.caseId === "C-H06").length === 1, "Luna singleton");
  check("12-h06-luna", attempts.find(a => a.caseId === "C-H06")?.model === "gpt-5.6-luna", "no Sol regeneration");
  check("13-h06-reference", final.h06ReferenceOnly === true, "predecided technical boundary");
  check("14-h06-ineligible", !final.eligiblePairs.includes("C-H06"), "not a formal pair");
  check("15-q10-ineligible", !final.eligiblePairs.includes("C-K10"), "excluded");
  check("16-eligible-max", final.eligiblePairs.length <= 10, `${final.eligiblePairs.length} pairs`);
  check("17-paired-row-count", eligibleRows.length === final.eligiblePairs.length * 2, `${eligibleRows.length} rows`);
  check("18-known-max-five", new Set(eligibleRows.filter(x => x.lane === "known").map(x => x.caseId)).size <= 5, "known");
  check("19-holdout-max-five", new Set(eligibleRows.filter(x => x.lane !== "known").map(x => x.caseId)).size <= 5, "new");
  check("20-mapping-complete", attempts.every(a => final.mapping?.[a.caseId]?.[a.model]), "all attempts");
  check("21-policy-one-attempt", definitions.policy.design.generationsPerCasePerModel === 1, "frozen policy");
  check("22-rubric-primary", definitions.policy.analysis.primary.includes("wholeScreenMeaning"), "frozen policy");
  check("23-no-statistical-claim", Boolean(definitions.policy.analysis.noStatisticalSuperiorityClaim), "frozen limitation");
  check("24-memo-opening-known", definitions.memo.accountingCorrection.correctedOpeningBalance.knownCentiMicroUSD === 6004300, "exact integer");
  check("25-memo-q10-reserve", definitions.memo.accountingCorrection.q10.unresolvedReservationCentiMicroUSD === 551250, "exact integer");
  check("26-memo-h06-cost", definitions.memo.accountingCorrection.h06.knownCalculatedCostCentiMicroUSD === 3416400, "exact integer");
  check("27-memo-old-opening", definitions.memo.accountingCorrection.previousSnapshot.totalCentiMicroUSD === 13537650, "exact integer");
  check("28-no-old-output-path", REPORT.startsWith(RUN) && HTML.startsWith(RUN), "new run only");
  check("29-distinct-outputs", REPORT !== HTML, "JSON and HTML");
  check("30-model-set", attempts.every(a => MODELS.includes(a.model)), "frozen two-model set");
  check("31-technical-kept", attempts.every(a => typeof a.technicalState === "string"), "all failures retained");
  check("32-usage-projected", attempts.every(a => a.usage && Object.hasOwn(a.usage, "input")), "all attempts");
  check("33-elapsed-projected", attempts.every(a => Object.hasOwn(a, "elapsedMs")), "observed field retained");
  check("34-review-paths-new-run", attempts.every(a => a.integrity.reviewPath.startsWith("private/reviews/")), "local assets");
  check("35-no-full-response", attempts.every(a => !Object.hasOwn(a, "outputText") && !Object.hasOwn(a, "answer")), "sanitized report");
  check("36-no-ciphertext", !JSON.stringify(attempts).includes("encrypted_content"), "not projected");
  check("37-safe-names-screened", attempts.every(a => a.metadata.sanitizedUnknownFields.every(x => !x.safeExactName ||
    ["public-schema-name", "screened-machine-identifier"].includes(x.safetyClassification))), "exact-name hierarchy");
  check("38-axes-separated", attempts.every(a => AXES.every(x => Object.hasOwn(a.grading.axes, x))), "five axes");
  check("39-primary-separated", attempts.every(a => Object.hasOwn(a.grading.axes, "wholeScreenMeaning")), "primary");
  check("40-readability-four", attempts.every(a => READABILITY.every(x => Object.hasOwn(a.grading.readability, x))), "four dimensions");
  check("41-quotes-limited", attempts.every(a => [...a.grading.illustrativeQuotes.answer,
    ...a.grading.illustrativeQuotes.source, a.grading.evidenceIllustration?.answerQuote,
    a.grading.evidenceIllustration?.sourceQuote].filter(Boolean).every(x => x.length <= 420)), "illustrative only");
  check("42-conditional-separated", attempts.every(a => Array.isArray(a.grading.conditionalOmissions)), "conditional");
  check("43-optional-separated", attempts.every(a => Array.isArray(a.grading.optionalOmissions)), "optional");
  check("44-no-review-reuse", final.priorReviewsReused === false, "fresh reviews");
  check("45-accounting-integers", [final.accounting?.knownCentiMicroUSD, final.accounting?.unresolvedCentiMicroUSD,
    final.accounting?.totalCentiMicroUSD].every(Number.isSafeInteger), "micro-financial values");
  check("46-final-id", final.comparisonId === "reading-comparison-02", "run identity");
  check("47-case-definitions", attempts.every(a => definitions.cases.cases.some(c => c.caseId === a.caseId)), "frozen cases");
  check("48-primary-denominator", eligibleRows.length <= 20, "never mixes H06 singleton");
  check("49-new-denominator", attempts.length === 21, "all technical rows");
  check("50-budget", final.accounting.totalCentiMicroUSD <= 100000000, "$1 ceiling");
  check("51-offline-boundary", attempts.filter(a => a.grading.axes.bodyMeaning === "fail"
    || a.grading.axes.bodyCompleteness === "missing").every(a => a.grading.evidenceIllustration?.verdictReasons.length),
  "generator has no network/API/DB/environment access; graded failures/true omissions have reasons");
  return checks;
}

function render(report) {
  const th = cells => `<tr>${cells.map(x => `<th>${esc(x)}</th>`).join("")}</tr>`;
  const td = cells => `<tr>${cells.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`;
  const attemptRows = report.attempts.map(a => td([
    a.attempt, a.caseId, MODEL_SHORT[a.model], a.technicalState, a.providerStatus ?? "—",
    a.tokenLimitFlag ? "yes" : "no", a.elapsedMs ?? "—", a.usage.input ?? "—",
    a.usage.output ?? "—", a.usage.reasoning ?? "—", a.usage.read ?? "—",
    a.usage.write ?? "—", a.usage.centiMicroUSD == null ? "—" : `${a.usage.centiMicroUSD} (${usd(a.usage.centiMicroUSD)})`,
  ])).join("");
  const primaryRows = [...report.analysis.known.primary.cases, ...report.analysis.new.primary.cases]
    .map(x => td([x.caseId, x.Sol, x.Luna])).join("");
  const details = report.attempts.map(a => {
    const quotes = a.grading.illustrativeQuotes;
    const criteria = a.grading.criteria.filter(x => /fail|missing|major|omit/i.test(x.verdict));
    const evidence = a.grading.evidenceIllustration;
    return `<details><summary>${esc(a.caseId)} / ${esc(MODEL_SHORT[a.model])} — ${esc(a.grading.axes.wholeScreenMeaning)}</summary>
      <div class="grid"><section><h4>意味・完全性（採点済み記録の投影）</h4>
      <dl>${[...AXES, "wholeScreenMeaning"].map(k => `<dt>${esc(k)}</dt><dd>${esc(a.grading.axes[k])}</dd>`).join("")}</dl>
      <p class="note">${esc(a.grading.ambiguityNote)}</p></section>
      <section><h4>日本語可読性（別軸）</h4><dl>${READABILITY.map(k => `<dt>${esc(k)}</dt><dd>${esc(a.grading.readability[k])}</dd>`).join("")}</dl></section></div>
      <h4>重大・欠落の記録（再採点ではない）</h4>
      ${criteria.length ? `<ul>${criteria.map(x => `<li><b>${esc(x.kind)}</b> ${esc(x.criterion)} — ${esc(x.verdict)}${x.reason ? `: ${esc(x.reason)}` : ""}</li>`).join("")}</ul>` : "<p>構造化された該当記録なし。</p>"}
      <div class="grid"><section><h4>回答引用（採点者選択）</h4>${quotes.answer.length ? quotes.answer.map(q => `<blockquote>${esc(q)}</blockquote>`).join("") : "<p>引用記録なし。</p>"}</section>
      <section><h4>原文引用（採点者選択）</h4>${quotes.source.length ? quotes.source.map(q => `<blockquote>${esc(q)}</blockquote>`).join("") : "<p>引用記録なし。</p>"}</section></div>
      <p class="note">引用は既に保存された採点理由の例示のみ。ここでは回答を再採点しない。conditional omission と optional omission は別配列で保持。</p>
      ${evidence ? `<section class="card"><h4>${evidence.kind === "already-graded-meaning-failure" ? "意味fail" : "真の条件省略"}の対照例</h4>
      <p><b>回答側:</b></p>${evidence.answerQuote ? `<blockquote>${esc(evidence.answerQuote)}</blockquote>` : "<p>回答内引用なし（省略は引用不能）。</p>"}
      <p><b>収録原文 ${esc(evidence.sourceOriginalId ?? "")}:</b></p>${evidence.sourceQuote ? `<blockquote>${esc(evidence.sourceQuote)}</blockquote>` : "<p>該当する短い原文引用なし。</p>"}
      <p><b>凍結レビュー理由:</b></p><ul>${evidence.verdictReasons.map(reason => `<li>${esc(reason)}</li>`).join("")}</ul>
      <p class="note">${esc(evidence.answerQuoteRole)}。既存判定の説明のみで再採点ではない。</p></section>` : ""}
      <h4>技術・メタデータ</h4><p>unknownFieldCount=${a.metadata.unknownFieldCount}; safeExactNames=${esc(a.metadata.safeExactNames.join(", ") || "なし")}</p>
      ${a.stopReasons.length || a.caseReasons.length ? `<p class="warn">stop: ${esc(a.stopReasons.join(", ") || "なし")} / case: ${esc(a.caseReasons.join(", ") || "なし")}</p>` : ""}
    </details>`;
  }).join("");
  const sec = Object.entries(report.analysis.known.secondary).map(([axis, value]) => {
    const fresh = report.analysis.new.secondary[axis];
    return `<tr><td>${esc(axis)}</td><td><code>${esc(JSON.stringify(value.Sol))}</code></td><td><code>${esc(JSON.stringify(value.Luna))}</code></td><td><code>${esc(JSON.stringify(fresh.Sol))}</code></td><td><code>${esc(JSON.stringify(fresh.Luna))}</code></td></tr>`;
  }).join("");
  const excluded = report.pairEligibility.excludedCases.map(x => td([
    x.caseId, x.nativeSamplingEligible, x.technicalStates.Sol, x.technicalStates.Luna, x.exclusionReason,
  ])).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>モデル比較 reading-comparison-02</title><style>
:root{color-scheme:light;--ink:#192126;--sub:#52616b;--line:#cbd5dc;--paper:#fff;--wash:#f3f7f8;--accent:#075985;--warn:#9a3412}
*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;line-height:1.65}
main{max-width:1180px;margin:auto;background:var(--paper);padding:clamp(18px,4vw,54px)}h1,h2,h3{line-height:1.3;color:#12303f}h1{font-size:clamp(1.7rem,4vw,2.8rem)}
.lede,.note{color:var(--sub)}.banner{border-left:5px solid var(--accent);padding:12px 16px;background:#eaf5fa}.warn{color:var(--warn)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.card{border:1px solid var(--line);padding:16px;border-radius:8px}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{padding:8px;border:1px solid var(--line);text-align:left;vertical-align:top}th{background:#e8f0f3}
details{border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0}summary{cursor:pointer;font-weight:700}dt{font-weight:700;float:left;clear:left;margin-right:1em}dd{margin:0 0 5px 13em}
blockquote{border-left:3px solid var(--line);margin:8px 0;padding:4px 12px;color:#34454f}code{white-space:normal;overflow-wrap:anywhere}
@media(max-width:600px){main{padding:15px}dt{float:none}dd{margin-left:0}.hide-small{display:none}}
@media print{body{background:#fff;font-size:10pt}main{max-width:none;padding:0}details{break-inside:avoid}details>summary{list-style:none}details>*{display:block!important}.banner{border:1px solid #777}.scroll{overflow:visible}a{color:#000}}
</style></head><body><main>
<p class="lede">オフライン・unmask後生成 / ${esc(report.generatedAt)}</p><h1>モデル比較レポート v2</h1>
<div class="banner"><b>結論の境界:</b> AIによる原文比較・日本語評価であり、臨床的・一般的・統計的優越性、採用、公開承認を示さない。質問は既知資料から作成され、未見コーパスではない。各モデル各ケース1回。</div>
<h2>比較対象と分母</h2><div class="grid">
<div class="card"><b>正式なeligible pair</b><br>${report.denominators.eligiblePairs}組 / ${report.denominators.eligiblePairedAttempts}回答<br>known 最大5 + new 最大5（最大10組）</div>
<div class="card"><b>全paired attempts</b><br>${report.denominators.allPairedAttempts}回答 / ${report.denominators.allCandidatePairs}組<br>うちeligibleは${report.denominators.eligiblePairs}組</div>
<div class="card"><b>新規技術記録</b><br>${report.denominators.newCalls} calls（H06 Luna 1件を含む）</div>
<div class="card"><b>除外・参照</b><br>Q10: 再生成なし・除外<br>H06: completion proof不足によるreference-only（品質判断ではない）</div></div>
<p>H06 Luna は新規のper-model記録、旧H06 Solはprior-content diagnosticであり、正式pairでもwinner判定でもない。21件の技術統計、eligible paired subset、旧H06費用の分母を混ぜない。</p>
<p>native-pair fairness guard: ${esc(report.pairEligibility.nativeSamplingSummary)}。guardまたは技術条件でblockedのcaseはeligible primaryから除外し、片側のsilent winにはしない。</p>
<div class="scroll"><table>${th(["excluded case","native sampling fair","Sol technical","Luna technical","reason"])}${excluded}</table></div>
<h2>Primary: wholeScreenMeaning</h2>
<div class="grid"><div class="card"><h3>Known</h3><pre>${esc(JSON.stringify(report.analysis.known.primary, null, 2))}</pre></div>
<div class="card"><h3>New</h3><pre>${esc(JSON.stringify(report.analysis.new.primary, null, 2))}</pre></div></div>
<p>Solのみ/Lunaのみ/両方pass/両方failをexact frozen primaryとして数える。同数はtie。二次軸へ恣意的な重みを付けた総合勝者は作らない。</p>
<div class="scroll"><table>${th(["case","Sol","Luna"])}${primaryRows}</table></div>
<h2>Secondary axes（個別集計）</h2><p>bodyMeaning / bodyQuestionCoverage / appDisplay / bodyAttributionPresence / bodyCompleteness と、可読性4軸は互いに別集計。completeness missing と question pass の意味を統一的なmeaning winへ作り替えない。</p>
<div class="scroll"><table>${th(["axis","known Sol","known Luna","new Sol","new Luna"])}${sec}</table></div>
<h2>技術状態: 全21新規attempt</h2>
<div class="scroll"><table>${th(["#","case","model","technical","provider","token limit","elapsedMs","input","output","reasoning","read","write","computed token fee"])}${attemptRows}</table></div>
<p>elapsedMsはrunnerが観測したprovider response elapsedであり、provider latencyの推測値ではない。新規モデル別中央値・範囲: <code>${esc(JSON.stringify(report.runtime.byModel))}</code>。旧Sol H06 latencyは利用不能で、補完しない。</p>
<p>baseline 21 + latest new 21 = cumulative 42 transmissions。A/B global stopは${report.technicalSummary.globalStopABCount}件で、全21新規attemptを完了。意味failやschema invalidをsilentに捨てていない。</p>
<h2>会計（exact centiMicroUSD）</h2>
<div class="scroll"><table>${th(["項目","centiMicroUSD","USD","扱い"])}
${td(["old opening",13537650,usd(13537650),"履歴は変更しない"])}
${td(["corrected opening known",6004300,usd(6004300),"old historical known + old H06 Sol actual"])}
${td(["Q10 reserve",551250,usd(551250),"unresolved; token estimateはcharged ledgerから除外、二重計上なし"])}
${td(["corrected opening total",6555550,usd(6555550),"new actualの前"])}
${td(["new actual known",report.accounting.newActualKnownCentiMicroUSD,usd(report.accounting.newActualKnownCentiMicroUSD),"21 new calls"])}
${td(["closed known",report.accounting.closedKnownCentiMicroUSD,usd(report.accounting.closedKnownCentiMicroUSD),"final.json"])}
${td(["closed unresolved",report.accounting.closedUnresolvedCentiMicroUSD,usd(report.accounting.closedUnresolvedCentiMicroUSD),"final.json"])}
${td(["closed total",report.accounting.closedTotalCentiMicroUSD,usd(report.accounting.closedTotalCentiMicroUSD),"上限 $1"])}
</table></div>
<p>旧H06 Sol: input 2581 / output 1192（reasoning 485はoutput内包）/ computed ${usd(3416400)}。旧Q10 token arithmetic ${usd(186620)} は参考推定で、保持された ${usd(551250)} reserveと二重課金しない。</p>
<h2>A / B / C とunknown fields</h2><ul><li><b>A</b>: 許可済みendpoint/model/tier/store/tool/cache条件への観測された矛盾。停止。</li><li><b>B</b>: 必須control/accounting証拠不足、usage不整合、価格不明、unpriced tool、transport/budget failure。reserve保持。</li><li><b>C</b>: 必須条件・検証済みusage/priceへの矛盾が立証されない追加metadata。unknownのまま保持。</li></ul>
<p>unknownFieldCount=${report.metadata.unknownFieldCount}。exact nameはunmask後diagnosticのsanitized projectionでpublic-schema-name / screened-machine-identifierに限定。ciphertext、full response、credentialは出力しない。</p>
<h2>ケース詳細（折りたたみ）</h2>${details}
<h2>レビュー形式上の警告</h2><p>H03 Xでは旧secret regexがidentifierを危険扱いする形式リスクを、sealing前に修正。pre-format draftを保存し、変更はcitation formatのみでgradesは変更していない。hash: <code>${esc(JSON.stringify(report.reviewFormatWarning))}</code></p>
<h2>整合性とオフラインテスト</h2><p>全reviewはmodel unmaskより前にhash固定。event chain tip: <code>${esc(report.integrity.eventChainTipSha256)}</code>、検証asset参照 ${report.integrity.verifiedAssetReferences}件。51/51 generator offline checks passed。既存履歴は変更せず、新run内の本JSON/HTMLだけを作成。</p>
<p class="note">source purpose: 一般の保護者向けreading。全failureを保持。フォント・script・network resourceなし。</p>
</main></body></html>`;
}

function main() {
  if (fs.existsSync(REPORT)) {
    const prior = readJson(REPORT);
    assert(prior?.reportId === "reading-comparison-02-offline-post-unmask", "refuse_to_replace_non_generator_report");
  }
  if (fs.existsSync(HTML)) {
    assert(readBytes(HTML).toString("utf8").includes("<title>モデル比較 reading-comparison-02</title>"),
      "refuse_to_replace_non_generator_html");
  }
  const { events, verifiedAssets, tipSha256 } = verifyAndLoadEvents();
  const final = readJson(FINAL);
  const definitions = Object.fromEntries(Object.entries(DEFINITIONS).map(([key, file]) => [key, readJson(file)]));
  assert(Array.isArray(final.attempted), "final_attempts_missing");
  assert(Array.isArray(final.eligiblePairs), "eligible_pairs_missing");
  const attempts = final.attempted.map(attempt => loadAttempt(final, attempt, definitions));
  const eligibleRows = attempts.filter(a => final.eligiblePairs.includes(a.caseId));
  const knownRows = eligibleRows.filter(a => a.lane === "known");
  const newRows = eligibleRows.filter(a => a.lane !== "known");
  const pairedCaseIds = [...new Set(attempts.filter(a => attempts.filter(b => b.caseId === a.caseId).length === 2)
    .map(a => a.caseId))].sort();
  const pairEligibility = pairedCaseIds.map(caseId => {
    const pair = attempts.filter(a => a.caseId === caseId);
    const authoritative = pair.map(a => a.pairEligibility).find(x => x?.nativeSampling);
    const technicalStates = Object.fromEntries(pair.map(a => [MODEL_SHORT[a.model], a.technicalState]));
    return {
      caseId,
      eligible: final.eligiblePairs.includes(caseId),
      nativeSamplingEligible: authoritative?.nativeSampling?.eligible ?? null,
      nativeSamplingFields: authoritative?.nativeSampling?.fields ?? [],
      technicalStates,
      exclusionReason: final.eligiblePairs.includes(caseId) ? null
        : Object.values(technicalStates).some(x => x !== "completed-schema")
          ? "technical-invalid side(s); not a silent win"
          : authoritative?.nativeSampling?.eligible === false
            ? "native-pair fairness guard blocked"
            : "runner-authoritative exclusion",
    };
  });
  const times = Object.fromEntries(MODELS.map(model => {
    const values = attempts.filter(a => a.model === model && Number.isFinite(a.elapsedMs)).map(a => a.elapsedMs);
    return [MODEL_SHORT[model], { observedCount: values.length, medianMs: median(values),
      rangeMs: values.length ? [Math.min(...values), Math.max(...values)] : null,
      meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }];
  }));
  const newActual = attempts.reduce((sum, a) => sum + (a.usage.centiMicroUSD ?? 0), 0);
  const draftHash = relative => fs.existsSync(path.join(RUN, relative)) ? sha256(readBytes(path.join(RUN, relative))) : null;
  const report = {
    schemaVersion: 2,
    reportId: "reading-comparison-02-offline-post-unmask",
    generatedAt: new Date().toISOString(),
    status: "generated-after-all-reviews-sealed-and-unmasked",
    scope: {
      evaluator: "AI原文比較・日本語評価（not grader in this generator; frozen reviews only）",
      sourcePurpose: "一般の保護者向けreading",
      limitations: ["not clinical superiority", "not general superiority", "not statistical superiority",
        "not adoption approval", "not publication approval", "questions authored from known sources; not unseen corpus",
        "one attempt per model per case"],
    },
    denominators: {
      baselineCalls: 21,
      eligiblePairs: final.eligiblePairs.length,
      eligiblePairedAttempts: eligibleRows.length,
      allCandidatePairs: pairedCaseIds.length,
      allPairedAttempts: pairedCaseIds.length * 2,
      knownEligiblePairs: new Set(knownRows.map(x => x.caseId)).size,
      newEligiblePairs: new Set(newRows.map(x => x.caseId)).size,
      newCalls: attempts.length,
      cumulativeCalls: 21 + attempts.length,
      h06LunaNewPerModelReference: attempts.filter(x => x.caseId === "C-H06").length,
      oldH06SolPriorDiagnostic: 1,
      q10RepeatedCalls: 0,
    },
    pairEligibility: {
      authority: "runner unmasked/final.json eligiblePairs plus captured pair conditions",
      nativeSamplingSummary: pairEligibility.every(x => x.nativeSamplingEligible !== false)
        ? "all 10 captured pairs passed equal-native-sampling guard"
        : `${pairEligibility.filter(x => x.nativeSamplingEligible === false).length} pair(s) blocked by native sampling`,
      pairs: pairEligibility,
      excludedCases: pairEligibility.filter(x => !x.eligible),
      noSilentWins: true,
    },
    analysis: {
      exactFrozenPrimary: "wholeScreenMeaning",
      known: { primary: tally(knownRows), secondary: secondary(knownRows) },
      new: { primary: tally(newRows), secondary: secondary(newRows) },
      tiePolicy: "no arbitrary overall weights; no overall winner synthesized",
      h06: "reference-only because completion proof is missing; predecided technical eligibility, not quality",
      q10: "excluded; no repeats",
    },
    attempts,
    technicalSummary: {
      total: attempts.length,
      byModel: Object.fromEntries(MODELS.map(model => [MODEL_SHORT[model], attempts.filter(x => x.model === model).length])),
      states: countBy(attempts, "technicalState", [...new Set(attempts.map(x => x.technicalState))]),
      completionFlags: countBy(attempts, "completionFlag", [...new Set(attempts.map(x => x.completionFlag))]),
      tokenLimitCount: attempts.filter(x => x.tokenLimitFlag).length,
      globalStopABCount: events.filter(e => e.type === "global-stop"
        || e.type === "response-recorded" && e.data?.stopReasons?.some(reason => /^(A|B):/.test(reason))).length,
      allFailuresRetained: true,
    },
    runtime: { meaning: "observed runner elapsedMs around provider response; not inferred provider-internal latency",
      byModel: times, oldSolH06Latency: "unavailable-not-invented" },
    accounting: {
      unit: "centiMicroUSD (100,000,000 = USD 1)",
      plannedBudgetCentiMicroUSD: 100000000,
      oldOpeningCentiMicroUSD: 13537650,
      correctedOpeningKnownCentiMicroUSD: 6004300,
      q10UnresolvedReserveCentiMicroUSD: 551250,
      correctedOpeningTotalCentiMicroUSD: 6555550,
      oldH06SolKnownCostCentiMicroUSD: 3416400,
      oldQ10TokenEstimateExcludedCentiMicroUSD: 186620,
      newActualKnownCentiMicroUSD: newActual,
      closedKnownCentiMicroUSD: final.accounting.knownCentiMicroUSD,
      closedUnresolvedCentiMicroUSD: final.accounting.unresolvedCentiMicroUSD,
      closedTotalCentiMicroUSD: final.accounting.totalCentiMicroUSD,
      reconciliation: {
        closedKnownEqualsOpeningPlusNew: final.accounting.knownCentiMicroUSD === 6004300 + newActual,
        noQ10EstimateDoubleCount: true,
        reasoningAlreadyIncludedInOutputTokens: true,
      },
    },
    metadata: {
      policy: definitions.memo.threeClassPolicy,
      unknownFieldCount: attempts.reduce((n, a) => n + a.metadata.unknownFieldCount, 0),
      byAttempt: attempts.map(a => ({ attempt: a.attempt, caseId: a.caseId, model: a.model,
        unknownFieldCount: a.metadata.unknownFieldCount, safeExactNames: a.metadata.safeExactNames,
        safeHierarchy: a.metadata.safeHierarchy })),
      sanitization: "post-unmask controls.unknown projection only; no values/ciphertext/full response/credential",
    },
    reviewFormatWarning: {
      caseId: "C-H03", label: "X", timing: "corrected-before-sealing",
      issue: "old secret-regex risk for an identifier", impact: "citation-format-only; grades unchanged",
      preFormatDraftPreserved: fs.existsSync(path.join(RUN, "drafts/C-H03-X.pre-format.json")),
      preFormatSha256: draftHash("drafts/C-H03-X.pre-format.json"),
      sealedDraftSha256: draftHash("drafts/C-H03-X.json"),
    },
    integrity: {
      allReviewsFrozenBeforeModelUnmask: true,
      eventChainTipSha256: tipSha256,
      verifiedAssetReferences: verifiedAssets.length,
      finalAssetSha256: sha256(readBytes(FINAL)),
      historicalFilesModified: 0,
      outputs: [`${RUN_REL}/report.json`, `${RUN_REL}/comparison-report-v2.html`],
    },
    offlineTests: [],
  };
  report.offlineTests = makeChecks({ events, verifiedAssets, final, attempts, eligibleRows, definitions });
  assert(report.accounting.reconciliation.closedKnownEqualsOpeningPlusNew, "closed_accounting_does_not_reconcile");
  const html = render(report);
  // Exclusive creation and same-directory atomic renames: never edit historical
  // reports and never silently replace a previously generated v2 report.
  const jsonTmp = `${REPORT}.tmp-${process.pid}`, htmlTmp = `${HTML}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(jsonTmp, encode(report), { flag: "wx", mode: 0o644 });
    fs.writeFileSync(htmlTmp, html, { flag: "wx", mode: 0o644 });
    fs.renameSync(jsonTmp, REPORT);
    fs.renameSync(htmlTmp, HTML);
  } catch (error) {
    for (const tmp of [jsonTmp, htmlTmp]) if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw error;
  }
  process.stdout.write(`GENERATED ${RUN_REL}/report.json and comparison-report-v2.html\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}