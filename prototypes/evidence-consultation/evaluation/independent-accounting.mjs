// Pure accounting and outcome classification for the explicitly authorized
// independent Q06-Q11 reading run. This module performs no I/O or transport.
import { createHash } from "node:crypto";
import { MODEL, estimate, measureUsage } from "./operational-accounting.mjs";

export { MODEL, estimate, measureUsage };

export const INDEPENDENT_CASES = Object.freeze([
  "Q06", "Q07", "Q08", "Q09", "Q10", "Q11",
]);
export const RUN_ID = "independent-cases-20260918";
export const BASELINE_TRANSMISSIONS = 7;
export const BASELINE_GENERATIONS = 6;
export const BASELINE_SPEND_MICRO_USD = 8_109;
export const CUMULATIVE_GENERATION_LIMIT = 12;
export const CUMULATIVE_TRANSMISSION_LIMIT = 20;
export const OPERATIONAL_BUDGET_MICRO_USD = 1_000_000;

const sha256Json = value => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const integer = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid_usage_integer");
  return value;
};
const assertSequence = entries => entries.forEach((entry, index) => {
  if (entry.sequence !== index + 1) throw new Error("ledger_sequence_invalid");
});
const hash64 = value => /^[a-f0-9]{64}$/.test(value ?? "");

export function assertIndependentBaseline(ledger) {
  if (ledger?.schemaVersion !== 2
    || ledger.purpose !== "cumulative-provider-api-transmissions-not-per-run")
    throw new Error("operational_ledger_required");
  if (ledger.entries?.length !== BASELINE_TRANSMISSIONS) throw new Error("baseline_changed");
  assertSequence(ledger.entries);
  const [metadata, ...generations] = ledger.entries;
  if (metadata.kind !== "model_metadata" || metadata.httpStatus !== 200
    || metadata.path !== `/v1/models/${MODEL}`)
    throw new Error("historical_metadata_missing");
  if (generations.length !== BASELINE_GENERATIONS
    || generations.slice(0, 4).some((entry, index) =>
      entry.kind !== "generation" || entry.caseId !== `Q0${index + 1}`
      || entry.review?.verdict !== "acceptable")
    || generations[4]?.caseId !== "Q05" || generations[4].review?.verdict !== "stop"
    || generations[5]?.caseId !== "Q05"
    || generations[5].revisionRunId !== "source-roles-20260918"
    || generations[5].review?.verdict !== "stop")
    throw new Error("historical_case_record_changed");
  if (generations.some(entry => !Number.isSafeInteger(entry.measuredMicroUSD))
    || generations.reduce((sum, entry) => sum + entry.measuredMicroUSD, 0)
      !== BASELINE_SPEND_MICRO_USD)
    throw new Error("historical_spend_changed");
  if (ledger.halted !== true || ledger.activeRevision?.state !== "stopped")
    throw new Error("prior_stop_not_preserved");
  if (ledger.limits?.maxApiTransmissions !== CUMULATIVE_TRANSMISSION_LIMIT
    || ledger.limits.operationalModelBudgetMicroUSD !== OPERATIONAL_BUDGET_MICRO_USD
    || ledger.limits.maxGenerationAttempts !== CUMULATIVE_GENERATION_LIMIT
    || ledger.limits.maxConcurrency !== 1 || ledger.limits.maxRetries !== 0)
    throw new Error("authorization_limits_changed");
  return {
    transmissions: BASELINE_TRANSMISSIONS,
    generations: BASELINE_GENERATIONS,
    spendMicroUSD: BASELINE_SPEND_MICRO_USD,
  };
}

