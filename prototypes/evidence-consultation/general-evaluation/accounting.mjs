// Pure accounting and response/review validation for the six authorized
// general-audience cases. This module performs no I/O or transport.
import { createHash } from "node:crypto";
import {
  MODEL, estimate, measureUsage,
} from "../evaluation/operational-accounting.mjs";

export { MODEL, estimate, measureUsage };
export const RUN_ID = "general-audience-six-01";
export const CASES = Object.freeze([
  "G-Q05", "G-Q06", "G-Q08", "G-Q09", "G-Q10", "G-Q11",
]);
export const BASELINE_TRANSMISSIONS = 13;
export const BASELINE_SPEND_MICRO_USD = 17_093;
export const MAX_ADDITIONAL_TRANSMISSIONS = 6;
export const CUMULATIVE_TRANSMISSION_CEILING = 19;
export const OPERATIONAL_BUDGET_MICRO_USD = 1_000_000;
export const RESERVATION_MICRO_USD = 3_800;

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const hash64 = value => /^[a-f0-9]{64}$/.test(value ?? "");
const integer = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid_usage_integer");
  return value;
};
const unique = values => new Set(values).size === values.length;

export function assertHistoricalLedger(oldLedger) {
  if (oldLedger?.schemaVersion !== 2
    || oldLedger.purpose !== "cumulative-provider-api-transmissions-not-per-run"
    || oldLedger.entries?.length !== BASELINE_TRANSMISSIONS)
    throw new Error("historical_ledger_changed");
  oldLedger.entries.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error("historical_ledger_sequence_changed");
  });
  const measured = oldLedger.entries.reduce((sum, entry) =>
    sum + (entry.kind === "generation" ? integer(entry.measuredMicroUSD) : 0), 0);
  if (measured !== BASELINE_SPEND_MICRO_USD
    || oldLedger.limits?.maxApiTransmissions !== 20
    || oldLedger.limits.operationalModelBudgetMicroUSD !== OPERATIONAL_BUDGET_MICRO_USD
    || oldLedger.limits.maxConcurrency !== 1 || oldLedger.limits.maxRetries !== 0)
    throw new Error("historical_accounting_changed");
  return { transmissions: BASELINE_TRANSMISSIONS, measuredMicroUSD: measured };
}

export function createRunLedger({
  oldLedger, oldLedgerSha256, historySnapshotSha256, preparationBindings, initializedAt,
}) {
  assertHistoricalLedger(oldLedger);
  if (![oldLedgerSha256, historySnapshotSha256,
    ...Object.values(preparationBindings ?? {})].every(hash64))
    throw new Error("invalid_frozen_binding");
  if (typeof initializedAt !== "string" || !initializedAt) throw new Error("initialized_time_required");
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    purpose: "six-new-general-audience-provider-attempts-separate-from-history",
    policy: {
      baselineTransmissions: BASELINE_TRANSMISSIONS,
      baselineMeasuredMicroUSD: BASELINE_SPEND_MICRO_USD,
      maxAdditionalTransmissions: MAX_ADDITIONAL_TRANSMISSIONS,
      cumulativeTransmissionCeiling: CUMULATIVE_TRANSMISSION_CEILING,
      leaveTwentiethTransmissionUnused: true,
      maxConcurrency: 1,
      maxRetries: 0,
      operationBudgetMicroUSD: OPERATIONAL_BUDGET_MICRO_USD,
    },
    bindings: { oldLedgerSha256, historySnapshotSha256, ...preparationBindings },
    initializedAt,
    state: "ready",
    nextCaseId: CASES[0],
    halted: false,
    globalStopReasons: [],
    entries: [],
  };
}

