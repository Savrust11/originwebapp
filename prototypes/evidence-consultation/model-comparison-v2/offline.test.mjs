// All generated responses/reviews and transport doubles are confined to this file.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { hash, encode, MODELS, ENDPOINT } from "../model-comparison-execution/controls.mjs";
import { ROOT, PREPARATION } from "../model-comparison-execution/runner.mjs";
import { OUTPUT, LIMITS, DECISION, DRIFT, DRIFT_ADDENDUM, DIAGNOSIS, continuation, loadDecision, validateDecision, virtualReportBytes, loadBaseline } from "./baseline.mjs";
import { createRunner, derive, canReserve } from "./runner.mjs";
import { inspectResponse, inspectControls, reserve, screenName, compareNativeSampling, containsCredential } from "./controls.mjs";
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const decision = loadDecision();
const manifest = read(`${DIAGNOSIS}/evidence-manifest.json`);
const before = manifest.protectedFiles.map(p => [p.path, hash(fs.readFileSync(path.join(ROOT, p.path)))]);
const privateExisted = fs.existsSync(path.join(ROOT, OUTPUT, "private"));
after(() => {
  assert.deepEqual(manifest.protectedFiles.map(p => [p.path, hash(fs.readFileSync(path.join(ROOT, p.path)))]), before);
  assert.equal(fs.existsSync(path.join(ROOT, OUTPUT, "private")), privateExisted);
});
const prepared = continuation({
  requests: read(`${PREPARATION}/request-packets.json`), order: read(`${PREPARATION}/execution-order.json`),
  displays: read(`${PREPARATION}/app-display-templates.json`), rubric: read(`${PREPARATION}/rubric.json`),
  freezeSha256: hash(fs.readFileSync(path.join(ROOT, PREPARATION, "final-freeze.json"))), predecessorSnapshot: "offline-fixture-only",
});
const request = prepared.requests.requests.find(p => p.caseId === "C-H06").requests.find(r => r.model === MODELS[0]);
function envelope(r = request) {
  const { input, ...settings } = structuredClone(r);
  const source = JSON.parse(input.find(i => i.role === "user").content).original_evidence[0].original_id;
  return { ...settings, id: "resp_OFFLINE", object: "response", created_at: 1, completed_at: 2,
    reasoning: { effort: "medium", summary: null, generate_summary: null, context: "all_turns", mode: null },
    text: { ...settings.text, format: { ...settings.text.format, description: null }, verbosity: "medium" },
    prompt_cache_options: { mode: "explicit", ttl: "30m", prewarm: false, comparison_response_id: null },
    prompt_cache_key: null, prompt_cache_retention: "24h", prompt_cache_diagnostics: null,
    instructions: null, previous_response_id: null, conversation: null, prompt: null, moderation: null,
    safety_identifier: null, user: null, tool_choice: "auto", parallel_tool_calls: true, max_tool_calls: null,
    temperature: 1, top_p: 0.98, top_logprobs: 0,
    status: "completed", error: null, incomplete_details: null, metadata: {},
    billing: { pricing_details: { extra_value: "PRIVATE-BILLING-VALUE" } },
    frequency_penalty: 0, presence_penalty: 0, routing_metadata: { protocol_version: "PRIVATE-VERSION" },
    output: [
      { id: "rs_OFFLINE", type: "reasoning", status: "completed", summary: [], content: [], encrypted_content: "NEVER-PERSIST-CIPHERTEXT" },
      { id: "msg_OFFLINE", type: "message", role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", annotations: [], logprobs: [], text: JSON.stringify({
          explanations: [{ text: "合成オフライン回答。", original_ids: [source] }],
          limitations: [], abstention: { applies: false, text: "", original_ids: [] },
        }) }] },
    ],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } },
  };
}
const inspect = (b, p = reserve(request)) => inspectResponse(b, request, p, 200);
function reviewFor(packet, bytes) {
  const invalid = packet.answer.kind === "technical-invalid";
  const grade = verdict => ({ verdict, reason: "合成オフラインテスト。" });
  return { schemaVersion: 1, caseId: packet.caseId, label: packet.label, blindPacketSha256: hash(bytes), reviewerType: "AI",
    contextIsolation: { freshContext: true, modelIdentityKnown: false, priorAnswersSeen: false },
    technicalAcknowledged: true, decision: "continue",
    criteria: Object.entries(packet.rubric.case).flatMap(([group, items]) => items.map((_, index) => ({
      group, index, verdict: invalid ? "not-assessable" : "pass", reason: "合成テスト。" }))),
    layers: { bodyMeaning: grade(invalid ? "not-assessable" : "pass"),
      bodyQuestionCoverage: grade(invalid ? "not-assessable" : "pass"),
      bodyAttributionPresence: grade(invalid ? "not-assessable" : "correct"),
      bodyCompleteness: grade(invalid ? "not-assessable" : "complete"), appDisplay: grade("pass"),
      wholeScreenMeaning: grade(invalid ? "not-assessable" : "pass"), surfaceQuality: grade(invalid ? "not-assessable" : "pass") },
    questionCoverage: [{ element: "合成質問", verdict: invalid ? "not-assessable" : "answered", reason: "合成テスト。" }],
    readability: packet.rubric.global.japaneseReadability.dimensions.map(dimension => ({
      dimension, verdict: invalid ? "not-assessable" : "pass", reason: "合成テスト。" })),
    limitations: "合成オフライン評価。実評価に使用しない。" };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comparison-v2-offline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, OUTPUT);
  fs.mkdirSync(path.join(base, "preflight"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, DECISION), path.join(base, "preflight/evidence-accounting-decision.json"));
  let sends = 0, credentialReads = 0;
  const events = () => fs.existsSync(path.join(base, "private/events"))
    ? fs.readdirSync(path.join(base, "private/events")).sort().map(n => JSON.parse(fs.readFileSync(path.join(base, "private/events", n)))) : [];
  const make = () => createRunner({ root, bindCode: false, loadPrepared: () => prepared,
    decisionLoader: () => options.decision ?? structuredClone(decision), coin: () => 0,
    readCredential: () => { credentialReads++; return "OFFLINE-CREDENTIAL-NEVER-LOG"; },
    fetchImpl: async (url, init) => {
      sends++;
      assert.equal(url, ENDPOINT); assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
      const planned = prepared.order.attempts[sends - 1];
      const expected = prepared.requests.requests.find(p => p.caseId === planned.caseId).requests.find(r => r.model === planned.model);
      assert.equal(init.body, JSON.stringify(expected));
      assert.equal(events().at(-1).type, "transmission-reserved");
      assert.equal(events().at(-1).data.requestSha256, hash(init.body));
      if (options.transportError) throw new Error("PRIVATE-PROVIDER-ERROR");
      const b = envelope(JSON.parse(init.body)); options.mutate?.(b, sends);
      if (options.wait) await options.wait;
      return new Response(JSON.stringify(b), { status: 200 });
    } });
  const runner = make();
  const accept = async (mutate = () => {}) => {
    const s = await runner.status(), bytes = fs.readFileSync(path.join(base, s.awaitingReview)), packet = JSON.parse(bytes);
    const review = reviewFor(packet, bytes); mutate(review);
    const source = path.join(root, "synthetic-review.json"); fs.writeFileSync(source, encode(review));
    return runner.review(packet.caseId, packet.label, source);
  };
  const diagnostic = () => readLocal(path.join(base, derive(events()).attempts.at(-1).result.diagnosticPath));
  return { root, base, runner, make, events, accept, diagnostic, sends: () => sends, credentials: () => credentialReads };
}
const readLocal = p => JSON.parse(fs.readFileSync(p, "utf8"));
test("network and listeners blocked, no real secret/runtime loaded", () => {
  assert.throws(() => fetch("https://invalid.example"), /offline_network/);
  assert.throws(() => net.createServer().listen(0), /offline_network/);
});
test("independent memo is loaded and validates separate H06 completion/cost", () => {
  assert.equal(validateDecision(decision).h06Sol.comparisonEligibility, false);
  for (const mutate of [d => d.h06Sol.comparisonEligibility = true,
    d => d.accountingCorrection.correctedOpeningBalance.knownCentiMicroUSD++,
    d => d.accountingCorrection.q10.reservationReplaced = true]) {
    const d = structuredClone(decision); mutate(d); assert.throws(() => validateDecision(d));
  }
});
test("exact remaining order and model-only frozen payload difference", () => {
  assert.equal(prepared.order.attempts.length, 21);
  assert.deepEqual(prepared.order.attempts.map(a => [a.caseId, a.model]),
    read(`${PREPARATION}/execution-order.json`).attempts.slice(3).map(a => [a.caseId, a.model]));
  for (const p of prepared.requests.requests) {
    const [{ model: a, ...x }, { model: b, ...y }] = p.requests;
    assert.notEqual(a, b); assert.deepEqual(x, y); p.requests.forEach(reserve);
  }
});
test("three exact 16-copy report projections preserve original hashes without writes", () => {
  const proof = read(DRIFT);
  for (const entry of proof.mismatches) {
    const bytes = virtualReportBytes(ROOT, entry.path, proof);
    assert.equal(hash(bytes), entry.expectedSha256); assert.equal(bytes.length, entry.expectedBytes);
  }
  assert.equal(manifest.protectedFiles.filter(p => hash(fs.readFileSync(path.join(ROOT, p.path))) === p.sha256).length, 77);
});
test("four historical presentation projections verify all 64 copies and real baseline loads", () => {
  const proof = read(DRIFT), addendum = read(DRIFT_ADDENDUM);
  for (const entry of addendum.paths) {
    const bytes = virtualReportBytes(ROOT, entry.path, proof, addendum);
    assert.equal(hash(bytes), entry.expectedSha256); assert.equal(bytes.length, entry.expectedBytes);
  }
  const real = loadBaseline();
  assert.equal(real.order.attempts.length, 21);
  assert.equal(real.decision.h06Sol.comparisonEligibility, false);
  assert.equal(real.decision.accountingCorrection.correctedOpeningBalance.totalCentiMicroUSD, 6555550);
});
test("realistic full envelope/new SDK fields/C extras do not stop or erase cost", () => {
  const r = inspect(envelope());
  assert.deepEqual(r.stopReasons, []); assert.equal(r.technicalState, "completed-schema");
  assert.equal(r.measured.centiMicroUSD, 4400); assert.equal(r.metadataState, "metadata-unresolved");
  assert.ok(r.controls.unknown.some(u => u.path === "$.routing_metadata"));
  assert.equal(r.outputStructure[0].encryptedContent.length, 24);
  assert.equal(r.outputStructure[1].phase.value, "final_answer");
  assert.equal(r.providerStatus.value, "completed");
  assert.ok(!JSON.stringify(r).includes("NEVER-PERSIST-CIPHERTEXT"));
  assert.ok(!JSON.stringify(r).includes("PRIVATE-BILLING-VALUE"));
});
test("C unknown usage breakdown preserves known numeric accounting", () => {
  const b = envelope(); b.usage.extra_details = { pricing_metadata: "PRIVATE" };
  b.usage.input_tokens_details.additional_tokens = 0;
  const r = inspect(b); assert.deepEqual(r.stopReasons, []); assert.equal(r.measured.centiMicroUSD, 4400);
  assert.ok(r.controls.unknown.some(u => u.nameSha256 === hash("additional_tokens")
    && (u.path.includes("additional_tokens") || u.safetyClassification.startsWith("redacted-"))));
});
for (const [name, mutate] of [
  ["actual different model", b => b.model = MODELS[1]], ["store", b => b.store = true],
  ["tier", b => b.service_tier = "priority"], ["cache mode", b => b.prompt_cache_options.mode = "implicit"],
  ["cache usage", b => b.usage.input_tokens_details.cached_tokens = 1],
  ["prewarm", b => b.prompt_cache_options.prewarm = true],
  ["tools", b => b.output.push({ type: "function_call", name: "arbitrary", arguments: "PRIVATE" })],
  ["background", b => b.background = true], ["effort", b => b.reasoning.effort = "high"],
]) test(`A required violation: ${name}`, () => {
  const b = envelope(); mutate(b); const r = inspect(b);
  assert.ok(r.stopReasons.some(r => r.startsWith("A:")));
  if (name === "actual different model") assert.equal(r.measured.centiMicroUSD, 80000);
  if (name === "store") assert.equal(r.measured.centiMicroUSD, 4400);
  if (name === "tier") { assert.equal(r.measured, null); assert.equal(r.computedTokenCost.centiMicroUSD, 4400); }
});
for (const [name, mutate] of [
  ["missing usage", b => delete b.usage], ["missing known breakdown", b => delete b.usage.input_tokens_details.cache_write_tokens],
  ["inconsistent usage", b => b.usage.total_tokens++], ["unknown actual price", b => b.model = "unpriced"],
  ["missing required cache evidence", b => delete b.prompt_cache_options.mode],
]) test(`B unusable evidence: ${name}`, () => {
  const b = envelope(); mutate(b); const r = inspect(b);
  assert.ok(r.stopReasons.some(r => r.startsWith("B:"))); assert.equal(r.retainReservation, true);
});
test("bound overrun keeps actual amount plus only reserve remainder, never erases cost", () => {
  const r = inspect(envelope(), { inputTokenBound: 50, outputTokenBound: 1500, centiMicroUSD: 100 });
  assert.equal(r.measured.centiMicroUSD, 4400); assert.ok(r.stopReasons.includes("B:reservation_bound_exceeded"));
});
test("$1 admission includes both pair reservations and accepts exact ceiling only", () => {
  const state = { actual: 6004300, unknown: 551250, pendingPairReserve: 0 };
  assert.equal(canReserve(state, [{ centiMicroUSD: 50000000 }, { centiMicroUSD: 43444450 }]), true);
  assert.equal(canReserve(state, [{ centiMicroUSD: 50000000 }, { centiMicroUSD: 43444451 }]), false);
  assert.equal(canReserve(state, [{ centiMicroUSD: NaN }]), false);
  assert.equal(canReserve({ ...state, pendingPairReserve: 1 }, [{ centiMicroUSD: 93444450 }]), false);
});
test("B accounting retains at least reservation without double settlement", () => {
  const events = [{ type: "transmission-reserved", data: { attempt: 1, projection: { centiMicroUSD: 10000 } } },
    { type: "response-recorded", data: { attempt: 1, measured: { centiMicroUSD: 4400 }, costAccounting: "known-total", retainReservation: true } }];
  const s = derive(events);
  assert.equal(s.actual, 6004300 + 4400); assert.equal(s.unknown, 551250 + 5600);
  assert.equal(s.actual + s.unknown, 6555550 + 10000);
});
test("known names at unknown hierarchy are still C with exact safe path", () => {
  const b = envelope(); b.output[1].billing = { usage: 123 };
  const r = inspect(b);
  assert.deepEqual(r.stopReasons, []);
  assert.ok(r.controls.unknown.some(u => u.path === "$.output[1].billing.usage"));
});
test("C additions across envelope, controls, metadata and output retain cost and valid answer", () => {
  for (const mutate of [
    b => b.processing_metadata = { engine_version: "opaque" },
    b => b.reasoning.routing_metadata = { protocol_version: "opaque" },
    b => b.prompt_cache_options.billing_metadata = { unit_details: 123 },
    b => b.text.format.routing_metadata = "opaque",
    b => b.output[0].routing_metadata = ["opaque"],
    b => b.output[1].content[0].routing_metadata = "opaque",
    b => b.metadata = { "unsafe free text": "opaque" },
    b => b.usage.output_tokens_details.processing_metadata = 123,
  ]) {
    const b = envelope(); mutate(b); const r = inspect(b);
    assert.deepEqual(r.stopReasons, []); assert.equal(r.measured.centiMicroUSD, 4400);
    assert.equal(r.technicalState, "completed-schema"); assert.equal(r.metadataState, "metadata-unresolved");
  }
});
test("legacy retention 24h and cache TTL30m remain distinct exact evidence", () => {
  const r = inspect(envelope());
  assert.equal(r.controls.fields.find(f => f.field === "prompt_cache_retention").returned.value, "24h");
  assert.equal(r.controls.fields.find(f => f.field === "prompt_cache_options.ttl").returned.value, "30m");
  const b = envelope(); b.prompt_cache_options.ttl = "24h";
  assert.ok(inspect(b).stopReasons.length);
});
test("exact frozen schema mismatch is a real required setting contradiction", () => {
  const b = envelope(); b.text.format.schema.additionalProperties = true;
  assert.ok(inspect(b).stopReasons.includes("A:required_setting:text.format.schema"));
});
for (const [name, mutate] of [
  ["provider incomplete", b => { b.status = "incomplete"; b.incomplete_details = { reason: "max_output_tokens" }; }],
  ["message incomplete", b => b.output[1].status = "incomplete"],
  ["bad schema", b => b.output[1].content[0].text = "{}"],
  ["unknown output type", b => b.output.push({ type: "future_unknown" })],
]) test(`case-only technical failure: ${name}`, () => {
  const b = envelope(); mutate(b); const r = inspect(b);
  assert.deepEqual(r.stopReasons, []); assert.equal(r.technicalState, "technical-invalid"); assert.ok(r.measured);
});
test("name screening rejects credentials, PII, prose, high entropy and source echoes, not merely regex", () => {
  assert.equal(screenName("billing"), "public-schema-name");
  assert.equal(screenName("routing_metadata"), "screened-machine-identifier");
  for (const name of ["john_smith", "jane@example.com", "secret_value", "api_key", "access_token", "family_name",
    "a".repeat(100), "please save my prompt", "routing_a7b8c9d123456"])
    assert.match(screenName(name), /^redacted/);
  assert.equal(screenName("routing_metadata", { sensitiveText: "routing metadata is prompt text" }), "redacted-source-fragment");
  assert.equal(screenName("routing_metadata", { credential: "routing_metadata" }), "redacted-credential");
  const b = envelope(); b["jane@example.com"] = "SECRET_VALUE";
  b.routing_metadata["person name"] = { billing: "PRIVATE" };
  const r = inspect(b), encoded = JSON.stringify(r);
  assert.ok(!encoded.includes("jane@example.com")); assert.ok(!encoded.includes("person name"));
  assert.ok(r.controls.unknown.some(u => u.path.includes("<redacted:") && u.name === "billing"));
  assert.ok(!encoded.includes("SECRET_VALUE"));
});
test("credential echo anywhere including decoded key is detected", () => {
  assert.equal(containsCredential({ "part-OFFLINE-KEY": "x" }, "OFFLINE-KEY"), true);
  assert.equal(containsCredential({ text: ["OFFLINE-KEY"] }, "OFFLINE-KEY"), true);
  const b = envelope(); b.metadata.credential = "OFFLINE-KEY";
  assert.throws(() => inspectResponse(b, request, reserve(request), 200, { credential: "OFFLINE-KEY" }), /credential_echo/);
});
test("status/init no credential or sends; opening correction once; summaries blinded", async t => {
  const f = fixture(t); await f.runner.status(); await f.runner.initialize();
  assert.equal(f.sends(), 0); assert.equal(f.credentials(), 0);
  assert.ok(!/model|usage|cost|microUSD|luna|sol/i.test(JSON.stringify(await f.runner.status())));
  assert.equal(f.events().filter(e => e.type === "opening-accounting-correction").length, 1);
  assert.deepEqual([derive(f.events()).actual, derive(f.events()).unknown], [6004300, 551250]);
});
test("21 calls only, 42/43 total, every fresh review freezes before next, H06 reference only", async t => {
  const f = fixture(t); await f.runner.initialize();
  for (let i = 0; i < 21; i++) {
    const s = await f.make().next(); assert.equal(s.cumulativeTransmissions, 22 + i);
    await assert.rejects(f.runner.next(), /previous_attempt_requires/);
    await assert.rejects(f.runner.unmask("offline early unmask"), /unmask_requires_all/);
    await f.accept();
  }
  await assert.rejects(f.runner.next(), /transmission_limit/);
  assert.equal(f.sends(), 21); assert.equal(f.credentials(), 21);
  const state = derive(f.events()); assert.equal(state.pendingPairReserve, 0);
  assert.ok(state.actual + state.unknown < 100000000); assert.equal(state.unknown, 551250);
  const closed = await f.runner.unmask("offline completed fixtures only");
  assert.equal(closed.cumulativeTransmissions, 42);
  const final = readLocal(path.join(f.base, "unmasked/final.json"));
  assert.equal(final.eligiblePairs.length, 10); assert.ok(!final.eligiblePairs.includes("C-H06"));
  assert.equal(f.events().filter(e => e.type === "pair-reserved").length, 11);
  assert.equal(f.events().find(e => e.type === "pair-reserved").data.projections.length, 1);
});
test("technical invalid still requires review and does not stop independent next", async t => {
  const f = fixture(t, { mutate: b => { b.status = "incomplete"; b.incomplete_details = { reason: "max_output_tokens" }; } });
  await f.runner.initialize(); const s = await f.runner.next(); assert.equal(s.stopped, false);
  await f.accept(); await f.runner.next(); assert.equal(f.sends(), 2);
});
test("native mismatch is pair fairness failure only; both bodies still reviewable", async t => {
  const f = fixture(t, { mutate: (b, n) => { if (n === 3) b.top_p = 0.9; } });
  await f.runner.initialize();
  for (let i = 0; i < 3; i++) { await f.runner.next(); await f.accept(); }
  assert.equal(f.diagnostic().pairEligibility.eligible, false);
  assert.equal(f.diagnostic().technicalState, "completed-schema");
  assert.equal((await f.runner.status()).stopped, false);
  await f.runner.next(); assert.equal(f.sends(), 4);
});
test("bad semantic review is case-only unless explicit decision stop", async t => {
  const f = fixture(t); await f.runner.initialize(); await f.runner.next();
  await f.accept(r => { r.layers.bodyMeaning.verdict = "fail"; r.layers.wholeScreenMeaning.verdict = "fail"; r.layers.surfaceQuality.verdict = "fail"; });
  await f.runner.next(); assert.equal(f.sends(), 2);
});
test("transport failure zero retries, reserved charge, technical review then stopped", async t => {
  const f = fixture(t, { transportError: true }); await f.runner.initialize(); await f.runner.next();
  assert.equal(f.sends(), 1); assert.ok(derive(f.events()).unknown > 551250);
  await f.accept(); await assert.rejects(f.runner.next(), /continuation_stopped/);
});
test("credential echo body never reaches any persisted asset", async t => {
  const f = fixture(t, { mutate: b => b.routing_metadata["OFFLINE-CREDENTIAL-NEVER-LOG"] = "unsafe" });
  await f.runner.initialize(); await f.runner.next(); assert.equal(f.sends(), 1);
  const walk = p => fs.readdirSync(p).every(n => fs.statSync(path.join(p, n)).isDirectory() ? walk(path.join(p, n))
    : !fs.readFileSync(path.join(p, n), "utf8").includes("OFFLINE-CREDENTIAL-NEVER-LOG"));
  assert.equal(walk(f.base), true);
});
test("shared legacy lock prevents concurrency during awaited POST", async t => {
  let release; const wait = new Promise(r => { release = r; });
  const f = fixture(t, { wait }); await f.runner.initialize();
  const pending = f.runner.next();
  await new Promise(r => setImmediate(r));
  await assert.rejects(f.make().next(), /EEXIST/); assert.equal(f.sends(), 1);
  release(); await pending;
});
test("tampered frozen review/decision and broken event chain fail closed", async t => {
  const f = fixture(t); await f.runner.initialize(); await f.runner.next(); await f.accept();
  const last = f.events().at(-1);
  fs.appendFileSync(path.join(f.base, last.assets[0].path), " ");
  await assert.rejects(f.runner.next(), /sealed_asset_changed/); assert.equal(f.sends(), 1);
});
test("reviews reject reused context, wrong packet hash and passing technical invalid", async t => {
  const f = fixture(t, { mutate: b => b.status = "incomplete" });
  await f.runner.initialize(); await f.runner.next();
  await assert.rejects(f.accept(r => r.contextIsolation.freshContext = false), /review_not_blind/);
  await assert.rejects(f.accept(r => r.blindPacketSha256 = "0".repeat(64)), /review_binding_invalid/);
  await assert.rejects(f.accept(r => r.layers.bodyMeaning.verdict = "pass"), /invalid_answer_cannot_pass/);
  assert.equal(f.sends(), 1); await f.accept();
});
test("explicit reviewer stop blocks further calls after freezing review", async t => {
  const f = fixture(t); await f.runner.initialize(); await f.runner.next();
  await f.accept(r => r.decision = "stop");
  await assert.rejects(f.runner.next(), /continuation_stopped/); assert.equal(f.sends(), 1);
});
for (const kind of ["A", "B", "reviewer"]) test(`crash after durable ${kind} failure before global-stop cannot resume`, async t => {
  const f = fixture(t, { mutate: b => {
    if (kind === "A") b.store = true;
    if (kind === "B") delete b.usage;
  } });
  await f.runner.initialize(); await f.runner.next();
  if (kind === "reviewer") await f.accept(r => r.decision = "stop");
  // Remove only the trailing redundant stop event in this disposable journal.
  // The durable response/review, all hashes, assets and preceding chain remain.
  const events = f.events(), last = events.at(-1);
  assert.equal(last.type, "global-stop");
  fs.unlinkSync(path.join(f.base, `private/events/${String(events.length).padStart(6, "0")}.json`));
  assert.equal(f.events().some(e => e.type === "global-stop"), false);
  assert.equal((await f.make().status()).stopped, true);
  if (kind !== "reviewer") await f.accept();
  await assert.rejects(f.make().next(), /continuation_stopped/);
  assert.equal(f.sends(), 1); assert.equal(f.credentials(), 1);
});
test("A required violation stops but known actual cost settles exactly once", async t => {
  const f = fixture(t, { mutate: b => b.store = true }); await f.runner.initialize(); await f.runner.next();
  const s = derive(f.events()); assert.equal(s.actual, 6004300 + 4400); assert.equal(s.unknown, 551250);
  await f.accept(); await assert.rejects(f.runner.next(), /continuation_stopped/);
  await f.runner.status(); assert.equal(derive(f.events()).actual, s.actual);
});
test("unknown usage stops and keeps full new reservation plus inherited Q10 only", async t => {
  const f = fixture(t, { mutate: b => delete b.usage }); await f.runner.initialize(); await f.runner.next();
  const s = derive(f.events()); assert.equal(s.actual, 6004300);
  assert.equal(s.unknown, 551250 + s.attempts[0].projection.centiMicroUSD);
  await f.accept(); await assert.rejects(f.runner.next(), /continuation_stopped/);
});
test("recovery never resends reserved uncertain outcome and requires its review", async t => {
  const f = fixture(t); await f.runner.initialize(); await f.runner.next();
  // Simulate crash after write-ahead in a disposable fixture only.
  const e = f.events(), resultIndex = e.findIndex(e => e.type === "response-recorded");
  for (let i = resultIndex; i < e.length; i++) {
    for (const a of e[i].assets) fs.unlinkSync(path.join(f.base, a.path));
    fs.unlinkSync(path.join(f.base, `private/events/${String(i + 1).padStart(6, "0")}.json`));
  }
  await f.runner.recover(); assert.equal(f.sends(), 1);
  await f.accept(); await assert.rejects(f.runner.next(), /continuation_stopped/);
});