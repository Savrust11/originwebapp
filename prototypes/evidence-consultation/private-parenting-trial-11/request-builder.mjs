import fs from "node:fs";
import { createHash } from "node:crypto";
import { LIMITS, MODEL_SETTINGS, SYSTEM_POLICY } from "./policy.mjs";
import { sourceBlocksForScene } from "./source-loader.mjs";
import { validateProviderEnvelope, verifyReceiptPath } from "./response-record.mjs";
import { loadPlans, selectedMessage } from "./plan-adapter.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const forbidden = /(自治体|市区町村|都道府県|municipal|地域子育て支援|動画終了|未採用)/iu;
const forbiddenKeys = /(expected|example|sample|rubric|evaluation|purpose|scenario|caseId)/iu;
const nonempty = value => typeof value === "string" && value.trim().length > 0;

function assertSafeObject(value, path = "$") {
  if (Array.isArray(value)) return value.forEach((child, index) => assertSafeObject(child, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) throw new Error(`FORBIDDEN_GENERATION_FIELD:${path}.${key}`);
    assertSafeObject(child, `${path}.${key}`);
  }
}

function verifiedAssistantTurn(receipt, expectedRequestSha256) {
  if (!receipt || typeof receipt !== "object") throw new Error("ASSISTANT_RECEIPT_REQUIRED");
  verifyReceiptPath(receipt);
  const raw = fs.readFileSync(receipt.rawPath);
  const metadata = JSON.parse(fs.readFileSync(receipt.metadataPath, "utf8"));
  if (metadata.rawSha256 !== sha(raw) || metadata.requestSha256 !== expectedRequestSha256) {
    throw new Error("ASSISTANT_RECEIPT_HASH_MISMATCH");
  }
  const checked = validateProviderEnvelope(raw);
  if (checked.outputText !== metadata.parsedDisplay?.text) throw new Error("ASSISTANT_DISPLAY_MISMATCH");
  return Object.freeze({ content: checked.outputText, synthetic: metadata.synthetic === true });
}

export function buildPendingRequest(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(key => !["sceneId", "parentMessageId", "previousTurns"].includes(key))) {
    throw new Error("REQUEST_OPTIONS_SCHEMA");
  }
  const { sceneId, parentMessageId, previousTurns = [] } = options;
  if (!nonempty(sceneId) || !nonempty(parentMessageId)) throw new Error("SCENE_AND_REGISTERED_MESSAGE_REQUIRED");
  if (!Array.isArray(previousTurns) || previousTurns.length > 4 || previousTurns.length % 2 !== 0) {
    throw new Error("INVALID_HISTORY");
  }
  const plans = loadPlans();
  const scene = plans.scenes.scenes.find(item => item.id === sceneId);
  if (!scene) throw new Error("UNKNOWN_SCENE");
  const parent = selectedMessage(scene, parentMessageId);
  if (previousTurns.length === 0 && parentMessageId !== "initial") throw new Error("FOLLOWUP_REQUIRES_HISTORY");
  if (previousTurns.length > 0 && parentMessageId === "initial") throw new Error("INITIAL_CANNOT_REPEAT");
  const sources = sourceBlocksForScene(sceneId);
  const conversation = [];
  let previousRequestSha256 = null;
  let syntheticOfflineOnly = false;
  const seenMessages = new Set();
  for (let index = 0; index < previousTurns.length; index += 2) {
    const user = previousTurns[index];
    const assistant = previousTurns[index + 1];
    if (!user || Object.keys(user).some(key => !["role", "messageId", "requestSha256"].includes(key))
      || user.role !== "user" || !nonempty(user.messageId)
      || !/^[a-f0-9]{64}$/.test(user.requestSha256 ?? "")
      || !assistant || Object.keys(assistant).some(key => !["role", "receipt"].includes(key))
      || assistant.role !== "assistant") throw new Error("UNVERIFIED_CONVERSATION_TURN");
    if (index === 0 && user.messageId !== "initial") throw new Error("HISTORY_MUST_START_INITIAL");
    if (index > 0 && user.messageId === "initial") throw new Error("INITIAL_CANNOT_REPEAT");
    if (seenMessages.has(user.messageId)) throw new Error("PARENT_MESSAGE_REPEATED");
    const registered = selectedMessage(scene, user.messageId);
    seenMessages.add(user.messageId);
    conversation.push({ role: "user", content: registered.text });
    previousRequestSha256 = user.requestSha256;
    const verified = verifiedAssistantTurn(assistant.receipt, previousRequestSha256);
    syntheticOfflineOnly ||= verified.synthetic;
    conversation.push({ role: "assistant", content: verified.content });
  }
  if (seenMessages.has(parentMessageId)) throw new Error("PARENT_MESSAGE_REPEATED");
  conversation.push({ role: "user", content: parent.text });
  assertSafeObject({ sources: sources.packetBlocks, conversation });
  const sourceText = sources.packetBlocks.map(item => `${item.label}:\n${item.originalText}`).join("\n\n");
  const packet = {
    model: MODEL_SETTINGS.model,
    service_tier: MODEL_SETTINGS.service_tier,
    reasoning: MODEL_SETTINGS.reasoning,
    max_output_tokens: MODEL_SETTINGS.max_output_tokens,
    tools: [],
    store: false,
    background: false,
    truncation: "disabled",
    prompt_cache_options: MODEL_SETTINGS.prompt_cache_options,
    stream: false,
    input: [
      { role: "system", content: SYSTEM_POLICY },
      { role: "system", content: `次の確認済み原文だけを根拠として使ってください。\n\n${sourceText}` },
      ...conversation,
    ],
  };
  const serialized = JSON.stringify(packet);
  if (forbidden.test(`${sourceText}\n${conversation.map(turn => turn.content).join("\n")}`)) {
    throw new Error("EXCLUDED_GENERATION_CONTENT");
  }
  for (const item of sources.sidecar) {
    if (serialized.includes(item.unitId) || serialized.includes(item.sourceId) || serialized.includes(item.versionId)) {
      throw new Error("SOURCE_METADATA_LEAK");
    }
  }
  const bytes = Buffer.byteLength(serialized);
  if (bytes > LIMITS.requestBytes) throw new Error(`CONSERVATIVE_INPUT_BOUND:${bytes}`);
  const digest = sha(Buffer.from(serialized));
  return Object.freeze({
    packet,
    serialized,
    sha256: digest,
    inputMeasurement: Object.freeze({
      utf8Bytes: bytes,
      conservativeMaximumTokens: bytes,
      configuredTokenLimit: LIMITS.inputTokens,
      rule: "1 UTF-8 byte = 1 token as a deliberately conservative upper bound; no truncation",
    }),
    localStatus: "assembled_unsent",
    externalStatus: syntheticOfflineOnly
      ? "permanently_not_sendable_synthetic_history"
      : "blocked_current_authorization_zero",
    syntheticOfflineOnly,
    sidecar: Object.freeze({
      sceneId,
      parentMessageId,
      fixedFactIds: Object.freeze([...parent.usedFactIds]),
      sourceAttribution: sources.sidecar,
      requestSha256: digest,
    }),
  });
}