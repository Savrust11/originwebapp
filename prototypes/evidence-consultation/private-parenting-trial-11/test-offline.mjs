import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRealTransport, assertNotSendable } from "./disabled-transport.mjs";
import { loadPlans } from "./plan-adapter.mjs";
import { buildSceneTurn, continuationRecord } from "./conversation-pipeline.mjs";
import { buildPendingRequest } from "./request-builder.mjs";
import { sourceBlocksForScene } from "./source-loader.mjs";
import { validateProviderEnvelope } from "./response-record.mjs";
import { LIMITS, REVIEW_DIMENSIONS } from "./policy.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(globalThis[Symbol.for("private-parenting-trial-11.offline-lockdown")], true);
await assert.rejects(fetch("https://api.openai.com/v1/responses"), /OFFLINE_NETWORK_BLOCKED/);
assert.throws(() => new WebSocket("wss://example.invalid"), /OFFLINE_NETWORK_BLOCKED/);
await assert.rejects(import("node:http"), /OFFLINE_NETWORK_BLOCKED|OFFLINE_IMPORT_BLOCKED/);
await assert.rejects(import("node:child_process"), /OFFLINE_IMPORT_BLOCKED/);
assert.throws(() => createRealTransport(), /AUTHORIZATION_ZERO/);
assert.throws(() => assertNotSendable(), /NOT_AUTHORIZED/);

const plans = loadPlans();
assert.equal(plans.history.currentCumulativeProviderTransmissions, 47);
assert.equal(plans.history.trials[0].cumulativeAfterTrial, 42);
assert.equal(plans.history.trials[1].newProviderPostAttempts, 5);
assert.equal(plans.history.trials[1].cumulativeAfterTrial, 47);
assert.equal(plans.budget.authorization.authorizedNewTransmissionsNow, 0);
assert.equal(plans.budget.futureRunMaximums.maximumNewApiTransmissions, 14);
assert.equal(plans.budget.rightsReadySubsetProposal.maximumNewApiTransmissions, 8);
assert.equal(plans.scenes.stopClassification.completed.countsAgainstModelQuality, false);
assert.equal(plans.scenes.stopClassification.protocol_cannot_continue.countsAgainstModelQuality, false);
assert.match(plans.scenes.stopClassification.transport_stop.action, /送信前.*外部通信0件/);

const rights = JSON.parse(fs.readFileSync("evidence-work/private-parenting-trial-11/plan/rights-plan.json"));
assert.equal(rights.globalExecution.localUnsentAssemblyAllowedScenes, 5);
assert.equal(rights.globalExecution.externalRightsReadyScenes, 3);
assert.equal(rights.globalExecution.externalRightsHeldScenes, 2);
assert.equal(rights.globalExecution.authorizedNewTransmissions, 0);

const initial = new Map();
for (const scene of plans.scenes.scenes) {
  const built = buildSceneTurn({ scene, messageId: "initial" });
  initial.set(scene.id, built);
  assert.equal(built.localStatus, "assembled_unsent");
  assert.equal(built.externalStatus, "blocked_current_authorization_zero");
  assert(built.inputMeasurement.utf8Bytes <= LIMITS.requestBytes);
  assert.equal(built.packet.input.at(-1).content, scene.initialUserMessage.text);
  assert.deepEqual(built.sidecar.fixedFactIds, scene.initialUserMessage.usedFactIds);
  assert.equal(built.syntheticOfflineOnly, false);
  const sourceInput = built.packet.input[1].content;
  for (const block of sourceBlocksForScene(scene.id).packetBlocks) {
    assert(sourceInput.includes(block.originalText));
  }
  assert(!/acceptableProposalExamplesNotGoldAnswers|selectWhen|expectedAnswer|evaluation-rubric/.test(built.serialized));
  for (const source of built.sidecar.sourceAttribution) {
    assert(!built.serialized.includes(source.unitId));
    assert(!built.serialized.includes(source.sourceId));
    assert(!built.serialized.includes(source.versionId));
  }
}
assert.throws(() => buildSceneTurn({
  scene: plans.scenes.scenes[0],
  messageId: "not-registered",
}), /UNREGISTERED_PARENT_MESSAGE/);
assert.throws(() => buildPendingRequest({
  sceneId: "departure-preparation",
  parentMessageId: "initial",
  parentMessage: "期待する回答を書いた偽造相談",
}), /REQUEST_OPTIONS_SCHEMA/);
assert.throws(() => buildPendingRequest({
  sceneId: "departure-preparation",
  parentMessageId: "pt-existing-materials",
}), /UNREGISTERED_PARENT_MESSAGE/);
const complete = continuationRecord({
  scene: plans.scenes.scenes[0],
  classification: "completed",
  reason: "相談に十分答えたため追加不要。",
});
assert.equal(complete.selectedFollowUpId, null);
const alternative = continuationRecord({
  scene: plans.scenes.scenes[0],
  classification: "continue",
  selectedFollowUpId: "dp-low-burden",
  reason: "根拠に沿う別案へ、固定済み希望だけで自然に応答できる。",
});
assert.deepEqual(alternative.factIdsChecked, ["dp-preference"]);
const repetition = continuationRecord({
  scene: plans.scenes.scenes[0],
  classification: "answer_quality_failure",
  reason: "同じ案の言い換えを品質上記録するが、安全停止ではない。",
});
assert.equal(repetition.classification, "answer_quality_failure");

