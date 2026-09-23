// Pure response inspection. No credentials, I/O, provider strings in diagnostics.
import {
  hash, assertRequest, measureUsage, validateAnswer, MODELS,
} from "../model-comparison-execution/controls.mjs";
export { reserve, blindPacket, validateReview } from "../model-comparison-execution/controls.mjs";
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v, key) => object(v) && Object.hasOwn(v, key);
const digest = v => ({
  type: v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
  sha256: hash(JSON.stringify(v) ?? "undefined"),
});
const absent = Object.freeze({ presence: "omitted" });
const emptyArray = v => Array.isArray(v) && v.length === 0;
const positive = v => Number.isSafeInteger(v) && v >= 0;
// Structural comparison walks individual fields (including frozen JSON schema).
// Not string/object equality: field order is irrelevant, extra fields are not.
function equivalent(a, b) {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equivalent(a[k], b[k]));
}
export function inspectControls(body, request) {
  assertRequest(request);
  const fields = [], unknown = [], reasons = [];
  const problem = code => { if (!reasons.includes(code)) reasons.push(code); };
  const extras = (value, allowed, scope) => {
    if (!object(value)) { problem("invalid_control_object"); return; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) {
      // Arbitrary field names can themselves contain credentials or consultation.
      unknown.push({ scope, nameSha256: hash(key), ...digest(value[key]) });
      problem("undocumented_response_field");
    }
  };
  function field(parent, key, name, requested, expected, valid, evidence, omitted = false, encode = v => v, admitted = () => true) {
    const present = own(parent, key), value = present ? parent[key] : undefined;
    const known = present && valid(value);
    const matches = present ? known && equivalent(value, expected) && admitted(value) : omitted;
    fields.push({
      field: name, requested: requested === undefined ? absent : { presence: "present", value: requested },
      returned: !present ? absent : known ? { presence: "present", value: encode(value) } : { presence: "present", ...digest(value) },
      comparison: matches ? present && requested === undefined ? "documented-addition" : present ? "match" : "documented-omission" : "mismatch-or-unknown",
      reason: matches ? evidence : !present ? "required_echo_missing" : known ? "important_setting_mismatch" : "unknown_value_or_null",
      evidence,
    });
    if (!matches) problem(["temperature", "top_p"].includes(name) ? "unknown_native_sampling"
      : !present ? "required_control_missing" : known ? "important_control_mismatch" : "unknown_control_value");
  }
  const ancillary = (parent, key, name, admitted, evidence, recognized = admitted) =>
    field(parent, key, name, undefined, own(parent, key) ? parent[key] : undefined,
      recognized, evidence, true, v => v, admitted);
  const nullableAbsent = (parent, key, name, evidence) =>
    ancillary(parent, key, name, v => v === null, evidence);
  extras(body, [
    "id", "object", "created_at", "completed_at", "status", "error", "incomplete_details",
    "output", "usage", "metadata", "model", "service_tier", "store", "background", "tools",
    "truncation", "reasoning", "max_output_tokens", "prompt_cache_options",
    "prompt_cache_key", "prompt_cache_retention", "text", "instructions", "previous_response_id",
    "conversation", "prompt", "moderation", "prompt_cache_diagnostics", "safety_identifier", "user",
    "parallel_tool_calls", "tool_choice", "max_tool_calls", "temperature", "top_p", "top_logprobs",
  ], "response");
  field(body, "model", "model", request.model, request.model, v => MODELS.includes(v), "SDK129-135");
  field(body, "service_tier", "service_tier", request.service_tier, "default",
    v => ["default", "auto", "flex", "priority", "fast", "ultrafast"].includes(v), "SDK215-241:actual-tier-echo-required");
  field(body, "store", "store", request.store, false, v => typeof v === "boolean",
    "SDK244-250:explicit-store-false;response-schema0-Response-has-no-store-field:sent-request-contract-non-echo-fallback",
    true);
  if (!own(body, "store")) {
    const entry = fields.at(-1);
    entry.comparison = "request-contract-non-echo-fallback";
    entry.reason = "Response class has no store field; the byte-bound outgoing request explicitly disables storage. Not a claim of observed server storage.";
    entry.requestSha256 = hash(JSON.stringify(request));
  }
  field(body, "background", "background", request.background, false, v => typeof v === "boolean", "SDK45-49;schema0:364-368:explicit-false-echo");
  field(body, "truncation", "truncation", request.truncation, "disabled",
    v => ["auto", "disabled"].includes(v), "SDK319-327:explicit-disabled-echo");
  field(body, "max_output_tokens", "max_output_tokens", request.max_output_tokens, 1500, positive, "SDK104-109:includes-reasoning");
  field(body, "tools", "tools.count", 0, [], emptyArray, "SDK279-301:no-tools", false, v => v.length);
  extras(body?.reasoning, ["effort", "summary", "generate_summary", "context", "mode"], "reasoning");
  field(body?.reasoning, "effort", "reasoning.effort", "medium", "medium",
    v => ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(v), "frozen-request:medium;schema1:28-37");
  for (const key of ["summary", "generate_summary"])
    ancillary(body?.reasoning, key, `reasoning.${key}`, v => v === null,
      "schema1:39-61:nullable-unrequested-summary;non-null-would-add-content",
      v => v === null || ["auto", "concise", "detailed"].includes(v));
  ancillary(body?.reasoning, "context", "reasoning.context", v => v === null || v === "auto" || v === "all_turns",
    "schema1:18-25:GPT5.6-default-all_turns;nullable-unset-or-auto-resolves-default",
    v => v === null || ["auto", "current_turn", "all_turns"].includes(v));
  ancillary(body?.reasoning, "mode", "reasoning.mode", v => v === null || v === "standard",
    "schema1:47-51:nullable-unrequested-or-standard-only;pro/unknown-not-admitted",
    v => v === null || ["standard", "pro"].includes(v));
  const cache = body?.prompt_cache_options;
  extras(cache, ["mode", "ttl", "prewarm", "comparison_response_id"], "prompt_cache_options");
  field(cache, "mode", "prompt_cache_options.mode", "explicit", "explicit",
    v => ["implicit", "explicit"].includes(v), "SDK398-405:missing-mode-is-NOT-explicit");
  field(cache, "ttl", "prompt_cache_options.ttl", undefined, "30m",
    v => v === "30m", "guide465-470;SDK415-419:only-value-and-default-30m", true);
  field(cache, "prewarm", "prompt_cache_options.prewarm", undefined, false,
    v => typeof v === "boolean", "SDK408-412:default-false", true);
  for (const [parent, key, name] of [
    [cache, "comparison_response_id", "prompt_cache_options.comparison_response_id"],
    [body, "prompt_cache_key", "prompt_cache_key"], [body, "prompt_cache_retention", "prompt_cache_retention"],
  ]) {
    nullableAbsent(parent, key, name, "schema0:256,421-451:Optional-default-None;unrequested-null-is-unset-not-a-ttl");
  }
  for (const key of ["instructions", "previous_response_id", "conversation", "prompt", "moderation",
    "prompt_cache_diagnostics", "safety_identifier", "user"])
    nullableAbsent(body, key, key, "schema0:273,376,398-419,460,538:unrequested-Optional-default-None");
  // Tool-control defaults cannot invoke a tool when the separately verified
  // request AND response tools arrays are empty and every output type is checked.
  const noTools = emptyArray(request.tools) && emptyArray(body?.tools);
  ancillary(body, "parallel_tool_calls", "parallel_tool_calls", v => noTools && typeof v === "boolean",
    "schema0:313-314,331-352:no-available-tools-so-parallelism-has-no-effect");
  ancillary(body, "tool_choice", "tool_choice", v => noTools && ["auto", "none"].includes(v),
    "schema3:7;schema0:324-352:no-available-tools;required-or-object-choice-forbidden",
    v => ["auto", "none", "required"].includes(v));
  ancillary(body, "max_tool_calls", "max_tool_calls", v => noTools && (v === null || positive(v)),
    "schema0:390-395:Optional-call-limit;no-tools-no-calls");
  ancillary(body, "temperature", "temperature", v => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 2),
    "schema0:316-322:unrequested-sampling-control-in-documented-range;record-effective-value-not-an-asserted-default");
  ancillary(body, "top_p", "top_p", v => v === null || (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1),
    "schema0:355-362:unrequested-probability-mass;record-effective-value-not-an-asserted-default");
  for (const entry of fields.filter(f => ["temperature", "top_p"].includes(f.field))) {
    if (entry.comparison !== "mismatch-or-unknown") {
      entry.comparison = "observed-native-sampling";
      entry.reason = "Frozen request intentionally omits this sampling setting. Observed value is NOT proof of a shared default; pair equivalence must pass before companion grading.";
    }
  }
  ancillary(body, "top_logprobs", "top_logprobs", v => v === null || v === 0,
    "schema0:515-520:no-additional-logprob-output-requested",
    v => v === null || positive(v) && v <= 20);
  fields.push({
    field: "prompt_cache_breakpoints.count", requested: { presence: "present", value: 0 },
    returned: absent, comparison: "request-evidence",
    reason: "Breakpoints belong to input content, not response controls. Frozen serialized request has none; zero cache usage independently required.",
    evidence: "guide233-236;SDK398-405",
  });
  // Exact frozen output format, compared by member rather than object ordering.
  if (own(body, "text")) {
    extras(body.text, ["format", "verbosity"], "text");
    ancillary(body.text, "verbosity", "text.verbosity", v => v === null || v === "medium",
      "schema2:37-42:nullable-unset-or-documented-medium-default",
      v => v === null || ["low", "medium", "high"].includes(v));
    const format = body.text?.format, expected = request.text.format;
    extras(format, ["type", "name", "strict", "schema"], "text.format");
    for (const key of ["type", "name", "strict"])
      field(format, key, `text.format.${key}`, expected[key], expected[key],
        v => v === expected[key], "frozen-output-schema");
    const matches = equivalent(format?.schema, expected.schema);
    fields.push({ field: "text.format.schema", requested: digest(expected.schema),
      returned: digest(format?.schema), comparison: matches ? "match" : "mismatch-or-unknown",
      reason: "field-by-field-frozen-schema-comparison" });
    if (!matches) problem("important_control_mismatch");
  } else problem("required_control_missing");
  if (own(body, "metadata")) {
    const metadata = body.metadata;
    const harmless = metadata === null || object(metadata) && Object.keys(metadata).length <= 16
      && Object.entries(metadata).every(([k, v]) => k.length <= 64 && typeof v === "string" && v.length <= 512);
    fields.push({ field: "metadata", requested: absent, returned: digest(metadata),
      comparison: harmless ? "documented-inert-metadata" : "mismatch-or-unknown", reason: "SDK119-127;schema0:281-289:nullable-object-annotations-not-execution-controls" });
    if (!harmless) problem("unknown_control_value");
  }
  return { fields, unknown, stopReasons: reasons };
}

