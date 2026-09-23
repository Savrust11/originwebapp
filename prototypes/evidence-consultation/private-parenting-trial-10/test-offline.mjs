import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildGenerationRequest } from "./request-builder.mjs";
import { createOfflineInjectedTransport, createRealModelAdapter } from "./disabled-adapter.mjs";
import { archiveRawResponse, validateProviderEnvelope } from "./response-record.mjs";
import { LIMITS, MODEL_SETTINGS, REVIEW_DIMENSIONS } from "./policy.mjs";
import { validatePlanBundle } from "./plan-adapter.mjs";

assert.equal(globalThis[Symbol.for("private-parenting-trial-10.offline-lockdown")], true);
await assert.rejects(fetch("https://api.openai.com/v1/responses"), /OFFLINE_NETWORK_BLOCKED/);
assert.throws(() => new WebSocket("wss://example.invalid"), /OFFLINE_NETWORK_BLOCKED/);
assert.throws(() => createRealModelAdapter(), /AUTHORIZATION_ZERO/);
const planBase = path.resolve("evidence-work/private-parenting-trial-10/plan");
const adaptedPlan = validatePlanBundle({
  scenes: JSON.parse(fs.readFileSync(path.join(planBase, "scenes.json"), "utf8")),
  sources: JSON.parse(fs.readFileSync(path.join(planBase, "source-plan.json"), "utf8")),
  budget: JSON.parse(fs.readFileSync(path.join(planBase, "model-budget.json"), "utf8")),
});
assert.equal(adaptedPlan.sceneCount, 5);
assert.equal(adaptedPlan.actualRequestCandidates.length, 0);
assert(adaptedPlan.eligibility.every(scene => !scene.eligible && scene.blockers.length > 0));

const fakeSource = {
  title: "合成接続試験用の技術文",
  location: "ローカル試験",
  originalText: "この合成試験では外部送信を行わない。",
  applicability: "通信遮断の技術確認だけに用いる。",
  requiredContext: [],
  requiredContextRequired: false,
  externalAI: "send_eligible",
  externalAIStatus: "test_only",
};
const built = buildGenerationRequest({
  scene: { key: "technical-dry-run", title: "通信遮断の技術確認" },
  sources: [fakeSource],
  conversation: [{ role: "user", content: "これは合成接続試験です。" }],
});
assert.equal(built.packet.store, false);
assert.equal(built.packet.background, false);
assert.equal(built.packet.stream, false);
assert.deepEqual(built.packet.tools, []);
assert.equal(built.packet.reasoning.effort, "medium");
assert.equal(built.packet.max_output_tokens, 1500);
assert.deepEqual(built.packet.prompt_cache_options, { mode: "explicit" });
assert(!Object.hasOwn(built.packet, "prompt_cache_breakpoints"));
assert(!/expectedAnswer|evaluationCriteria|scenarioId|caseId/.test(built.serialized));
assert(!built.serialized.includes(fakeSource.title));
assert(!built.serialized.includes(fakeSource.location));
assert(!built.serialized.includes(fakeSource.applicability));

for (const blocked of [
  { ...fakeSource, externalAI: "unknown" },
  { ...fakeSource, externalAI: "prohibited" },
]) assert.throws(() => buildGenerationRequest({
  scene: { key: "x", title: "x" }, sources: [blocked],
  conversation: [{ role: "user", content: "test" }],
}), /SOURCE_NOT_SEND_ELIGIBLE/);
assert.throws(() => buildGenerationRequest({
  scene: { key: "x", title: "x" },
  sources: [{ ...fakeSource, requiredContextRequired: true }],
  conversation: [{ role: "user", content: "test" }],
}), /REQUIRED_CONTEXT_MISSING/);
assert.throws(() => buildGenerationRequest({
  scene: { key: "x", title: "x" },
  sources: [fakeSource],
  conversation: [{ role: "user", content: "自治体の窓口も探して" }],
}), /MUNICIPAL_INPUT_FORBIDDEN/);
assert.throws(() => buildGenerationRequest({
  scene: { key: "x", title: "動画終了" },
  sources: [fakeSource],
  conversation: [{ role: "user", content: "test" }],
}), /UNADOPTED_TOPIC_FORBIDDEN/);
assert.throws(() => buildGenerationRequest({
  scene: { key: "x", title: "x", expectedAnswer: "fixture" },
  sources: [fakeSource],
  conversation: [{ role: "user", content: "test" }],
}), /FORBIDDEN_GENERATION_FIELD/);

const response = Buffer.from(JSON.stringify({
  id: "synthetic-technical-response",
  model: MODEL_SETTINGS.model,
  status: "completed",
  output: [{ type: "message", role: "assistant", status: "completed", content: [{
    type: "output_text",
    text: "合成通信テスト応答です。実モデルの育児回答ではありません。",
    annotations: [],
  }] }],
  usage: { input_tokens: 40, output_tokens: 18 },
}));
validateProviderEnvelope(response);
assert.throws(() => validateProviderEnvelope(Buffer.alloc(LIMITS.responseBytes + 1)), /RESPONSE_BYTE_BOUND/);
const transport = createOfflineInjectedTransport(async packet => {
  assert.equal(packet, built.serialized);
  return response;
});
assert.deepEqual(await transport.attempt(built.serialized), response);
assert.equal(transport.attempts, 1);

const outRoot = path.resolve("evidence-work/private-parenting-trial-10/offline");
fs.mkdirSync(outRoot, { recursive: true });
const temporary = fs.mkdtempSync(path.join(outRoot, "test-owned-"));
const archived = archiveRawResponse({
  directory: path.join(temporary, "responses"),
  rawBytes: response,
  requestSha256: built.sha256,
  synthetic: true,
});
assert.equal(archived.metadata.rawSha256, createHash("sha256").update(response).digest("hex"));
assert.deepEqual(Object.keys(archived.metadata.review), [...REVIEW_DIMENSIONS]);
assert(Object.values(archived.metadata.review).every(x => x.status === "unrated"));
const reread = fs.readFileSync(archived.rawPath);
assert.deepEqual(reread, response);
const malformed = Buffer.from("{technical-malformed-response");
const malformedRecord = archiveRawResponse({
  directory: path.join(temporary, "responses"),
  rawBytes: malformed,
  requestSha256: built.sha256,
  synthetic: true,
});
assert.equal(malformedRecord.metadata.parseStatus, "invalid_needs_review");
assert.deepEqual(fs.readFileSync(malformedRecord.rawPath), malformed);
assert.throws(() => archiveRawResponse({
  directory: path.resolve("/tmp/private-parenting-trial-escape"),
  rawBytes: response,
  requestSha256: built.sha256,
  synthetic: true,
}), /ARCHIVE_OUTSIDE_OWNED_PATH/);
fs.rmSync(temporary, { recursive: true, force: true });

const oldManifest = fs.readFileSync("evidence-work/comparison-closeout/reading-comparison-02/evidence-manifest.json");
assert.equal(createHash("sha256").update(oldManifest).digest("hex"), "3d2d55621d3ebab1f87a8c2951b3364e1084684c22804331b1cf21327418393d");
assert.equal(LIMITS.attempts, 15);
console.log("PASS offline private parenting trial: network blocked, real transport disabled, strict packet and raw archive verified");
