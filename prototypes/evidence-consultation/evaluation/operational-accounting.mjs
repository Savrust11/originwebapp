// Operational estimates, not an absolute invoice cap. No I/O or transport.
export const MODEL = "gpt-5.6-luna";
export function integer(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid_usage_integer");
  return n;
}
export function measureUsage(usage) {
  if (!usage || !usage.input_tokens_details || !usage.output_tokens_details) throw new Error("usage_missing");
  const input = integer(usage.input_tokens);
  const output = integer(usage.output_tokens);
  const read = integer(usage.input_tokens_details.cached_tokens);
  const write = integer(usage.input_tokens_details.cache_write_tokens);
  const reasoning = integer(usage.output_tokens_details.reasoning_tokens);
  if (read + write > input || reasoning > output || integer(usage.total_tokens) !== input + output)
    throw new Error("usage_inconsistent");
  if (input > 272_000) throw new Error("unexpected_long_context_price_requires_review");
  // Integer microUSD, rounded upward. Reasoning is already in output.
  const microUSD = Math.ceil(((input - read - write) * 20 + read * 2 + write * 25 + output * 120) / 100);
  return { microUSD, input, output, read, write, reasoning };
}
export function estimate(localJsonTokens, previous = []) {
  integer(localJsonTokens);
  // Heuristic only: never assume observed server differences are constant.
  const observedPositiveDifference = Math.max(0, ...previous.map(e =>
    (e.usage?.input_tokens ?? 0) - (e.estimate?.localJsonTokens ?? 0)));
  const estimatedInputTokens = Math.ceil(Math.max(8_000, localJsonTokens * 2,
    localJsonTokens + observedPositiveDifference * 2));
  if (estimatedInputTokens > 272_000) throw new Error("unexpected_long_context_estimate");
  return { localJsonTokens, estimatedInputTokens, outputCapTokens: 1500,
    estimatedMicroUSD: Math.ceil(estimatedInputTokens * .25 + 1500 * 1.2),
    heuristicNotBound: true, observedPositiveDifference,
    inputAssumptionIsNotAFixedLimit: true };
}
export function admit(ledger, caseId, projection) {
  if (ledger.schemaVersion !== 2 || ledger.purpose !== "cumulative-provider-api-transmissions-not-per-run")
    throw new Error("operational_ledger_required");
  const l = ledger.limits;
  if (l.maxApiTransmissions !== 20 || l.operationalModelBudgetMicroUSD !== 1_000_000
    || l.maxGenerationAttempts !== 11 || l.maxConcurrency !== 1 || l.maxRetries !== 0)
    throw new Error("authorization_limits_changed");
  const first = ledger.entries[0];
  if (first?.sequence !== 1 || first.kind !== "model_metadata" || first.httpStatus !== 200
    || first.path !== "/v1/models/gpt-5.6-luna") throw new Error("historical_metadata_missing");
  if (ledger.halted) throw new Error("run_halted_no_automatic_resume");
  if (ledger.entries.length >= 20) throw new Error("transmission_limit");
  ledger.entries.forEach((entry, i) => {
    if (entry.sequence !== i + 1) throw new Error("ledger_sequence_invalid");
    if (i > 0 && entry.kind !== "generation") throw new Error("unexpected_transmission");
  });
  const previous = ledger.entries.filter(e => e.kind === "generation");
  if (previous.length >= 11) throw new Error("generation_limit");
  if (caseId !== `Q${String(previous.length + 1).padStart(2, "0")}`) throw new Error("one_case_sequential_no_retry");
  if (previous.some(e => e.state !== "completed" || e.review?.verdict !== "acceptable"
    || !Number.isSafeInteger(e.measuredMicroUSD))) throw new Error("previous_case_not_reviewed_or_usage_unknown");
  const spentMicroUSD = previous.reduce((s, e) => s + integer(e.measuredMicroUSD), 0);
  integer(projection.estimatedMicroUSD);
  if (spentMicroUSD + projection.estimatedMicroUSD * 10 > l.operationalModelBudgetMicroUSD)
    throw new Error("insufficient_operational_headroom");
  return { spentMicroUSD, remainingMicroUSD: l.operationalModelBudgetMicroUSD - spentMicroUSD };
}
export function checkResponse(body, sourceContext, projection) {
  const issues = [];
  let measured = null, answer = null;
  try { measured = measureUsage(body.usage); } catch (e) { issues.push(e.message); }
  if (body.model !== MODEL) issues.push("unexpected_model");
  if (body.service_tier !== "default") issues.push("unexpected_service_tier");
  if (body.status !== "completed" || body.incomplete_details || body.error) issues.push("response_not_complete");
  const messages = (body.output ?? []).filter(x => x.type === "message");
  if (messages.length !== 1 || messages.some(x => x.status !== "completed")) issues.push("message_not_complete");
  if ((body.output ?? []).some(x => !["message", "reasoning"].includes(x.type))) issues.push("unexpected_tool_output");
  const content = messages.flatMap(x => x.content ?? []);
  if (content.some(x => x.type !== "output_text")) issues.push("refusal_or_unexpected_content");
  const outputText = content.filter(x => x.type === "output_text").map(x => x.text).join("\n");
  try {
    answer = JSON.parse(outputText);
    if (typeof answer.answer_ja !== "string" || typeof answer.abstained !== "boolean"
      || !Array.isArray(answer.citations) || Object.keys(answer).sort().join() !== "abstained,answer_ja,citations")
      throw new Error();
    if (!answer.abstained && !answer.citations.length) throw new Error();
    for (const c of answer.citations) {
      if (typeof c.locator !== "string" || !sourceContext.citations.some(s =>
        s.source_id === c.source_id && s.version === c.version && s.section_id === c.section_id))
        throw new Error();
    }
  } catch { issues.push("answer_schema_or_citation_mismatch"); }
  if (measured) {
    if (measured.output > projection.outputCapTokens) issues.push("output_cap_exceeded");
    if (measured.microUSD > projection.estimatedMicroUSD) issues.push("cost_above_pre_send_estimate");
    if (measured.read || measured.write) issues.push("unexpected_cache_usage");
  }
  return { measuredMicroUSD: measured?.microUSD ?? null, outputText, answer,
    automatedChecks: { passed: issues.length === 0, issues }, stopReasons: issues };
}