// Fairness is separate from priced usage. Identical frozen requests leave native
// sampling unspecified; only equivalent observed settings permit pair comparison.
export function compareNativeSampling(firstControls, secondControls) {
  const fields = ["temperature", "top_p"].map(name => {
    const observe = controls => {
      const entry = controls?.fields?.find(f => f.field === name);
      const r = entry?.returned;
      if (entry?.comparison !== "observed-native-sampling") return { state: "unknown" };
      if (r?.presence === "omitted") return { state: "unset", presence: "omitted" };
      if (r?.presence === "present" && Object.hasOwn(r, "value")) {
        if (r.value === null) return { state: "unset", presence: "present", value: null };
        const value = r.value;
        const valid = typeof value === "number" && Number.isFinite(value)
          && (name === "temperature" ? value >= 0 && value <= 2 : value > 0 && value <= 1);
        if (valid) return { state: "numeric", presence: "present", value };
      }
      return { state: "unknown" };
    };
    const first = observe(firstControls), second = observe(secondControls);
    const equivalent = first.state === "unset" && second.state === "unset"
      || first.state === "numeric" && second.state === "numeric" && first.value === second.value;
    return { field: name, first, second, equivalent,
      reason: equivalent ? first.state === "unset"
        ? "both-no-explicit-setting-schema-Optional-None;no-numeric-default-claim"
        : "identical-observed-native-sampling-values"
        : first.state === "unknown" || second.state === "unknown"
          ? "effective-native-sampling-unknown" : "effective-native-sampling-differs" };
  });
  return { eligible: fields.every(f => f.equivalent), fields,
    policy: "prospective-equal-native-sampling-or-both-unset;not-a-default-value-assertion" };
}

