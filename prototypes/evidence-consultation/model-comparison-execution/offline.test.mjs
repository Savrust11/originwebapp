// OFFLINE ONLY. Production fetch and environment access are never invoked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ENDPOINT, MODELS, RATES, LIMITS, hash, encode, reserve, measureUsage, inspectResponse,
  blindPacket, validateReview,
} from "./controls.mjs";
import { ROOT, OUTPUT, loadPreparation, createRunner, withSharedLock, writeOnce } from "./runner.mjs";

const prepared = loadPreparation();
const attempt = prepared.order.attempts[0];
const request = prepared.requests.requests.find(v => v.caseId === attempt.caseId)
  .requests.find(v => v.model === attempt.model);
const sourceId = JSON.parse(request.input[1].content).original_evidence[0].original_id;
const answer = { explanations: [{ text: "Offline test fixture.", original_ids: [sourceId] }],
  limitations: [], abstention: { applies: false, text: "", original_ids: [] } };
function body(req = request, options = {}) {
  return {
    model: req.model, service_tier: "default", status: "completed",
    usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 50 } },
    output: [{ type: "reasoning", summary: [] }, {
      type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(answer), annotations: [] }],
    }], ...options,
  };
}
function reviewFor(packet, bytes = encode(packet)) {
  const invalid = packet.answer.kind === "technical-invalid";
  const layer = verdict => ({ verdict, reason: "Offline fixture rationale only." });
  return {
    schemaVersion: 1, caseId: packet.caseId, label: packet.label, blindPacketSha256: hash(bytes),
    reviewerType: "AI", contextIsolation: { freshContext: true, modelIdentityKnown: false, priorAnswersSeen: false },
    technicalAcknowledged: true, decision: "continue",
    criteria: Object.entries(packet.rubric.case).flatMap(([group, items]) => items.map((_, index) => ({
      group, index, verdict: invalid ? "not-assessable" : "pass", reason: "Offline fixture rationale only.",
    }))),
    layers: {
      bodyMeaning: layer(invalid ? "not-assessable" : "pass"),
      bodyQuestionCoverage: layer(invalid ? "not-assessable" : "pass"),
      bodyAttributionPresence: layer(invalid ? "not-assessable" : "correct"),
      bodyCompleteness: layer(invalid ? "not-assessable" : "complete"),
      appDisplay: layer("pass"), wholeScreenMeaning: layer(invalid ? "not-assessable" : "pass"),
      surfaceQuality: layer(invalid ? "not-assessable" : "pass"),
    },
    questionCoverage: [{ element: "Offline fixture question.", verdict: invalid ? "not-assessable" : "answered",
      reason: "Offline fixture rationale only." }],
    readability: packet.rubric.global.japaneseReadability.dimensions.map(dimension => ({
      dimension, verdict: invalid ? "not-assessable" : "pass", reason: "Offline fixture rationale only.",
    })),
    limitations: "Offline fixture; not a real judgment or production result.",
  };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comparison-offline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, OUTPUT);
  fs.mkdirSync(path.join(base, "preflight"), { recursive: true });
  for (const name of ["current-pricing.json", "official-0.md", "official-1.md", "official-2.md"])
    fs.copyFileSync(path.join(ROOT, OUTPUT, "preflight", name), path.join(base, "preflight", name));
  let sends = 0, credentialReads = 0;
  const fetchImpl = async (url, init) => {
    sends++;
    assert.equal(url, ENDPOINT);
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const events = fs.readdirSync(path.join(base, "private/events")).sort()
      .map(name => JSON.parse(fs.readFileSync(path.join(base, "private/events", name))));
    assert.equal(events.at(-1).type, "transmission-reserved", "durable reservation precedes fetch");
    const sent = JSON.parse(init.body), response = options.respond ? options.respond(sent, init) : body(sent);
    return new Response(JSON.stringify(response), { status: options.httpStatus ?? 200 });
  };
  const runner = createRunner({
    root, loadPrepared: options.loadPrepared ?? (() => prepared), bindCode: false,
    coin: options.coin ?? (() => 0),
    readCredential: () => { credentialReads++; return "offline-fixture-credential-not-a-secret"; },
    fetchImpl: options.fetchImpl ?? fetchImpl,
  });
  const accept = () => {
    const status = runner.status(), packetPath = path.join(base, status.awaitingReview);
    const bytes = fs.readFileSync(packetPath), packet = JSON.parse(bytes);
    const source = path.join(root, "review.json");
    fs.writeFileSync(source, encode(reviewFor(packet, bytes)));
    return runner.acceptReview(packet.caseId, packet.label, source);
  };
  return { root, base, runner, accept, sends: () => sends, credentialReads: () => credentialReads };
}

