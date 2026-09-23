import { randomUUID } from "node:crypto";
import {
  mkdirSync, openSync, writeSync, fsyncSync, closeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

// Deliberately not imported by the application or CandidateProvider.
export const LIMITS = Object.freeze({
  attempts: 20,
  retries: 0,
  inputPerAttempt: 8_000,
  outputPerAttempt: 1_500,
  totalInput: 160_000,
  totalOutput: 30_000,
  responseBytes: 24_000,
  budgetMicroUSD: 80_000,
});

export class EvaluationBudgetError extends Error {
  constructor(code) {
    super(code);
    this.name = "EvaluationBudgetError";
    this.code = code;
  }
}
const fail = (code) => { throw new EvaluationBudgetError(code); };
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const exact = (value, keys) => value !== null && typeof value === "object"
  && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/;
const casePattern = /^case-[0-9]{4}$/;
const journals = new WeakMap();

function ceilCost(tokens, rate) {
  return (BigInt(tokens) * BigInt(rate) + 999_999n) / 1_000_000n;
}

function priceFor(input, output, rate) {
  // Round each component upwards. No cached-input discount.
  return ceilCost(input, rate.inputMicroUSDPerMillion)
    + ceilCost(output, rate.outputMicroUSDPerMillion);
}

function validRate(rate) {
  const baseKeys = ["modelId", "rateId", "inputMicroUSDPerMillion", "outputMicroUSDPerMillion"];
  if (!exact(rate, baseKeys) && !exact(rate, [...baseKeys, "inputBillingRates"])) return false;
  if (typeof rate.modelId !== "string" || !modelPattern.test(rate.modelId)
    || typeof rate.rateId !== "string" || !/^[a-f0-9]{64}$/.test(rate.rateId)
    || !integer(rate.inputMicroUSDPerMillion) || !integer(rate.outputMicroUSDPerMillion)
    || rate.inputMicroUSDPerMillion === 0 || rate.outputMicroUSDPerMillion === 0) return false;
  if (rate.inputBillingRates !== undefined) {
    if (!exact(rate.inputBillingRates, ["uncached", "cacheWrite", "cachedRead"])
      || !Object.values(rate.inputBillingRates).every((n) =>
        integer(n) && n > 0 && n <= rate.inputMicroUSDPerMillion)) return false;
  }
  return true;
}

function usageEstimate(usage, rate) {
  const breakdown = usage.inputTokenBreakdown;
  if (breakdown === undefined) {
    return { microUSD: priceFor(usage.inputTokens, usage.outputTokens, rate), basis: "input_upper_bound" };
  }
  if (!rate.inputBillingRates
    || !exact(breakdown, ["uncached", "cacheWrite", "cachedRead"])
    || !Object.values(breakdown).every(integer)
    || breakdown.uncached + breakdown.cacheWrite + breakdown.cachedRead !== usage.inputTokens) {
    fail("unknown_or_invalid_usage");
  }
  // These are mutually exclusive input counters. Cache WRITE REPLACES the
  // uncached-input rate for those tokens: never charge both rates on them.
  const inputEstimate = Object.keys(breakdown).reduce((sum, key) =>
    sum + ceilCost(breakdown[key], rate.inputBillingRates[key]), 0n);
  return {
    microUSD: inputEstimate + ceilCost(usage.outputTokens, rate.outputMicroUSDPerMillion),
    basis: "reported_breakdown",
  };
}

/**
 * Owns a NEW directory exclusively. Existing paths (including stale crash
 * locks) are refused, never read, repaired, truncated, resumed, or deleted.
 * The directory itself is a permanent one-shot lock, not a PID-based lock.
 * Parent must already exist on a trusted local durable filesystem.
 */
export function createOfflineJournal(directory) {
  if (typeof directory !== "string" || !directory.startsWith("/")) fail("journal_path");
  const path = resolve(directory);
  let fd;
  try {
    mkdirSync(path, { mode: 0o700 });
    const parent = openSync(dirname(path), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
    fd = openSync(`${path}/spend.jsonl`, "wx", 0o600);
    fsyncSync(fd);
    const own = openSync(path, "r");
    try { fsyncSync(own); } finally { closeSync(own); }
  } catch {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* Preserve the permanent lock. */ }
    }
    fail("journal_unavailable_or_locked");
  }
  const handle = Object.freeze({});
  journals.set(handle, { fd, claimed: false, broken: false, closed: false });
  return handle;
}

function append(journal, entry) {
  const state = journals.get(journal);
  if (!state || state.closed || state.broken) fail("journal_unavailable");
  try {
    const bytes = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(state.fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error("write");
      offset += written;
    }
    fsyncSync(state.fd); // Must return successfully BEFORE any mock invocation.
  } catch {
    state.broken = true;
    fail("journal_io");
  }
}

