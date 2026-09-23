import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import {
  LIMITS, createOfflineJournal, closeOfflineJournal,
  createOfflineEvaluation, createRealEvaluation,
} from "../prototypes/evidence-consultation/evaluation/budget.mjs";
import {
  PROPOSED_LUNA_RATE, PROPOSED_BUDGET_MICRO_USD, PROPOSED_MODEL_STATUS,
} from "../prototypes/evidence-consultation/evaluation/proposed-rates.mjs";

// Entirely synthetic fixtures; never load originals, application code, DB
// configuration, environment variables, credentials, or user records.
const rate = Object.freeze({
  modelId: "offline-fixture", rateId: "a".repeat(64),
  inputMicroUSDPerMillion: 1_000_000,
  outputMicroUSDPerMillion: 2_000_000,
});
const packet = () => ({
  rules: { instructions: ["fixture-only"] },
  question: "synthetic private marker",
  groups: [{
    groupId: "person-00000000-0000-4000-8000-000000000001",
    evidence: [{ originalText: "synthetic mandatory original" }],
    requiredContextReferences: ["synthetic required context"],
  }],
  snapshotDigest: "synthetic-snapshot",
});
const request = (overrides = {}) => ({
  caseId: "case-0001", modelId: rate.modelId, packet: packet(), ...overrides,
});
function response(overrides = {}) {
  return {
    complete: true, modelId: rate.modelId, rateId: rate.rateId,
    output: "synthetic response marker",
    usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5, outputIncludesReasoning: true },
    ...overrides,
  };
}
function fixture(t, config = {}, execute = async () => response()) {
  // Create and remove ONLY the temporary directory owned by this test.
  const root = mkdtempSync("/tmp/evidence-evaluation-budget-");
  const path = `${root}/journal`;
  const journal = createOfflineJournal(path);
  t.after(() => {
    closeOfflineJournal(journal);
    rmSync(root, { recursive: true, force: true });
  });
  let calls = 0;
  const options = {
    mode: "offline-dry-run", journal, planFingerprint: "b".repeat(64),
    prices: [rate], budgetMicroUSD: 80_000,
    adapter: {
      kind: "offline-mock",
      execute: (...args) => { calls += 1; return execute(...args); },
    },
    ...config,
  };
  const runner = createOfflineEvaluation(options);
  return {
    runner, journal, options, path, calls: () => calls,
    entries: () => readFileSync(`${path}/spend.jsonl`, "utf8").trim().split("\n").map(JSON.parse),
  };
}
const rejects = (promise, code) => assert.rejects(promise, { code });

test("factory refuses runtime without dedicated offline preload marker", () => {
  const marker = Symbol.for("evidence-evaluation.offline-lockdown");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, marker);
  assert.equal(descriptor?.value, true, "run only with dedicated evaluation offline-lockdown preload");
  // Synchronous removal/restoration avoids subprocesses and any unguarded
  // adapter call. Tests are not configured to run concurrently.
  try {
    delete globalThis[marker];
    assert.throws(() => createOfflineEvaluation(), { code: "offline_lockdown_required" });
  } finally {
    Object.defineProperty(globalThis, marker, descriptor);
  }
});

test("fixed ceilings; complete packet and durable reservation precede single invocation", async (t) => {
  let f;
  const original = packet();
  f = fixture(t, {}, async (serialized, options) => {
    assert.deepEqual(JSON.parse(serialized), original);
    assert.equal(options.retries, 0);
    assert.equal(options.maxInputTokens, 8_000);
    assert.equal(options.maxOutputTokens, 1_500);
    const entries = f.entries();
    assert.equal(entries.length, 2);
    assert.equal(entries[1].type, "reserve");
    assert.equal(entries[1].reservedMicroUSD, "11000");
    return response();
  });
  await f.runner.attempt(request({ packet: original }));
  assert.equal(f.calls(), 1);
  assert.deepEqual(LIMITS, {
    attempts: 20, retries: 0, inputPerAttempt: 8_000, outputPerAttempt: 1_500,
    totalInput: 160_000, totalOutput: 30_000, responseBytes: 24_000, budgetMicroUSD: 80_000,
  });
  const summary = f.runner.snapshot();
  assert.equal(summary.reservedMicroUSD, "11000");
  assert.equal(summary.reportedEstimateMicroUSD, "50"); // Reasoning already included.
  const raw = JSON.stringify(f.entries());
  for (const text of [original.question, original.snapshotDigest, original.groups[0].groupId,
    original.groups[0].evidence[0].originalText, response().output]) {
    assert.ok(!raw.includes(text));
  }
  assert.deepEqual(f.entries()[0].prices, [rate]);
});