export function assertRunState(ledger) {
  if (ledger?.schemaVersion !== 1 || ledger.runId !== RUN_ID
    || ledger.policy?.baselineTransmissions !== BASELINE_TRANSMISSIONS
    || ledger.policy.baselineMeasuredMicroUSD !== BASELINE_SPEND_MICRO_USD
    || ledger.policy.maxAdditionalTransmissions !== MAX_ADDITIONAL_TRANSMISSIONS
    || ledger.policy.cumulativeTransmissionCeiling !== CUMULATIVE_TRANSMISSION_CEILING
    || ledger.policy.leaveTwentiethTransmissionUnused !== true
    || ledger.policy.maxConcurrency !== 1 || ledger.policy.maxRetries !== 0
    || ledger.policy.operationBudgetMicroUSD !== OPERATIONAL_BUDGET_MICRO_USD
    || !Array.isArray(ledger.entries))
    throw new Error("general_run_state_invalid");
  ledger.entries.forEach((entry, index) => {
    if (entry.sequence !== BASELINE_TRANSMISSIONS + index + 1
      || entry.caseId !== CASES[index] || entry.kind !== "generation")
      throw new Error("general_run_sequence_invalid");
    const measuredKnown = Number.isSafeInteger(entry.measuredMicroUSD);
    if (entry.usageKnown !== measuredKnown)
      throw new Error("general_run_usage_knowledge_invalid");
  });
  return ledger;
}

export function summarizeAccounting(ledger) {
  assertRunState(ledger);
  const knownAdditional = ledger.entries
    .filter(entry => entry.usageKnown === true)
    .reduce((sum, entry) => sum + entry.measuredMicroUSD, 0);
  const usageKnown = ledger.entries.every(entry =>
    entry.usageKnown === true);
  const reservedUnknownMicroUSD = ledger.entries
    .filter(entry => entry.usageKnown !== true)
    .reduce((sum, entry) => sum + integer(entry.reservedModelComputeMicroUSD), 0);
  return {
    cumulativeTransmissions: BASELINE_TRANSMISSIONS + ledger.entries.length,
    knownCostMicroUSD: BASELINE_SPEND_MICRO_USD + knownAdditional,
    usageKnown,
    reservedUnknownMicroUSD,
    displayMeasuredTotalMicroUSD: usageKnown
      ? BASELINE_SPEND_MICRO_USD + knownAdditional : null,
  };
}

export function verifyPriorArtifacts(ledger, readBytes) {
  assertRunState(ledger);
  let verified = 0;
  for (const entry of ledger.entries) {
    if (entry.state === "reserved" || entry.state === "outcome_uncertain")
      throw new Error("unresolved_attempt_requires_global_stop");
    if (!entry.responseFile || !hash64(entry.responseFileSha256)
      || sha256(readBytes(entry.responseFile)) !== entry.responseFileSha256)
      throw new Error("prior_response_changed");
    verified++;
    if (entry.review) {
      if (!entry.reviewFile || !hash64(entry.reviewFileSha256)
        || sha256(readBytes(entry.reviewFile)) !== entry.reviewFileSha256
        || entry.review.responseSha256 !== entry.responseFileSha256
        || entry.review.rubricSha256 !== ledger.bindings.rubricSha256)
        throw new Error("prior_review_changed");
      if (!entry.appDisplayFile || !hash64(entry.appDisplayFileSha256)
        || sha256(readBytes(entry.appDisplayFile)) !== entry.appDisplayFileSha256
        || entry.review.appDisplaySha256 !== entry.appDisplayFileSha256)
        throw new Error("prior_app_display_changed");
      verified += 2;
    }
  }
  return { verifiedArtifacts: verified };
}

