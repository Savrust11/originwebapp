// Append-only separate continuation. One explicit next -> at most one POST.
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { ROOT, writeOnce, withSharedLock } from "../model-comparison-execution/runner.mjs";
import { ENDPOINT, MODELS, hash, encode, assert, validatePricing } from "../model-comparison-execution/controls.mjs";
import { ID, OUTPUT, OLD, CODE, SDK, LIMITS, loadBaseline } from "./baseline.mjs";
import { reserve, inspectResponse, compareNativeSampling, blindPacket, validateReview } from "./controls.mjs";
export { ROOT, OUTPUT, LIMITS };
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
function safe(root, relative) {
  assert(typeof relative === "string" && relative.length && !path.isAbsolute(relative)
    && !relative.split(/[\\/]/).includes(".."), "unsafe_path");
  const target = path.join(root, relative);
  for (let p = target; p !== path.dirname(p); p = path.dirname(p))
    if (fs.existsSync(p)) assert(!fs.lstatSync(p).isSymbolicLink(), "symlink_forbidden");
  return target;
}
export function derive(events) {
  const attempts = events.filter(e => e.type === "transmission-reserved").map(e => ({
    ...e.data,
    result: events.find(r => r.type === "response-recorded" && r.data.attempt === e.data.attempt)?.data,
    review: events.find(r => r.type === "review-accepted" && r.data.attempt === e.data.attempt)?.data,
  }));
  const known = a => a.result?.costAccounting === "known-total" && a.result?.measured;
  const actual = LIMITS.baselineKnownCentiMicroUSD
    + attempts.reduce((sum, a) => sum + (known(a) ? a.result.measured.centiMicroUSD : 0), 0);
  const unknown = LIMITS.baselineUnresolvedCentiMicroUSD
    + attempts.reduce((sum, a) => sum + (known(a) ? 0 : a.projection.centiMicroUSD), 0);
  const closed = events.some(e => e.type === "unmasked");
  const pendingPairReserve = closed ? 0 : events.filter(e => e.type === "pair-reserved")
    .reduce((sum, e) => sum + e.data.projections.reduce((subtotal, projection, i) =>
      subtotal + (attempts.some(a => a.attempt === e.data.startAttempt + i) ? 0 : projection.centiMicroUSD), 0), 0);
  return { attempts, actual, unknown, pendingPairReserve, closed,
    stopped: events.some(e => e.type === "global-stop") };
}
export function createRunner({
  root = ROOT, output = OUTPUT, loadPrepared = () => loadBaseline(root),
  fetchImpl = (...args) => fetch(...args), readCredential = () => process.env.OPENAI_API_KEY,
  coin = () => randomInt(2), now = () => new Date().toISOString(),
  bindCode = true,
} = {}) {
  const base = safe(root, output), file = p => safe(base, p);
  const record = (p, value) => {
    const bytes = encode(value); writeOnce(file(p), bytes); return { path: p, sha256: hash(bytes) };
  };
  const binding = p => ({ path: p, sha256: hash(fs.readFileSync(safe(root, p))) });
  const loadEvents = () => {
    if (!fs.existsSync(file("private/events"))) return [];
    let previous = null;
    return fs.readdirSync(file("private/events")).sort().map((name, i) => {
      assert(name === `${String(i + 1).padStart(6, "0")}.json`, "event_sequence_broken");
      const bytes = fs.readFileSync(file(`private/events/${name}`)), event = JSON.parse(bytes);
      assert(event.sequence === i + 1 && event.previousSha256 === previous, "event_chain_broken");
      for (const asset of event.assets)
        assert(hash(fs.readFileSync(file(asset.path))) === asset.sha256, "sealed_asset_changed");
      previous = hash(bytes);
      return { ...event, sha256: previous };
    });
  };
  const append = (events, type, data, assets = []) => {
    const event = { sequence: events.length + 1, previousSha256: events.at(-1)?.sha256 ?? null,
      at: now(), type, data, assets };
    const asset = record(`private/events/${String(event.sequence).padStart(6, "0")}.json`, event);
    events.push({ ...event, sha256: asset.sha256 });
  };
  const stop = (events, reason) => {
    if (!events.some(e => e.type === "global-stop")) append(events, "global-stop", { reason });
  };
  const verify = events => {
    const prepared = loadPrepared();
    assert(events[0]?.type === "initialized", "run_not_initialized");
    const auth = read(file("private/authorization.json"));
    for (const b of auth.bindings)
      assert(hash(fs.readFileSync(safe(root, b.path))) === b.sha256, "bound_code_docs_or_preflight_changed");
    for (const [key, value] of Object.entries(LIMITS)) assert(auth.limits[key] === value, "limits_changed");
    assert(auth.predecessorSnapshot === prepared.predecessorSnapshot, "predecessor_changed");
    return prepared;
  };
  const summary = events => {
    const s = derive(events), last = s.attempts.at(-1);
    const publicSummary = {
      comparisonId: ID, initialized: !!events.length, baselineTransmissions: LIMITS.baselineTransmissions,
      newMaxTransmissions: LIMITS.newMaxTransmissions, plannedTransmissions: LIMITS.plannedTransmissions,
      newTransmissions: s.attempts.length, cumulativeTransmissions: LIMITS.baselineTransmissions + s.attempts.length,
      cumulativeMaxTransmissions: LIMITS.cumulativeMaxTransmissions,
      excludedCase: "C-K10", stopped: s.stopped || fs.existsSync(file("private/emergency-stop.json")),
      closed: s.closed, awaitingReview: last && !last.review ? last.result?.blindPath ?? "unresolved-use-recover-no-resend" : null,
      latestBlindPacketSha256: last?.result?.blindPacketSha256 ?? null,
      nextRequiresExplicitCommand: true,
    };
    if (s.closed) publicSummary.accounting = {
      baselineKnownCentiMicroUSD: LIMITS.baselineKnownCentiMicroUSD,
      baselineUnresolvedCentiMicroUSD: LIMITS.baselineUnresolvedCentiMicroUSD,
      knownCentiMicroUSD: s.actual, unresolvedCentiMicroUSD: s.unknown,
      pendingPairReserveCentiMicroUSD: s.pendingPairReserve,
      totalAccountedAndReservedCentiMicroUSD: s.actual + s.unknown + s.pendingPairReserve,
    };
    return publicSummary;
  };
  function initialize() {
    const prepared = loadPrepared();
    assert(!fs.existsSync(file("private/authorization.json")), "already_initialized");
    const preflight = read(file("preflight.json"));
    assert(preflight.state === "offline-prepared-not-initialized-no-transmissions"
      && preflight.excludedCase === "C-K10", "preflight_changed");
    let bindings = [binding(`${output}/preflight.json`)];
    if (bindCode) {
      validatePricing(read(safe(root, `${OLD}/preflight/current-pricing.json`)));
      bindings = bindings.concat([
        ...["baseline.mjs", "controls.mjs", "runner.mjs", "cli.mjs", "offline.test.mjs", "offline-lockdown.mjs"].map(n => `${CODE}/${n}`),
        `${OLD}/preflight/current-pricing.json`, ...[0, 1, 2].map(n => `${OLD}/preflight/official-${n}.md`), SDK,
      ].map(binding));
      for (const doc of preflight.documentation) {
        assert(binding(doc.path).sha256 === doc.sha256, "preflight_documentation_changed");
        if (!bindings.some(b => b.path === doc.path)) bindings.push(binding(doc.path));
      }
    }
    const mapping = {};
    for (const pair of prepared.order.pairs) {
      const labels = coin() === 0 ? ["X", "Y"] : ["Y", "X"];
      mapping[pair.caseId] = Object.fromEntries(MODELS.map((m, i) => [m, labels[i]]));
    }
    const mapAsset = record("private/mapping.json", { comparisonId: ID, mapping,
      assignment: "new-independent-random-per-pair-canonical-model-list; not-prior-order-or-labels" });
    const authAsset = record("private/authorization.json", {
      schemaVersion: 1, comparisonId: ID, authorizedAt: now(), authorization: preflight.authorization,
      limits: LIMITS, endpoint: ENDPOINT, method: "POST", credentialEnvironmentVariable: "OPENAI_API_KEY",
      predecessorSnapshot: prepared.predecessorSnapshot, preparedFreezeSha256: prepared.freezeSha256,
      bindings, mappingSha256: mapAsset.sha256, excludedCase: "C-K10",
      reusePriorReview: false, baselineIncludedForWinners: false,
      operationalReservationsNotProviderInvoiceGuarantees: true,
    });
    const events = [];
    append(events, "initialized", { comparisonId: ID, baselineTransmissions: 20, newMaxTransmissions: 23 },
      [authAsset, mapAsset, { path: "preflight.json", sha256: hash(fs.readFileSync(file("preflight.json"))) }]);
    return summary(events);
  }
  function finish(events, prepared, attempt, result) {
    const companion = derive(events).attempts.find(a => a.caseId === attempt.caseId && a.attempt !== attempt.attempt && a.result);
    if (companion) {
      const priorResult = read(file(companion.result.responsePath));
      result.pairEligibility = compareNativeSampling(priorResult.controls, result.controls);
      if (!result.pairEligibility.eligible) {
        // A fairness failure does not make otherwise validated model/tier usage
        // unpriced. Keep measured actual cost, but never grade this as comparable.
        result.stopReasons.push("native_sampling_pair_mismatch_or_unknown");
        result.technicalState = "technical-invalid";
        result.answer = null;
      }
    } else result.pairEligibility = { eligible: false, state: "awaiting-companion" };
    const label = read(file("private/mapping.json")).mapping[attempt.caseId][attempt.model];
    const responsePath = `private/results/${attempt.caseId}/${label}.json`;
    const resultAsset = record(responsePath, result); // Deliberate private content destination.
    const packet = blindPacket(prepared, attempt, label, result);
    const blindPath = `blind/${attempt.caseId}/${label}/packet.json`;
    const packetAsset = record(blindPath, packet);
    append(events, "response-recorded", {
      attempt: attempt.attempt, responsePath, responseSha256: resultAsset.sha256,
      blindPath, blindPacketSha256: packetAsset.sha256, measured: result.measured,
      costAccounting: result.costAccounting, technicalState: result.technicalState,
      stopReasons: result.stopReasons, pairEligibility: result.pairEligibility,
    }, [resultAsset, packetAsset]);
    if (result.stopReasons.length) stop(events, result.stopReasons.includes("native_sampling_pair_mismatch_or_unknown")
      ? "native_sampling_pair_mismatch_or_unknown" : "response_controls_or_accounting_failed");
    return summary(events);
  }
  const requestFor = (prepared, attempt) => {
    const request = prepared.requests.requests.find(p => p.caseId === attempt.caseId)
      ?.requests.find(r => r.model === attempt.model);
    reserve(request);
    return request;
  };
  async function next() {
    const events = loadEvents(), prepared = verify(events), state = derive(events);
    assert(!state.stopped && !state.closed && !fs.existsSync(file("private/emergency-stop.json")), "continuation_stopped");
    assert(state.attempts.every(a => a.result && a.review), "previous_attempt_requires_review_or_recover");
    const index = state.attempts.length;
    assert(index < prepared.order.attempts.length && index < LIMITS.newMaxTransmissions
      && LIMITS.baselineTransmissions + index < LIMITS.cumulativeMaxTransmissions, "transmission_limit");
    const planned = prepared.order.attempts[index], request = requestFor(prepared, planned);
    assert(planned.caseId !== "C-K10", "excluded_case_forbidden");
    const body = JSON.stringify(request), projection = reserve(request);
    let pair = events.find(e => e.type === "pair-reserved" && e.data.caseId === planned.caseId)?.data;
    if (!pair) {
      const other = prepared.order.attempts[index + 1];
      assert(index % 2 === 0 && other?.caseId === planned.caseId, "whole_pair_order_invalid");
      const projections = [projection, reserve(requestFor(prepared, other))];
      const total = projections.reduce((sum, p) => sum + p.centiMicroUSD, 0);
      if (state.actual + state.unknown + state.pendingPairReserve + total > LIMITS.budgetCentiMicroUSD) {
        stop(events, "cannot_reserve_whole_pair"); return summary(events);
      }
      pair = { caseId: planned.caseId, startAttempt: index + 1, projections };
      append(events, "pair-reserved", pair);
    }
    const reservedState = derive(events);
    assert(reservedState.actual + reservedState.unknown + reservedState.pendingPairReserve <= LIMITS.budgetCentiMicroUSD,
      "budget_reservation_invalid");
    // Only this explicit operation reads the existing secret runtime, never init/status.
    const key = readCredential();
    assert(typeof key === "string" && key.trim().length, "credential_not_available");
    const attempt = { attempt: index + 1, cumulativeTransmission: 21 + index,
      caseId: planned.caseId, model: planned.model, projection,
      requestSha256: hash(body), endpoint: ENDPOINT, method: "POST" };
    append(events, "transmission-reserved", attempt);
    let result, rawResponseSha256 = null, httpStatus = null;
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(LIMITS.timeoutMs),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body,
      });
      httpStatus = response.status;
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; assert(size <= 1048576, "response_too_large"); chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks); rawResponseSha256 = hash(raw);
      const parsed = JSON.parse(raw.toString("utf8"));
      // Fail the entire result if any decoded key/value echoes the credential.
      // No provider body, headers or exception text can reach diagnostic output.
      const echoesCredential = value => typeof value === "string" ? value.includes(key)
        : Array.isArray(value) ? value.some(echoesCredential)
          : value && typeof value === "object"
            ? Object.entries(value).some(([name, v]) => name.includes(key) || echoesCredential(v)) : false;
      assert(!echoesCredential(parsed), "credential_echo");
      result = inspectResponse(parsed, request, projection, httpStatus);
    } catch {
      result = { measured: null, costAccounting: "unknown-retain-reservation", outputText: "", answer: null,
        technicalState: "technical-invalid", stopReasons: ["transport_or_response_unknown_no_retry"] };
    }
    return finish(events, prepared, attempt, {
      schemaVersion: 1, requestSha256: attempt.requestSha256, rawResponseSha256, httpStatus, ...result,
    });
  }
  function review(caseId, label, source) {
    const events = loadEvents(); verify(events);
    const state = derive(events), attempt = state.attempts.at(-1);
    assert(!state.closed && attempt?.result && !attempt.review, "latest_attempt_not_reviewable");
    const bytes = fs.readFileSync(file(attempt.result.blindPath)), packet = JSON.parse(bytes);
    assert(packet.caseId === caseId && packet.label === label, "review_wrong_packet");
    let assessment; try { assessment = read(source); } catch { throw new Error("review_source_invalid"); }
    validateReview(assessment, packet, hash(bytes));
    const asset = record(`private/reviews/${caseId}/${label}.json`, assessment);
    append(events, "review-accepted", { attempt: attempt.attempt, caseId, label,
      decision: assessment.decision, blindPacketSha256: hash(bytes) }, [asset]);
    if (assessment.decision === "stop") stop(events, "blind_reviewer_requested_stop");
    return summary(events);
  }
  function recover() {
    const events = loadEvents(), prepared = verify(events), state = derive(events), attempt = state.attempts.at(-1);
    assert(!state.closed && attempt && !attempt.result, "no_unresolved_reservation");
    stop(events, "interrupted_write_ahead_never_resend");
    return finish(events, prepared, attempt, { measured: null, costAccounting: "unknown-retain-reservation",
      outputText: "", answer: null, technicalState: "technical-invalid",
      stopReasons: ["interrupted_write_ahead_never_resend"] });
  }
  function unmask(reason) {
    const events = loadEvents(), prepared = verify(events), state = derive(events);
    assert(!state.closed && typeof reason === "string" && reason.trim().length >= 8, "unmask_requires_reason");
    assert(state.attempts.every(a => a.result && a.review), "unmask_requires_all_frozen_reviews");
    // Do not store arbitrary operator reason text in diagnostics.
    const closureReasonSha256 = hash(reason);
    const eligiblePairs = prepared.order.pairs.filter(p => {
      const attempts = state.attempts.filter(a => a.caseId === p.caseId);
      return attempts.length === 2 && attempts.every(a => a.result?.technicalState === "completed-schema" && a.review)
        && attempts.at(-1).result.pairEligibility?.eligible === true;
    }).map(p => p.caseId);
    const asset = record("unmasked/final.json", {
      comparisonId: ID, closureReasonSha256, mapping: read(file("private/mapping.json")).mapping,
      baselineExcludedFromWinners: true, priorReviewReused: false, excludedCase: "C-K10",
      eligiblePairs, attempted: state.attempts, unexecuted: prepared.order.attempts.slice(state.attempts.length),
      accounting: { knownCentiMicroUSD: state.actual, unresolvedCentiMicroUSD: state.unknown,
        untransmittedPairReserveCentiMicroUSD: 0, totalCentiMicroUSD: state.actual + state.unknown },
      safety: "AI-only evaluation. No clinical/publication/adoption approval.",
    });
    append(events, "unmasked", { closureReasonSha256 }, [asset]);
    return { ...summary(events), unmaskedFile: asset.path };
  }
  function status() {
    const events = loadEvents();
    if (events.length) verify(events); else loadPrepared();
    return summary(events);
  }
  function emergencyStop() {
    if (fs.existsSync(file("private/authorization.json")) && !fs.existsSync(file("private/emergency-stop.json")))
      record("private/emergency-stop.json", { reason: "local_integrity_failure_no_automatic_resume" });
  }
  // Lock the entire action including await fetch, even for direct module callers.
  const guarded = fn => (...args) => withSharedLock(async () => {
    try { return await fn(...args); }
    catch (e) {
      if (!/^(already_initialized|run_not_initialized|continuation_stopped|previous_attempt_|transmission_limit|credential_not_available|latest_attempt_|review_|invalid_answer_|unmask_requires_|no_unresolved_)/.test(e.message))
        emergencyStop();
      throw e;
    }
  }, root);
  return Object.fromEntries(Object.entries({ initialize, next, review, recover, unmask, status })
    .map(([key, fn]) => [key, guarded(fn)]));
}