import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MODEL, RUN_ID, INDEPENDENT_CASES, estimate, assertIndependentBaseline,
  initializeIndependentRun, admitIndependentCase, checkIndependentResponse,
  requiredIndependentReviewCriteria, validateIndependentCaseReview,
  verifyPriorIndependentArtifacts,
} from "../prototypes/evidence-consultation/evaluation/independent-accounting.mjs";

const bindings = {
  preparedPackageSha256: "a".repeat(64),
  catalogSha256: "b".repeat(64),
  rubricSha256: "c".repeat(64),
};
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const usage = {
  input_tokens: 1000,
  output_tokens: 500,
  total_tokens: 1500,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 100 },
};

function baseline() {
  const costs = [1502, 1989, 1817, 1573, 738, 490];
  return {
    schemaVersion: 2,
    purpose: "cumulative-provider-api-transmissions-not-per-run",
    limits: {
      maxApiTransmissions: 20,
      operationalModelBudgetMicroUSD: 1_000_000,
      maxGenerationAttempts: 12,
      maxConcurrency: 1,
      maxRetries: 0,
    },
    entries: [
      { sequence: 1, kind: "model_metadata", httpStatus: 200, path: `/v1/models/${MODEL}` },
      ...costs.map((measuredMicroUSD, index) => ({
        sequence: index + 2,
        kind: "generation",
        caseId: index >= 4 ? "Q05" : `Q0${index + 1}`,
        ...(index === 5 ? { revisionRunId: "source-roles-20260918" } : {}),
        measuredMicroUSD,
        review: { verdict: index >= 4 ? "stop" : "acceptable" },
      })),
    ],
    halted: true,
    activeRevision: { runId: "source-roles-20260918", state: "stopped" },
  };
}

function initialized() {
  const ledger = baseline();
  initializeIndependentRun(ledger, {
    runId: RUN_ID,
    initializedAt: "2026-09-18T04:00:00Z",
    ...bindings,
    priorLedgerSha256: "d".repeat(64),
    baselineEntriesSha256: sha(ledger.entries),
  });
  return ledger;
}

test("requires exactly seven transmissions, 8109 microUSD and both Q05 failures", () => {
  assert.deepEqual(assertIndependentBaseline(baseline()), {
    transmissions: 7, generations: 6, spendMicroUSD: 8109,
  });
  for (const mutate of [
    ledger => { ledger.entries[5].review.verdict = "acceptable"; },
    ledger => { ledger.entries[6].review.verdict = "acceptable"; },
    ledger => { ledger.entries[6].measuredMicroUSD++; },
    ledger => { ledger.halted = false; },
  ]) {
    const ledger = baseline();
    mutate(ledger);
    assert.throws(() => assertIndependentBaseline(ledger));
  }
});

test("initialization preserves both Q05 failures and authorizes Q06-Q11 only", () => {
  const ledger = initialized();
  assert.deepEqual(ledger.authorizationIndependentRuns[0].authorizedCases, INDEPENDENT_CASES);
  assert.deepEqual(ledger.authorizationIndependentRuns[0].prohibitedCases, ["Q05"]);
  assert.equal(ledger.entries[5].review.verdict, "stop");
  assert.equal(ledger.entries[6].review.verdict, "stop");
  assert.equal(ledger.independentRun.nextCaseId, "Q06");
  assert.equal(ledger.rules.independentRunCaseFailure,
    "record-bound-review-then-continue-no-retry");
  assert.equal(ledger.rules.independentRunGlobalFailure, "halt-all-no-retry");
  assert.equal(ledger.halted, false);
  assert.throws(() => initializeIndependentRun(ledger, {}));
});

test("Q05 is prohibited and each independent case has exactly one ordered attempt", () => {
  const ledger = initialized();
  assert.throws(() =>
    admitIndependentCase(ledger, RUN_ID, "Q05", estimate(1000), bindings),
  /case_not_authorized/);
  assert.throws(() =>
    admitIndependentCase(ledger, RUN_ID, "Q07", estimate(1000), bindings),
  /independent_case_order_or_retry/);
  assert.equal(
    admitIndependentCase(ledger, RUN_ID, "Q06", estimate(1000), bindings).spentMicroUSD,
    8109,
  );
});

