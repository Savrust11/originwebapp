import test from "node:test";
import assert from "node:assert/strict";
import {
  digest,
  evaluateConditionDisplay,
} from "../prototypes/evidence-consultation/condition-display/display-policy.mjs";

const support = (overrides = {}) => ({
  originalId: "SRC-F-1",
  sourceId: "SRC",
  title: "架空研究",
  version: "v1",
  locator: "p.1",
  url: "https://example.invalid/source.pdf",
  originalTextSha256: "a".repeat(64),
  quote: "eligible population",
  quoteStart: 4,
  quoteEnd: 23,
  ...overrides,
});

const fixture = ({
  mode = "fictional-example",
  applicability = "unknown",
  existingGate = "confirmation-required",
  verdict = "pass",
  contradictions = [],
  unsupportedClaims = [],
  historicalVerdict,
} = {}) => {
  const body = [{
    id: "claim-1",
    text: "研究では平均的な改善が示されましたが、個人への保証ではありません。",
    originalIds: ["SRC-F-1"],
  }];
  const conditionCase = {
    caseId: "QX",
    blocks: [
      {
        id: "population",
        kind: "population",
        tier: "mandatory",
        text: "対象は平均36か月以下の集団です。",
        supports: [support()],
      },
      {
        id: "detail",
        kind: "researchDetail",
        tier: "conditional",
        text: "95%信頼区間は質問に応じて表示します。",
        supports: [support({ quote: "confidence interval", quoteEnd: 23 })],
      },
    ],
  };
  const assessment = {
    caseId: "QX",
    bodySha256: digest(body),
    blocksSha256: digest(conditionCase.blocks),
    verdict,
    checkedBy: "agent-source-comparison-not-clinical-review",
    findings: ["本文、対象条件、限界を収録原文と比較した。"],
    contradictions,
    unsupportedClaims,
    claimBindings: [{ claimId: "claim-1", blockIds: ["population"] }],
    kind: mode === "saved-evaluation"
      ? "saved-model-review" : "offline-editorial-example",
  };
  return {
    caseId: "QX",
    body,
    conditionCase,
    context: {
      mode,
      applicability,
      existingGate,
      adoptionApproved: false,
      publicationApproved: false,
    },
    assessment,
    ...(historicalVerdict ? { historicalVerdict } : {}),
  };
};

test("digest is deterministic and bound to ordered JSON.stringify representation", () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ a: 1, b: 2 }));
  assert.notEqual(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
});

test("fictional example displays explicitly bound mandatory conditions while remaining not user-ready", () => {
  const result = evaluateConditionDisplay(fixture());
  assert.equal(result.displayStatus, "fictional-example");
  assert.equal(result.conditionIntegrityPassed, true);
  assert.equal(result.bodyReviewPassed, true);
  assert.equal(result.contradictionFree, true);
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.userReady, false);
  assert.equal(result.adjacentClaims.length, 1);
  assert.deepEqual(result.adjacentClaims[0].blocks.map(block => block.id), ["population"]);
  assert.ok(result.blockingReasons.includes("applicability_confirmation_required"));
  assert.match(result.notices.join("\n"), /架空データ/);
  assert.match(result.notices.join("\n"), /停止・確認処理/);
});

test("saved historical failure remains diagnostic and cannot be retroactively passed", () => {
  const input = fixture({
    mode: "saved-evaluation",
    applicability: "matched",
    existingGate: "allowed",
    historicalVerdict: "fail",
  });
  const result = evaluateConditionDisplay(input);
  assert.equal(result.displayStatus, "diagnostic-failed");
  assert.equal(result.conditionIntegrityPassed, true);
  assert.equal(result.bodyReviewPassed, false);
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.userReady, false);
  assert.ok(result.blockingReasons.includes("historical_failure_preserved"));
  assert.match(result.notices.join("\n"), /完成回答ではありません/);
});

test("unsupported Q06 total wording is not repaired by adjacent source blocks", () => {
  const input = fixture({
    verdict: "fail",
    unsupportedClaims: ["claim-1: 取得原文は「合計」を支持しない。"],
  });
  input.body[0].text = "睡眠時間の合計は10〜13時間です。";
  input.assessment.bodySha256 = digest(input.body);
  const result = evaluateConditionDisplay(input);
  assert.equal(result.conditionIntegrityPassed, true);
  assert.equal(result.bodyReviewPassed, false);
  assert.equal(result.contradictionFree, true);
  assert.equal(result.displayStatus, "diagnostic-failed");
  assert.ok(result.blockingReasons.includes("body_review_not_passed"));
});

test("explicit target mismatch contradiction fails despite structurally valid conditions", () => {
  const input = fixture({
    verdict: "fail",
    contradictions: ["claim-1: 条件欄は対象外だが本文は「あなたにも効果があります」と断定する。"],
  });
  input.body[0].text = "対象外ですが、あなたにも効果があります。";
  input.assessment.bodySha256 = digest(input.body);
  const result = evaluateConditionDisplay(input);
  assert.equal(result.conditionIntegrityPassed, true);
  assert.equal(result.bodyReviewPassed, false);
  assert.equal(result.contradictionFree, false);
});

test("the policy does not pretend to detect an unreported prose contradiction", () => {
  const input = fixture();
  input.body[0].text = "対象外ですが、あなたにも効果があります。";
  // The old hash proves that modified/unknown prose requires a new review.
  const result = evaluateConditionDisplay(input);
  assert.equal(result.bodyReviewPassed, false);
  assert.equal(result.adjacentClaims.length, 0);
  assert.ok(result.blockingReasons.includes("assessment_binding_changed"));
  assert.match(result.notices.join("\n"), /自動推測しません/);
});