export function initializeIndependentRun(ledger, authorization) {
  assertIndependentBaseline(ledger);
  if (authorization?.runId !== RUN_ID) throw new Error("invalid_independent_run_id");
  for (const key of [
    "preparedPackageSha256", "catalogSha256", "rubricSha256",
    "priorLedgerSha256", "baselineEntriesSha256",
  ]) {
    if (!hash64(authorization[key])) throw new Error("invalid_independent_binding");
  }
  if (ledger.independentRun || ledger.authorizationIndependentRuns?.length)
    throw new Error("independent_run_already_initialized");
  if (typeof authorization.initializedAt !== "string" || !authorization.initializedAt)
    throw new Error("independent_time_required");
  ledger.authorizationIndependentRuns = [{
    runId: RUN_ID,
    initializedAt: authorization.initializedAt,
    authorizedCases: [...INDEPENDENT_CASES],
    prohibitedCases: ["Q05"],
    priorState: {
      halted: true,
      transmissions: BASELINE_TRANSMISSIONS,
      generations: BASELINE_GENERATIONS,
      measuredMicroUSD: BASELINE_SPEND_MICRO_USD,
      originalQ05Verdict: ledger.entries[5].review.verdict,
      revisedQ05Verdict: ledger.entries[6].review.verdict,
    },
    reason: "explicit-user-authorized-independent-q06-q11-after-preserved-q05-failures",
    stoppingPolicy: {
      caseFailureContinuesAfterBoundReview: true,
      globalFailureStopsAll: true,
      noRetry: true,
    },
    bindings: {
      preparedPackageSha256: authorization.preparedPackageSha256,
      catalogSha256: authorization.catalogSha256,
      rubricSha256: authorization.rubricSha256,
    },
    priorLedgerSha256: authorization.priorLedgerSha256,
    baselineEntriesSha256: authorization.baselineEntriesSha256,
    maxNewGenerations: INDEPENDENT_CASES.length,
  }];
  ledger.independentRun = { runId: RUN_ID, nextCaseId: "Q06", state: "ready" };
  ledger.rules = {
    ...ledger.rules,
    independentRunCaseFailure: "record-bound-review-then-continue-no-retry",
    independentRunGlobalFailure: "halt-all-no-retry",
  };
  // The two Q05 stops remain on their entries and in priorState. This flag now
  // represents only a run-wide fault in the independent controller.
  ledger.halted = false;
  return ledger;
}

function runRecord(ledger, runId) {
  if (runId !== RUN_ID || ledger.independentRun?.runId !== RUN_ID)
    throw new Error("independent_run_not_active");
  if (ledger.limits?.maxApiTransmissions !== CUMULATIVE_TRANSMISSION_LIMIT
    || ledger.limits.operationalModelBudgetMicroUSD !== OPERATIONAL_BUDGET_MICRO_USD
    || ledger.limits.maxGenerationAttempts !== CUMULATIVE_GENERATION_LIMIT
    || ledger.limits.maxConcurrency !== 1 || ledger.limits.maxRetries !== 0)
    throw new Error("independent_authorization_limits_changed");
  const record = ledger.authorizationIndependentRuns?.find(item => item.runId === RUN_ID);
  if (!record || record.priorState?.originalQ05Verdict !== "stop"
    || record.priorState.revisedQ05Verdict !== "stop"
    || record.prohibitedCases?.join(",") !== "Q05")
    throw new Error("q05_failures_not_preserved");
  return record;
}

export function assertIndependentRunState(ledger, runId = RUN_ID) {
  const record = runRecord(ledger, runId);
  assertSequence(ledger.entries);
  if (ledger.entries.length < BASELINE_TRANSMISSIONS
    || sha256Json(ledger.entries.slice(0, BASELINE_TRANSMISSIONS))
      !== record.baselineEntriesSha256)
    throw new Error("baseline_entries_changed");
  return record;
}