test("reviewed case-level failure advances, but global failure blocks all cases", () => {
  const ledger = initialized();
  ledger.entries.push({
    sequence: 8,
    kind: "generation",
    independentRunId: RUN_ID,
    caseId: "Q06",
    state: "case_failed",
    caseFailure: true,
    globalFailure: false,
    measuredMicroUSD: 600,
    review: { verdict: "fail" },
  });
  ledger.independentRun.nextCaseId = "Q07";
  assert.doesNotThrow(() =>
    admitIndependentCase(ledger, RUN_ID, "Q07", estimate(1000), bindings));
  ledger.entries[7].globalFailure = true;
  ledger.halted = true;
  ledger.independentRun.state = "globally_stopped";
  assert.throws(() =>
    admitIndependentCase(ledger, RUN_ID, "Q07", estimate(1000), bindings),
  /globally_stopped/);
});

test("a pass and a fail are both valid reviewed predecessors; missing review is not", () => {
  const ledger = initialized();
  ledger.entries.push({
    sequence: 8,
    kind: "generation",
    independentRunId: RUN_ID,
    caseId: "Q06",
    state: "completed",
    caseFailure: false,
    globalFailure: false,
    measuredMicroUSD: 600,
  });
  ledger.independentRun.nextCaseId = "Q07";
  assert.throws(() =>
    admitIndependentCase(ledger, RUN_ID, "Q07", estimate(1000), bindings),
  /previous_case_not_independently_reviewed/);
  ledger.entries[7].review = { verdict: "pass" };
  assert.doesNotThrow(() =>
    admitIndependentCase(ledger, RUN_ID, "Q07", estimate(1000), bindings));
});

function body(overrides = {}) {
  return {
    model: MODEL,
    service_tier: "default",
    status: "completed",
    incomplete_details: null,
    error: null,
    usage,
    output: [{
      type: "message",
      status: "completed",
      content: [{ type: "output_text", text: "{}" }],
    }],
    ...overrides,
  };
}
const validContract = () => ({ passed: true, issues: [], answer: {} });

test("known-usage schema and incomplete failures are case-local", () => {
  const invalidCitation = checkIndependentResponse(body(), estimate(1000),
    () => { throw new Error("bad"); });
  assert.equal(invalidCitation.classification.globalFailure, false);
  assert.equal(invalidCitation.classification.caseFailure, true);
  assert.deepEqual(invalidCitation.classification.caseIssues,
    ["claim_citation_contract_failed"]);
  const incomplete = checkIndependentResponse(body({ status: "incomplete" }),
    estimate(1000), validContract);
  assert.equal(incomplete.classification.globalFailure, false);
  assert.equal(incomplete.classification.caseFailure, true);
});

test("unknown usage, model, tier, cache and estimate overruns are global", () => {
  const variants = [
    body({ usage: null }),
    body({ model: "other" }),
    body({ service_tier: "priority" }),
    body({ usage: {
      ...usage,
      input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 },
    } }),
  ];
  for (const value of variants) {
    assert.equal(checkIndependentResponse(value, estimate(1000), validContract)
      .classification.globalFailure, true);
  }
  assert.equal(checkIndependentResponse(body(), {
    ...estimate(1000), estimatedMicroUSD: 1,
  }, validContract).classification.globalFailure, true);
  assert.equal(checkIndependentResponse(body({
    output: [{ type: "tool_call", status: "completed" }],
  }), estimate(1000), validContract).classification.globalFailure, true);
});

