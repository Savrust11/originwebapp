// Synthetic fixtures exist only here, never in the production ledger or requests.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODELS, ENDPOINT, hash, encode } from "../model-comparison-execution/controls.mjs";
import { loadBaseline, snapshot, SNAPSHOT, OUTPUT, LIMITS } from "./baseline.mjs";
import { ROOT, createRunner, derive } from "./runner.mjs";
import { inspectResponse, inspectControls, compareNativeSampling, reserve, validateReview } from "./controls.mjs";

const prepared = loadBaseline(), before = snapshot();
const first = prepared.order.attempts[0];
const request = prepared.requests.requests.find(p => p.caseId === first.caseId).requests.find(r => r.model === first.model);
const realPrivateExisted = fs.existsSync(path.join(ROOT, OUTPUT, "private"));
after(() => {
  assert.deepEqual(snapshot(), before, "ALL frozen preparation, old records, sender code remain byte-identical");
  assert.equal(fs.existsSync(path.join(ROOT, OUTPUT, "private")), realPrivateExisted, "tests never initialize real ledger");
});
function body(r = request) {
  const { input, ...settings } = structuredClone(r);
  // Full ordinary Responses envelope, not merely the requested fields. Official
  // Response schema has no store echo; the request contract supplies that evidence.
  delete settings.store;
  settings.reasoning = { effort: "medium", summary: null, generate_summary: null, context: "all_turns", mode: null };
  settings.text.verbosity = "medium";
  const source = JSON.parse(input.find(i => i.role === "user").content).original_evidence[0].original_id;
  return {
    ...settings, id: "resp_OFFLINE_FIXTURE", object: "response", created_at: 1, completed_at: 2,
    prompt_cache_options: { ttl: "30m", mode: "explicit", comparison_response_id: null },
    prompt_cache_key: null, prompt_cache_retention: null, prompt_cache_diagnostics: null,
    instructions: null, previous_response_id: null, conversation: null, prompt: null,
    moderation: null, safety_identifier: null, user: null,
    tool_choice: "auto", parallel_tool_calls: true, max_tool_calls: null,
    temperature: 1, top_p: 1, top_logprobs: 0,
    status: "completed", error: null, incomplete_details: null, metadata: {},
    output: [{ type: "reasoning", id: "rs_OFFLINE_FIXTURE", summary: [] },
      { id: "msg_OFFLINE_FIXTURE", type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify({
        explanations: [{ text: "オフライン専用の合成回答。", original_ids: [source] }],
        limitations: [], abstention: { applies: false, text: "", original_ids: [] },
      }), annotations: [], logprobs: [] }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 5 } },
  };
}
function reviewFor(packet, bytes) {
  const invalid = packet.answer.kind === "technical-invalid";
  const grade = verdict => ({ verdict, reason: "合成オフラインテスト。実評価ではない。" });
  return {
    schemaVersion: 1, caseId: packet.caseId, label: packet.label, blindPacketSha256: hash(bytes),
    reviewerType: "AI", contextIsolation: { freshContext: true, modelIdentityKnown: false, priorAnswersSeen: false },
    technicalAcknowledged: true, decision: "continue",
    criteria: Object.entries(packet.rubric.case).flatMap(([group, items]) => items.map((_, index) => ({
      group, index, verdict: invalid ? "not-assessable" : "pass", reason: "合成評価。",
    }))),
    layers: {
      bodyMeaning: grade(invalid ? "not-assessable" : "pass"),
      bodyQuestionCoverage: grade(invalid ? "not-assessable" : "pass"),
      bodyAttributionPresence: grade(invalid ? "not-assessable" : "correct"),
      bodyCompleteness: grade(invalid ? "not-assessable" : "complete"),
      appDisplay: grade("pass"), wholeScreenMeaning: grade(invalid ? "not-assessable" : "pass"),
      surfaceQuality: grade(invalid ? "not-assessable" : "pass"),
    },
    questionCoverage: [{ element: "合成質問", verdict: invalid ? "not-assessable" : "answered", reason: "合成評価。" }],
    readability: packet.rubric.global.japaneseReadability.dimensions.map(dimension => ({
      dimension, verdict: invalid ? "not-assessable" : "pass", reason: "合成評価。",
    })),
    limitations: "合成オフラインテストのみ。実際の採点には使用しない。",
  };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comparison-resume-offline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, OUTPUT);
  fs.mkdirSync(base, { recursive: true });
  fs.copyFileSync(path.join(ROOT, OUTPUT, "preflight.json"), path.join(base, "preflight.json"));
  if (options.bindCode) {
    const preflight = JSON.parse(fs.readFileSync(path.join(base, "preflight.json")));
    const paths = [
      ...["baseline.mjs", "controls.mjs", "runner.mjs", "cli.mjs", "offline.test.mjs", "offline-lockdown.mjs"]
        .map(n => `prototypes/evidence-consultation/model-comparison-resume/${n}`),
      ...[0, 1, 2].map(n => `evidence-work/model-comparison-runs/reading-comparison-01/preflight/official-${n}.md`),
      "evidence-work/model-comparison-runs/reading-comparison-01/preflight/current-pricing.json",
      ...preflight.documentation.map(d => d.path),
    ];
    for (const p of paths) {
      fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, p), path.join(root, p));
    }
  }
  let sends = 0, credentialReads = 0;
  const events = () => fs.existsSync(path.join(base, "private/events"))
    ? fs.readdirSync(path.join(base, "private/events")).sort().map(n => JSON.parse(fs.readFileSync(path.join(base, "private/events", n)))) : [];
  const create = () => createRunner({
    root, loadPrepared: options.loadPrepared ?? (() => prepared), bindCode: options.bindCode ?? false, coin: options.coin ?? (() => 1),
    readCredential: () => { credentialReads++; return "OFFLINE-NOT-A-REAL-CREDENTIAL"; },
    fetchImpl: async (url, init) => {
      sends++;
      assert.equal(url, ENDPOINT); assert.equal(init.redirect, "error"); assert.equal(init.method, "POST");
      assert.equal(events().at(-1).type, "transmission-reserved");
      const planned = prepared.order.attempts[sends - 1];
      const expected = prepared.requests.requests.find(p => p.caseId === planned.caseId).requests.find(r => r.model === planned.model);
      assert.equal(init.body, JSON.stringify(expected), "byte-identical frozen prepared serialization");
      assert.equal(events().at(-1).data.requestSha256, hash(init.body));
      if (options.transportError) throw new Error("must-not-log-provider-message");
      const result = body(JSON.parse(init.body));
      if (options.mutate) options.mutate(result, sends);
      if (options.wait) await options.wait;
      return new Response(JSON.stringify(result), { status: 200 });
    },
  });
  const runner = create();
  const accept = async (mutate = () => {}) => {
    const status = await runner.status(), bytes = fs.readFileSync(path.join(base, status.awaitingReview));
    const packet = JSON.parse(bytes), review = reviewFor(packet, bytes); mutate(review);
    const source = path.join(root, "synthetic-review.json"); fs.writeFileSync(source, encode(review));
    return runner.review(packet.caseId, packet.label, source);
  };
  return { root, base, runner, create, accept, events, sends: () => sends, credentialReads: () => credentialReads };
}

