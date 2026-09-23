import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  buildArtifacts, checkPreparation, CASE_IDS, GENERAL_INSTRUCTIONS,
  MODEL, OUTPUT_DIRECTORY, ROOT, RUN_ID,
} from "../prototypes/evidence-consultation/general-evaluation/prepare.mjs";

const artifacts = buildArtifacts();
const prepared = artifacts["prepared-package.json"];
const rubric = artifacts["rubric.json"];

test("six hard cases are fixed in the authorized order with no easier Q07", () => {
  assert.equal(RUN_ID, "general-audience-six-01");
  assert.deepEqual(CASE_IDS, ["G-Q05", "G-Q06", "G-Q08", "G-Q09", "G-Q10", "G-Q11"]);
  assert.deepEqual(prepared.requests.map(item => item.caseId), CASE_IDS);
  assert.deepEqual(prepared.requests.map(item => item.baseCaseId),
    ["Q05", "Q06", "Q08", "Q09", "Q10", "Q11"]);
  assert.match(prepared.requests.find(x => x.caseId === "G-Q09").question,
    /研究数.*効果量数.*CES-D.*分母/);
  assert.match(prepared.requests.find(x => x.caseId === "G-Q10").question,
    /38分.*平均年齢6歳未満.*5\.8歳.*6\.1歳.*5\.95歳/);
  assert.match(prepared.requests.find(x => x.caseId === "G-Q11").question,
    /改善しなかった2つの介入.*平均年齢条件/);
});

test("model input contains only general rules, the question, and complete verbatim originals", () => {
  const sourcePackets = Object.fromEntries(["E02", "E03", "E04"].map(id => [id,
    JSON.parse(fs.readFileSync(path.join(ROOT, `evidence-work/v0.2/${id}.json`)))]));
  const sourceText = new Map(Object.values(sourcePackets)
    .flatMap(packet => packet.fragments).map(fragment => [fragment.id, fragment.original_text]));
  for (const item of prepared.requests) {
    assert.equal(item.request.input.length, 2);
    assert.deepEqual(item.request.input.map(input => input.role), ["developer", "user"]);
    assert.equal(item.request.input[0].content, GENERAL_INSTRUCTIONS);
    const user = JSON.parse(item.request.input[1].content);
    assert.deepEqual(Object.keys(user).sort(), ["original_evidence", "question"]);
    assert.equal(user.question, item.question);
    assert.deepEqual(user.original_evidence.map(x => x.original_id), item.originalIds);
    for (const original of user.original_evidence)
      assert.equal(original.original_text, sourceText.get(original.original_id));
  }
});

test("complete original closures are retained for E03 and E04 cases", () => {
  const expectedE03 = ["E03-C-ELIGIBILITY", "E03-C-LIMITATIONS",
    "E03-C-RISK-OF-BIAS", "E03-C-STUDY-CHARACTERISTICS"];
  for (const id of ["G-Q08", "G-Q09"]) {
    const ids = prepared.requests.find(x => x.caseId === id).originalIds;
    assert.deepEqual(ids.filter(x => x.startsWith("E03-C-")).sort(), expectedE03);
  }
  const expectedE04 = ["E04-C-ELIGIBILITY", "E04-C-METHODOLOGICAL-LIMITATIONS",
    "E04-C-PROTOCOL-DEVIATIONS", "E04-C-REVIEW-LIMITATIONS",
    "E04-C-STUDY-CHARACTERISTICS"];
  for (const id of ["G-Q10", "G-Q11"]) {
    const ids = prepared.requests.find(x => x.caseId === id).originalIds;
    assert.deepEqual(ids.filter(x => x.startsWith("E04-C-")).sort(), expectedE04);
  }
});

test("source files and all selected full fragments are hash-bound before preparation", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIRECTORY, "manifest.json")));
  assert.equal(manifest.files["evidence-work/v0.2/E02.json"].sha256,
    "97ddaddb95db1d8581c4bfa7aa9f7e79bebf9a20269023832dbb136f63d1b5b5");
  assert.equal(manifest.files["evidence-work/v0.2/E03.json"].sha256,
    "cf6da398b615a2ac96ca65145b949475bc26f211fcfcd0563854e20541168a76");
  assert.equal(manifest.files["evidence-work/v0.2/E04.json"].sha256,
    "061bf103c8b1056fbc8d1744fc5ac4e47e3dc67418c2042f3614ba0f3706f352");
  for (const item of Object.values(artifacts["original-evidence.json"].originals))
    assert.equal(item.textSha256, createHash("sha256").update(item.originalText).digest("hex"));
});