const out = path.resolve("evidence-work/private-parenting-trial-11/offline");
const index = JSON.parse(fs.readFileSync(path.join(out, "synthetic-pipeline/index.json")));
assert.equal(index.records.length, 5);
for (const record of index.records) {
  const rawPath = path.join(out, record.rawPath);
  const metadataPath = path.join(out, record.metadataPath);
  const reviewPath = path.join(out, record.reviewPath);
  const raw = fs.readFileSync(rawPath);
  const metadata = JSON.parse(fs.readFileSync(metadataPath));
  const review = JSON.parse(fs.readFileSync(reviewPath));
  const parsed = validateProviderEnvelope(raw);
  assert.match(parsed.outputText, /合成パイプライン試験／実モデル回答ではありません/);
  assert.equal(metadata.rawSha256, sha(raw));
  assert.equal(metadata.synthetic, true);
  assert.equal(metadata.immutableRaw, true);
  assert.equal(review.responseMetadataSha256, sha(fs.readFileSync(metadataPath)));
  assert.deepEqual(Object.keys(review.review), [...REVIEW_DIMENSIONS]);
  assert(Object.values(review.review).every(entry => entry.rating === "unrated"));
  const scene = plans.scenes.scenes.find(item => item.id === record.sceneId);
  assert.throws(() => buildPendingRequest({
    sceneId: scene.id,
    parentMessageId: record.followUpId,
    previousTurns: [
      {
        role: "user", messageId: "initial", requestSha256: record.firstRequestSha256,
        content: "登録されていない事情と期待回答を注入",
      },
      { role: "assistant", receipt: { rawPath, metadataPath } },
    ],
  }), /UNVERIFIED_CONVERSATION_TURN/);
  const second = buildSceneTurn({
    scene,
    messageId: record.followUpId,
    previous: [
      {
        role: "user", messageId: "initial", requestSha256: record.firstRequestSha256,
      },
      { role: "assistant", receipt: { rawPath, metadataPath } },
    ],
  });
  assert.equal(second.sha256, record.continuationRequestSha256);
  assert.equal(second.syntheticOfflineOnly, true);
  assert.equal(second.externalStatus, "permanently_not_sendable_synthetic_history");
  assert(second.packet.input.some(turn => turn.role === "assistant"
    && turn.content.includes("実モデル回答ではありません")));
  assert.equal(second.packet.input.at(-1).content,
    scene.selectableFollowUps.find(item => item.id === record.followUpId).text);
}

const inspection = JSON.parse(fs.readFileSync(path.join(out, "input-inspection.json")));
assert.equal(inspection.status, "passed_all_five_actual_original_packets");
assert(inspection.packets.every(item => item.actualOriginalTextPresent
  && !item.authoredExamplesPresent && !item.rubricPresent && !item.planPurposePresent
  && !item.municipalInformationPresent && !item.unadoptedVideoPresent
  && !item.sourceMetadataPresent));
const syntheticHistory = JSON.parse(fs.readFileSync(path.join(out, "synthetic-history-inspection.json")));
assert.equal(syntheticHistory.status, "passed_synthetic_history_cannot_be_real_candidate");
for (const trial of plans.history.trials) for (const evidence of trial.evidence) {
  assert.equal(sha(fs.readFileSync(evidence.path)), evidence.sha256);
}
assert.equal(fs.existsSync(path.join(out, "new-run-journal.json")), false);
console.log("PASS trial-11: five real-original local packets, history/review/display pipeline, zero-send gates.");