test("20 global attempts across cases/persons; successful usage never refunds capacity", async (t) => {
  const f = fixture(t, {
    prices: [{ ...rate, inputMicroUSDPerMillion: 100_000, outputMicroUSDPerMillion: 200_000 }],
    budgetMicroUSD: 22_000,
  });
  for (let n = 0; n < 20; n += 1) {
    const p = packet();
    p.groups[0].groupId = `synthetic-person-${n}`;
    await f.runner.attempt(request({ caseId: `case-${String(n + 1).padStart(4, "0")}`, packet: p }));
  }
  assert.equal(f.runner.snapshot().reservedInput, 160_000);
  assert.equal(f.runner.snapshot().reservedOutput, 30_000);
  assert.equal(f.runner.snapshot().reservedMicroUSD, "22000");
  await rejects(f.runner.attempt(request()), "capacity_limit");
  assert.equal(f.calls(), 20);
});

test("strict money reservation stops before first call, even if expected actual usage is tiny", async (t) => {
  const f = fixture(t, { budgetMicroUSD: 10_999 });
  await rejects(f.runner.attempt(request()), "budget_limit");
  assert.equal(f.calls(), 0);
  assert.equal(f.runner.snapshot().attempts, 0);
});

test("integer microUSD accounting rounds upward and includes reasoning without discount", async (t) => {
  const tiny = { ...rate, inputMicroUSDPerMillion: 1, outputMicroUSDPerMillion: 1 };
  const f = fixture(t, { prices: [tiny], budgetMicroUSD: 2 });
  await f.runner.attempt(request());
  assert.equal(f.runner.snapshot().reservedMicroUSD, "2");
  assert.equal(f.runner.snapshot().reportedEstimateMicroUSD, "2");
  await rejects(f.runner.attempt(request()), "budget_limit");
});

test("proposed rates reserve $0.076 for 20 calls under $0.08; proposal never unlocks real mode", async (t) => {
  const f = fixture(t, {
    prices: [PROPOSED_LUNA_RATE], budgetMicroUSD: PROPOSED_BUDGET_MICRO_USD,
  }, async () => response({ modelId: PROPOSED_LUNA_RATE.modelId, rateId: PROPOSED_LUNA_RATE.rateId }));
  for (let i = 0; i < 20; i += 1) {
    const result = await f.runner.attempt(request({ modelId: PROPOSED_LUNA_RATE.modelId }));
    assert.equal(result.estimateBasis, "input_upper_bound");
    assert.equal(result.estimateIsInvoice, false);
  }
  assert.equal(f.runner.snapshot().reservedMicroUSD, "76000");
  assert.equal(f.runner.snapshot().reportedUpperBoundAttempts, 20);
  assert.equal(PROPOSED_MODEL_STATUS.approvedForRealExecution, false);
  assert.equal(PROPOSED_MODEL_STATUS.immutableSnapshotConfirmed, false);
  await rejects(f.runner.attempt(request({ modelId: PROPOSED_LUNA_RATE.modelId })), "capacity_limit");
});

test("reported cache-write counters replace uncached rate; no additive double charge", async (t) => {
  const p = packet();
  p.question = "x".repeat(7_000);
  const f = fixture(t, {
    prices: [PROPOSED_LUNA_RATE], budgetMicroUSD: PROPOSED_BUDGET_MICRO_USD,
  }, async () => response({
    modelId: PROPOSED_LUNA_RATE.modelId, rateId: PROPOSED_LUNA_RATE.rateId,
    usage: {
      inputTokens: 6_000, outputTokens: 1_500, reasoningTokens: 500, outputIncludesReasoning: true,
      inputTokenBreakdown: { uncached: 2_000, cacheWrite: 2_000, cachedRead: 2_000 },
    },
  }));
  const result = await f.runner.attempt(request({ modelId: PROPOSED_LUNA_RATE.modelId, packet: p }));
  assert.equal(result.estimatedMicroUSD, "2740"); // 400 + 500 + 40 + 1800.
  assert.equal(result.estimateBasis, "reported_breakdown");
  assert.equal(f.runner.snapshot().reservedMicroUSD, "3800");
  assert.equal(f.runner.snapshot().reportedBreakdownAttempts, 1);
});