test("no rubric, expected answer, prior answer, app prose, or editorial metadata leaks into requests", () => {
  const serialized = JSON.stringify(prepared.requests.map(item => item.request));
  for (const forbidden of [
    "bodyMandatory", "forbiddenContent", "recurrenceChecks", "sampleBody",
    "q06-age-duration", "offline-editorial-illustration", "editorial_notes",
    "human_approval", "publication_status", "verification_reference_ids",
    "AASM公式PDFの視覚確認では", "5研究中2研究（41%）",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden));
  assert.doesNotMatch(serialized, /あなたにも必ず効果があります/);
  assert.match(serialized, /original_evidence/);
});

test("general generation rules cover recurrence classes without supplying case answers", () => {
  for (const required of [
    "原文で支持できない", "平均年齢", "参加者全員", "割合、研究数、参加者数",
    "原文にない分母", "有意差がないことを効果ゼロ", "改善しなかった結果",
    "対象・採択・除外条件と矛盾する個別助言", "AASM本文は",
    "昼寝を含む24時間合計",
  ]) assert.match(GENERAL_INSTRUCTIONS, new RegExp(required));
  assert.doesNotMatch(GENERAL_INSTRUCTIONS, /11〜14|10〜13|SMD|96\\.56|5\\.95|CES-D/);
});

test("provider request controls and output contract remain unchanged", () => {
  for (const { request } of prepared.requests) {
    assert.equal(request.model, MODEL);
    assert.equal(request.background, false);
    assert.equal(request.store, false);
    assert.equal(request.max_output_tokens, 1500);
    assert.deepEqual(request.reasoning, { effort: "medium" });
    assert.deepEqual(request.prompt_cache_options, { mode: "explicit" });
    assert.equal(request.truncation, "disabled");
    assert.deepEqual(request.tools, []);
    assert.equal(request.service_tier, "default");
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.name, "claim_source_explanation");
  }
});

test("adopted triad is prospective and body, app, whole-screen verdicts stay separate", () => {
  assert.equal(rubric.adoptedForThisRun, true);
  assert.equal(rubric.historicalResultsOrRubricsChanged, false);
  assert.equal(rubric.applicationAndBodyScoredSeparately, true);
  for (const id of CASE_IDS) {
    const row = rubric.cases[id];
    assert.ok(row.adoptedClassification.mandatory.body.length);
    assert.ok(row.adoptedClassification.mandatory.applicationDisplay.length);
    assert.ok(row.adoptedClassification.mandatory.wholeScreen.length);
    assert.equal(row.scoring.wholeScreen.includes("bodyAloneとappDisplay"), true);
    assert.equal(row.historicalScoringChanged, false);
  }
  assert.equal(artifacts["proposal.json"].status,
    "adopted-for-this-new-general-audience-evaluation-only");
  assert.equal(artifacts["proposal.json"].historicalRegradingAllowed, false);
});

test("verified app catalog is separately bound and is never model input", () => {
  const app = artifacts["app-catalog.json"];
  assert.equal(app.role, "app-owned-source-verified-adjacent-display-not-model-input");
  assert.equal(app.evaluationSeparation.appDisplayDoesNotRepairBody, true);
  assert.equal(app.evaluationSeparation.bodyAndDisplayScoredSeparately, true);
  for (const base of ["Q05", "Q06", "Q08", "Q09", "Q10", "Q11"]) {
    assert.equal(app.reviewBinding.cases[base].verdict, "pass");
    assert.ok(app.catalog.cases[base].blocks.some(block => block.tier === "mandatory"));
  }
  const requests = JSON.stringify(prepared);
  assert.doesNotMatch(requests, /app-owned-source-verified|q08-result-meaning|app_attribution/);
});

test("accounting leaves one transmission unused and reserves within the one-dollar budget", () => {
  const controls = artifacts["rationale.json"].controls;
  assert.equal(controls.baselineTransmissions, 13);
  assert.equal(controls.maximumNewTransmissions, 6);
  assert.equal(controls.maximumFinalTransmissions, 19);
  assert.equal(controls.reservedTransmissionsNotUsed, 1);
  assert.equal(controls.baselineMeasuredMicroUSD, 17093);
  assert.equal(controls.operationalBudgetMicroUSD, 1000000);
  assert.equal(controls.maxConcurrency, 1);
  assert.equal(controls.automaticRetries, 0);
  assert.ok(controls.baselineMeasuredMicroUSD + controls.maximumProjectedNewMicroUSD
    < controls.operationalBudgetMicroUSD);
});

test("--check artifact comparison is deterministic and read-only", () => {
  assert.doesNotThrow(() => checkPreparation());
  const before = new Map(fs.readdirSync(OUTPUT_DIRECTORY).map(name => [
    name, fs.readFileSync(path.join(OUTPUT_DIRECTORY, name)),
  ]));
  checkPreparation();
  for (const [name, bytes] of before)
    assert.deepEqual(fs.readFileSync(path.join(OUTPUT_DIRECTORY, name)), bytes);
});