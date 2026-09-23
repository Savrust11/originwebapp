// Pure comparison controls. No network, credentials, filesystem or application imports.
import { createHash } from "node:crypto";

export const ID = "reading-comparison-01";
export const ENDPOINT = "https://api.openai.com/v1/responses";
export const MODELS = ["gpt-5.6-luna", "gpt-5.6-sol"];
export const RATES = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
};
export const LIMITS = {
  newTransmissions: 24, cumulativeTransmissions: 43, historicalTransmissions: 19,
  historicalCostCentiMicroUSD: 2587900, budgetCentiMicroUSD: 100000000,
  concurrency: 1, retries: 0, timeoutMs: 120000, inputOverheadTokens: 2048,
};
export const hash = value => createHash("sha256").update(value).digest("hex");
export const encode = value => `${JSON.stringify(value, null, 2)}\n`;
export const assert = (condition, code) => { if (!condition) throw new Error(code); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, allowed, required = allowed) => object(v)
  && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k));
const text = v => typeof v === "string" && v.trim().length > 0 && v.length <= 20000;
const identity = /gpt[-\s]?5|openai|\bluna\b|\bsol\b|ルナ|ソル|api[_ -]?key|bearer\s|sk-[a-z0-9]/i;

export function validatePricing(pricing) {
  assert(pricing?.endpoint === ENDPOINT && !Number.isNaN(Date.parse(pricing.verifiedAt)), "pricing_unverified");
  assert(JSON.stringify(pricing.models) === JSON.stringify(RATES), "pricing_rates_changed");
  assert(pricing.cachedWriteMultiplier === 1.25
    && pricing.cacheControl?.mode === "explicit" && pricing.cacheControl.explicitBreakpoints === 0
    && pricing.cacheControl.expectedReadsAndWrites === 0, "pricing_cache_policy_changed");
}

export function assertRequest(request) {
  assert(MODELS.includes(request.model) && request.service_tier === "default"
    && request.reasoning?.effort === "medium" && request.max_output_tokens === 1500
    && Array.isArray(request.tools) && request.tools.length === 0 && request.store === false
    && request.background === false && request.truncation === "disabled"
    && JSON.stringify(request.prompt_cache_options) === '{"mode":"explicit"}'
    && !JSON.stringify(request).includes('"cache_control"'), "request_controls_changed");
}

export function reserve(request) {
  assertRequest(request);
  const payloadBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  const inputTokenBound = payloadBytes + LIMITS.inputOverheadTokens;
  assert(inputTokenBound < 272000, "long_context_reservation_forbidden");
  return {
    payloadBytes, inputOverheadTokens: LIMITS.inputOverheadTokens, inputTokenBound,
    outputTokenBound: request.max_output_tokens,
    centiMicroUSD: inputTokenBound * Math.round(RATES[request.model].cacheWrite * 100)
      + request.max_output_tokens * Math.round(RATES[request.model].output * 100),
    basis: "full-UTF8-payload-byte-token-bound-plus-overhead; operational-not-invoice-guarantee",
  };
}

export function measureUsage(usage, model) {
  assert(MODELS.includes(model), "unknown_priced_model");
  assert(keys(usage, ["input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details"]),
    "unknown_usage_fields");
  assert(keys(usage.input_tokens_details, ["cached_tokens", "cache_write_tokens"])
    && keys(usage.output_tokens_details, ["reasoning_tokens"]), "unknown_cache_or_output_accounting");
  const input = usage.input_tokens, output = usage.output_tokens;
  const read = usage.input_tokens_details.cached_tokens, write = usage.input_tokens_details.cache_write_tokens;
  const reasoning = usage.output_tokens_details.reasoning_tokens;
  assert([input, output, read, write, reasoning, usage.total_tokens].every(integer)
    && read + write <= input && reasoning <= output && usage.total_tokens === input + output,
  "inconsistent_usage");
  assert(input < 272000, "long_context_usage");
  const uncached = input - read - write, rates = RATES[model];
  const centiMicroUSD = uncached * Math.round(rates.input * 100)
    + read * Math.round(rates.cachedInput * 100) + write * Math.round(rates.cacheWrite * 100)
    + output * Math.round(rates.output * 100);
  assert(integer(centiMicroUSD), "cost_overflow");
  return { input, output, uncached, read, write, reasoning, centiMicroUSD, microUSD: centiMicroUSD / 100 };
}

