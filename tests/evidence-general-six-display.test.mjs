import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assembleGeneralDisplay } from "../prototypes/evidence-consultation/general-evaluation/display.mjs";
import { accountingPresentation } from "../prototypes/evidence-consultation/general-evaluation/render-report.mjs";
import {
  createRunLedger, reserveCase,
} from "../prototypes/evidence-consultation/general-evaluation/accounting.mjs";

const catalog = JSON.parse(fs.readFileSync(
  "evidence-work/condition-display-offline/verified-condition-catalog.json", "utf8"));
const prepared = baseCaseId => ({
  caseId: `G-${baseCaseId}`,
  baseCaseId,
  originalIds: [...new Set(catalog.cases[baseCaseId].blocks
    .flatMap(block => block.supports.map(support => support.originalId)))],
});
const result = text => ({
  status: "completed",
  outputText: JSON.stringify({
    explanations: [{ text, original_ids: ["E02-F-S01-S02-SHARED"] }],
    limitations: [],
    abstention: { applies: false, text: "", original_ids: [] },
  }),
  answer: {
    explanations: [{ text, original_ids: ["E02-F-S01-S02-SHARED"] }],
    limitations: [],
    abstention: { applies: false, text: "", original_ids: [] },
  },
  classification: { globalFailure: false, caseFailure: false },
});

test("attaches all mandatory verified blocks without changing raw answer", () => {
  const input = result("原文が述べていない合計だと断定します。");
  const before = structuredClone(input);
  const display = assembleGeneralDisplay(input, prepared("Q06"), catalog);
  assert.deepEqual(input, before);
  assert.deepEqual(display.rawAnswer, before.answer);
  assert.equal(display.appDisplay.claims.length, 1);
  assert.deepEqual(display.appDisplay.claims[0].blocks,
    catalog.cases.Q06.blocks.filter(block => block.tier === "mandatory"));
  assert.equal(display.bodySemanticsAssessed, false);
  assert.equal(display.bodySemanticsPassed, null);
  assert.equal(display.userReady, false);
  assert.equal(display.individualAdviceBlocked, true);
});

test("source cards do not repair unsupported prose or pretend to review semantics", () => {
  const display = assembleGeneralDisplay(
    result("この原文は昼寝を含む24時間合計だと確認しました。"),
    prepared("Q05"), catalog);
  assert.match(display.rawAnswer.explanations[0].text, /24時間合計/);
  assert.equal(display.conditionIntegrityPassed, true);
  assert.equal(display.bodySemanticsAssessed, false);
  assert.match(display.notices.join("\n"), /修正せず/);
  assert.match(display.notices.join("\n"), /AASM本文は未収録/);
});

test("case mapping is explicit and cannot be inferred from prose or cited IDs", () => {
  const wrong = prepared("Q06");
  wrong.baseCaseId = "Q05";
  assert.throws(() => assembleGeneralDisplay(result("同じ引用です。"), wrong, catalog),
    /CASE_BINDING_INVALID/);
  const missing = prepared("Q06");
  missing.originalIds = [];
  assert.throws(() => assembleGeneralDisplay(result("同じ引用です。"), missing, catalog),
    /SELECTED_ORIGINALS_REQUIRED/);
});

test("every case support must be part of the frozen selected original closure", () => {
  const item = prepared("Q10");
  item.originalIds = ["E04-F-S01"];
  assert.throws(() => assembleGeneralDisplay({
    ...result("38分です。"),
    answer: {
      explanations: [{ text: "38分です。", original_ids: ["E04-F-S01"] }],
      limitations: [], abstention: { applies: false, text: "", original_ids: [] },
    },
  }, item, catalog), /CONDITION_BLOCK_INVALID/);
});

test("tampered catalog, support association, and sample-body leakage fail closed", () => {
  const tampered = structuredClone(catalog);
  tampered.cases.Q06.blocks[0].text = "昼寝を含む24時間合計です。";
  assert.throws(() => assembleGeneralDisplay(result("本文"), prepared("Q06"), tampered),
    /FROZEN_APP_CATALOG_CHANGED/);
  const association = structuredClone(catalog);
  association.cases.Q06.blocks[0].supports[0].sourceId = "E03";
  assert.throws(() => assembleGeneralDisplay(result("本文"), prepared("Q06"), association),
    /FROZEN_APP_CATALOG_CHANGED/);
  const display = assembleGeneralDisplay(result("本文"), prepared("Q06"), catalog);
  assert.equal("sampleBody" in display.appDisplay, false);
  assert.doesNotMatch(JSON.stringify(display), /q06-body-1/);
});

