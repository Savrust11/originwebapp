import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MODEL, REVISION_CASES, estimate, assertHistoricalBaseline, initializeRevision,
  admitRevision, checkRevisedResponse, requiredReviewCriteria, validateIndependentReview,
} from "../prototypes/evidence-consultation/evaluation/revised-accounting.mjs";

const usage = {
  input_tokens: 1000,
  output_tokens: 500,
  total_tokens: 1500,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 100 },
};
const bindings = {
  preparedPackageSha256: "a".repeat(64),
  catalogSha256: "b".repeat(64),
  rubricSha256: "c".repeat(64),
};
const sha256Json = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function historical() {
  const costs = [1502, 1989, 1817, 1573, 738];
  return {
    schemaVersion: 2,
    purpose: "cumulative-provider-api-transmissions-not-per-run",
    limits: {
      maxApiTransmissions: 20,
      operationalModelBudgetMicroUSD: 1_000_000,
      maxGenerationAttempts: 11,
      maxConcurrency: 1,
      maxRetries: 0,
    },
    entries: [
      { sequence: 1, kind: "model_metadata", httpStatus: 200, path: `/v1/models/${MODEL}` },
      ...costs.map((measuredMicroUSD, index) => ({
        sequence: index + 2,
        kind: "generation",
        caseId: `Q0${index + 1}`,
        state: index === 4 ? "stopped" : "completed",
        measuredMicroUSD,
        stopReasons: index === 4 ? ["answer_schema_or_citation_mismatch"] : [],
        review: { verdict: index === 4 ? "stop" : "acceptable" },
      })),
    ],
    halted: true,
  };
}
function initialized() {
  const ledger = historical();
  initializeRevision(ledger, {
    runId: "q05-grounding-r1",
    initializedAt: "2026-09-18T03:00:00Z",
    ...bindings,
    priorLedgerSha256: "d".repeat(64),
    historicalEntriesSha256: sha256Json(ledger.entries),
  });
  return ledger;
}

test("requires the exact six-transmission, 7619-microUSD failed baseline", () => {
  assert.deepEqual(assertHistoricalBaseline(historical()),
    { spendMicroUSD: 7619, transmissions: 6 });
  for (const mutate of [
    ledger => { ledger.entries[5].state = "completed"; },
    ledger => { ledger.entries[5].review.verdict = "acceptable"; },
    ledger => { ledger.entries[5].measuredMicroUSD++; },
    ledger => { ledger.halted = false; },
  ]) {
    const ledger = historical();
    mutate(ledger);
    assert.throws(() => assertHistoricalBaseline(ledger));
  }
});

test("initialization preserves old stop as history and authorizes exactly seven new cases", () => {
  const ledger = initialized();
  assert.equal(ledger.entries.length, 6);
  assert.equal(ledger.entries[5].state, "stopped");
  assert.equal(ledger.entries[5].review.verdict, "stop");
  assert.equal(ledger.authorizationRevisions[0].priorState.halted, true);
  assert.equal(ledger.authorizationRevisions[0].priorState.measuredMicroUSD, 7619);
  assert.equal(ledger.authorizationRevisions[0].priorLedgerSha256, "d".repeat(64));
  assert.equal(ledger.authorizationRevisions[0].historicalEntriesSha256,
    sha256Json(ledger.entries));
  assert.deepEqual(ledger.authorizationRevisions[0].authorizedCases, REVISION_CASES);
  assert.equal(ledger.limits.maxGenerationAttempts, 12);
  assert.equal(ledger.halted, false);
  assert.equal(ledger.activeRevision.nextCaseId, "Q05");
  assert.throws(() => initializeRevision(ledger,
    {
      runId: "another",
      initializedAt: "x",
      ...bindings,
      priorLedgerSha256: "d".repeat(64),
      historicalEntriesSha256: sha256Json(ledger.entries),
    }), /historical_halt_missing|revision_already/);
});