export function validateAnswer(answer, sourceIds) {
  assert(keys(answer, ["explanations", "limitations", "abstention"]), "answer_schema_invalid");
  const clause = (v, explanation = false, abstention = false) => {
    assert(keys(v, abstention ? ["text", "original_ids", "applies"] : ["text", "original_ids"])
      && typeof v.text === "string" && Array.isArray(v.original_ids)
      && (!explanation || v.original_ids.length > 0)
      && v.original_ids.every(id => typeof id === "string" && sourceIds.includes(id))
      && (!abstention || typeof v.applies === "boolean"), "answer_schema_or_citation_invalid");
  };
  assert(Array.isArray(answer.explanations) && Array.isArray(answer.limitations), "answer_schema_invalid");
  answer.explanations.forEach(v => clause(v, true));
  answer.limitations.forEach(v => clause(v));
  clause(answer.abstention, false, true);
  assert(!identity.test(JSON.stringify(answer)), "answer_identity_leak");
  return answer;
}

// Whitelisted response projection; never preserves request headers, credentials,
// arbitrary server error messages or echoed prompts. The raw body has a hash only.
export function inspectResponse(body, request, projection, httpStatus) {
  const stopReasons = [];
  let measured = null, answer = null;
  try { measured = measureUsage(body?.usage, body?.model); }
  catch (error) { stopReasons.push(error.message); }
  if (body?.model !== request.model) stopReasons.push("unexpected_model");
  if (body?.service_tier !== "default") stopReasons.push("unexpected_service_tier");
  if (httpStatus < 200 || httpStatus >= 300 || body?.error) stopReasons.push("http_or_provider_error_no_fallback");
  if (!["completed", "incomplete"].includes(body?.status)) stopReasons.push("unexpected_response_status");
  if (body?.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length))
    stopReasons.push("unexpected_tools");
  if (body?.prompt_cache_options !== undefined
    && JSON.stringify(body.prompt_cache_options) !== '{"mode":"explicit"}')
    stopReasons.push("unexpected_cache_configuration");
  const output = Array.isArray(body?.output) ? body.output : [];
  if (!Array.isArray(body?.output) || output.some(item => !["message", "reasoning"].includes(item?.type)))
    stopReasons.push("unexpected_tool_or_output_type");
  const messages = output.filter(item => item.type === "message");
  const content = messages.flatMap(item => Array.isArray(item.content) ? item.content : []);
  if (content.some(item => !["output_text", "refusal"].includes(item?.type)
    || (item.annotations !== undefined && (!Array.isArray(item.annotations) || item.annotations.length))))
    stopReasons.push("unexpected_content_or_tool_annotation");
  if (messages.some(item => item.role !== "assistant")) stopReasons.push("unexpected_message_role");
  const outputText = content.filter(item => item.type === "output_text" && typeof item.text === "string")
    .map(item => item.text).join("\n");
  let technical = body?.status !== "completed" || body?.incomplete_details != null
    || messages.length !== 1 || messages.some(item => item.status !== "completed")
    || content.some(item => item.type !== "output_text");
  try {
    const sources = JSON.parse(request.input.find(item => item.role === "user").content).original_evidence;
    answer = validateAnswer(JSON.parse(outputText), sources.map(source => source.original_id));
  } catch { technical = true; }
  if (measured) {
    if (measured.read || measured.write) stopReasons.push("unexpected_cache_reads_or_writes");
    if (measured.input > projection.inputTokenBound || measured.output > projection.outputTokenBound
      || measured.centiMicroUSD > projection.centiMicroUSD) stopReasons.push("reservation_bound_exceeded");
  }
  // A valid token count alone does NOT establish the total price when model,
  // tier, tool billing or another unpriced control changed. Keep the original
  // conservative reservation instead of releasing it for a default-rate subtotal.
  // Known cache usage and bound violations have explicit rates and remain charged
  // in full, but still invalidate the answer as a comparator.
  const validatedUsage = measured ? body.usage : null;
  const costUnknownReasons = stopReasons.filter(reason =>
    !["unexpected_cache_reads_or_writes", "reservation_bound_exceeded"].includes(reason));
  if (costUnknownReasons.length) measured = null;
  if (stopReasons.length) technical = true;
  // Only inert scalar metadata is retained, not arbitrary nested provider strings.
  const scalar = v => typeof v === "string" ? v.slice(0, 200) : null;
  const numericFields = v => object(v) ? Object.fromEntries(Object.entries(v)
    .filter(([key, value]) => /^[a-z_]+$/.test(key) && typeof value === "number")) : null;
  return {
    model: scalar(body?.model), status: scalar(body?.status), serviceTier: scalar(body?.service_tier),
    incompleteReason: scalar(body?.incomplete_details?.reason),
    errorType: scalar(body?.error?.type), errorCode: scalar(body?.error?.code),
    usage: validatedUsage,
    costAccounting: measured ? "known-total" : "unknown-retain-reservation",
    costUnknownReasons,
    observedUsage: {
      totals: numericFields(body?.usage), inputDetails: numericFields(body?.usage?.input_tokens_details),
      outputDetails: numericFields(body?.usage?.output_tokens_details),
    },
    observedUsageFieldNames: object(body?.usage) ? Object.keys(body.usage).filter(k => /^[a-z_]+$/.test(k)) : [],
    observedInputDetailFieldNames: object(body?.usage?.input_tokens_details)
      ? Object.keys(body.usage.input_tokens_details).filter(k => /^[a-z_]+$/.test(k)) : [],
    observedOutputDetailFieldNames: object(body?.usage?.output_tokens_details)
      ? Object.keys(body.usage.output_tokens_details).filter(k => /^[a-z_]+$/.test(k)) : [],
    measured, outputText,
    outputTypes: output.map(item => scalar(item?.type)),
    reasoningItems: output.filter(item => item.type === "reasoning").length,
    answer: technical ? null : answer,
    technicalState: technical ? "technical-invalid" : "completed-schema",
    stopReasons,
  };
}