test("conditional details and optional background remain separate from always-adjacent blocks", () => {
  const answer = {
    status: "completed", outputText: "raw",
    answer: {
      explanations: [{ text: "結果の説明", original_ids: ["E03-F-S01"] }],
      limitations: [{ text: "限界", original_ids: ["E03-C-LIMITATIONS"] }],
      abstention: { applies: true, text: "個人には判断できません。",
        original_ids: ["E03-F-S01"] },
    },
    classification: { globalFailure: false, caseFailure: false },
  };
  const display = assembleGeneralDisplay(answer, prepared("Q08"), catalog);
  assert.equal(display.appDisplay.claims.length, 3);
  assert.ok(display.appDisplay.claims.every(claim =>
    claim.blocks.every(block => block.tier === "mandatory")));
  assert.ok(display.appDisplay.researchDetails.every(block => block.tier === "conditional"));
  assert.ok(display.appDisplay.optionalBackground.every(block => block.tier === "optional"));
  assert.match(display.appDisplay.researchDetails.map(block => block.text).join("\n"), /I²=93%/);
});

test("pending and technical no-answer records render deterministically without an approved answer", () => {
  for (const pending of [
    { status: "pending", outputText: "", answer: null,
      classification: { globalFailure: false, caseFailure: false } },
    { status: "failed", outputText: "", answer: null,
      classification: { globalFailure: true, caseFailure: false } },
  ]) {
    const display = assembleGeneralDisplay(pending, prepared("Q11"), catalog);
    assert.equal(display.rawAnswer, null);
    assert.deepEqual(display.appDisplay.claims, []);
    assert.equal(display.completedResponseAvailable, false);
    assert.equal(display.userReady, false);
    assert.ok(display.noAnswerReason);
  }
});

test("raw claim citations do not select or remove app-owned mandatory context", () => {
  const answer = {
    status: "completed", outputText: "raw",
    answer: {
      explanations: [{ text: "割合と研究数を誤読した本文",
        original_ids: ["E03-F-S02"] }],
      limitations: [], abstention: { applies: false, text: "", original_ids: [] },
    },
    classification: { globalFailure: false, caseFailure: false },
  };
  const display = assembleGeneralDisplay(answer, prepared("Q09"), catalog);
  assert.equal(display.appDisplay.claims[0].blocks.length,
    catalog.cases.Q09.blocks.filter(block => block.tier === "mandatory").length);
  assert.equal(display.bodySemanticsPassed, null);
});

test("report accounting stops the displayed total when any sent usage is unknown", () => {
  const historical = {
    schemaVersion: 2,
    purpose: "cumulative-provider-api-transmissions-not-per-run",
    limits: { maxApiTransmissions: 20, operationalModelBudgetMicroUSD: 1_000_000,
      maxConcurrency: 1, maxRetries: 0 },
    entries: Array.from({ length: 13 }, (_, index) => ({
      sequence: index + 1,
      kind: index === 0 ? "model_metadata" : "generation",
      ...(index === 0 ? {} : {
        measuredMicroUSD: index === 12 ? 6093 : 1000,
      }),
    })),
  };
  const hash = "a".repeat(64);
  const ledger = createRunLedger({
    oldLedger: historical, oldLedgerSha256: hash, historySnapshotSha256: hash,
    preparationBindings: { preparedPackageSha256: hash },
    initializedAt: "2026-01-01T00:00:00Z",
  });
  reserveCase(ledger, {
    caseId: "G-Q05", requestSha256: hash, requestSerializedSha256: hash,
    projection: { estimatedInputTokens: 8000, outputCapTokens: 1500,
      estimatedMicroUSD: 3800 },
    reservedAt: "2026-01-01T00:00:01Z",
  });
  const view = accountingPresentation(ledger);
  assert.equal(view.usageKnown, false);
  assert.equal(view.displayMeasuredTotalMicroUSD, null);
  assert.equal(view.measuredTotalLabel, "利用量未確定・総額算出停止");
  assert.equal(view.knownCostMicroUSD, 17093);
  assert.equal(view.reservedUnknownMicroUSD, 3800);
  assert.doesNotMatch(view.measuredTotalLabel, /17,093|0\\.017093/);
});