test("revision Q05 admission carries cost and cannot become a generic halted bypass", () => {
  const ledger = initialized();
  const admitted = admitRevision(ledger, "q05-grounding-r1", "Q05", estimate(1246), bindings);
  assert.equal(admitted.spentMicroUSD, 7619);
  assert.equal(admitted.priorFailurePreserved, true);
  assert.throws(() => admitRevision(ledger, "q05-grounding-r1", "Q06", estimate(1000), bindings),
    /revision_case_order_or_retry/);
  assert.throws(() => admitRevision(ledger, "other", "Q05", estimate(1000), bindings),
    /revision_not_active/);
  ledger.halted = true;
  assert.throws(() => admitRevision(ledger, "q05-grounding-r1", "Q05", estimate(1000), bindings),
    /revision_halted/);
});

test("any mutation to the six historical entry objects is rejected after initialization", () => {
  const ledger = initialized();
  ledger.entries[0].provenance = "changed";
  assert.throws(() =>
    admitRevision(ledger, "q05-grounding-r1", "Q05", estimate(1246), bindings),
  /historical_entries_snapshot_changed/);
});

test("each next case requires completed automated gate and independent acceptable review", () => {
  const ledger = initialized();
  ledger.entries.push({
    sequence: 7,
    kind: "generation",
    revisionRunId: "q05-grounding-r1",
    caseId: "Q05",
    state: "completed",
    measuredMicroUSD: 800,
    automatedChecksPassed: true,
  });
  ledger.activeRevision.nextCaseId = "Q06";
  ledger.activeRevision.q03DisplayGate = { passed: true };
  assert.throws(() => admitRevision(ledger, "q05-grounding-r1", "Q06", estimate(1000), bindings),
    /previous_revision_case_not_reviewed/);
  ledger.entries[6].review = { verdict: "acceptable" };
  assert.doesNotThrow(() =>
    admitRevision(ledger, "q05-grounding-r1", "Q06", estimate(1000), bindings));
  ledger.entries[6].state = "outcome_unknown";
  assert.throws(() =>
    admitRevision(ledger, "q05-grounding-r1", "Q06", estimate(1000), bindings));
});

test("Q06 also requires the explicit offline Q03 citation-display gate", () => {
  const ledger = initialized();
  ledger.entries.push({
    sequence: 7,
    kind: "generation",
    revisionRunId: "q05-grounding-r1",
    caseId: "Q05",
    state: "completed",
    measuredMicroUSD: 800,
    automatedChecksPassed: true,
    review: { verdict: "acceptable" },
  });
  ledger.activeRevision.nextCaseId = "Q06";
  assert.throws(() =>
    admitRevision(ledger, "q05-grounding-r1", "Q06", estimate(1000), bindings),
  /q03_offline_display_gate_required/);
  ledger.activeRevision.q03DisplayGate = { passed: true };
  assert.doesNotThrow(() =>
    admitRevision(ledger, "q05-grounding-r1", "Q06", estimate(1000), bindings));
});

test("changed bindings, limits, budget headroom, and retry attempts stop", () => {
  const ledger = initialized();
  assert.throws(() => admitRevision(ledger, "q05-grounding-r1", "Q05", estimate(1000),
    { ...bindings, rubricSha256: "d".repeat(64) }), /revision_binding_changed/);
  ledger.limits.maxConcurrency = 2;
  assert.throws(() => admitRevision(ledger, "q05-grounding-r1", "Q05", estimate(1000), bindings),
    /revision_authorization_limits_changed/);
  ledger.limits.maxConcurrency = 1;
  ledger.entries[1].measuredMicroUSD = 990000;
  assert.throws(() => admitRevision(ledger, "q05-grounding-r1", "Q05", estimate(1000), bindings));
});

test("response requires strict claim-to-source validator as well as technical checks", () => {
  const body = {
    model: MODEL,
    service_tier: "default",
    status: "completed",
    usage,
    output: [{
      type: "message",
      status: "completed",
      content: [{ type: "output_text", text: '{"claims":[]}' }],
    }],
  };
  const accepted = checkRevisedResponse(body, estimate(1246), outputText => ({
    passed: true,
    issues: [],
    answer: JSON.parse(outputText),
  }));
  assert.equal(accepted.automatedChecks.passed, true);
  assert.equal(accepted.measuredMicroUSD, 800);
  for (const validator of [
    undefined,
    () => ({ passed: false, issues: ["editorial_id_not_citable"], answer: null }),
    () => { throw new Error("bad schema"); },
  ]) {
    const checked = checkRevisedResponse(body, estimate(1246), validator);
    assert.equal(checked.automatedChecks.passed, false);
  }
});