export function blindPacket(prepared, attempt, label, result) {
  const request = prepared.requests.requests.find(item => item.caseId === attempt.caseId)
    .requests.find(item => item.model === attempt.model);
  const user = JSON.parse(request.input.find(item => item.role === "user").content);
  return {
    schemaVersion: 1, caseId: attempt.caseId, label, reviewerType: "AI",
    instructions: "新しい文脈で、この匿名回答一件を完全原文と凍結基準で評価。外部APIは使用しない。対応鍵・生成順・運用記録・過去回答は閲覧しない。forbiddenのpassは禁則違反なしを意味する。",
    question: user.question, originalEvidence: user.original_evidence,
    applicationTemplate: prepared.displays.appDisplays.find(item => item.caseId === attempt.caseId),
    rubric: { global: prepared.rubric.global, case: prepared.rubric.cases[attempt.caseId] },
    answer: result.technicalState === "completed-schema"
      ? { kind: "completed-schema", content: result.answer }
      : { kind: "technical-invalid", marker: "技術的に有効な完了回答なし。本文の意味・日本語品質は評価不能。技術的無効を確認し、共通アプリ表示は別に評価する。" },
  };
}

const layerGrades = {
  bodyMeaning: ["pass", "fail", "not-assessable"],
  bodyQuestionCoverage: ["pass", "fail", "not-assessable"],
  bodyAttributionPresence: ["correct", "absent", "false-or-unsupported", "not-applicable", "not-assessable"],
  bodyCompleteness: ["complete", "partial", "missing", "not-assessable"],
  appDisplay: ["pass", "fail", "not-assessable"],
  wholeScreenMeaning: ["pass", "fail", "not-assessable"],
  surfaceQuality: ["pass", "fail", "not-assessable"],
};
export function validateReview(review, packet, packetSha256) {
  assert(keys(review, ["schemaVersion", "caseId", "label", "blindPacketSha256", "reviewerType",
    "contextIsolation", "technicalAcknowledged", "decision", "criteria", "layers", "questionCoverage",
    "readability", "limitations"]), "review_fields_invalid");
  assert(review.schemaVersion === 1 && review.caseId === packet.caseId && review.label === packet.label
    && review.blindPacketSha256 === packetSha256 && review.reviewerType === "AI"
    && review.technicalAcknowledged === true && ["continue", "stop"].includes(review.decision)
    && text(review.limitations), "review_binding_invalid");
  assert(keys(review.contextIsolation, ["freshContext", "modelIdentityKnown", "priorAnswersSeen"])
    && review.contextIsolation.freshContext === true && review.contextIsolation.modelIdentityKnown === false
    && review.contextIsolation.priorAnswersSeen === false, "review_not_blind");
  assert(!identity.test(JSON.stringify(review)), "review_contains_identity_or_secret");
  const criteria = Object.entries(packet.rubric.case)
    .flatMap(([group, items]) => items.map((_, index) => `${group}:${index}`));
  assert(Array.isArray(review.criteria) && review.criteria.length === criteria.length, "review_missing_criteria");
  const seen = new Set();
  for (const criterion of review.criteria) {
    const id = `${criterion.group}:${criterion.index}`;
    assert(keys(criterion, ["group", "index", "verdict", "reason"]) && integer(criterion.index)
      && criteria.includes(id) && !seen.has(id)
      && ["pass", "fail", "not-applicable", "not-assessable"].includes(criterion.verdict)
      && text(criterion.reason), "review_criterion_invalid");
    seen.add(id);
  }
  assert(keys(review.layers, Object.keys(layerGrades)), "review_layers_missing");
  for (const [name, grades] of Object.entries(layerGrades))
    assert(keys(review.layers[name], ["verdict", "reason"])
      && grades.includes(review.layers[name].verdict) && text(review.layers[name].reason), "review_layer_invalid");
  assert(Array.isArray(review.questionCoverage) && review.questionCoverage.length > 0
    && review.questionCoverage.every(item => keys(item, ["element", "verdict", "reason"])
      && text(item.element) && text(item.reason)
      && ["answered", "missing", "not-applicable", "not-assessable"].includes(item.verdict)), "review_question_coverage_missing");
  const dimensions = packet.rubric.global.japaneseReadability.dimensions;
  assert(Array.isArray(review.readability) && review.readability.length === dimensions.length
    && new Set(review.readability.map(item => item.dimension)).size === dimensions.length
    && review.readability.every(item => keys(item, ["dimension", "verdict", "reason"])
      && dimensions.includes(item.dimension) && ["pass", "minor", "major", "not-assessable"].includes(item.verdict)
      && text(item.reason)), "review_readability_missing");
  const verdict = name => review.layers[name].verdict;
  if (packet.answer.kind === "technical-invalid")
    assert(["bodyMeaning", "bodyQuestionCoverage", "bodyAttributionPresence", "bodyCompleteness",
      "wholeScreenMeaning", "surfaceQuality"].every(name => verdict(name) === "not-assessable")
      && review.readability.every(item => item.verdict === "not-assessable")
      && review.criteria.every(item => item.verdict === "not-assessable")
      && review.questionCoverage.every(item => item.verdict === "not-assessable"), "invalid_answer_cannot_pass");
  if (verdict("wholeScreenMeaning") === "pass")
    assert(verdict("bodyMeaning") === "pass" && verdict("appDisplay") === "pass", "review_layers_inconsistent");
  if (verdict("surfaceQuality") === "pass")
    assert(verdict("wholeScreenMeaning") === "pass"
      && review.readability.every(item => ["pass", "minor"].includes(item.verdict)), "review_surface_inconsistent");
  return review;
}