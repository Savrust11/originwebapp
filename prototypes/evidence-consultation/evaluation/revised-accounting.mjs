// Pure accounting and admission rules for the explicitly authorized Q05 revision.
// This module performs no I/O and cannot send provider requests.
import { createHash } from "node:crypto";
import { MODEL, estimate, measureUsage } from "./operational-accounting.mjs";

export { MODEL, estimate, measureUsage };

export const REVISION_CASES = Object.freeze([
  "Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11",
]);
export const REVISION_GENERATION_LIMIT = 7;
export const CUMULATIVE_GENERATION_LIMIT = 12;
export const CUMULATIVE_TRANSMISSION_LIMIT = 20;
export const OPERATIONAL_BUDGET_MICRO_USD = 1_000_000;
export const HISTORICAL_TRANSMISSIONS = 6;
export const HISTORICAL_GENERATIONS = 5;
export const HISTORICAL_SPEND_MICRO_USD = 7_619;

function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid_usage_integer");
  return value;
}

function assertSequence(entries) {
  entries.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error("ledger_sequence_invalid");
  });
}

const sha256Json = value => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");

export function assertHistoricalBaseline(ledger) {
  if (ledger?.schemaVersion !== 2
    || ledger.purpose !== "cumulative-provider-api-transmissions-not-per-run")
    throw new Error("operational_ledger_required");
  if (ledger.entries?.length !== HISTORICAL_TRANSMISSIONS) throw new Error("historical_baseline_changed");
  assertSequence(ledger.entries);
  const [metadata, ...generations] = ledger.entries;
  if (metadata.kind !== "model_metadata" || metadata.httpStatus !== 200
    || metadata.path !== `/v1/models/${MODEL}`)
    throw new Error("historical_metadata_missing");
  if (generations.length !== HISTORICAL_GENERATIONS
    || generations.some((entry, index) => entry.kind !== "generation"
      || entry.caseId !== `Q0${index + 1}` || !Number.isSafeInteger(entry.measuredMicroUSD)
      || (index < 4 && (entry.state !== "completed" || entry.review?.verdict !== "acceptable"))))
    throw new Error("historical_generation_record_changed");
  const spend = generations.reduce((sum, entry) => sum + entry.measuredMicroUSD, 0);
  if (spend !== HISTORICAL_SPEND_MICRO_USD) throw new Error("historical_spend_changed");
  const failed = generations.at(-1);
  if (failed.caseId !== "Q05" || failed.state !== "stopped"
    || failed.review?.verdict !== "stop"
    || !failed.stopReasons?.includes("answer_schema_or_citation_mismatch"))
    throw new Error("historical_q05_failure_changed");
  if (ledger.halted !== true) throw new Error("historical_halt_missing");
  if (ledger.limits?.maxApiTransmissions !== CUMULATIVE_TRANSMISSION_LIMIT
    || ledger.limits.operationalModelBudgetMicroUSD !== OPERATIONAL_BUDGET_MICRO_USD
    || ledger.limits.maxGenerationAttempts !== 11
    || ledger.limits.maxConcurrency !== 1 || ledger.limits.maxRetries !== 0)
    throw new Error("historical_authorization_limits_changed");
  return { spendMicroUSD: spend, transmissions: ledger.entries.length };
}

export function initializeRevision(ledger, authorization) {
  assertHistoricalBaseline(ledger);
  if (!authorization || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(authorization.runId ?? ""))
    throw new Error("invalid_revision_run_id");
  for (const key of [
    "preparedPackageSha256", "catalogSha256", "rubricSha256",
    "priorLedgerSha256", "historicalEntriesSha256",
  ]) {
    if (!/^[a-f0-9]{64}$/.test(authorization[key] ?? "")) throw new Error("invalid_revision_binding");
  }
  if (ledger.authorizationRevisions?.length || ledger.activeRevision)
    throw new Error("revision_already_initialized");
  const initializedAt = authorization.initializedAt;
  if (typeof initializedAt !== "string" || !initializedAt) throw new Error("revision_time_required");
  ledger.authorizationRevisions = [{
    runId: authorization.runId,
    initializedAt,
    authorizedCases: [...REVISION_CASES],
    priorState: {
      halted: true,
      transmissions: HISTORICAL_TRANSMISSIONS,
      generations: HISTORICAL_GENERATIONS,
      measuredMicroUSD: HISTORICAL_SPEND_MICRO_USD,
      failedCaseId: "Q05",
      failedSequence: 6,
      failedVerdict: "stop",
    },
    reason: "explicit-user-authorized-q05-grounding-revision-then-q06-q11",
    bindings: {
      preparedPackageSha256: authorization.preparedPackageSha256,
      catalogSha256: authorization.catalogSha256,
      rubricSha256: authorization.rubricSha256,
    },
    priorLedgerSha256: authorization.priorLedgerSha256,
    historicalEntriesSha256: authorization.historicalEntriesSha256,
    maxNewGenerations: REVISION_GENERATION_LIMIT,
    noRetry: true,
  }];
  ledger.activeRevision = { runId: authorization.runId, nextCaseId: "Q05", state: "ready" };
  ledger.limits.maxGenerationAttempts = CUMULATIVE_GENERATION_LIMIT;
  // The previous halted state remains immutable in authorizationRevisions[0].priorState.
  ledger.halted = false;
  return ledger;
}

