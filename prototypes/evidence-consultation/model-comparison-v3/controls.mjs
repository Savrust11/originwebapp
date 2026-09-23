// Prospective inspection only. No runner, authorization, filesystem or transport.
// Transport/accounting behavior is retained from v2; answer checks are versioned.
import { measureUsage } from "../model-comparison-execution/controls.mjs";
import { inspectControls, digest, containsCredential } from "../model-comparison-v2/controls.mjs";
import { inspectAnswerText, VALIDATOR_VERSION } from "./answer-validation.mjs";
export { reserve } from "../model-comparison-execution/controls.mjs";
export { inspectControls };
export { validateAnswer, validateAnswerStructure, validateAnswerCitations,
  validateAnswerIdentity, inspectAnswerText, VALIDATOR_VERSION } from "./answer-validation.mjs";

const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v, k) => object(v) && Object.hasOwn(v, k);
const empty = v => Array.isArray(v) && v.length === 0;
const enums = (v, values) => values.includes(v) ? { value: v } : digest(v);
const usageProjection = u => ({
  input_tokens: u?.input_tokens, output_tokens: u?.output_tokens, total_tokens: u?.total_tokens,
  input_tokens_details: { cached_tokens: u?.input_tokens_details?.cached_tokens, cache_write_tokens: u?.input_tokens_details?.cache_write_tokens },
  output_tokens_details: { reasoning_tokens: u?.output_tokens_details?.reasoning_tokens },
});
const toolTypes = new Set(["function_call", "web_search_call", "file_search_call", "computer_call", "code_interpreter_call",
  "image_generation_call", "local_shell_call", "shell_call", "apply_patch_call", "mcp_call", "mcp_list_tools",
  "mcp_approval_request", "custom_tool_call", "function_call_output", "tool_call"]);

export function inspectResponse(body, request, projection, httpStatus, context = {}) {
  // A known credential echo must never reach projections (even a public ID
  // exemption), and must keep its safe cause rather than a generic catch message.
  if (containsCredential(body, context.credential)) return {
    measured: null, computedTokenCost: null, usage: null, costAccounting: "unknown-retain-reservation",
    retainReservation: true, outputText: "", answer: null, technicalState: "technical-invalid",
    caseReasons: ["answer_secret_leak"], stopReasons: ["B:credential_echo"],
    answerValidation: { validatorVersion: VALIDATOR_VERSION, valid: false, reasons: ["answer_secret_leak"],
      checks: { json: "not-run", structure: "not-run", citations: "not-run", secrets: "fail", modelIdentity: "not-run" } },
  };
  const controls = inspectControls(body, request, context);
  const A = [...controls.violations], B = [...controls.evidenceFailures], caseReasons = [];
  if (typeof body?.model === "string" && body.model !== request.model) A.push("actual_model_differs");
  const texts = [], messages = [], outputStructure = [];
  const output = Array.isArray(body?.output) ? body.output : [];
  if (!Array.isArray(body?.output)) caseReasons.push("missing_output");
  for (const [index, item] of output.entries()) {
    outputStructure.push({ index, type: enums(item?.type, ["reasoning", "message", ...toolTypes]),
      status: own(item, "status") ? enums(item.status, ["in_progress", "completed", "incomplete"]) : { presence: "omitted" },
      contentCount: Array.isArray(item?.content) ? item.content.length : null,
      phase: own(item, "phase") ? enums(item.phase, [null, "commentary", "final_answer"]) : { presence: "omitted" },
      encryptedContent: own(item, "encrypted_content") ? { presence: "present", ...digest(item.encrypted_content) } : { presence: "omitted" } });
    if (toolTypes.has(item?.type)) { A.push("unexpected_tool_output"); B.push("unpriced_tool_output"); continue; }
    if (item?.type === "reasoning") {
      if (!empty(item.summary) || (own(item, "content") && item.content !== null && !empty(item.content)))
        caseReasons.push("unexpected_reasoning_content");
      if (own(item, "encrypted_content") && item.encrypted_content !== null && typeof item.encrypted_content !== "string")
        caseReasons.push("invalid_encrypted_content_type");
    } else if (item?.type === "message") {
      messages.push(item);
      if (item.role !== "assistant" || !Array.isArray(item.content)) { caseReasons.push("invalid_message"); continue; }
      if (item.phase != null && item.phase !== "final_answer") caseReasons.push("nonfinal_message_phase");
      for (const c of item.content) {
        if (c?.type !== "output_text" || typeof c.text !== "string" || !empty(c.annotations)
          || (own(c, "logprobs") && !empty(c.logprobs))) caseReasons.push("invalid_or_refusal_content");
        else texts.push(c.text);
      }
    } else caseReasons.push("unresolved_output_type");
  }
  let measured = null, usage = null;
  try {
    usage = usageProjection(body?.usage);
    measured = measureUsage(usage, body?.model);
  } catch { usage = null; B.push("unusable_usage_or_unknown_model_price"); }
  if (body?.service_tier !== "default") B.push("unknown_tier_price");
  if (measured) {
    if (measured.read || measured.write) A.push("unexpected_cache_reads_or_writes");
    if (measured.input > projection.inputTokenBound || measured.output > projection.outputTokenBound
      || measured.centiMicroUSD > projection.centiMicroUSD) B.push("reservation_bound_exceeded");
  }
  const priceUnknown = B.some(r => ["unknown_tier_price", "unpriced_tool_output", "unusable_usage_or_unknown_model_price"].includes(r));
  const computedTokenCost = measured ? { ...measured,
    basis: body?.service_tier === "default" ? "actual-model-default-tier-archived-price" : "actual-model-default-rate-subtotal-only-actual-tier-unpriced" } : null;
  if (priceUnknown) measured = null;
  if (!(httpStatus >= 200 && httpStatus < 300)) B.push("http_transport_outcome_unusable");
  if (body?.error != null) caseReasons.push("provider_error");
  if (body?.status !== "completed" || body?.incomplete_details != null
    || messages.length !== 1 || messages.some(m => m.status !== "completed")) caseReasons.push("not_completed");
  const outputText = texts.join("\n");
  let sourceIds;
  try {
    const sources = JSON.parse(request.input.find(i => i.role === "user").content).original_evidence;
    sourceIds = sources.map(s => s.original_id);
  } catch { /* inspectAnswerText records a fixed source-context failure, never parser text. */ }
  const { answer, ...answerValidation } = inspectAnswerText(outputText, sourceIds, context);
  caseReasons.push(...answerValidation.reasons);
  const stopReasons = [...new Set([...A.map(r => `A:${r}`), ...B.map(r => `B:${r}`)])];
  const technicalState = !caseReasons.length && !stopReasons.length && answer ? "completed-schema" : "technical-invalid";
  return { controls, outputStructure, providerStatus: enums(body?.status, ["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"]),
    incompleteReason: body?.incomplete_details == null ? { presence: "absent-or-null" }
      : enums(body.incomplete_details.reason, ["max_output_tokens", "content_filter"]),
    usage, usageDiagnostic: digest(body?.usage), measured, computedTokenCost,
    costAccounting: measured ? "known-total" : "unknown-retain-reservation",
    retainReservation: B.length > 0,
    // Rejecting a secret but returning it in outputText would defeat safe storage.
    outputText: technicalState === "completed-schema" ? outputText : "",
    answer: technicalState === "completed-schema" ? answer : null, answerValidation,
    technicalState, caseReasons: [...new Set(caseReasons)], stopReasons,
    metadataState: controls.unknown.length || controls.unresolved.length ? "metadata-unresolved" : "no-unresolved-additions-observed" };
}