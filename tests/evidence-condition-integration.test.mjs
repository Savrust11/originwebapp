import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDisplayRecords, assertCatalogReview } from "../prototypes/evidence-consultation/condition-display/build-display-records.mjs";
import { digest, evaluateConditionDisplay } from "../prototypes/evidence-consultation/condition-display/display-policy.mjs";
import { verifyHistory, outputDirectory, root } from "../prototypes/evidence-consultation/condition-display/history-integrity.mjs";

const records = buildDisplayRecords();
test("old sources/results/rubrics/gates/ledger and all limits are unchanged", () => {
  assert.equal(verifyHistory().protectedFiles, 123);
  assert.equal(verifyHistory().measuredMicroUSD, 17093);
  assert.equal(verifyHistory().transmissions, 13);
  assert.equal(records.externalModelCalls, 0);
  assert.equal(records.userReady, false);
  assert.equal(records.originalQ05.review.verdict, "stop");
});
test("all actual saved cases preserve their historical verdict, while confirmed conditions remain visible", () => {
  const expected = { Q05: "stop", Q06: "fail", Q07: "pass", Q08: "fail",
    Q09: "fail", Q10: "fail", Q11: "fail" };
  for (const row of records.cases) {
    assert.equal(row.historical.verdict, expected[row.caseId]);
    assert.equal(row.savedEvaluation.conditionIntegrityPassed, true);
    assert.equal(row.savedEvaluation.userReady, false);
    assert.ok(row.savedEvaluation.adjacentClaims.length > 0);
    if (expected[row.caseId] !== "pass") {
      assert.equal(row.savedEvaluation.displayStatus, "diagnostic-failed");
      assert.equal(row.savedEvaluation.bodyReviewPassed, false);
    }
    const original = JSON.parse(fs.readFileSync(path.join(root, row.historical.responseFile)));
    assert.equal(row.historical.outputText, original.outputText);
  }
});
test("Q06 unsupported 合計, Q09 study-proportion mistranslation, Q10 individual-range claim remain failed", () => {
  for (const id of ["Q06", "Q09", "Q10"]) {
    const row = records.cases.find(row => row.caseId === id);
    assert.equal(row.bodyReview.bodyVerdict, "fail");
    assert.ok(row.bodyReview.unsupportedClaims.length + row.bodyReview.contradictions.length > 0);
    assert.equal(row.savedEvaluation.bodyReviewPassed, false);
  }
  assert.match(records.cases.find(row => row.caseId === "Q06").historical.outputText, /合計/);
});
test("all fictional illustrations are explicit edited examples and retain mandatory conditions", () => {
  for (const row of records.cases) {
    assert.equal(row.sample.provenance, "offline-editorial-illustration-not-model-answer");
    assert.equal(row.sample.evaluation.displayStatus, "fictional-example");
    assert.equal(row.sample.evaluation.userReady, false);
    for (const claim of row.sample.evaluation.adjacentClaims) {
      for (const block of row.conditionCase.blocks.filter(block => block.tier === "mandatory"))
        assert.ok(claim.blocks.some(attached => attached.id === block.id));
    }
  }
});
test("unknown/mismatched/matched individual requests return no body for every actual case", () => {
  for (const row of records.cases) for (const scenario of row.gateScenarios) {
    assert.equal(scenario.evaluation.userReady, false);
    assert.equal(scenario.evaluation.adjacentClaims.length, 0);
    assert.equal(scenario.evaluation.displayStatus, "blocked");
  }
});
test("body edits invalidate semantic review even if all confirmed source cards remain", () => {
  const row = records.cases.find(row => row.caseId === "Q10");
  const body = structuredClone(row.sample.body);
  body[0].text = "あなたにも必ず効果があります。";
  const result = evaluateConditionDisplay({
    caseId: row.caseId, body, conditionCase: row.conditionCase,
    context: { mode: "fictional-example", applicability: "mismatched",
      existingGate: "blocked", adoptionApproved: false, publicationApproved: false },
    assessment: row.sample.assessment,
  });
  assert.equal(result.bodyReviewPassed, false);
  assert.equal(result.adjacentClaims.length, 0);
});
test("rebuilding cannot silently approve edited catalog text or a modified fictional short answer", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(outputDirectory, "verified-condition-catalog.json")));
  assert.doesNotThrow(() => assertCatalogReview(catalog, records.catalogReview));
  const changedBody = structuredClone(catalog);
  changedBody.cases.Q06.sampleBody[0].text += "昼寝は禁止です。";
  assert.throws(() => assertCatalogReview(changedBody, records.catalogReview),
    /CATALOG_REQUIRES_NEW_EXPLICIT_SOURCE_REVIEW/);
  const changedConditions = structuredClone(catalog);
  changedConditions.cases.Q08.blocks[0].text = "対象条件はありません。";
  assert.throws(() => assertCatalogReview(changedConditions, records.catalogReview),
    /CATALOG_REQUIRES_NEW_EXPLICIT_SOURCE_REVIEW/);
});
test("explicit supported-condition/body contradiction never passes when assessment is correctly bound", () => {
  const row = records.cases.find(row => row.caseId === "Q10");
  const body = structuredClone(row.sample.body);
  body[0].text = "対象外でも、あなたにも必ず効果があります。";
  const assessment = { ...row.sample.assessment, bodySha256: digest(body),
    verdict: "fail", contradictions: ["対象外の個人に効果を保証する本文は研究の対象条件と矛盾する。"],
    unsupportedClaims: ["個人への効果保証を原文は支持していない。"] };
  const result = evaluateConditionDisplay({
    caseId: row.caseId, body, conditionCase: row.conditionCase,
    context: { mode: "fictional-example", applicability: "mismatched",
      existingGate: "blocked", adoptionApproved: false, publicationApproved: false }, assessment,
  });
  assert.equal(result.contradictionFree, false);
  assert.equal(result.bodyReviewPassed, false);
  assert.equal(result.displayStatus, "diagnostic-failed");
});
test("proposed optional statistics do not drop mandatory heterogeneity or negative-result meaning", () => {
  for (const id of ["Q08", "Q09", "Q10"]) {
    const row = records.cases.find(row => row.caseId === id);
    const mandatory = row.conditionCase.blocks.filter(block => block.tier === "mandatory").map(block => block.text).join("\n");
    assert.match(mandatory, /異質性|ばらつき/);
    assert.ok(row.conditionCase.blocks.some(block => block.tier === "conditional"));
  }
  const sleep = records.cases.find(row => row.caseId === "Q11");
  const all = sleep.conditionCase.blocks.filter(block => block.tier === "mandatory").map(block => block.text).join("\n");
  assert.match(all, /夜間覚醒/);
  assert.match(all, /睡眠効率/);
  assert.match(all, /入眠潜時/);
  assert.match(all, /睡眠問題/);
  assert.equal(records.proposal.historicalRegradingAllowed, false);
  assert.equal(records.proposal.status, "proposal-not-adopted");
});
test("isolated import graph rejects network, normal application, and paid runners", async () => {
  await assert.rejects(() => fetch("https://invalid.example"), /CONDITION_OFFLINE_NETWORK_BLOCKED/);
  for (const specifier of ["node:http", "node:net", "node:child_process",
    "../prototypes/evidence-consultation/evaluation/run-independent-reading.mjs",
    "../server/index.ts"]) {
    await assert.rejects(() => import(specifier), /CONDITION_OFFLINE_IMPORT_BLOCKED/);
  }
  assert.ok(fs.existsSync(path.join(outputDirectory, "display-evaluation.json")));
});