export function closeOfflineJournal(journal) {
  const state = journals.get(journal);
  if (!state || state.closed) return;
  state.closed = true;
  try { closeSync(state.fd); } catch { fail("journal_io"); }
  // Never remove the directory lock, even after a clean close.
}

/** No flag, fingerprint, permit, or environment variable enables real calls. */
export function createRealEvaluation() {
  fail("real_execution_not_implemented");
}

/**
 * Offline-only protocol:
 * - adapter.kind === "offline-mock"; execute gets the FULL serialized packet.
 * - One packet has exactly one AnswerPacket group.
 * - usage.outputTokens INCLUDES reasoningTokens (a subset, not additive).
 * - output is a complete buffered string; candidate validation is separate.
 *
 * A caller-provided function cannot be sandboxed by a JS label. Execute these
 * fixtures ONLY under the supplied import/network lockdown. No actual adapter,
 * tokenizer, runtime integration, or approved pricing is shipped.
 */
export function createOfflineEvaluation({
  mode, journal, planFingerprint, prices, budgetMicroUSD,
  adapter, retries = 0, timeoutMs = 1_000,
} = {}) {
  if (globalThis[Symbol.for("evidence-evaluation.offline-lockdown")] !== true) {
    fail("offline_lockdown_required");
  }
  if (mode !== "offline-dry-run") fail("offline_only");
  if (retries !== 0) fail("retries_forbidden");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail("timeout_config");
  if (!/^[a-f0-9]{64}$/.test(planFingerprint ?? "")) fail("plan_fingerprint_required");
  if (!integer(budgetMicroUSD) || budgetMicroUSD === 0
    || budgetMicroUSD > LIMITS.budgetMicroUSD) fail("budget_required");
  if (!adapter || adapter.kind !== "offline-mock" || typeof adapter.execute !== "function") fail("mock_required");
  const state = journals.get(journal);
  if (!state || state.closed || state.broken) fail("persistence_required");
  if (state.claimed) fail("journal_runner_locked");
  if (!Array.isArray(prices) || prices.length === 0) fail("trusted_prices_required");
  const rates = new Map();
  for (const rate of prices) {
    if (!validRate(rate) || rates.has(rate.modelId)) fail("invalid_trusted_prices");
    rates.set(rate.modelId, Object.freeze({
      ...rate,
      ...(rate.inputBillingRates ? { inputBillingRates: Object.freeze({ ...rate.inputBillingRates }) } : {}),
    }));
  }
  state.claimed = true;
  const runId = randomUUID();
  append(journal, {
    type: "plan", runId, planFingerprint, limits: LIMITS,
    budgetMicroUSD: String(budgetMicroUSD), prices: [...rates.values()],
  });
  let busy = false;
  let stopped = false;
  let attempts = 0;
  let reservedInput = 0;
  let reservedOutput = 0;
  let reservedMicroUSD = 0n;
  let reportedInput = 0;
  let reportedOutput = 0;
  let reportedEstimateMicroUSD = 0n;
  let reportedUpperBoundAttempts = 0;
  let reportedBreakdownAttempts = 0;

  function snapshot() {
    return Object.freeze({
      attempts, reservedInput, reservedOutput,
      reservedMicroUSD: String(reservedMicroUSD),
      reportedInput, reportedOutput,
      reportedEstimateMicroUSD: String(reportedEstimateMicroUSD),
      reportedUpperBoundAttempts, reportedBreakdownAttempts,
      estimateIsInvoice: false,
      stopped, busy,
    });
  }

  async function attempt({ caseId, modelId, packet, signal } = {}) {
    if (busy) fail("concurrent_attempt_forbidden");
    if (stopped) fail("run_stopped");
    busy = true;
    let reserved = false;
    let attemptId;
    let timer;
    let onAbort;
    const controller = new AbortController();
    try {
      if (signal?.aborted) fail("cancelled");
      if (typeof caseId !== "string" || !casePattern.test(caseId)) fail("opaque_case_id_required");
      const rate = rates.get(modelId);
      if (!rate) fail("unknown_model_or_rate");
      // JSON round-trip snapshots the whole packet; never truncate or select
      // evidence to fit. Required-context completeness remains policy's job.
      const serialized = JSON.stringify(packet);
      if (typeof serialized !== "string") fail("invalid_packet");
      const copy = JSON.parse(serialized);
      if (!copy || !Array.isArray(copy.groups) || copy.groups.length !== 1
        || typeof copy.question !== "string" || !copy.rules
        || typeof copy.snapshotDigest !== "string") fail("one_person_packet_required");
      // Offline byte-token vocabulary: at most one token per UTF-8 byte.
      // No chars/4 heuristic. A future real adapter needs a verified tokenizer
      // for its EXACT wire encoding, including framing and special tokens.
      const inputBound = Buffer.byteLength(serialized, "utf8");
      if (inputBound > LIMITS.inputPerAttempt) fail("input_limit");
      const reservation = priceFor(LIMITS.inputPerAttempt, LIMITS.outputPerAttempt, rate);
      if (attempts >= LIMITS.attempts
        || reservedInput + LIMITS.inputPerAttempt > LIMITS.totalInput
        || reservedOutput + LIMITS.outputPerAttempt > LIMITS.totalOutput) fail("capacity_limit");
      if (reservedMicroUSD + reservation > BigInt(budgetMicroUSD)) fail("budget_limit");
      attemptId = randomUUID();
      append(journal, {
        type: "reserve", runId, attemptId, caseId, modelId, rateId: rate.rateId,
        attempt: attempts + 1, inputBound,
        inputTokens: LIMITS.inputPerAttempt, outputTokens: LIMITS.outputPerAttempt,
        reservedMicroUSD: String(reservation),
      });
      // Reservations are NEVER refunded, even on fully known success.
      attempts += 1;
      reservedInput += LIMITS.inputPerAttempt;
      reservedOutput += LIMITS.outputPerAttempt;
      reservedMicroUSD += reservation;
      reserved = true;
      const cancelled = new Promise((_, reject) => {
        onAbort = () => {
          reject(new EvaluationBudgetError("cancelled"));
          controller.abort();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new EvaluationBudgetError("timeout"));
          controller.abort();
        }, timeoutMs);
      });
      const completion = Promise.resolve().then(() => {
        if (controller.signal.aborted) fail("cancelled");
        // Exactly ONE invocation. The injected mock must not retry or fan out.
        return adapter.execute(serialized, Object.freeze({
          signal: controller.signal, modelId, rateId: rate.rateId,
          maxInputTokens: LIMITS.inputPerAttempt,
          maxOutputTokens: LIMITS.outputPerAttempt,
          retries: 0, attemptId,
        }));
      }).catch(() => { fail("mock_error"); });
      const response = await Promise.race([completion, cancelled, timeout]);
      if (controller.signal.aborted) fail("cancelled");
      if (!exact(response, ["complete", "modelId", "rateId", "output", "usage"])
        || response.complete !== true) fail("malformed_response");
      if (response.modelId !== modelId || response.rateId !== rate.rateId) fail("unknown_model_or_rate");
      if (typeof response.output !== "string"
        || Buffer.byteLength(response.output, "utf8") > LIMITS.responseBytes) fail("response_limit");
      const usage = response.usage;
      const usageKeys = ["inputTokens", "outputTokens", "reasoningTokens", "outputIncludesReasoning"];
      if ((!exact(usage, usageKeys) && !exact(usage, [...usageKeys, "inputTokenBreakdown"]))
        || !integer(usage.inputTokens) || !integer(usage.outputTokens)
        || !integer(usage.reasoningTokens) || usage.outputIncludesReasoning !== true
        || usage.reasoningTokens > usage.outputTokens
        || usage.inputTokens > inputBound || usage.inputTokens > LIMITS.inputPerAttempt
        || usage.outputTokens > LIMITS.outputPerAttempt
        || (serialized.length > 0 && usage.inputTokens === 0)
        || (response.output.length > 0 && usage.outputTokens === 0)) fail("unknown_or_invalid_usage");
      const estimate = usageEstimate(usage, rate);
      append(journal, {
        type: "usage", runId, attemptId, caseId, modelId, rateId: rate.rateId,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens, estimatedMicroUSD: String(estimate.microUSD),
        estimateBasis: estimate.basis,
        ...(usage.inputTokenBreakdown ? { inputTokenBreakdown: { ...usage.inputTokenBreakdown } } : {}),
      });
      reportedInput += usage.inputTokens;
      reportedOutput += usage.outputTokens;
      reportedEstimateMicroUSD += estimate.microUSD;
      if (estimate.basis === "input_upper_bound") reportedUpperBoundAttempts += 1;
      else reportedBreakdownAttempts += 1;
      // Only return after usage commit. Nothing sensitive is persisted.
      return Object.freeze({
        output: response.output, usage: Object.freeze({ ...usage }), attemptId,
        estimatedMicroUSD: String(estimate.microUSD), estimateBasis: estimate.basis, estimateIsInvoice: false,
      });
    } catch (error) {
      stopped = true;
      controller.abort();
      // Never retain provider error messages, request/response data, or stacks.
      if (reserved) {
        append(journal, { type: "stop", runId, attemptId, caseId });
      }
      if (error instanceof EvaluationBudgetError) throw error;
      fail("invalid_input_or_mock_failure");
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      busy = false;
    }
  }
  return Object.freeze({ attempt, snapshot });
}