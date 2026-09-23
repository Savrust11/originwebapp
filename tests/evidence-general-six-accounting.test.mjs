import test from "node:test";
import assert from "node:assert/strict";
import {
  RUN_ID, CASES, createRunLedger, assertHistoricalLedger, admitCase, reserveCase,
  checkResponse, requiredReviewCriteria, validateReview, verifyPriorArtifacts,
  summarizeAccounting,
} from "../prototypes/evidence-consultation/general-evaluation/accounting.mjs";

const H = "a".repeat(64);
const old = () => ({
  schemaVersion: 2, purpose: "cumulative-provider-api-transmissions-not-per-run",
  limits: { maxApiTransmissions: 20, operationalModelBudgetMicroUSD: 1_000_000,
    maxConcurrency: 1, maxRetries: 0 },
  entries: Array.from({ length: 13 }, (_, index) => ({
    sequence: index + 1, kind: index ? "generation" : "model_metadata",
    measuredMicroUSD: index ? (index === 12 ? 17_093 - 11_000 : 1000) : undefined,
  })),
});
const projection = { localJsonTokens: 1000, estimatedInputTokens: 8000,
  outputCapTokens: 1500, estimatedMicroUSD: 3800 };
const ledger = () => createRunLedger({
  oldLedger: old(), oldLedgerSha256: H, historySnapshotSha256: H,
  preparationBindings: { preparedPackageSha256: H, catalogSha256: H,
    rubricSha256: H, appCatalogSha256: H, manifestSha256: H },
  initializedAt: "2026-01-01T00:00:00Z",
});
test("historical accounting is exactly 13 transmissions and 17093 microUSD", () => {
  assert.deepEqual(assertHistoricalLedger(old()), { transmissions: 13, measuredMicroUSD: 17093 });
  const changed = old(); changed.entries[12].measuredMicroUSD++;
  assert.throws(() => assertHistoricalLedger(changed), /historical_accounting_changed/);
});
test("first reservation is transmission 14, spends one attempt, and cannot retry", () => {
  const l = ledger();
  const e = reserveCase(l, { caseId: CASES[0], requestSha256: H,
    requestSerializedSha256: H, projection, reservedAt: "now" });
  assert.equal(e.sequence, 14);
  assert.equal(e.measuredMicroUSD, null);
  assert.equal(e.usageKnown, false);
  assert.deepEqual(summarizeAccounting(l), {
    cumulativeTransmissions: 14,
    knownCostMicroUSD: 17093,
    usageKnown: false,
    reservedUnknownMicroUSD: 3800,
    displayMeasuredTotalMicroUSD: null,
  });
  assert.equal(l.entries.length, 1);
  assert.throws(() => admitCase(l, CASES[0], projection, l.bindings));
});
test("six attempts reach 19 and there is no seventh or twentieth attempt", () => {
  const l = ledger();
  for (let i = 0; i < CASES.length; i++) {
    if (i) l.nextCaseId = CASES[i];
    const e = reserveCase(l, { caseId: CASES[i], requestSha256: H,
      requestSerializedSha256: H, projection, reservedAt: "now" });
    e.state = "completed"; e.measuredMicroUSD = 100; e.usageKnown = true;
    e.review = { screenVerdict: "pass" };
  }
  l.nextCaseId = null;
  assert.equal(l.entries.at(-1).sequence, 19);
  assert.throws(() => admitCase(l, "G-Q12", projection, l.bindings),
    /one_case|nineteenth/);
});
test("previous case requires independent bound review but a reviewed quality fail can continue", () => {
  const l = ledger();
  const e = reserveCase(l, { caseId: CASES[0], requestSha256: H,
    requestSerializedSha256: H, projection, reservedAt: "now" });
  e.state = "case_failed"; e.measuredMicroUSD = 100; e.usageKnown = true;
  l.nextCaseId = CASES[1];
  assert.throws(() => admitCase(l, CASES[1], projection, l.bindings),
    /previous_case_review_required/);
  e.review = { screenVerdict: "fail" };
  assert.doesNotThrow(() => admitCase(l, CASES[1], projection, l.bindings));
});
const usage = { input_tokens: 100, input_tokens_details: { cached_tokens: 0,
  cache_write_tokens: 0 }, output_tokens: 100,
  output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 200 };
const body = overrides => ({ model: "gpt-5.6-luna", service_tier: "default",
  status: "completed", incomplete_details: null, error: null, usage,
  output: [{ type: "message", status: "completed",
    content: [{ type: "output_text", text: "{}" }] }], ...overrides });