export function inspectResponse(body, request, projection, httpStatus) {
  const controls = inspectControls(body, request), stopReasons = [...controls.stopReasons];
  const problem = code => { if (!stopReasons.includes(code)) stopReasons.push(code); };
  // Never save raw envelopes or provider error messages; only enumerated fields.
  if (httpStatus < 200 || httpStatus >= 300 || body?.error != null) problem("http_or_provider_error");
  if (!["completed", "incomplete"].includes(body?.status)) problem("unknown_response_status");
  const output = Array.isArray(body?.output) ? body.output : [];
  if (!Array.isArray(body?.output)) problem("missing_output");
  const unknownOutput = [];
  const shape = (value, allowed, scope) => {
    if (!object(value)) { problem("invalid_output_shape"); return; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) {
      unknownOutput.push({ scope, nameSha256: hash(key), ...digest(value[key]) });
      problem("unknown_output_field");
    }
  };
  const texts = [], messages = [];
  for (const item of output) {
    if (item?.type === "reasoning") {
      shape(item, ["id", "type", "summary", "status"], "reasoning-item");
      if (!emptyArray(item.summary)) problem("unexpected_reasoning_content");
    } else if (item?.type === "message") {
      shape(item, ["id", "type", "role", "status", "content"], "message");
      messages.push(item);
      if (item.role !== "assistant" || !Array.isArray(item.content)) { problem("invalid_message"); continue; }
      for (const content of item.content) {
        shape(content, ["type", "text", "annotations", "logprobs"], "message-content");
        if (content.type !== "output_text" || typeof content.text !== "string"
          || !emptyArray(content.annotations)
          || (own(content, "logprobs") && !emptyArray(content.logprobs))) problem("unexpected_content");
        else texts.push(content.text);
      }
    } else problem("unexpected_tool_or_output_type");
  }
  let measured = null, validatedUsage = null;
  try {
    measured = measureUsage(body?.usage, request.model);
    // Copy only the validated closed numeric usage schema.
    validatedUsage = structuredClone(body.usage);
    if (measured.read || measured.write) problem("unexpected_cache_reads_or_writes");
    if (measured.input > projection.inputTokenBound || measured.output > projection.outputTokenBound
      || measured.centiMicroUSD > projection.centiMicroUSD) problem("reservation_bound_exceeded");
  } catch { problem("unknown_or_inconsistent_usage"); }
  const outputText = texts.join("\n");
  let answer = null;
  try {
    const sources = JSON.parse(request.input.find(i => i.role === "user").content).original_evidence;
    answer = validateAnswer(JSON.parse(outputText), sources.map(s => s.original_id));
  } catch { /* Deliberate private result retains content, not diagnostic messages. */ }
  const costUnknownReasons = stopReasons.filter(r =>
    !["unexpected_cache_reads_or_writes", "reservation_bound_exceeded", "unknown_native_sampling"].includes(r));
  if (costUnknownReasons.length) measured = null;
  const valid = !stopReasons.length && answer && body.status === "completed"
    && body.incomplete_details == null && messages.length === 1 && messages[0].status === "completed";
  return {
    controls, unknownOutput, usage: validatedUsage, usageDiagnostic: digest(body?.usage),
    measured, costAccounting: measured ? "known-total" : "unknown-retain-reservation", costUnknownReasons,
    outputText, answer: valid ? answer : null,
    technicalState: valid ? "completed-schema" : "technical-invalid", stopReasons,
  };
}