test("unknown usage, model or cache use remains fail-stop", () => {
  const base = {
    model: MODEL,
    service_tier: "default",
    status: "completed",
    usage,
    output: [{
      type: "message",
      status: "completed",
      content: [{ type: "output_text", text: "{}" }],
    }],
  };
  const validator = () => ({ passed: true, issues: [], answer: {} });
  for (const body of [
    { ...base, usage: null },
    { ...base, model: "other" },
    { ...base, usage: {
      ...usage,
      input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 },
    } },
  ]) {
    assert.equal(checkRevisedResponse(body, estimate(1246), validator).automatedChecks.passed, false);
  }
});

const reviewRubric = {
  semanticReviewRequired: true,
  globalCriteria: { pass: "pass", citationContract: "citations" },
  cases: {
    Q05: {
      requiredMeanings: ["duration", "attribution"],
      forbiddenContent: ["unsupported aggregation"],
      stopConditions: ["missing attribution"],
      requiredOriginalIds: ["E02-F-S01-S02-SHARED"],
      applicabilityReview: { unknownPreserved: true },
      serviceNoticeReview: { appOwned: true },
      individualRecommendation: false,
    },
  },
};
const boundReview = (verdict = "acceptable", unmet = []) => ({
  runId: "q05-grounding-r1",
  caseId: "Q05",
  rubricSha256: "c".repeat(64),
  responseSha256: "e".repeat(64),
  verdict,
  checkedBy: "agent-source-comparison-not-clinical-review",
  findings: ["原文と全基準を照合した。"],
  criterionResults: requiredReviewCriteria(reviewRubric, "Q05").map(criterionId => ({
    criterionId,
    met: !unmet.includes(criterionId),
    finding: `${criterionId}を個別に照合した。`,
  })),
});

test("independent review is bound and must explicitly assess every frozen criterion", () => {
  const options = {
    runId: "q05-grounding-r1",
    caseId: "Q05",
    rubricSha256: "c".repeat(64),
    responseSha256: "e".repeat(64),
    rubric: reviewRubric,
    automatedPassed: true,
  };
  assert.doesNotThrow(() => validateIndependentReview(boundReview(), options));
  const missing = boundReview();
  missing.criterionResults.pop();
  assert.throws(() => validateIndependentReview(missing, options),
    /every_frozen_review_criterion_required/);
  const wrongResponse = boundReview();
  wrongResponse.responseSha256 = "f".repeat(64);
  assert.throws(() => validateIndependentReview(wrongResponse, options),
    /explicit_bound_source_review_required/);
});

test("acceptable can never override automated or semantic failure; stop can record it", () => {
  const options = {
    runId: "q05-grounding-r1",
    caseId: "Q05",
    rubricSha256: "c".repeat(64),
    responseSha256: "e".repeat(64),
    rubric: reviewRubric,
    automatedPassed: true,
  };
  assert.throws(() => validateIndependentReview(
    boundReview("acceptable", ["case.requiredMeanings.0"]), options),
  /acceptable_review_cannot_override_failure/);
  assert.throws(() => validateIndependentReview(boundReview(), {
    ...options, automatedPassed: false,
  }), /acceptable_review_cannot_override_failure/);
  assert.doesNotThrow(() => validateIndependentReview(
    boundReview("stop", ["case.requiredMeanings.0"]), options));
  assert.doesNotThrow(() => validateIndependentReview(boundReview("stop"), {
    ...options, automatedPassed: false,
  }));
});

test("both runner versions use one lock and legacy runner rejects an active revision", () => {
  const legacy = new URL("../prototypes/evidence-consultation/evaluation/run-isolated-reading.mjs",
    import.meta.url);
  const revised = new URL("../prototypes/evidence-consultation/evaluation/run-revised-reading.mjs",
    import.meta.url);
  const legacyText = readFileSync(legacy, "utf8");
  const revisedText = readFileSync(revised, "utf8");
  assert.match(legacyText, /\.isolated-reading\.lock/);
  assert.match(revisedText, /\.isolated-reading\.lock/);
  assert.match(legacyText, /if \(ledger\.activeRevision\) throw/);
});