function revisionRecord(ledger, runId) {
  if (ledger?.limits?.maxApiTransmissions !== CUMULATIVE_TRANSMISSION_LIMIT
    || ledger.limits.operationalModelBudgetMicroUSD !== OPERATIONAL_BUDGET_MICRO_USD
    || ledger.limits.maxGenerationAttempts !== CUMULATIVE_GENERATION_LIMIT
    || ledger.limits.maxConcurrency !== 1 || ledger.limits.maxRetries !== 0)
    throw new Error("revision_authorization_limits_changed");
  const revision = ledger.authorizationRevisions?.find(item => item.runId === runId);
  if (!revision || ledger.activeRevision?.runId !== runId) throw new Error("revision_not_active");
  if (revision.priorState?.halted !== true || revision.priorState.failedCaseId !== "Q05"
    || revision.priorState.failedSequence !== 6 || revision.priorState.failedVerdict !== "stop")
    throw new Error("historical_failure_not_preserved");
  return revision;
}

export function admitRevision(ledger, runId, caseId, projection, bindings) {
  const revision = revisionRecord(ledger, runId);
  if (ledger.halted || ledger.activeRevision.state !== "ready")
    throw new Error("revision_halted_no_automatic_resume");
  assertSequence(ledger.entries);
  if (ledger.entries.length < HISTORICAL_TRANSMISSIONS) throw new Error("historical_baseline_changed");
  const historical = ledger.entries.slice(0, HISTORICAL_TRANSMISSIONS);
  if (sha256Json(historical) !== revision.historicalEntriesSha256)
    throw new Error("historical_entries_snapshot_changed");
  const historicalSpend = historical.slice(1)
    .reduce((sum, entry) => sum + integer(entry.measuredMicroUSD), 0);
  if (historicalSpend !== HISTORICAL_SPEND_MICRO_USD
    || historical.at(-1).caseId !== "Q05" || historical.at(-1).review?.verdict !== "stop")
    throw new Error("historical_failure_not_preserved");
  if (!bindings || Object.keys(revision.bindings).some(key => bindings[key] !== revision.bindings[key]))
    throw new Error("revision_binding_changed");
  const revised = ledger.entries.slice(HISTORICAL_TRANSMISSIONS);
  if (revised.some(entry => entry.kind !== "generation" || entry.revisionRunId !== runId))
    throw new Error("unexpected_revision_transmission");
  if (revised.length >= revision.maxNewGenerations) throw new Error("revision_generation_limit");
  if (ledger.entries.length >= CUMULATIVE_TRANSMISSION_LIMIT) throw new Error("transmission_limit");
  const expected = REVISION_CASES[revised.length];
  if (caseId !== expected || ledger.activeRevision.nextCaseId !== expected)
    throw new Error("revision_case_order_or_retry");
  if (caseId === "Q06" && ledger.activeRevision.q03DisplayGate?.passed !== true)
    throw new Error("q03_offline_display_gate_required");
  if (revised.some(entry => entry.state !== "completed"
    || entry.review?.verdict !== "acceptable"
    || entry.automatedChecksPassed !== true
    || !Number.isSafeInteger(entry.measuredMicroUSD)))
    throw new Error("previous_revision_case_not_reviewed_or_usage_unknown");
  const allGenerations = ledger.entries.filter(entry => entry.kind === "generation");
  if (allGenerations.length >= CUMULATIVE_GENERATION_LIMIT) throw new Error("generation_limit");
  const spentMicroUSD = allGenerations.reduce(
    (sum, entry) => sum + integer(entry.measuredMicroUSD), 0);
  integer(projection?.estimatedMicroUSD);
  if (spentMicroUSD + projection.estimatedMicroUSD * 10 > OPERATIONAL_BUDGET_MICRO_USD)
    throw new Error("insufficient_operational_headroom");
  return {
    spentMicroUSD,
    remainingMicroUSD: OPERATIONAL_BUDGET_MICRO_USD - spentMicroUSD,
    priorFailurePreserved: true,
  };
}

