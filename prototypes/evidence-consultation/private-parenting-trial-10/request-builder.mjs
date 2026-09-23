import { createHash } from "node:crypto";
import { MODEL_SETTINGS, SYSTEM_POLICY, LIMITS } from "./policy.mjs";

const plain = value => value && typeof value === "object" && !Array.isArray(value);
const forbiddenPlanKeys = new Set([
  "expectedAnswer", "expectedAnswers", "authoredAnswer", "authoredDialogue",
  "editorialExample", "evaluationCriteria", "review", "scenarioId", "caseId",
]);
const forbiddenSourceStates = new Set(["unknown", "unconfirmed", "held", "prohibited", "not_allowed"]);
const municipalPattern = /(自治体|市区町村|都道府県|municipal|地域子育て支援|子ども家庭支援センター)/iu;
const excludedTopicPattern = /(動画終了|screen transition|未採用|追加候補)/iu;

function assertNoForbiddenKeys(value, path = "$") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
  if (!plain(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPlanKeys.has(key)) throw new Error(`FORBIDDEN_GENERATION_FIELD:${path}.${key}`);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function checkedText(value, label, max = 24_000) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > max) {
    throw new Error(`INVALID_${label}`);
  }
  return value;
}

function sourceInput(source) {
  if (!plain(source) || source.externalAI !== "send_eligible") throw new Error("SOURCE_NOT_SEND_ELIGIBLE");
  if (forbiddenSourceStates.has(String(source.externalAIStatus ?? "").toLowerCase())) throw new Error("SOURCE_RIGHTS_HELD");
  const originalText = checkedText(source.originalText, "SOURCE_TEXT");
  checkedText(source.applicability, "SOURCE_SCOPE", 8_000);
  if (municipalPattern.test(`${source.title ?? ""}\n${originalText}`)) throw new Error("MUNICIPAL_SOURCE_FORBIDDEN");
  if (excludedTopicPattern.test(`${source.title ?? ""}\n${originalText}`)) throw new Error("UNADOPTED_TOPIC_FORBIDDEN");
  const required = source.requiredContext ?? [];
  if (!Array.isArray(required)) throw new Error("INVALID_REQUIRED_CONTEXT");
  if (source.requiredContextRequired === true && required.length === 0) throw new Error("REQUIRED_CONTEXT_MISSING");
  return {
    originalText,
    requiredContext: required.map((item) => checkedText(item.text, "REQUIRED_CONTEXT", 8_000)),
  };
}

export function buildGenerationRequest({ scene, sources, conversation } = {}) {
  assertNoForbiddenKeys({ scene, sources, conversation });
  if (!plain(scene) || typeof scene.key !== "string" || typeof scene.title !== "string") throw new Error("INVALID_SCENE");
  if (!Array.isArray(sources) || sources.length === 0) throw new Error("NO_SEND_ELIGIBLE_SOURCES");
  if (!Array.isArray(conversation) || conversation.length === 0 || conversation.length > 5) throw new Error("INVALID_CONVERSATION");
  const turns = conversation.map((turn) => {
    if (!plain(turn) || !["user", "assistant"].includes(turn.role)) throw new Error("INVALID_TURN");
    return { role: turn.role, content: checkedText(turn.content, "TURN", 12_000) };
  });
  if (turns[0].role !== "user") throw new Error("FIRST_TURN_MUST_BE_USER");
  if (municipalPattern.test(JSON.stringify({ scene, sources, conversation }))) throw new Error("MUNICIPAL_INPUT_FORBIDDEN");
  if (excludedTopicPattern.test(JSON.stringify({ scene, sources, conversation }))) throw new Error("UNADOPTED_TOPIC_FORBIDDEN");
  const sourceText = sources.map(sourceInput);
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
      { role: "system", content: `外部AI送信可能性を確認済みの原文と必須文脈:\n${JSON.stringify(sourceText)}` },
      ...turns,
    ],
  };
  const serialized = JSON.stringify(packet);
  if (Buffer.byteLength(serialized, "utf8") > LIMITS.inputTokensPerAttempt * 4) throw new Error("INPUT_BOUND_EXCEEDED");
  return Object.freeze({
    packet: Object.freeze(packet),
    serialized,
    sha256: createHash("sha256").update(serialized).digest("hex"),
  });
}