export function admitCase(ledger, caseId, projection, preparationBindings) {
  assertRunState(ledger);
  if (ledger.halted || ledger.state === "globally_stopped")
    throw new Error("global_stop_no_resume");
  if (ledger.nextCaseId !== caseId || CASES[ledger.entries.length] !== caseId)
    throw new Error("one_case_sequential_no_retry");
  if (ledger.entries.length >= MAX_ADDITIONAL_TRANSMISSIONS
    || BASELINE_TRANSMISSIONS + ledger.entries.length >= CUMULATIVE_TRANSMISSION_CEILING)
    throw new Error("nineteenth_transmission_ceiling");
  if (ledger.entries.some(entry => !entry.review || !["pass", "fail"].includes(entry.review.screenVerdict)))
    throw new Error("previous_case_review_required");
  for (const [key, value] of Object.entries(preparationBindings ?? {})) {
    if (ledger.bindings[key] !== value) throw new Error("frozen_preparation_changed");
  }
  if (projection?.estimatedInputTokens !== 8000
    || projection.outputCapTokens !== 1500
    || projection.estimatedMicroUSD !== RESERVATION_MICRO_USD)
    throw new Error("reservation_projection_changed");
  const known = ledger.entries.reduce((sum, entry) =>
    sum + (entry.usageKnown === true ? integer(entry.measuredMicroUSD) : 0),
  BASELINE_SPEND_MICRO_USD);
  const outstanding = ledger.entries.reduce((sum, entry) =>
    sum + (entry.state === "reserved" ? RESERVATION_MICRO_USD : 0), 0);
  if (known + outstanding + RESERVATION_MICRO_USD > OPERATIONAL_BUDGET_MICRO_USD)
    throw new Error("operational_budget_exceeded");
  return {
    additionalTransmissionNumber: ledger.entries.length + 1,
    cumulativeTransmissionNumber: BASELINE_TRANSMISSIONS + ledger.entries.length + 1,
    knownSpendMicroUSD: known,
    reservedTotalMicroUSD: known + outstanding + RESERVATION_MICRO_USD,
  };
}

export function reserveCase(ledger, {
  caseId, requestSha256, requestSerializedSha256, projection, reservedAt,
}) {
  const budget = admitCase(ledger, caseId, projection, ledger.bindings);
  if (!hash64(requestSha256) || !hash64(requestSerializedSha256)
    || typeof reservedAt !== "string" || !reservedAt)
    throw new Error("invalid_reservation_binding");
  const entry = {
    sequence: budget.cumulativeTransmissionNumber,
    kind: "generation", runId: RUN_ID, caseId, state: "reserved",
    questionOrSourceSent: false, modelInference: true, retryAllowed: false,
    requestSha256, requestSerializedSha256, estimate: projection,
    reservedModelComputeMicroUSD: RESERVATION_MICRO_USD, reservedAt,
    measuredMicroUSD: null, usageKnown: false,
  };
  ledger.entries.push(entry);
  ledger.state = "sending";
  return entry;
}

export function checkResponse(body, projection, validateContract) {
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
  if (content.some(item => item.type === "refusal")) caseIssues.push("refusal_content");
  const outputText = content.filter(item => item.type === "output_text")
    .map(item => item.text).join("\n");
  let contract = null;
  try {
    if (typeof validateContract !== "function") throw new Error("claim_validator_required");
    contract = validateContract(outputText);
    if (!contract?.passed || !contract.answer)
      caseIssues.push(...(contract?.issues?.length ? contract.issues : ["claim_contract_failed"]));
  } catch {
    caseIssues.push("claim_contract_failed");
  }
  if (measured) {
    if (measured.output > projection.outputCapTokens) globalIssues.push("output_cap_exceeded");
    if (measured.microUSD > projection.estimatedMicroUSD) globalIssues.push("cost_above_reservation");
    if (measured.read || measured.write) globalIssues.push("unexpected_cache_usage");
  }
  return {
    measuredMicroUSD: measured?.microUSD ?? null, outputText,
    answer: contract?.answer ?? null, contract,
    classification: {
      globalFailure: globalIssues.length > 0,
      caseFailure: caseIssues.length > 0,
      globalIssues: [...new Set(globalIssues)],
      caseIssues: [...new Set(caseIssues)],
    },
  };
}

