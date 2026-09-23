// Impact-based inspection. Unknown metadata is evidence, not a pricing override.
import { hash, assertRequest, measureUsage, validateAnswer, MODELS } from "../model-comparison-execution/controls.mjs";
import { inspectControls as legacyControls, compareNativeSampling } from "../model-comparison-resume/controls.mjs";
export { reserve, blindPacket, validateReview } from "../model-comparison-execution/controls.mjs";
export { compareNativeSampling };
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v, k) => object(v) && Object.hasOwn(v, k);
const empty = v => Array.isArray(v) && v.length === 0;
export const digest = v => ({
  type: v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
  length: typeof v === "string" || Array.isArray(v) ? v.length : object(v) ? Object.keys(v).length : null,
  sha256: hash(JSON.stringify(v) ?? "undefined"),
});
const enums = (v, values) => values.includes(v) ? { value: v } : digest(v);
const publicNames = new Set(("id object created_at completed_at status error incomplete_details reason output usage metadata model service_tier store background tools truncation reasoning effort summary generate_summary context mode max_output_tokens prompt_cache_options ttl prewarm comparison_response_id prompt_cache_key prompt_cache_retention text format type name strict schema description verbosity instructions previous_response_id conversation prompt moderation prompt_cache_diagnostics safety_identifier user parallel_tool_calls tool_choice max_tool_calls temperature top_p top_logprobs billing frequency_penalty presence_penalty content encrypted_content phase role annotations logprobs input_tokens output_tokens total_tokens input_tokens_details output_tokens_details cached_tokens cache_write_tokens reasoning_tokens").split(" "));
// An intentionally small semantic vocabulary supplements (does not replace)
// credential/source screening. A name merely matching identifier regex is NOT safe.
const machineWords = new Set(("response request routing route metadata diagnostic diagnostics billing pricing cache provider server transport protocol version feature flags flag enabled disabled processing execution generation output input token tokens control controls details info options policy state statistics stats count total rate amount unit units default native sampling frequency presence penalty latency timing duration milliseconds seconds extra additional unknown extension extensions opaque audit trace inference budget usage tier region type mode status value values hint hints service configuration revision internal public schema field fields safety format capabilities capability runtime data engine").split(" "));
const knownAt = (path, name) => {
  const scope = path.replace(/\[\d+\]/g, "[]");
  const names = {
    "$": "id object created_at completed_at status error incomplete_details output usage metadata model service_tier store background tools truncation reasoning max_output_tokens prompt_cache_options prompt_cache_key prompt_cache_retention text instructions previous_response_id conversation prompt moderation prompt_cache_diagnostics safety_identifier user parallel_tool_calls tool_choice max_tool_calls temperature top_p top_logprobs",
    "$.reasoning": "effort summary generate_summary context mode",
    "$.prompt_cache_options": "mode ttl prewarm comparison_response_id",
    "$.text": "format verbosity",
    "$.text.format": "type name strict schema description",
    "$.usage": "input_tokens output_tokens total_tokens input_tokens_details output_tokens_details",
    "$.usage.input_tokens_details": "cached_tokens cache_write_tokens",
    "$.usage.output_tokens_details": "reasoning_tokens",
    "$.incomplete_details": "reason",
    "$.output[]": "id type role status content summary encrypted_content phase",
    "$.output[].content[]": "type text annotations logprobs refusal",
  };
  return names[scope]?.split(" ").includes(name) ?? false;
};
const normalized = v => v.toLowerCase().replace(/[^a-z0-9]/g, "");
export function containsCredential(value, credential) {
  if (typeof credential !== "string" || !credential.length) return false;
  if (typeof value === "string") return value.includes(credential);
  if (Array.isArray(value)) return value.some(v => containsCredential(v, credential));
  return object(value) && Object.entries(value).some(([k, v]) => k.includes(credential) || containsCredential(v, credential));
}
export function screenName(name, { credential = "", sensitiveText = "" } = {}) {
  if (credential && (name.includes(credential) || normalized(name).includes(normalized(credential))))
    return "redacted-credential";
  if (name.length > 64 || !/^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*$/.test(name)
    || /(?:secret|password|credential|authorization|bearer|cookie|email|phone|address|patient|child|family|person|session|apikey|api_key|(?:^|_)token(?:_|$)|sk_)/i.test(name)
    || /[0-9]{4,}/.test(name)) return "redacted-sensitive-or-nonidentifier";
  if (publicNames.has(name)) return "public-schema-name";
  const n = normalized(name), source = normalized(sensitiveText);
  if (n.length >= 6 && source.includes(n)) return "redacted-source-fragment";
  const parts = name.split("_");
  if (parts.some(p => p.length >= 8 && source.includes(p))) return "redacted-source-fragment";
  return parts.length >= 2 && parts.every(p => machineWords.has(p))
    ? "screened-machine-identifier" : "redacted-unverified-name";
}
function unknownFields(body, context) {
  const rows = [];
  const walk = (value, path, depth, forceUnknown = false) => {
    if (depth > 20 || rows.length >= 2048) return;
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1, forceUnknown));
    if (!object(value)) return;
    for (const [name, v] of Object.entries(value)) {
      const safetyClassification = screenName(name, context);
      const safe = ["public-schema-name", "screened-machine-identifier"].includes(safetyClassification);
      const child = `${path}.${safe ? name : `<redacted:${hash(name)}>`}`;
      // Metadata and unknown objects are always value-redacted, including nested
      // public-looking leaves. No arbitrary numeric billing values are trusted.
      const unknown = forceUnknown || !knownAt(path, name) || name === "metadata";
      if (unknown) rows.push({ path: child, ...(safe ? { name } : {}), nameSha256: hash(name),
        safetyClassification, classification: "C-metadata-unresolved", ...digest(v) });
      // Never traverse schema, generated text, prompt, ciphertext or arbitrary strings.
      if (!["schema", "text", "instructions", "encrypted_content"].includes(name) || object(v))
        if (name !== "schema") walk(v, child, depth + 1, unknown);
    }
  };
  walk(body, "$", 0);
  return rows;
}
const required = new Set(["model", "service_tier", "store", "background", "truncation", "max_output_tokens",
  "tools.count", "reasoning.effort", "prompt_cache_options.mode", "prompt_cache_options.ttl",
  "prompt_cache_options.prewarm", "text.format.type", "text.format.name", "text.format.strict", "text.format.schema"]);