export function admitIndependentCase(ledger, runId, caseId, projection, bindings) {
  const record = assertIndependentRunState(ledger, runId);
  if (ledger.halted || ledger.independentRun.state !== "ready")
    throw new Error("independent_run_globally_stopped");
  if (caseId === "Q05" || !INDEPENDENT_CASES.includes(caseId))
    throw new Error("case_not_authorized");
  if (!bindings || Object.keys(record.bindings).some(key => bindings[key] !== record.bindings[key]))
    throw new Error("independent_binding_changed");
  const entries = ledger.entries.slice(BASELINE_TRANSMISSIONS);
  if (entries.some(entry => entry.kind !== "generation"
    || entry.independentRunId !== RUN_ID || !INDEPENDENT_CASES.includes(entry.caseId)))
    throw new Error("unexpected_independent_transmission");
  const expected = INDEPENDENT_CASES[entries.length];
  if (caseId !== expected || ledger.independentRun.nextCaseId !== expected)
    throw new Error("independent_case_order_or_retry");
  if (entries.some(entry => !Number.isSafeInteger(entry.measuredMicroUSD)
    || entry.globalFailure === true
    || !["completed", "case_failed"].includes(entry.state)
    || !["pass", "fail"].includes(entry.review?.verdict)))
    throw new Error("previous_case_not_independently_reviewed");
  if (ledger.entries.length >= CUMULATIVE_TRANSMISSION_LIMIT
    || entries.length >= INDEPENDENT_CASES.length)
    throw new Error("transmission_limit");
  const allGenerations = ledger.entries.filter(entry => entry.kind === "generation");
  if (allGenerations.length >= CUMULATIVE_GENERATION_LIMIT)
    throw new Error("generation_limit");
  const spentMicroUSD = allGenerations.reduce(
    (sum, entry) => sum + integer(entry.measuredMicroUSD), 0);
  integer(projection?.estimatedMicroUSD);
  if (spentMicroUSD + projection.estimatedMicroUSD * 10 > OPERATIONAL_BUDGET_MICRO_USD)
    throw new Error("insufficient_operational_headroom");
  return {
    spentMicroUSD,
    remainingMicroUSD: OPERATIONAL_BUDGET_MICRO_USD - spentMicroUSD,
    priorQ05FailuresPreserved: true,
  };
}

export function verifyPriorIndependentArtifacts(ledger, runId, readArtifactBytes) {
  const record = assertIndependentRunState(ledger, runId);
  if (typeof readArtifactBytes !== "function") throw new Error("artifact_reader_required");
  const entries = ledger.entries.slice(BASELINE_TRANSMISSIONS);
  for (const entry of entries) {
    if (!entry.review) continue;
    if (!hash64(entry.responseFileSha256) || !hash64(entry.reviewFileSha256)
      || entry.reviewedResponseSha256 !== entry.responseFileSha256
      || entry.reviewedRubricSha256 !== entry.rubricSha256
      || entry.rubricSha256 !== record.bindings.rubricSha256)
      throw new Error("independent_review_binding_changed");
    let resultBytes;
    let reviewBytes;
    try {
      resultBytes = readArtifactBytes(entry.responseFile);
      reviewBytes = readArtifactBytes(entry.reviewFile);
    } catch {
      throw new Error("independent_artifact_unavailable");
    }
    if (createHash("sha256").update(resultBytes).digest("hex") !== entry.responseFileSha256
      || createHash("sha256").update(reviewBytes).digest("hex") !== entry.reviewFileSha256)
      throw new Error("independent_artifact_hash_changed");
    let result;
    let review;
    try {
      result = JSON.parse(Buffer.from(resultBytes).toString("utf8"));
      review = JSON.parse(Buffer.from(reviewBytes).toString("utf8"));
    } catch {
      throw new Error("independent_artifact_invalid_json");
    }
    if (result.independentRunId !== runId || result.caseId !== entry.caseId
      || review.runId !== runId || review.caseId !== entry.caseId
      || review.responseSha256 !== entry.responseFileSha256
      || review.rubricSha256 !== entry.rubricSha256
      || review.verdict !== entry.review.verdict
      || JSON.stringify(review) !== JSON.stringify(entry.review))
      throw new Error("independent_artifact_internal_binding_changed");
  }
  return { verifiedArtifacts: entries.filter(entry => entry.review).length * 2 };
}

export function requiredIndependentReviewCriteria(rubric, caseId) {
  const target = rubric?.cases?.[caseId];
  if (rubric?.semanticReviewRequired !== true || !target) throw new Error("frozen_case_rubric_missing");
  const result = [];
  const leaves = (value, prefix) => {
    if (Array.isArray(value)) {
      if (!value.length) result.push(prefix);
      else value.forEach((item, index) => leaves(item, `${prefix}.${index}`));
    } else if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (!keys.length) result.push(prefix);
      else keys.forEach(key => leaves(value[key], `${prefix}.${key}`));
    } else result.push(prefix);
  };
  leaves(rubric.globalCriteria ?? {}, "globalCriteria");
  leaves(target, "case");
  return result;
}