export function requiredReviewCriteria(rubric, caseId) {
  const target = rubric?.cases?.[caseId];
  const reviewRequired = rubric?.semanticReviewRequired === true
    || (rubric?.frozenBeforeSend === true && rubric?.adoptedForThisRun === true
      && rubric?.applicationAndBodyScoredSeparately === true);
  if (!reviewRequired || !target)
    throw new Error("frozen_case_rubric_missing");
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

export function validateReview(assessment, {
  caseId, rubricSha256, responseSha256, appDisplaySha256, rubric,
  globalFailure, technicalCaseFailure,
}) {
  if (assessment?.runId !== RUN_ID || assessment.caseId !== caseId
    || assessment.rubricSha256 !== rubricSha256
    || assessment.responseSha256 !== responseSha256
    || assessment.appDisplaySha256 !== appDisplaySha256
    || !["pass", "fail"].includes(assessment.bodyVerdict)
    || !["pass", "fail"].includes(assessment.appVerdict)
    || !["pass", "fail"].includes(assessment.screenVerdict)
    || assessment.checkedBy !== "agent-source-comparison-not-clinical-review"
    || !Array.isArray(assessment.findings) || !assessment.findings.length
    || !Array.isArray(assessment.recurrence)
    || !Array.isArray(assessment.newIssues)
    || !Array.isArray(assessment.criterionResults))
    throw new Error("explicit_bound_general_review_required");
  if (globalFailure) throw new Error("global_failure_cannot_be_reviewed_forward");
  const expected = requiredReviewCriteria(rubric, caseId);
  const seen = assessment.criterionResults.map(item => item?.criterionId);
  if (seen.length !== expected.length || !unique(seen)
    || expected.some(id => !seen.includes(id))
    || assessment.criterionResults.some(item => typeof item.met !== "boolean"
      || typeof item.finding !== "string" || !item.finding.includes(item.criterionId)
      || Object.keys(item).sort().join(",") !== "criterionId,finding,met"))
    throw new Error("every_frozen_general_criterion_required");
  const allMet = assessment.criterionResults.every(item => item.met);
  const layer = id => id.includes(".adoptedClassification.mandatory.applicationDisplay.")
      || id === "case.scoring.appDisplay" ? "app"
    : id.includes(".adoptedClassification.mandatory.wholeScreen.")
      || id === "case.scoring.wholeScreen" || id === "case.scoring.reviewer"
      ? "screen" : "body";
  const layerMet = name => assessment.criterionResults
    .filter(item => layer(item.criterionId) === name).every(item => item.met);
  const layerHasFailure = name => assessment.criterionResults
    .some(item => layer(item.criterionId) === name && !item.met);
  if (technicalCaseFailure && assessment.bodyVerdict === "pass")
    throw new Error("technical_case_failure_cannot_body_pass");
  if (assessment.bodyVerdict === "pass" && !layerMet("body"))
    throw new Error("body_pass_requires_all_body_criteria");
  if (assessment.appVerdict === "pass" && !layerMet("app"))
    throw new Error("app_pass_requires_all_app_criteria");
  if (assessment.bodyVerdict === "fail" && !technicalCaseFailure && !layerHasFailure("body"))
    throw new Error("body_fail_requires_body_issue");
  if (assessment.appVerdict === "fail" && !layerHasFailure("app"))
    throw new Error("app_fail_requires_app_issue");
  if (assessment.screenVerdict === "pass" && !layerMet("screen"))
    throw new Error("screen_pass_requires_screen_criteria");
  if (assessment.screenVerdict === "pass"
    && (assessment.bodyVerdict !== "pass" || assessment.appVerdict !== "pass" || !allMet))
    throw new Error("screen_pass_requires_both_layers_and_criteria");
  if (assessment.bodyVerdict === "pass" && assessment.appVerdict === "pass"
    && allMet && assessment.screenVerdict !== "pass")
    throw new Error("screen_fail_requires_identified_issue");
  if (assessment.screenVerdict === "fail"
    && assessment.bodyVerdict === "pass" && assessment.appVerdict === "pass" && allMet)
    throw new Error("screen_fail_requires_identified_issue");
  return assessment;
}