export function requiredReviewCriteria(rubric, caseId) {
  const caseRubric = rubric?.cases?.[caseId];
  if (!caseRubric || rubric.semanticReviewRequired !== true)
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
    } else {
      result.push(prefix);
    }
  };
  leaves(rubric.globalCriteria ?? {}, "globalCriteria");
  leaves(caseRubric, "case");
  if (!result.length) throw new Error("frozen_case_rubric_invalid");
  return result;
}

export function validateIndependentReview(assessment, {
  runId, caseId, rubricSha256, responseSha256, rubric, automatedPassed,
}) {
  if (!assessment || assessment.runId !== runId || assessment.caseId !== caseId
    || assessment.rubricSha256 !== rubricSha256
    || assessment.responseSha256 !== responseSha256
    || !["acceptable", "stop"].includes(assessment.verdict)
    || assessment.checkedBy !== "agent-source-comparison-not-clinical-review"
    || !Array.isArray(assessment.findings) || !assessment.findings.length
    || !Array.isArray(assessment.criterionResults))
    throw new Error("explicit_bound_source_review_required");
  const expected = requiredReviewCriteria(rubric, caseId);
  const seen = assessment.criterionResults.map(item => item?.criterionId);
  if (seen.length !== expected.length || new Set(seen).size !== expected.length
    || expected.some(id => !seen.includes(id))
    || assessment.criterionResults.some(item => typeof item.met !== "boolean"
      || typeof item.finding !== "string" || !item.finding.trim()
      || !item.finding.includes(item.criterionId)
      || Object.keys(item).sort().join(",") !== "criterionId,finding,met"))
    throw new Error("every_frozen_review_criterion_required");
  if (assessment.verdict === "acceptable"
    && (!automatedPassed || assessment.criterionResults.some(item => !item.met)))
    throw new Error("acceptable_review_cannot_override_failure");
  if (assessment.verdict === "stop"
    && automatedPassed && assessment.criterionResults.every(item => item.met))
    throw new Error("stop_review_requires_identified_unmet_criterion");
  return assessment;
}

export function checkRevisedResponse(body, projection, validateContract) {
  const issues = [];
  let measured = null;
  try { measured = measureUsage(body?.usage); } catch (error) { issues.push(error.message); }
  if (body?.model !== MODEL) issues.push("unexpected_model");
  if (body?.service_tier !== "default") issues.push("unexpected_service_tier");
  if (body?.status !== "completed" || body.incomplete_details || body.error)
    issues.push("response_not_complete");
  const messages = (body?.output ?? []).filter(item => item.type === "message");
  if (messages.length !== 1 || messages.some(item => item.status !== "completed"))
    issues.push("message_not_complete");
  if ((body?.output ?? []).some(item => !["message", "reasoning"].includes(item.type)))
    issues.push("unexpected_tool_output");
  const content = messages.flatMap(item => item.content ?? []);
  if (content.some(item => item.type !== "output_text"))
    issues.push("refusal_or_unexpected_content");
  const outputText = content.filter(item => item.type === "output_text")
    .map(item => item.text).join("\n");
  let contract = null;
  try {
    if (typeof validateContract !== "function") throw new Error("claim_citation_validator_required");
    contract = validateContract(outputText);
    if (!contract || contract.passed !== true || !contract.answer)
      issues.push(...(contract?.issues?.length ? contract.issues : ["claim_citation_contract_failed"]));
  } catch (error) {
    issues.push(error.message === "claim_citation_validator_required"
      ? error.message : "claim_citation_contract_failed");
  }
  if (measured) {
    if (measured.output > projection.outputCapTokens) issues.push("output_cap_exceeded");
    if (measured.microUSD > projection.estimatedMicroUSD) issues.push("cost_above_pre_send_estimate");
    if (measured.read || measured.write) issues.push("unexpected_cache_usage");
  }
  return {
    measuredMicroUSD: measured?.microUSD ?? null,
    outputText,
    answer: contract?.answer ?? null,
    contract,
    automatedChecks: { passed: issues.length === 0, issues: [...new Set(issues)] },
    stopReasons: [...new Set(issues)],
  };
}