test("incomplete cache breakdown is rejected rather than inventing a discount", async (t) => {
  const f = fixture(t, { prices: [PROPOSED_LUNA_RATE] }, async () => response({
    modelId: PROPOSED_LUNA_RATE.modelId, rateId: PROPOSED_LUNA_RATE.rateId,
    usage: { ...response().usage, inputTokenBreakdown: { uncached: 1, cacheWrite: 1, cachedRead: 1 } },
  }));
  await rejects(f.runner.attempt(request({ modelId: PROPOSED_LUNA_RATE.modelId })), "unknown_or_invalid_usage");
  assert.equal(f.runner.snapshot().reservedMicroUSD, "3800");
});

test("UTF-8 byte bound rejects large multibyte input without dropping evidence", async (t) => {
  const f = fixture(t);
  const p = packet();
  p.question = "あ".repeat(2_667);
  await rejects(f.runner.attempt(request({ packet: p })), "input_limit");
  assert.equal(f.calls(), 0);
  assert.equal(p.groups[0].evidence.length, 1);
});

test("exact 8000 input-byte boundary is accepted; 8001 rejected", async (t) => {
  const f = fixture(t);
  const p = packet();
  p.question += "x".repeat(8_000 - Buffer.byteLength(JSON.stringify(p), "utf8"));
  assert.equal(Buffer.byteLength(JSON.stringify(p), "utf8"), 8_000);
  await f.runner.attempt(request({ packet: p }));
  p.question += "x";
  await rejects(f.runner.attempt(request({ packet: p })), "input_limit");
  assert.equal(f.calls(), 1);
});

test("multi-person packet cannot masquerade as a single attempt", async (t) => {
  const f = fixture(t);
  const p = packet();
  p.groups.push(structuredClone(p.groups[0]));
  await rejects(f.runner.attempt(request({ packet: p })), "one_person_packet_required");
  assert.equal(f.calls(), 0);
});

test("unknown requested model stops before send", async (t) => {
  const f = fixture(t);
  await rejects(f.runner.attempt(request({ modelId: "unapproved" })), "unknown_model_or_rate");
  assert.equal(f.calls(), 0);
  await rejects(f.runner.attempt(request()), "run_stopped");
});

for (const [label, result, code] of [
  ["missing usage", response({ usage: undefined }), "unknown_or_invalid_usage"],
  ["unknown model", response({ modelId: "other-model" }), "unknown_model_or_rate"],
  ["unknown rate", response({ rateId: "c".repeat(64) }), "unknown_model_or_rate"],
  ["partial", response({ complete: false }), "malformed_response"],
  ["oversized response", response({ output: "x".repeat(24_001) }), "response_limit"],
  ["negative usage", response({ usage: { ...response().usage, inputTokens: -1 } }), "unknown_or_invalid_usage"],
  ["fractional usage", response({ usage: { ...response().usage, outputTokens: 1.5 } }), "unknown_or_invalid_usage"],
  ["unknown reasoning semantics", response({ usage: { ...response().usage, outputIncludesReasoning: false } }), "unknown_or_invalid_usage"],
  ["reasoning not included", response({ usage: { ...response().usage, reasoningTokens: 21 } }), "unknown_or_invalid_usage"],
  ["over output cap", response({ usage: { ...response().usage, outputTokens: 1_501 } }), "unknown_or_invalid_usage"],
  ["over reserved input", response({ usage: { ...response().usage, inputTokens: 8_001 } }), "unknown_or_invalid_usage"],
  ["unexpected usage fields", response({ usage: { ...response().usage, cachedInputTokens: 1 } }), "unknown_or_invalid_usage"],
]) {
  test(`${label}: stop permanently, retain full reservation, no retry`, async (t) => {
    const f = fixture(t, {}, async () => result);
    await rejects(f.runner.attempt(request()), code);
    await rejects(f.runner.attempt(request()), "run_stopped");
    assert.equal(f.calls(), 1);
    assert.equal(f.runner.snapshot().reservedMicroUSD, "11000");
    assert.equal(f.runner.snapshot().reportedEstimateMicroUSD, "0");
  });
}

test("ambiguous provider rejection is sanitized and never refunded/retried", async (t) => {
  const f = fixture(t, {}, async () => { throw new Error("synthetic-secret-marker"); });
  await rejects(f.runner.attempt(request()), "mock_error");
  assert.equal(f.calls(), 1);
  assert.equal(f.runner.snapshot().reservedInput, 8_000);
  assert.ok(!JSON.stringify(f.entries()).includes("synthetic-secret-marker"));
});