const contract = () => ({ passed: true, answer: {} });
test("known quality problem is case failure; unknown usage/model/cache are global", () => {
  assert.equal(checkResponse(body({ status: "incomplete" }), projection, contract)
    .classification.caseFailure, true);
  const unknown = checkResponse(body({ usage: null }), projection, contract);
  assert.equal(unknown.measuredMicroUSD, null);
  assert.equal(unknown.classification.globalFailure, true);
  for (const b of [
    body({ usage: null }), body({ model: "other" }),
    body({ usage: { ...usage, input_tokens_details: {
      cached_tokens: 1, cache_write_tokens: 0 } } }),
  ]) assert.equal(checkResponse(b, projection, contract).classification.globalFailure, true);
});
const rubric = { semanticReviewRequired: true,
  globalCriteria: { mandatory: ["faithful"], citations: "direct" },
  cases: { "G-Q05": { adoptedClassification: { mandatory: {
    body: ["accurate"], applicationDisplay: ["adjacent"],
    wholeScreen: ["consistent"],
  }, conditional: ["details"] }, forbiddenContent: ["unsupported"],
  scoring: { bodyAlone: "pass", appDisplay: "pass", wholeScreen: "pass",
    reviewer: "separate" } } } };
const assessment = () => ({
  runId: RUN_ID, caseId: "G-Q05", rubricSha256: H, responseSha256: H,
  appDisplaySha256: H, bodyVerdict: "pass", appVerdict: "pass", screenVerdict: "pass",
  checkedBy: "agent-source-comparison-not-clinical-review", findings: ["ok"],
  recurrence: [], newIssues: [], criterionResults:
    requiredReviewCriteria(rubric, "G-Q05").map(criterionId =>
      ({ criterionId, met: true, finding: `${criterionId}: met` })),
});
test("review binds response, app display, every frozen leaf, and separates layers", () => {
  assert.doesNotThrow(() => validateReview(assessment(), {
    caseId: "G-Q05", rubricSha256: H, responseSha256: H, appDisplaySha256: H,
    rubric, globalFailure: false, technicalCaseFailure: false }));
  const bad = assessment(); bad.bodyVerdict = "fail";
  assert.throws(() => validateReview(bad, {
    caseId: "G-Q05", rubricSha256: H, responseSha256: H, appDisplaySha256: H,
    rubric, globalFailure: false, technicalCaseFailure: false }),
  /body_fail_requires|screen_pass_requires/);
  assert.throws(() => validateReview(assessment(), {
    caseId: "G-Q05", rubricSha256: H, responseSha256: H, appDisplaySha256: "b".repeat(64),
    rubric, globalFailure: false, technicalCaseFailure: false }),
  /explicit_bound/);
});
test("body and app pass cannot hide a failed criterion in their own layer", () => {
  const body = assessment();
  body.criterionResults.find(item =>
    item.criterionId === "case.adoptedClassification.mandatory.body.0").met = false;
  assert.throws(() => validateReview(body, {
    caseId: "G-Q05", rubricSha256: H, responseSha256: H, appDisplaySha256: H,
    rubric, globalFailure: false, technicalCaseFailure: false }),
  /body_pass_requires_all_body_criteria/);

  const app = assessment();
  app.criterionResults.find(item =>
    item.criterionId === "case.adoptedClassification.mandatory.applicationDisplay.0").met = false;
  assert.throws(() => validateReview(app, {
    caseId: "G-Q05", rubricSha256: H, responseSha256: H, appDisplaySha256: H,
    rubric, globalFailure: false, technicalCaseFailure: false }),
  /app_pass_requires_all_app_criteria/);
});
test("a failed screen criterion cannot coexist with screen pass", () => {
  const value = assessment();
  value.criterionResults.find(item =>
    item.criterionId === "case.adoptedClassification.mandatory.wholeScreen.0").met = false;
  assert.throws(() => validateReview(value, {
    caseId: "G-Q05", rubricSha256: H, responseSha256: H, appDisplaySha256: H,
    rubric, globalFailure: false, technicalCaseFailure: false }),
  /screen_pass_requires_screen_criteria|screen_pass_requires_both_layers/);
});
test("prior artifacts are hash-bound and unresolved reservations globally block", () => {
  const l = ledger();
  const e = reserveCase(l, { caseId: CASES[0], requestSha256: H,
    requestSerializedSha256: H, projection, reservedAt: "now" });
  assert.throws(() => verifyPriorArtifacts(l, () => Buffer.from("x")),
    /unresolved_attempt/);
});