export function validateIndependentCaseReview(assessment, {
  runId, caseId, rubricSha256, responseSha256, rubric, globalFailure, qualityPassed,
}) {
  if (assessment?.runId !== runId || assessment.caseId !== caseId
    || assessment.rubricSha256 !== rubricSha256
    || assessment.responseSha256 !== responseSha256
    || !["pass", "fail"].includes(assessment.verdict)
    || assessment.checkedBy !== "agent-source-comparison-not-clinical-review"
    || !Array.isArray(assessment.findings) || !assessment.findings.length
    || !Array.isArray(assessment.criterionResults))
    throw new Error("explicit_bound_independent_review_required");
  if (globalFailure) throw new Error("global_failure_cannot_be_reviewed_forward");
  const expected = requiredIndependentReviewCriteria(rubric, caseId);
  const seen = assessment.criterionResults.map(item => item?.criterionId);
  if (seen.length !== expected.length || new Set(seen).size !== expected.length
    || expected.some(id => !seen.includes(id))
    || assessment.criterionResults.some(item => typeof item.met !== "boolean"
      || typeof item.finding !== "string" || !item.finding.includes(item.criterionId)
      || Object.keys(item).sort().join(",") !== "criterionId,finding,met"))
    throw new Error("every_frozen_review_criterion_required");
  const allMet = assessment.criterionResults.every(item => item.met);
  if (assessment.verdict === "pass" && (!qualityPassed || !allMet))
    throw new Error("pass_cannot_override_case_failure");
  if (assessment.verdict === "fail" && qualityPassed && allMet)
    throw new Error("fail_requires_identified_case_issue");
  return assessment;
}

export function checkIndependentResponse(body, projection, validateContract) {
  const globalIssues = [];
  const caseIssues = [];
  let measured = null;
  try { measured = measureUsage(body?.usage); } catch (error) { globalIssues.push(error.message); }
  if (body?.model !== MODEL) globalIssues.push("unexpected_model");
  if (body?.service_tier !== "default") globalIssues.push("unexpected_service_tier");
  if (body?.status !== "completed" || body.incomplete_details || body.error)
    caseIssues.push("response_not_complete");
  const messages = (body?.output ?? []).filter(item => item.type === "message");
  if (messages.length !== 1 || messages.some(item => item.status !== "completed"))
    caseIssues.push("message_not_complete");
  if ((body?.output ?? []).some(item => !["message", "reasoning"].includes(item.type)))
    globalIssues.push("unexpected_tool_output");
  const content = messages.flatMap(item => item.content ?? []);
  if (content.some(item => !["output_text", "refusal"].includes(item.type)))
    globalIssues.push("unexpected_tool_output");
  if (content.some(item => item.type === "refusal"))
    caseIssues.push("refusal_content");
  const outputText = content.filter(item => item.type === "output_text")
    .map(item => item.text).join("\n");
  let contract = null;
  try {
    if (typeof validateContract !== "function") throw new Error("claim_citation_validator_required");
    contract = validateContract(outputText);
    if (!contract || contract.passed !== true || !contract.answer)
      caseIssues.push(...(contract?.issues?.length
        ? contract.issues : ["claim_citation_contract_failed"]));
  } catch {
    caseIssues.push("claim_citation_contract_failed");
  }
  if (measured) {
    if (measured.output > projection.outputCapTokens) globalIssues.push("output_cap_exceeded");
    if (measured.microUSD > projection.estimatedMicroUSD)
      globalIssues.push("cost_above_pre_send_estimate");
    if (measured.read || measured.write) globalIssues.push("unexpected_cache_usage");
  }
  return {
    measuredMicroUSD: measured?.microUSD ?? null,
    outputText,
    answer: contract?.answer ?? null,
    contract,
    classification: {
      globalFailure: globalIssues.length > 0,
      caseFailure: caseIssues.length > 0,
      globalIssues: [...new Set(globalIssues)],
      caseIssues: [...new Set(caseIssues)],
    },
  };
}