export function inspectControls(body, request, context = {}) {
  assertRequest(request);
  const copy = structuredClone(body);
  // Normalize only the legacy check's obsolete nullable-only retention rule.
  if (object(copy) && [null, "in_memory", "24h"].includes(copy.prompt_cache_retention)) copy.prompt_cache_retention = null;
  const old = legacyControls(copy, request);
  const violations = [], evidenceFailures = [], unresolved = [];
  for (const f of old.fields) {
    if (f.field === "prompt_cache_retention" && own(body, "prompt_cache_retention")) {
      f.returned = { presence: "present", ...enums(body.prompt_cache_retention, [null, "in_memory", "24h"]) };
      f.comparison = [null, "in_memory", "24h"].includes(body.prompt_cache_retention) ? "documented-addition" : "metadata-unresolved";
      f.reason = "schema0:434-451:legacy-retention-independent-of-explicit-cache-ttl";
    }
    if (f.comparison !== "mismatch-or-unknown") continue;
    if (required.has(f.field)) {
      // Missing/ill-typed required evidence is not a demonstrated violation.
      (f.reason === "important_setting_mismatch" || f.field === "text.format.schema"
        ? violations : evidenceFailures).push(`required_setting:${f.field}`);
    } else if (["reasoning.mode", "reasoning.context", "reasoning.summary", "reasoning.generate_summary",
      "tool_choice", "text.verbosity", "top_logprobs"].includes(f.field)
      && f.reason === "important_setting_mismatch") violations.push(`required_setting:${f.field}`);
    else unresolved.push(`unresolved_setting:${f.field}`);
  }
  // Legacy tools validator only recognizes an empty list, so handle actual
  // nonempty arrays explicitly as a demonstrated contradiction.
  if (Array.isArray(body?.tools) && body.tools.length) violations.push("tools_not_empty");
  if (!own(body, "text")) evidenceFailures.push("required_setting:text");
  if (own(body?.text?.format, "description")) {
    const description = body.text.format.description;
    old.fields.push({ field: "text.format.description", requested: { presence: "omitted" },
      returned: { presence: "present", ...digest(description) },
      comparison: description === null ? "documented-addition" : "metadata-unresolved",
      reason: "SDK3-format:36-40:nullable-description;non-null-not-asserted-inert" });
    if (description !== null) unresolved.push("unresolved_format_description");
  }
  return { fields: old.fields, violations: [...new Set(violations)], evidenceFailures: [...new Set(evidenceFailures)],
    unresolved, unknown: unknownFields(body, { ...context, sensitiveText: JSON.stringify(request.input) }) };
}
const usageProjection = u => ({
  input_tokens: u?.input_tokens, output_tokens: u?.output_tokens, total_tokens: u?.total_tokens,
  input_tokens_details: { cached_tokens: u?.input_tokens_details?.cached_tokens, cache_write_tokens: u?.input_tokens_details?.cache_write_tokens },
  output_tokens_details: { reasoning_tokens: u?.output_tokens_details?.reasoning_tokens },
});
const toolTypes = new Set(["function_call", "web_search_call", "file_search_call", "computer_call", "code_interpreter_call",
  "image_generation_call", "local_shell_call", "shell_call", "apply_patch_call", "mcp_call", "mcp_list_tools",
  "mcp_approval_request", "custom_tool_call", "function_call_output", "tool_call"]);