test("timeout retains reservation and aborts mock; late completion cannot permit more calls", async (t) => {
  let finish;
  let mockSignal;
  const f = fixture(t, { timeoutMs: 5 }, async (_, options) => {
    mockSignal = options.signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  await rejects(f.runner.attempt(request()), "timeout");
  assert.equal(mockSignal.aborted, true);
  finish(response());
  await rejects(f.runner.attempt(request()), "run_stopped");
  assert.equal(f.calls(), 1);
  assert.equal(f.runner.snapshot().reservedMicroUSD, "11000");
});

test("cancellation after invocation retains reservation; already cancelled sends nothing", async (t) => {
  const controller = new AbortController();
  const f = fixture(t, {}, async () => {
    controller.abort();
    return new Promise(() => {});
  });
  await rejects(f.runner.attempt(request({ signal: controller.signal })), "cancelled");
  assert.equal(f.calls(), 1);
  assert.equal(f.runner.snapshot().reservedMicroUSD, "11000");
  const other = fixture(t);
  await rejects(other.runner.attempt(request({ signal: controller.signal })), "cancelled");
  assert.equal(other.calls(), 0);
});

test("concurrent attempt and second runner are rejected, not queued", async (t) => {
  let finish;
  const f = fixture(t, {}, async () => new Promise((resolve) => { finish = resolve; }));
  const first = f.runner.attempt(request());
  await rejects(f.runner.attempt(request()), "concurrent_attempt_forbidden");
  assert.throws(() => createOfflineEvaluation(f.options), { code: "journal_runner_locked" });
  assert.throws(() => createOfflineJournal(f.path), { code: "journal_unavailable_or_locked" });
  finish(response());
  await first;
  assert.equal(f.calls(), 1);
});

test("restart/crash/partial journal cannot be reopened or silently reset", async (t) => {
  const f = fixture(t);
  await f.runner.attempt(request());
  closeOfflineJournal(f.journal);
  assert.throws(() => createOfflineJournal(f.path), { code: "journal_unavailable_or_locked" });
  const root = mkdtempSync("/tmp/evidence-evaluation-crash-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(`${root}/crashed`);
  assert.throws(() => createOfflineJournal(`${root}/crashed`), { code: "journal_unavailable_or_locked" });
});

test("persistence failure before send blocks invocation", async (t) => {
  const f = fixture(t);
  closeOfflineJournal(f.journal);
  await rejects(f.runner.attempt(request()), "journal_unavailable");
  assert.equal(f.calls(), 0);
  assert.equal(f.runner.snapshot().stopped, true);
});

test("usage persistence failure suppresses output and retains reservation", async (t) => {
  let f;
  f = fixture(t, {}, async () => {
    closeOfflineJournal(f.journal);
    return response();
  });
  await rejects(f.runner.attempt(request()), "journal_unavailable");
  assert.equal(f.runner.snapshot().reservedMicroUSD, "11000");
  await rejects(f.runner.attempt(request()), "run_stopped");
});

test("real mode, retries, missing persistence, missing fingerprint, and invalid pricing fail closed", (t) => {
  const f = fixture(t);
  assert.throws(() => createRealEvaluation({ approved: true }), { code: "real_execution_not_implemented" });
  for (const [config, code] of [
    [{ mode: "real" }, "offline_only"],
    [{ retries: 1 }, "retries_forbidden"],
    [{ journal: {} }, "persistence_required"],
    [{ planFingerprint: "" }, "plan_fingerprint_required"],
    [{ budgetMicroUSD: 80_001 }, "budget_required"],
    [{ adapter: { kind: "http", execute() {} } }, "mock_required"],
  ]) {
    assert.throws(() => createOfflineEvaluation({ ...f.options, ...config }), { code });
  }
  for (const prices of [
    [], [{ ...rate, inputMicroUSDPerMillion: -1 }],
    [{ ...rate, inputMicroUSDPerMillion: 0 }],
    [{ ...rate, outputMicroUSDPerMillion: 0 }],
    [{ ...rate, outputMicroUSDPerMillion: 0.5 }], [rate, rate],
    ...["uncached", "cacheWrite", "cachedRead"].map((key) => [{
      ...PROPOSED_LUNA_RATE,
      inputBillingRates: { ...PROPOSED_LUNA_RATE.inputBillingRates, [key]: 0 },
    }]),
  ]) {
    const root = mkdtempSync("/tmp/evidence-evaluation-config-");
    const journal = createOfflineJournal(`${root}/journal`);
    t.after(() => { closeOfflineJournal(journal); rmSync(root, { recursive: true, force: true }); });
    assert.throws(() => createOfflineEvaluation({ ...f.options, journal, prices }),
      { code: prices.length ? "invalid_trusted_prices" : "trusted_prices_required" });
  }
});