test("closed predecessor frozen, Q10 evidence absent, exact remaining order", () => {
  assert.equal(before.sha256, SNAPSHOT); assert.equal(before.files.length, 50);
  assert.equal(prepared.order.pairs.length, 11); assert.equal(prepared.order.attempts.length, 22);
  assert.ok(prepared.order.attempts.every(a => a.caseId !== "C-K10"));
  assert.equal(prepared.order.attempts[0].caseId, "C-H06");
  assert.equal(LIMITS.baselineTransmissions, 20); assert.equal(LIMITS.newMaxTransmissions, 23);
});
test("documented ttl/prewarm default expansion and key order are harmless", () => {
  const full = body(); full.prompt_cache_options.prewarm = false;
  const result = inspectResponse(full, request, reserve(request), 200);
  assert.deepEqual(result.stopReasons, []); assert.equal(result.technicalState, "completed-schema");
  const ttl = result.controls.fields.find(f => f.field === "prompt_cache_options.ttl");
  assert.equal(ttl.returned.value, "30m"); assert.equal(ttl.requested.presence, "omitted");
  assert.equal(ttl.comparison, "documented-addition");
  const b = body(); delete b.prompt_cache_options.ttl; delete b.prompt_cache_options.prewarm;
  assert.deepEqual(inspectControls(b, request).stopReasons, []);
});
test("documented inert metadata is accepted but arbitrary contents are not logged", () => {
  const b = body(); b.metadata = { note: "PRIVATE-CONSULTATION-MARKER" };
  const result = inspectResponse(b, request, reserve(request), 200);
  assert.equal(result.technicalState, "completed-schema");
  assert.ok(!JSON.stringify(result.controls).includes("PRIVATE-CONSULTATION-MARKER"));
});
test("missing mode never becomes explicit; null is not omitted; old-model ttl unsupported", () => {
  for (const mutate of [
    b => delete b.prompt_cache_options.mode, b => delete b.prompt_cache_options,
    b => { b.prompt_cache_options.ttl = null; }, b => { b.prompt_cache_options.ttl = "24h"; },
    b => { b.prompt_cache_options.ttl = "in_memory"; }, b => { b.store = null; },
    b => delete b.background, b => delete b.tools,
    b => delete b.reasoning.effort, b => delete b.max_output_tokens, b => delete b.service_tier,
    b => { b.background = null; }, b => { b.service_tier = null; }, b => { b.model = null; },
    b => { b.tools = null; }, b => { b.reasoning.effort = null; }, b => { b.max_output_tokens = null; },
    b => { b.truncation = null; }, b => { b.prompt_cache_options.mode = null; },
  ]) {
    const b = body(); mutate(b);
    const result = inspectResponse(b, request, reserve(request), 200);
    assert.ok(result.stopReasons.length); assert.equal(result.measured, null);
    assert.equal(result.costAccounting, "unknown-retain-reservation");
  }
});
test("important known mismatches retain safe exact scalars and stop", () => {
  for (const [key, value] of [["store", true], ["background", true], ["service_tier", "priority"],
    ["truncation", "auto"], ["max_output_tokens", 2000], ["model", MODELS.find(m => m !== request.model)]]) {
    const b = body(); b[key] = value;
    const result = inspectResponse(b, request, reserve(request), 200);
    assert.ok(result.stopReasons.includes("important_control_mismatch")); assert.equal(result.measured, null);
    assert.equal(result.controls.fields.find(f => f.field === key).returned.value, value);
  }
  for (const change of [b => { b.prompt_cache_options.mode = "implicit"; },
    b => { b.prompt_cache_options.prewarm = true; }, b => { b.reasoning.effort = "high"; }]) {
    const b = body(); change(b); assert.ok(inspectControls(b, request).stopReasons.length);
  }
});
test("unknown names/values/billing/diagnostic options fail closed and use hashes only", () => {
  for (const mutate of [
    b => { b.prompt_cache_options["SECRET-NAME"] = "SECRET-VALUE"; },
    b => { b.prompt_cache_options.mode = "SECRET-VALUE"; },
    b => { b.prompt_cache_options.comparison_response_id = "SECRET-VALUE"; },
    b => { b["SECRET-NAME"] = { billing: "SECRET-VALUE" }; },
    b => { b.reasoning.summary = "SECRET-VALUE"; },
    b => { b.usage.input_tokens_details["SECRET-NAME"] = "SECRET-VALUE"; },
  ]) {
    const b = body(); mutate(b);
    const result = inspectResponse(b, request, reserve(request), 200);
    assert.ok(result.stopReasons.length); assert.equal(result.measured, null);
    assert.ok(!JSON.stringify(result).includes("SECRET-NAME"));
    assert.ok(!JSON.stringify(result).includes("SECRET-VALUE"));
  }
});
test("known cache accounting charges actual yet stops; unknown accounting reserves", () => {
  const b = body(); b.usage.input_tokens_details.cache_write_tokens = 10;
  const result = inspectResponse(b, request, reserve(request), 200);
  assert.ok(result.measured.centiMicroUSD > 0);
  assert.ok(result.stopReasons.includes("unexpected_cache_reads_or_writes"));
  delete b.usage.input_tokens_details.cache_write_tokens;
  assert.equal(inspectResponse(b, request, reserve(request), 200).measured, null);
});
test("status/init need no credentials or network and summaries remain blinded", async t => {
  const f = fixture(t);
  assert.equal((await f.runner.status()).initialized, false);
  await f.runner.initialize();
  const state = await f.runner.status();
  assert.equal(state.baselineTransmissions, 20); assert.equal(f.credentialReads(), 0); assert.equal(f.sends(), 0);
  assert.ok(!/model|usage|cost|microUSD|luna|sol/i.test(JSON.stringify(state)));
  const auth = JSON.parse(fs.readFileSync(path.join(f.base, "private/authorization.json")));
  assert.match(auth.authorization, /without asking again/);
  assert.equal(auth.baselineIncludedForWinners, false);
});
test("whole pair admission, known actual replaces reserve once; review required; re-open resumes", async t => {
  const f = fixture(t); await f.runner.initialize();
  const result = await f.runner.next();
  assert.equal(result.cumulativeTransmissions, 21);
  assert.ok(!/model|usage|cost|microUSD|luna|sol/i.test(JSON.stringify(result)));
  let s = derive(f.events());
  assert.equal(s.unknown, 551250);
  assert.equal(s.actual, 2587900 + s.attempts[0].result.measured.centiMicroUSD);
  const pair = f.events().find(e => e.type === "pair-reserved").data;
  assert.equal(s.pendingPairReserve, pair.projections[1].centiMicroUSD);
  await assert.rejects(f.runner.next(), /previous_attempt_requires/);
  await assert.rejects(f.runner.unmask("test early closure"), /unmask_requires_all/);
  await f.accept();
  await f.create().next();
  s = derive(f.events()); assert.equal(s.pendingPairReserve, 0); assert.equal(s.unknown, 551250);
  await f.accept(); const closed = await f.runner.unmask("synthetic test closure");
  assert.ok(closed.accounting); assert.equal(closed.accounting.unresolvedCentiMicroUSD, 551250);
  await assert.rejects(f.runner.next(), /continuation_stopped/);
});
test("all 22 sends obey frozen order/byte identity, remaining slot not used, baseline never scored", async t => {
  const f = fixture(t); await f.runner.initialize();
  for (let i = 0; i < 22; i++) { await f.runner.next(); await f.accept(); }
  await assert.rejects(f.runner.next(), /transmission_limit/);
  assert.equal(f.sends(), 22);
  const result = await f.runner.unmask("synthetic complete continuation");
  assert.equal(result.cumulativeTransmissions, 42);
  const final = JSON.parse(fs.readFileSync(path.join(f.base, "unmasked/final.json")));
  assert.equal(final.eligiblePairs.length, 11); assert.equal(final.baselineExcludedFromWinners, true);
  assert.ok(final.attempted.every(a => a.caseId !== "C-K10"));
});
test("transport or unknown controls retain reservation and block any further sends", async t => {
  for (const options of [{ transportError: true }, { mutate: b => { b.prompt_cache_options.mode = "unrecognized"; } }]) {
    const f = fixture(t, options); await f.runner.initialize(); await f.runner.next();
    const s = derive(f.events());
    assert.equal(s.actual, 2587900); assert.equal(s.unknown, 551250 + s.attempts[0].projection.centiMicroUSD);
    await f.accept(); await assert.rejects(f.runner.next(), /continuation_stopped/);
    const final = await f.runner.unmask("synthetic failed continuation");
    assert.equal(final.accounting.pendingPairReserveCentiMicroUSD, 0); assert.equal(f.sends(), 1);
  }
});
test("accounting pair admission math includes old unknown exactly once", () => {
  const events = [
    { type: "pair-reserved", data: { startAttempt: 1, projections: [{ centiMicroUSD: 100 }, { centiMicroUSD: 200 }] } },
    { type: "transmission-reserved", data: { attempt: 1, projection: { centiMicroUSD: 100 } } },
  ];
  let s = derive(events); assert.equal(s.actual + s.unknown + s.pendingPairReserve, 2587900 + 551250 + 300);
  events.push({ type: "response-recorded", data: { attempt: 1, costAccounting: "known-total", measured: { centiMicroUSD: 30 } } });
  s = derive(events); assert.equal(s.actual + s.unknown + s.pendingPairReserve, 2587900 + 551250 + 230);
  events.push({ type: "unmasked" }); s = derive(events);
  assert.equal(s.actual + s.unknown + s.pendingPairReserve, 2587900 + 551250 + 30);
});
test("judge schema freezes every criterion, separate app/body and four Japanese axes", async t => {
  const f = fixture(t); await f.runner.initialize(); const status = await f.runner.next();
  const bytes = fs.readFileSync(path.join(f.base, status.awaitingReview)), packet = JSON.parse(bytes);
  assert.equal(packet.rubric.global.japaneseReadability.dimensions.length, 4);
  for (const mutate of [
    r => r.criteria.pop(), r => r.readability.pop(), r => delete r.layers.appDisplay,
    r => { r.contextIsolation.priorAnswersSeen = true; }, r => { r.contextIsolation.modelIdentityKnown = true; },
  ]) {
    const review = reviewFor(packet, bytes); mutate(review);
    assert.throws(() => validateReview(review, packet, hash(bytes)));
  }
  assert.ok(!JSON.stringify(packet).includes(request.model));
  await f.accept();
});
test("new mapping is independently drawn for all remaining pairs", async t => {
  let draws = 0;
  const f = fixture(t, { coin: () => draws++ % 2 }); await f.runner.initialize();
  assert.equal(draws, 11);
  const mapping = JSON.parse(fs.readFileSync(path.join(f.base, "private/mapping.json"))).mapping;
  assert.equal(Object.keys(mapping).length, 11); assert.equal(mapping["C-K10"], undefined);
  assert.equal(mapping[prepared.order.pairs[0].caseId][MODELS[0]], "X");
  assert.equal(mapping[prepared.order.pairs[1].caseId][MODELS[0]], "Y");
});
test("shared lock excludes simultaneous sends and stale locks", async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { wait }); await f.runner.initialize();
  const pending = f.runner.next();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.runner.next(), /EEXIST/);
  release(); await pending; assert.equal(f.sends(), 1);
});
test("sealed preflight corruption stops before reading credential", async t => {
  const f = fixture(t); await f.runner.initialize();
  fs.appendFileSync(path.join(f.base, "preflight.json"), " ");
  await assert.rejects(f.runner.next(), /sealed_asset_changed/);
  assert.equal(f.sends(), 0); assert.equal(f.credentialReads(), 0);
});
test("insufficient funds refuse the entire next pair without credentials or sends", async t => {
  const oversized = structuredClone(prepared);
  const target = oversized.requests.requests.find(p => p.caseId === first.caseId);
  for (const r of target.requests) r.input[0].content += "a".repeat(230000);
  const f = fixture(t, { loadPrepared: () => oversized }); await f.runner.initialize();
  const result = await f.runner.next();
  assert.equal(result.stopped, true); assert.equal(f.sends(), 0); assert.equal(f.credentialReads(), 0);
  assert.ok(!f.events().some(e => e.type === "pair-reserved"));
  assert.equal(derive(f.events()).unknown, 551250);
});
test("interrupted write-ahead reservation is never resent; recovery requires technical review", async t => {
  const f = fixture(t); await f.runner.initialize(); await f.runner.next();
  // Simulate a process crash between durable reservation and response recording
  // in this temporary fixture only; no original run files are touched.
  const eventDir = path.join(f.base, "private/events");
  const events = f.events();
  for (const event of events.filter(e => e.sequence > 3))
    fs.unlinkSync(path.join(eventDir, `${String(event.sequence).padStart(6, "0")}.json`));
  fs.rmSync(path.join(f.base, "private/results"), { recursive: true, force: true });
  fs.rmSync(path.join(f.base, "blind"), { recursive: true, force: true });
  await assert.rejects(f.runner.next(), /previous_attempt_requires/);
  const recovered = await f.runner.recover(); assert.equal(recovered.stopped, true);
  await f.accept(); await f.runner.unmask("synthetic interrupted reservation closure");
  assert.equal(f.sends(), 1);
  const state = derive(f.events());
  assert.equal(state.actual, 2587900);
  assert.equal(state.unknown, 551250 + state.attempts[0].projection.centiMicroUSD);
});
test("credential echo and provider exception content never enter diagnostics or result files", async t => {
  const f = fixture(t, { mutate: b => { b.metadata = { note: "OFFLINE-NOT-A-REAL-CREDENTIAL" }; } });
  await f.runner.initialize(); const result = await f.runner.next();
  assert.equal(result.stopped, true);
  const attempt = derive(f.events()).attempts[0];
  const saved = fs.readFileSync(path.join(f.base, attempt.result.responsePath), "utf8");
  assert.ok(!saved.includes("OFFLINE-NOT-A-REAL-CREDENTIAL"));
  assert.ok(!saved.includes("must-not-log-provider-message"));
  assert.equal(attempt.result.measured, null);
});
test("full ordinary response envelope accepts field-specific documented null/defaults without content in diagnostics", () => {
  const full = body(), result = inspectResponse(full, request, reserve(request), 200);
  assert.deepEqual(result.stopReasons, []);
  const fields = result.controls.fields;
  assert.equal(fields.find(f => f.field === "store").comparison, "request-contract-non-echo-fallback");
  assert.equal(fields.find(f => f.field === "store").requestSha256, hash(JSON.stringify(request)));
  assert.equal(fields.find(f => f.field === "reasoning.summary").returned.value, null);
  assert.equal(fields.find(f => f.field === "text.verbosity").returned.value, "medium");
  assert.equal(fields.find(f => f.field === "parallel_tool_calls").returned.value, true);
  assert.equal(fields.find(f => f.field === "temperature").returned.value, 1);
  assert.equal(fields.find(f => f.field === "prompt_cache_key").returned.value, null);
  assert.ok(!JSON.stringify(result.controls).includes("オフライン専用の合成回答"));
  for (const key of ["instructions", "previous_response_id", "conversation", "prompt", "moderation",
    "prompt_cache_key", "prompt_cache_retention", "prompt_cache_diagnostics", "safety_identifier", "user",
    "temperature", "top_p", "max_tool_calls"]) {
    const b = body(); delete b[key]; assert.deepEqual(inspectControls(b, request).stopReasons, []);
  }
  for (const mutate of [
    b => { b.metadata = null; }, b => { b.text.verbosity = null; },
    b => { b.reasoning.context = null; }, b => { b.reasoning.context = "auto"; },
    b => { b.reasoning.mode = "standard"; }, b => { b.parallel_tool_calls = false; },
    b => { b.max_tool_calls = 5; }, b => { b.tool_choice = "none"; },
    b => { b.temperature = null; }, b => { b.top_p = null; }, b => { b.store = false; },
  ]) {
    const b = body(); mutate(b); assert.deepEqual(inspectControls(b, request).stopReasons, []);
  }
});
test("non-null ancillary changes and unknown enums are never generic harmless additions", () => {
  for (const mutate of [
    b => { b.instructions = "DO-NOT-PERSIST"; }, b => { b.conversation = { id: "DO-NOT-PERSIST" }; },
    b => { b.prompt_cache_key = "DO-NOT-PERSIST"; }, b => { b.prompt_cache_retention = "24h"; },
    b => { b.reasoning.summary = "auto"; }, b => { b.reasoning.mode = "pro"; },
    b => { b.reasoning.mode = "future-mode"; }, b => { b.reasoning.context = "current_turn"; },
    b => { b.text.verbosity = "high"; }, b => { b.text.verbosity = "future-verbosity"; },
    b => { b.tool_choice = "required"; }, b => { b.parallel_tool_calls = null; },
    b => { b.tool_choice = { type: "future-tool" }; }, b => { b.max_tool_calls = -1; },
    b => { b.top_logprobs = 10; },
    b => { b.prompt_cache_options.comparison_response_id = "DO-NOT-PERSIST"; },
  ]) {
    const b = body(); mutate(b); const result = inspectResponse(b, request, reserve(request), 200);
    assert.ok(result.stopReasons.length); assert.equal(result.measured, null);
    assert.ok(!JSON.stringify(result.controls).includes("DO-NOT-PERSIST"));
  }
  const knownMismatch = body(); knownMismatch.text.verbosity = "high"; knownMismatch.reasoning.mode = "pro";
  const audit = inspectControls(knownMismatch, request);
  assert.equal(audit.fields.find(f => f.field === "text.verbosity").returned.value, "high");
  assert.equal(audit.fields.find(f => f.field === "reasoning.mode").returned.value, "pro");
  assert.ok(audit.stopReasons.includes("important_control_mismatch"));
});
test("all four new official schemas and source URLs are sealed before any credential read", async t => {
  const f = fixture(t, { bindCode: true }); await f.runner.initialize();
  const auth = JSON.parse(fs.readFileSync(path.join(f.base, "private/authorization.json")));
  const preflight = JSON.parse(fs.readFileSync(path.join(f.base, "preflight.json")));
  for (let i = 0; i < 4; i++) {
    const p = `${OUTPUT}/official-schema-${i}.md`;
    assert.ok(auth.bindings.some(b => b.path === p));
    assert.match(preflight.documentation.find(d => d.path === p).sourceURL, /^https:\/\/raw\.githubusercontent\.com\/openai\/openai-python\//);
  }
  fs.appendFileSync(path.join(f.base, "official-schema-1.md"), " ");
  await assert.rejects(f.runner.next(), /bound_code_docs_or_preflight_changed/);
  assert.equal(f.credentialReads(), 0); assert.equal(f.sends(), 0);
});
test("native sampling is observed, not asserted default; exact numbers or corresponding unset required", () => {
  const controls = b => inspectControls(b, request);
  const a = body(), b = body();
  const audit = controls(a);
  assert.equal(audit.fields.find(f => f.field === "temperature").comparison, "observed-native-sampling");
  assert.equal(audit.fields.find(f => f.field === "top_p").comparison, "observed-native-sampling");
  assert.equal(compareNativeSampling(audit, controls(b)).eligible, true);
  a.temperature = 0; b.temperature = 2;
  assert.equal(compareNativeSampling(controls(a), controls(b)).eligible, false);
  a.temperature = b.temperature = 1; b.top_p = 0.5;
  assert.equal(compareNativeSampling(controls(a), controls(b)).eligible, false);
  a.top_p = b.top_p = 1; b.temperature = null;
  assert.equal(compareNativeSampling(controls(a), controls(b)).eligible, false);
  a.temperature = null;
  assert.equal(compareNativeSampling(controls(a), controls(b)).eligible, true);
  delete b.temperature;
  assert.equal(compareNativeSampling(controls(a), controls(b)).eligible, true);
  b.temperature = "undocumented-native-value";
  assert.equal(compareNativeSampling(controls(a), controls(b)).eligible, false);
  assert.equal(compareNativeSampling(null, controls(a)).eligible, false);
});
test("pair sampling mismatch invalidates second packet before grading, stops, but keeps priced actual usage", async t => {
  for (const mutate of [
    (b, n) => { b.temperature = n === 1 ? 0 : 2; },
    (b, n) => { b.top_p = n === 1 ? 1 : 0.5; },
    (b, n) => { b.temperature = n === 1 ? 1 : null; },
    (b, n) => { if (n === 2) delete b.top_p; },
  ]) {
    const f = fixture(t, { mutate });
    await f.runner.initialize(); await f.runner.next(); await f.accept();
    const result = await f.runner.next(); assert.equal(result.stopped, true);
    const state = derive(f.events()), second = state.attempts[1];
    assert.equal(second.result.pairEligibility.eligible, false);
    assert.equal(second.result.costAccounting, "known-total");
    assert.ok(second.result.measured.centiMicroUSD > 0);
    assert.equal(state.unknown, 551250, "fairness mismatch does not retain an already-priced new reservation");
    assert.equal(state.actual, 2587900 + state.attempts.reduce((sum, a) => sum + a.result.measured.centiMicroUSD, 0));
    const packet = JSON.parse(fs.readFileSync(path.join(f.base, second.result.blindPath)));
    assert.equal(packet.answer.kind, "technical-invalid");
    const saved = JSON.parse(fs.readFileSync(path.join(f.base, second.result.responsePath)));
    assert.deepEqual(saved.costUnknownReasons, []);
    assert.equal(saved.answer, null);
    assert.ok(saved.outputText.length, "content preserved only in deliberate private result");
    await f.accept(); await assert.rejects(f.runner.next(), /continuation_stopped/);
    await f.runner.unmask("synthetic sampling mismatch closure");
    const final = JSON.parse(fs.readFileSync(path.join(f.base, "unmasked/final.json")));
    assert.deepEqual(final.eligiblePairs, []); assert.equal(f.sends(), 2);
  }
});
test("ordinary 1/1 pair and both schema-unset sampling pass the prospective pair rule", async t => {
  for (const mutate of [
    () => {},
    (b, n) => { b.temperature = null; b.top_p = null; if (n === 2) { delete b.temperature; delete b.top_p; } },
  ]) {
    const f = fixture(t, { mutate });
    await f.runner.initialize(); await f.runner.next(); await f.accept();
    const result = await f.runner.next(); assert.equal(result.stopped, false);
    const second = derive(f.events()).attempts[1];
    assert.equal(second.result.pairEligibility.eligible, true);
    assert.equal(second.result.technicalState, "completed-schema");
    await f.accept(); await f.runner.unmask("synthetic comparable pair closure");
    const final = JSON.parse(fs.readFileSync(path.join(f.base, "unmasked/final.json")));
    assert.deepEqual(final.eligiblePairs, [first.caseId]);
  }
});
test("unknown companion sampling stops fairness but keeps independently validated priced usage", async t => {
  const f = fixture(t, { mutate: (b, n) => { if (n === 2) b.temperature = "unknown"; } });
  await f.runner.initialize(); await f.runner.next(); await f.accept();
  assert.equal((await f.runner.next()).stopped, true);
  const second = derive(f.events()).attempts[1];
  assert.equal(second.result.pairEligibility.eligible, false);
  assert.equal(second.result.technicalState, "technical-invalid");
  assert.equal(second.result.costAccounting, "known-total", "unknown native sampling alone does not change token pricing");
  assert.equal(derive(f.events()).unknown, 551250);
  const invalidOtherControl = body(); invalidOtherControl.temperature = "unknown"; invalidOtherControl.service_tier = "unknown";
  assert.equal(inspectResponse(invalidOtherControl, request, reserve(request), 200).costAccounting,
    "unknown-retain-reservation", "other invalid billing controls still retain reservations");
});