export function inspectResponse(body, request, projection, httpStatus, context = {}) {
  if (containsCredential(body, context.credential)) throw new Error("credential_echo");
  const controls = inspectControls(body, request, context);
  const A = [...controls.violations], B = [...controls.evidenceFailures], caseReasons = [];
  if (typeof body?.model === "string" && body.model !== request.model) A.push("actual_model_differs");
  const texts = [], messages = [], outputStructure = [];
  const output = Array.isArray(body?.output) ? body.output : [];
  if (!Array.isArray(body?.output)) caseReasons.push("missing_output");
  for (const [index, item] of output.entries()) {
    const row = { index, type: enums(item?.type, ["reasoning", "message", ...toolTypes]),
      status: own(item, "status") ? enums(item.status, ["in_progress", "completed", "incomplete"]) : { presence: "omitted" },
      contentCount: Array.isArray(item?.content) ? item.content.length : null,
      phase: own(item, "phase") ? enums(item.phase, [null, "commentary", "final_answer"]) : { presence: "omitted" },
      encryptedContent: own(item, "encrypted_content") ? { presence: "present", ...digest(item.encrypted_content) } : { presence: "omitted" } };
    outputStructure.push(row);
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
    // Measure with the actual echoed model, never silently with a requested model.
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
  // Keep known token arithmetic even if total price is unusable; never erase it
  // solely for unknown metadata, output metadata or answer-quality failure.
  const computedTokenCost = measured ? { ...measured,
    basis: body?.service_tier === "default" ? "actual-model-default-tier-archived-price" : "actual-model-default-rate-subtotal-only-actual-tier-unpriced" } : null;
  if (priceUnknown) measured = null;
  if (!(httpStatus >= 200 && httpStatus < 300)) B.push("http_transport_outcome_unusable");
  if (body?.error != null) caseReasons.push("provider_error");
  if (body?.status !== "completed" || body?.incomplete_details != null
    || messages.length !== 1 || messages.some(m => m.status !== "completed")) caseReasons.push("not_completed");
  const outputText = texts.join("\n");
  let answer = null;
  try {
    const sources = JSON.parse(request.input.find(i => i.role === "user").content).original_evidence;
    answer = validateAnswer(JSON.parse(outputText), sources.map(s => s.original_id));
  } catch { caseReasons.push("answer_schema_invalid"); }
  const stopReasons = [...new Set([...A.map(r => `A:${r}`), ...B.map(r => `B:${r}`)])];
  const technicalState = !caseReasons.length && !stopReasons.length && answer ? "completed-schema" : "technical-invalid";
  return { controls, outputStructure, providerStatus: enums(body?.status, ["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"]),
    incompleteReason: body?.incomplete_details == null ? { presence: "absent-or-null" }
      : enums(body.incomplete_details.reason, ["max_output_tokens", "content_filter"]),
    usage, usageDiagnostic: digest(body?.usage), measured, computedTokenCost,
    costAccounting: measured ? "known-total" : "unknown-retain-reservation",
    retainReservation: B.length > 0, outputText, answer: technicalState === "completed-schema" ? answer : null,
    technicalState, caseReasons: [...new Set(caseReasons)], stopReasons,
    metadataState: controls.unknown.length || controls.unresolved.length ? "metadata-unresolved" : "no-unresolved-additions-observed" };
}