test("all prior result and review bytes are rebound before every next case", () => {
  const ledger = initialized();
  const result = { independentRunId: RUN_ID, caseId: "Q06", answer: {} };
  const review = {
    runId: RUN_ID,
    caseId: "Q06",
    rubricSha256: bindings.rubricSha256,
    responseSha256: "",
    verdict: "fail",
  };
  const resultBytes = Buffer.from(`${JSON.stringify(result)}\n`);
  review.responseSha256 = createHash("sha256").update(resultBytes).digest("hex");
  const reviewBytes = Buffer.from(`${JSON.stringify(review)}\n`);
  ledger.entries.push({
    sequence: 8,
    kind: "generation",
    independentRunId: RUN_ID,
    caseId: "Q06",
    state: "case_failed",
    measuredMicroUSD: 500,
    globalFailure: false,
    caseFailure: true,
    rubricSha256: bindings.rubricSha256,
    responseFile: "result.json",
    responseFileSha256: review.responseSha256,
    reviewFile: "review.json",
    reviewFileSha256: createHash("sha256").update(reviewBytes).digest("hex"),
    reviewedResponseSha256: review.responseSha256,
    reviewedRubricSha256: bindings.rubricSha256,
    review,
  });
  const files = new Map([["result.json", resultBytes], ["review.json", reviewBytes]]);
  assert.deepEqual(verifyPriorIndependentArtifacts(
    ledger, RUN_ID, file => files.get(file)), { verifiedArtifacts: 2 });
  files.set("result.json", Buffer.from("tampered"));
  assert.throws(() => verifyPriorIndependentArtifacts(
    ledger, RUN_ID, file => files.get(file)), /artifact_hash_changed/);
  files.set("result.json", resultBytes);
  ledger.entries[7].reviewedRubricSha256 = "f".repeat(64);
  assert.throws(() => verifyPriorIndependentArtifacts(
    ledger, RUN_ID, file => files.get(file)), /review_binding_changed/);
});

const rubric = {
  semanticReviewRequired: true,
  globalCriteria: { faithful: true },
  cases: { Q06: { requiredMeanings: ["range"], forbiddenContent: ["ban"] } },
};
function assessment(verdict, unmet = []) {
  return {
    runId: RUN_ID,
    caseId: "Q06",
    rubricSha256: "c".repeat(64),
    responseSha256: "e".repeat(64),
    verdict,
    checkedBy: "agent-source-comparison-not-clinical-review",
    findings: ["原文と照合した。"],
    criterionResults: requiredIndependentReviewCriteria(rubric, "Q06")
      .map(criterionId => ({
        criterionId,
        met: !unmet.includes(criterionId),
        finding: `${criterionId} を原文と照合した。`,
      })),
  };
}

test("case review stays strict while a recorded failure may continue", () => {
  const options = {
    runId: RUN_ID,
    caseId: "Q06",
    rubricSha256: "c".repeat(64),
    responseSha256: "e".repeat(64),
    rubric,
    globalFailure: false,
    qualityPassed: true,
  };
  assert.doesNotThrow(() => validateIndependentCaseReview(assessment("pass"), options));
  assert.doesNotThrow(() => validateIndependentCaseReview(
    assessment("fail", ["case.requiredMeanings.0"]), options));
  assert.throws(() => validateIndependentCaseReview(
    assessment("pass", ["case.requiredMeanings.0"]), options),
  /pass_cannot_override/);
  assert.throws(() => validateIndependentCaseReview(assessment("fail"), options),
    /fail_requires_identified/);
  assert.throws(() => validateIndependentCaseReview(assessment("fail"), {
    ...options, globalFailure: true,
  }), /global_failure/);
});

test("all runners share one lock and older controllers reject independent mode", () => {
  const directory = new URL("../prototypes/evidence-consultation/evaluation/", import.meta.url);
  const legacy = readFileSync(new URL("run-isolated-reading.mjs", directory), "utf8");
  const revised = readFileSync(new URL("run-revised-reading.mjs", directory), "utf8");
  const independent = readFileSync(new URL("run-independent-reading.mjs", directory), "utf8");
  for (const text of [legacy, revised, independent]) assert.match(text, /\.isolated-reading\.lock/);
  assert.match(legacy, /ledger\.independentRun/);
  assert.match(revised, /if \(ledger\.independentRun\)/);
  assert.match(independent, /INDEPENDENT_CASES\.includes\(argument\)/);
  assert.match(independent, /PRE_SEND_GLOBAL_INTEGRITY_ERRORS/);
  assert.match(independent, /http_failure_no_retry/);
  assert.equal(independent.match(/\bfetch\(/g)?.length, 1);
  assert.doesNotMatch(independent, /Promise\.all/);
});