test("frozen preparation and all history verify read-only", () => {
  assert.equal(prepared.order.attempts.length, 24);
  assert.equal(prepared.requests.requests.length, 12);
});
test("UTF8 bounds and highest cache-write reserves replace the unverified 8000 assumption", () => {
  const r = reserve(request);
  assert.equal(r.inputTokenBound, Buffer.byteLength(JSON.stringify(request)) + 2048);
  assert.equal(r.centiMicroUSD, r.inputTokenBound * RATES[request.model].cacheWrite * 100 + 1500 * RATES[request.model].output * 100);
  assert.ok(r.inputTokenBound > 8000);
});
test("exact accounting includes writes and reasoning only once, without rounding", () => {
  const usage = { input_tokens: 7, output_tokens: 3, total_tokens: 10,
    input_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
    output_tokens_details: { reasoning_tokens: 2 } };
  assert.equal(measureUsage(usage, MODELS[0]).centiMicroUSD, 469);
  assert.equal(measureUsage(usage, MODELS[1]).centiMicroUSD, 8180);
});
test("unknown cache accounting, inconsistent totals and unpriced models refuse", () => {
  for (const mutate of [
    v => { delete v.input_tokens_details.cache_write_tokens; },
    v => { v.input_tokens_details.unknown_tokens = 0; },
    v => { v.output_tokens_details.unknown_tokens = 0; },
    v => { v.total_tokens++; },
    v => { v.input_tokens = -1; },
  ]) {
    const usage = structuredClone(body().usage); mutate(usage);
    assert.throws(() => measureUsage(usage, MODELS[0]));
  }
  assert.throws(() => measureUsage(body().usage, "unpriced"));
});
test("technical incomplete and schema mismatch with known usage are not global failures", () => {
  const incomplete = inspectResponse(body(request, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    request, reserve(request), 200);
  assert.equal(incomplete.technicalState, "technical-invalid");
  assert.equal(incomplete.incompleteReason, "max_output_tokens");
  assert.deepEqual(incomplete.stopReasons, []);
  const mismatch = body(); mismatch.output[1].content[0].text = '{"unexpected":true}';
  const checked = inspectResponse(mismatch, request, reserve(request), 200);
  assert.equal(checked.technicalState, "technical-invalid");
  assert.ok(checked.measured);
  assert.deepEqual(checked.stopReasons, []);
});
test("model, tier, tools, cache and authorization anomalies globally stop", () => {
  const variants = [
    { model: "unknown" }, { service_tier: "flex" }, { tools: [{ type: "web_search" }] },
    { output: [{ type: "web_search_call" }] }, { error: { type: "authentication_error" } },
    { usage: { ...body().usage, input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 } } },
  ];
  for (const variant of variants)
    assert.ok(inspectResponse(body(request, variant), request, reserve(request), 200).stopReasons.length);
  assert.equal(inspectResponse(body(request, { model: "unknown" }), request, reserve(request), 200).measured, null);
});
test("initialization and status are offline; private independent mapping and immutable authorization", t => {
  const f = fixture(t); f.runner.initialize();
  assert.equal(f.sends(), 0); assert.equal(f.credentialReads(), 0);
  f.runner.status(); assert.equal(f.credentialReads(), 0);
  const mapping = JSON.parse(fs.readFileSync(path.join(f.base, "private/mapping.json"))).mapping;
  for (const pair of prepared.order.pairs) {
    assert.equal(mapping[pair.caseId][MODELS[0]], "X");
    assert.equal(mapping[pair.caseId][MODELS[1]], "Y");
  }
  assert.ok(prepared.order.pairs.some(p => mapping[p.caseId][p.modelOrder[0]] === "X"));
  assert.ok(prepared.order.pairs.some(p => mapping[p.caseId][p.modelOrder[0]] === "Y"));
  assert.equal(fs.statSync(path.join(f.base, "private")).mode & 0o777, 0o700);
  assert.throws(() => f.runner.initialize(), /already_initialized/);
});
test("one next sends exactly once; review gate applies even to second answer of pair", async t => {
  const f = fixture(t); f.runner.initialize();
  let s = await f.runner.next();
  assert.equal(f.sends(), 1); assert.equal(s.newTransmissions, 1); assert.equal(s.cumulativeTransmissions, 20);
  assert.match(s.awaitingReview, /^blind\/C-K10\/[XY]\/packet.json$/);
  await assert.rejects(f.runner.next(), /previous_attempt_requires_frozen_blind_review/);
  assert.equal(f.sends(), 1);
  assert.throws(() => f.runner.unmask("Premature closure."), /all_attempted_reviews/);
  f.accept();
  s = await f.runner.next(); assert.equal(f.sends(), 2);
  await assert.rejects(f.runner.next(), /previous_attempt_requires_frozen_blind_review/);
  f.accept();
  const final = f.runner.unmask("Offline test closes after one pair.");
  assert.equal(final.closed, true);
  const unmasked = JSON.parse(fs.readFileSync(path.join(f.base, final.unmaskedFile)));
  assert.equal(unmasked.unexecuted.length, 22);
  assert.ok(unmasked.unexecuted.every(a => a.explanation.length > 8));
  await assert.rejects(f.runner.next(), /globally_stopped/);
});
test("blind packets contain full original question, exact template and rubric, no operator metadata", () => {
  const result = inspectResponse(body(), request, reserve(request), 200);
  const packet = blindPacket(prepared, attempt, "Y", result);
  assert.deepEqual(packet.originalEvidence, JSON.parse(request.input[1].content).original_evidence);
  assert.equal(packet.question, JSON.parse(request.input[1].content).question);
  assert.deepEqual(packet.applicationTemplate, prepared.displays.appDisplays.find(v => v.caseId === attempt.caseId));
  assert.deepEqual(packet.rubric.case, prepared.rubric.cases[attempt.caseId]);
  for (const forbidden of ["gpt-5.6", "elapsedMs", "microUSD", "input_tokens", "requestSha256", "modelOrder", "attempt:"])
    assert.ok(!JSON.stringify(packet).includes(forbidden), forbidden);
});
test("reviews require every criterion, every Japanese dimension, exact hash, and model-free fields", () => {
  const packet = blindPacket(prepared, attempt, "X", inspectResponse(body(), request, reserve(request), 200));
  const valid = reviewFor(packet);
  validateReview(valid, packet, hash(encode(packet)));
  for (const mutate of [
    v => { v.criteria.pop(); }, v => { v.readability.pop(); }, v => { v.model = MODELS[0]; },
    v => { v.limitations = "gpt-5.6-sol"; }, v => { v.contextIsolation.modelIdentityKnown = true; },
    v => { v.blindPacketSha256 = "wrong"; }, v => { v.layers.bodyMeaning.verdict = "fail"; },
  ]) {
    const review = structuredClone(valid); mutate(review);
    assert.throws(() => validateReview(review, packet, hash(encode(packet))));
  }
});
test("known technical failure must be reviewed, then may continue without retry", async t => {
  const f = fixture(t, { respond: req => body(req, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }) });
  f.runner.initialize();
  const s = await f.runner.next(); assert.equal(s.stopped, false);
  const packet = JSON.parse(fs.readFileSync(path.join(f.base, s.awaitingReview)));
  assert.equal(packet.answer.kind, "technical-invalid");
  assert.ok(!JSON.stringify(packet).includes("max_output_tokens"));
  await assert.rejects(f.runner.next(), /review/);
  f.accept(); await f.runner.next(); assert.equal(f.sends(), 2);
});
test("unknown transport outcomes retain reserve, require acknowledgment, never resume or retry", async t => {
  let sends = 0;
  const f = fixture(t, { fetchImpl: async () => { sends++; throw new Error("offline simulated timeout"); } });
  f.runner.initialize(); const s = await f.runner.next();
  assert.equal(s.stopped, true); assert.equal(s.newTransmissions, 1);
  assert.ok(s.unknownAttemptReserveCentiMicroUSD > 0);
  assert.throws(() => f.runner.unmask("Cannot unmask before acknowledgment."), /reviews_frozen/);
  f.accept(); await assert.rejects(f.runner.next(), /globally_stopped/); assert.equal(sends, 1);
  assert.equal(f.runner.unmask("Offline transport unknown acknowledged.").closed, true);
});
test("authentication and inaccessible model response stop without fallback", async t => {
  const f = fixture(t, { httpStatus: 403, respond: () => ({ error: { type: "permission_error", code: "model_not_found" } }) });
  f.runner.initialize(); const s = await f.runner.next(); assert.equal(s.stopped, true);
  f.accept(); await assert.rejects(f.runner.next(), /globally_stopped/); assert.equal(f.sends(), 1);
});
test("pair-level admission refuses BOTH packets when full source pair cannot fit", async t => {
  const large = structuredClone(prepared);
  const first = large.requests.requests.find(v => v.caseId === attempt.caseId);
  first.requests.forEach(req => { req.input[0].content += "a".repeat(190000); });
  const f = fixture(t, { loadPrepared: () => large });
  f.runner.initialize(); const s = await f.runner.next();
  assert.equal(s.stopped, true); assert.equal(f.sends(), 0); assert.equal(f.credentialReads(), 0);
  assert.equal(s.newTransmissions, 0);
});
test("all 24 maximum attempts are explicit calls and every answer is reviewed", async t => {
  const f = fixture(t); f.runner.initialize();
  for (let i = 0; i < 24; i++) {
    const s = await f.runner.next(); assert.equal(s.newTransmissions, i + 1);
    f.accept();
  }
  assert.equal(f.sends(), 24);
  await assert.rejects(f.runner.next(), /transmission_limit/);
  assert.equal(f.sends(), 24);
  assert.equal(f.runner.status().cumulativeTransmissions, 43);
});
test("response raw hash, sanitized hash and sealed reviews are verified; tampering refuses", async t => {
  const f = fixture(t); f.runner.initialize(); await f.runner.next(); f.accept();
  const reviewFile = path.join(f.base, "private/reviews/C-K10/X.json");
  fs.appendFileSync(reviewFile, " ");
  assert.throws(() => f.runner.status(), /sealed_artifact_changed/);
  await assert.rejects(f.runner.next(), /sealed_artifact_changed/);
  assert.equal(f.sends(), 1);
});
test("pricing binding changes refuse before credential access or transmission", async t => {
  const f = fixture(t); f.runner.initialize();
  fs.appendFileSync(path.join(f.base, "preflight/current-pricing.json"), "\n");
  await assert.rejects(f.runner.next(), /sealed_artifact_changed/);
  assert.equal(f.credentialReads(), 0); assert.equal(f.sends(), 0);
});
test("write-once artifacts cannot overwrite", t => {
  const f = fixture(t); const p = path.join(f.root, "immutable.json");
  writeOnce(p, "{}"); assert.throws(() => writeOnce(p, "changed"), /EEXIST/);
  assert.equal(fs.readFileSync(p, "utf8"), "{}");
});
test("shared legacy lock enforces concurrency and never deletes another holder's lock", async t => {
  const f = fixture(t);
  await withSharedLock(async () => {
    await assert.rejects(withSharedLock(async () => assert.fail("must not enter"), f.root), /EEXIST/);
    assert.ok(fs.existsSync(path.join(f.root, "evidence-work/model-evaluation/.isolated-reading.lock")));
  }, f.root);
  assert.ok(!fs.existsSync(path.join(f.root, "evidence-work/model-evaluation/.isolated-reading.lock")));
});
test("provider-echoed credential is redacted and causes a global stop", async t => {
  const f = fixture(t, { respond: req => {
    const v = body(req);
    v.output[1].content[0].text = JSON.stringify({ ...answer,
      limitations: [{ text: "offline-fixture-credential-not-a-secret", original_ids: [] }] });
    return v;
  } });
  f.runner.initialize(); const s = await f.runner.next(); assert.equal(s.stopped, true);
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  for (const p of walk(path.join(f.base, "private")))
    assert.ok(!fs.readFileSync(p, "utf8").includes("offline-fixture-credential-not-a-secret"));
});
test("non-JSON response retains actual body hash and HTTP status without persisting raw text", async t => {
  const raw = "Offline non-JSON provider response.";
  const f = fixture(t, { fetchImpl: async () => new Response(raw, { status: 502 }) });
  f.runner.initialize(); const s = await f.runner.next(); assert.equal(s.stopped, true);
  const response = JSON.parse(fs.readFileSync(path.join(f.base, "private/responses/C-K10/X.json")));
  assert.equal(response.rawResponseSha256, hash(raw)); assert.equal(response.httpStatus, 502);
  assert.equal(response.outputText, "");
});
test("a dangling write-ahead reservation recovers offline into stopped, review-required unknown outcome", async t => {
  const f = fixture(t); f.runner.initialize();
  const dir = path.join(f.base, "private/events");
  const first = fs.readFileSync(path.join(dir, "000001.json"));
  writeOnce(path.join(dir, "000002.json"), encode({
    sequence: 2, previousSha256: hash(first), at: new Date().toISOString(),
    type: "transmission-reserved", assets: [], data: {
      attempt: 1, cumulativeTransmission: 20, caseId: attempt.caseId, model: attempt.model,
      projection: reserve(request), requestSha256: hash(JSON.stringify(request)),
    },
  }));
  const s = f.runner.recover();
  assert.equal(s.stopped, true); assert.equal(s.newTransmissions, 1);
  assert.equal(f.sends(), 0); assert.equal(f.credentialReads(), 0);
  assert.ok(s.awaitingReview); assert.ok(s.unknownAttemptReserveCentiMicroUSD > 0);
  f.accept(); await assert.rejects(f.runner.next(), /globally_stopped/);
});
test("known actual usage releases only first packet's reserve while companion reserve remains", async t => {
  const f = fixture(t); f.runner.initialize();
  const first = await f.runner.next();
  const companion = prepared.requests.requests.find(v => v.caseId === attempt.caseId)
    .requests.find(v => v.model !== attempt.model);
  assert.equal(first.untransmittedPairReserveCentiMicroUSD, reserve(companion).centiMicroUSD);
  assert.equal(first.knownCostCentiMicroUSD, LIMITS.historicalCostCentiMicroUSD
    + measureUsage(body().usage, request.model).centiMicroUSD);
  f.accept(); const second = await f.runner.next();
  assert.equal(second.untransmittedPairReserveCentiMicroUSD, 0);
});
test("review file parse errors refuse without accepting or altering a response", async t => {
  const f = fixture(t); f.runner.initialize(); await f.runner.next();
  assert.throws(() => f.runner.acceptReview("C-K10", "X", path.join(f.root, "nonexistent")), /review_source_invalid/);
  assert.ok(f.runner.status().awaitingReview); assert.equal(f.runner.status().stopped, false);
});
test("schema-valid control anomalies never enter blind review as completed comparators", () => {
  const variants = [
    { model: MODELS.find(model => model !== request.model) },
    { model: "unpriced-model" },
    { service_tier: "flex" },
    { tools: [{ type: "web_search" }] },
    { output: [...body().output, { type: "web_search_call" }] },
    { prompt_cache_options: { mode: "auto" } },
    { error: { type: "permission_error" } },
    { status: "failed" },
    { usage: { ...body().usage, input_tokens_details: { cached_tokens: 5, cache_write_tokens: 1 } } },
    { usage: { ...body().usage, output_tokens: 1600, total_tokens: 2600 } },
  ];
  let commonMarker;
  for (const variant of variants) {
    const result = inspectResponse(body(request, variant), request, reserve(request), 200);
    assert.ok(result.stopReasons.length);
    assert.equal(result.technicalState, "technical-invalid");
    assert.equal(result.answer, null);
    const packet = blindPacket(prepared, attempt, "X", result);
    assert.equal(packet.answer.kind, "technical-invalid");
    commonMarker ??= packet.answer.marker;
    assert.equal(packet.answer.marker, commonMarker);
    assert.equal(Object.keys(packet.answer).sort().join(","), "kind,marker");
    assert.ok(!JSON.stringify(packet).includes("Offline test fixture."));
    for (const forbidden of ["gpt-5.6", "microUSD", "service_tier", "web_search", "flex", "reservation_bound_exceeded"])
      assert.ok(!JSON.stringify(packet).includes(forbidden), forbidden);
  }
});
test("unknown tier, billable tool and wrong-model accounting retain full reservation, not default-rate subtotal", async t => {
  const variants = [
    req => body(req, { service_tier: "flex" }),
    req => body(req, { tools: [{ type: "web_search" }] }),
    req => body(req, { output: [...body(req).output, { type: "web_search_call" }] }),
    req => body(req, { model: MODELS.find(model => model !== req.model) }),
    req => body(req, { model: "unpriced-model" }),
    req => body(req, { prompt_cache_options: { mode: "auto" } }),
  ];
  for (const respond of variants) {
    const f = fixture(t, { respond }); f.runner.initialize();
    const status = await f.runner.next();
    assert.equal(status.stopped, true);
    assert.equal(status.knownCostCentiMicroUSD, LIMITS.historicalCostCentiMicroUSD);
    assert.equal(status.unknownAttemptReserveCentiMicroUSD, reserve(request).centiMicroUSD);
    const result = JSON.parse(fs.readFileSync(path.join(f.base, "private/responses/C-K10/X.json")));
    assert.equal(result.measured, null);
    assert.equal(result.costAccounting, "unknown-retain-reservation");
    assert.ok(result.costUnknownReasons.length);
    assert.equal(result.observedUsage.totals.input_tokens, 1000);
    assert.equal(result.technicalState, "technical-invalid");
    f.accept();
    await assert.rejects(f.runner.next(), /globally_stopped/);
    assert.equal(f.runner.status().unknownAttemptReserveCentiMicroUSD, reserve(request).centiMicroUSD);
    assert.equal(f.sends(), 1);
  }
});
test("priced cache anomalies and known-cost bound overruns retain exact charge but invalidate comparator", async t => {
  for (const usage of [
    { ...body().usage, input_tokens_details: { cached_tokens: 5, cache_write_tokens: 1 } },
    { ...body().usage, output_tokens: 1600, total_tokens: 2600 },
  ]) {
    const f = fixture(t, { respond: req => body(req, { usage }) }); f.runner.initialize();
    const status = await f.runner.next();
    assert.equal(status.stopped, true);
    assert.equal(status.knownCostCentiMicroUSD, LIMITS.historicalCostCentiMicroUSD
      + measureUsage(usage, request.model).centiMicroUSD);
    assert.equal(status.unknownAttemptReserveCentiMicroUSD, 0);
    const result = JSON.parse(fs.readFileSync(path.join(f.base, "private/responses/C-K10/X.json")));
    assert.equal(result.costAccounting, "known-total");
    assert.equal(result.technicalState, "technical-invalid");
    const packet = JSON.parse(fs.readFileSync(path.join(f.base, status.awaitingReview)));
    assert.equal(packet.answer.kind, "technical-invalid");
    f.accept();
    await assert.rejects(f.runner.next(), /globally_stopped/);
  }
});