test("unknown and mismatched applicability never expose individual advice", () => {
  for (const applicability of ["unknown", "mismatched"]) {
    const input = fixture({
      mode: "individual-advice",
      applicability,
      existingGate: applicability === "unknown" ? "confirmation-required" : "blocked",
    });
    input.assessment.kind = "offline-editorial-example";
    const result = evaluateConditionDisplay(input);
    assert.equal(result.displayStatus, "blocked");
    assert.equal(result.userReady, false);
    assert.deepEqual(result.adjacentClaims, []);
    assert.ok(result.blockingReasons.includes(
      applicability === "unknown"
        ? "applicability_confirmation_required" : "applicability_mismatched",
    ));
  }
});

test("even artificial approvals cannot integrate this isolated module into individual advice", () => {
  const input = fixture({
    mode: "individual-advice",
    applicability: "matched",
    existingGate: "allowed",
  });
  input.context.adoptionApproved = true;
  input.context.publicationApproved = true;
  const result = evaluateConditionDisplay(input);
  assert.equal(result.userReady, false);
  assert.equal(result.displayStatus, "blocked");
  assert.deepEqual(result.adjacentClaims, []);
  assert.ok(result.blockingReasons.includes("isolated_experimental_module_not_integrated"));
});

test("tampered body and block assessments fail closed without displaying claims", () => {
  const bodyChanged = fixture();
  bodyChanged.body[0].text += "変更";
  const bodyResult = evaluateConditionDisplay(bodyChanged);
  assert.equal(bodyResult.bodyReviewPassed, false);
  assert.deepEqual(bodyResult.adjacentClaims, []);
  assert.ok(bodyResult.blockingReasons.includes("assessment_binding_changed"));

  const blockChanged = fixture();
  blockChanged.conditionCase.blocks[0].text += "変更";
  const blockResult = evaluateConditionDisplay(blockChanged);
  assert.equal(blockResult.bodyReviewPassed, false);
  assert.deepEqual(blockResult.adjacentClaims, []);
  assert.ok(blockResult.blockingReasons.includes("assessment_binding_changed"));
});

test("missing claim binding or mandatory block coverage fails closed", () => {
  const missingClaim = fixture();
  missingClaim.assessment.claimBindings = [];
  let result = evaluateConditionDisplay(missingClaim);
  assert.equal(result.bodyReviewPassed, false);
  assert.deepEqual(result.adjacentClaims, []);
  assert.ok(result.blockingReasons.includes("explicit_claim_condition_bindings_incomplete"));

  const missingMandatory = fixture();
  missingMandatory.assessment.claimBindings[0].blockIds = ["detail"];
  result = evaluateConditionDisplay(missingMandatory);
  assert.equal(result.bodyReviewPassed, false);
  assert.deepEqual(result.adjacentClaims, []);
});

test("malformed or unverified-looking source association fails condition integrity", () => {
  for (const overrides of [
    { originalTextSha256: "not-a-digest" },
    { originalId: "" },
    { quoteEnd: 999 },
    { url: "javascript:alert(1)" },
  ]) {
    const input = fixture();
    Object.assign(input.conditionCase.blocks[0].supports[0], overrides);
    input.assessment.blocksSha256 = digest(input.conditionCase.blocks);
    const result = evaluateConditionDisplay(input);
    assert.equal(result.conditionIntegrityPassed, false);
    assert.equal(result.bodyReviewPassed, false);
    assert.deepEqual(result.adjacentClaims, []);
    assert.ok(result.blockingReasons.includes("condition_source_integrity_invalid"));
  }
});

test("case/source block association and assessment shape must be explicit and exact", () => {
  const wrongCase = fixture();
  wrongCase.conditionCase.caseId = "QY";
  let result = evaluateConditionDisplay(wrongCase);
  assert.equal(result.conditionIntegrityPassed, false);
  assert.deepEqual(result.adjacentClaims, []);

  const missingAssessment = fixture();
  delete missingAssessment.assessment;
  result = evaluateConditionDisplay(missingAssessment);
  assert.equal(result.bodyReviewPassed, false);
  assert.deepEqual(result.adjacentClaims, []);
  assert.ok(result.blockingReasons.includes("explicit_bound_assessment_required"));
});

test("saved and fictional reviews cannot exchange assessment kinds or omit saved history", () => {
  const savedWithoutHistory = fixture({
    mode: "saved-evaluation",
    applicability: "matched",
    existingGate: "allowed",
  });
  let result = evaluateConditionDisplay(savedWithoutHistory);
  assert.equal(result.bodyReviewPassed, false);
  assert.ok(result.blockingReasons.includes(
    "saved_evaluation_requires_historical_verdict",
  ));

  const fictionalWithSavedReview = fixture();
  fictionalWithSavedReview.assessment.kind = "saved-model-review";
  result = evaluateConditionDisplay(fictionalWithSavedReview);
  assert.equal(result.bodyReviewPassed, false);
  assert.ok(result.blockingReasons.includes("assessment_kind_mode_mismatch"));
});

test("a pass verdict cannot coexist with unsupported claims and a fail needs an issue", () => {
  const inconsistentPass = fixture({ unsupportedClaims: ["claim-1: unsupported"] });
  let result = evaluateConditionDisplay(inconsistentPass);
  assert.equal(result.bodyReviewPassed, false);
  assert.ok(result.blockingReasons.includes("assessment_verdict_inconsistent"));

  const unexplainedFail = fixture({ verdict: "fail" });
  result = evaluateConditionDisplay(unexplainedFail);
  assert.equal(result.bodyReviewPassed, false);
  assert.ok(result.blockingReasons.includes("assessment_verdict_inconsistent"));
});