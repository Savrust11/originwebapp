// Standalone append-only successor; importing this module performs no operation.
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { ROOT, writeOnce, withSharedLock } from "../model-comparison-execution/runner.mjs";
import { ENDPOINT, MODELS, hash, encode, assert } from "../model-comparison-execution/controls.mjs";
import { ID, OUTPUT, CODE, OLD, RESUME, DIAGNOSIS, DRIFT, DRIFT_ADDENDUM, LIMITS, safe, loadBaseline, loadDecision, validateDecision } from "./baseline.mjs";
import { reserve, inspectResponse, compareNativeSampling, blindPacket, validateReview, containsCredential } from "./controls.mjs";
export { ROOT, OUTPUT, LIMITS };
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
export const canReserve = (state, projections) => {
  const amounts = [state.actual, state.unknown, state.pendingPairReserve, ...projections.map(p => p.centiMicroUSD)];
  return amounts.every(n => Number.isSafeInteger(n) && n >= 0)
    && amounts.reduce((n, v) => n + v, 0) <= LIMITS.budgetCentiMicroUSD;
};
export function derive(events) {
  const attempts = events.filter(e => e.type === "transmission-reserved").map(e => ({ ...e.data,
    result: events.find(r => r.type === "response-recorded" && r.data.attempt === e.data.attempt)?.data,
    review: events.find(r => r.type === "review-accepted" && r.data.attempt === e.data.attempt)?.data }));
  const charged = a => a.result?.costAccounting === "known-total" ? a.result.measured?.centiMicroUSD ?? 0 : 0;
  const actual = LIMITS.baselineKnownCentiMicroUSD + attempts.reduce((n, a) => n + charged(a), 0);
  const unknown = LIMITS.baselineUnresolvedCentiMicroUSD + attempts.reduce((n, a) => n
    + (!a.result || a.result.costAccounting !== "known-total" ? a.projection.centiMicroUSD
      : a.result.retainReservation ? Math.max(0, a.projection.centiMicroUSD - charged(a)) : 0), 0);
  const closed = events.some(e => e.type === "unmasked");
  const pendingPairReserve = closed ? 0 : events.filter(e => e.type === "pair-reserved")
    .reduce((n, e) => n + e.data.projections.reduce((s, p, i) => s
      + (attempts.some(a => a.attempt === e.data.startAttempt + i) ? 0 : p.centiMicroUSD), 0), 0);
  // A crash after a durable failure/reviewer-stop but before its redundant stop
  // event must not reopen admission. Meaning grades alone never imply a stop.
  const stopped = events.some(e => e.type === "global-stop"
    || e.type === "response-recorded" && e.data.stopReasons?.some(r => /^(A|B):/.test(r))
    || e.type === "review-accepted" && e.data.decision === "stop");
  return { attempts, actual, unknown, pendingPairReserve, closed, stopped };
}
// Injection points are only for offline fixtures. The CLI supplies none.
export function createRunner({ root = ROOT, output = OUTPUT, loadPrepared = () => loadBaseline(root),
  decisionLoader = () => loadDecision(root), fetchImpl = (...args) => fetch(...args),
  readCredential = () => process.env.OPENAI_API_KEY, coin = () => randomInt(2),
  now = () => new Date().toISOString(), clock = () => performance.now(), bindCode = true } = {}) {
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
      const bytes = fs.readFileSync(file(`private/events/${name}`)), e = JSON.parse(bytes);
      assert(e.sequence === i + 1 && e.previousSha256 === previous, "event_chain_broken");
      for (const a of e.assets) assert(hash(fs.readFileSync(file(a.path))) === a.sha256, "sealed_asset_changed");
      previous = hash(bytes); return { ...e, sha256: previous };
    });
  };
  const append = (events, type, data, assets = []) => {
    const e = { sequence: events.length + 1, previousSha256: events.at(-1)?.sha256 ?? null, at: now(), type, data, assets };
    const a = record(`private/events/${String(e.sequence).padStart(6, "0")}.json`, e);
    events.push({ ...e, sha256: a.sha256 });
  };
  const stop = (events, reason) => {
    if (!events.some(e => e.type === "global-stop")) append(events, "global-stop", { reason });
  };
  const verify = events => {
    assert(events[0]?.type === "initialized", "run_not_initialized");
    const p = loadPrepared(), d = validateDecision(decisionLoader()), auth = read(file("private/authorization.json"));
    for (const b of auth.bindings) assert(binding(b.path).sha256 === b.sha256, "bound_evidence_or_code_changed");
    assert(JSON.stringify(auth.limits) === JSON.stringify(LIMITS), "limits_changed");
    assert(auth.predecessorSnapshot === p.predecessorSnapshot && auth.decisionSha256 === hash(encode(d)), "predecessor_or_decision_changed");
    assert(events.filter(e => e.type === "opening-accounting-correction").length === 1, "opening_correction_missing_or_duplicate");
    return p;
  };
  const summary = events => {
    const s = derive(events), last = s.attempts.at(-1);
    const summary = { comparisonId: ID, initialized: !!events.length,
      baselineTransmissions: 21, newMaxTransmissions: 21, plannedTransmissions: 21,
      newTransmissions: s.attempts.length, cumulativeTransmissions: 21 + s.attempts.length,
      cumulativeMaxTransmissions: 43, stopped: s.stopped || fs.existsSync(file("private/emergency-stop.json")),
      closed: s.closed, awaitingReview: last && !last.review ? last.result?.blindPath ?? "unresolved-use-recover-no-resend" : null,
      latestBlindPacketSha256: last?.result?.blindPacketSha256 ?? null, nextRequiresExplicitCommand: true };
    if (s.closed) summary.accounting = { knownCentiMicroUSD: s.actual, unresolvedCentiMicroUSD: s.unknown,
      pendingPairReserveCentiMicroUSD: s.pendingPairReserve, totalCentiMicroUSD: s.actual + s.unknown + s.pendingPairReserve };
    return summary;
  };
  function initialize() {
    assert(!fs.existsSync(file("private/authorization.json")), "already_initialized");
    const decision = validateDecision(decisionLoader()); // Real independent memo MUST exist first.
    const prepared = loadPrepared();
    let bindings = [binding(`${output}/preflight/evidence-accounting-decision.json`)];
    if (bindCode) bindings = bindings.concat([
      DRIFT, DRIFT_ADDENDUM,
      ...["baseline.mjs", "controls.mjs", "runner.mjs", "cli.mjs", "offline.test.mjs", "offline-lockdown.mjs", "policy.json"].map(n => `${CODE}/${n}`),
      ...[0, 1, 2].map(n => `${OLD}/preflight/official-${n}.md`), `${OLD}/preflight/current-pricing.json`,
      ...["official-response_reasoning_item.py.md", "official-response_output_message.py.md",
        "official-response_format_text_json_schema_config.py.md"].map(n => `${DIAGNOSIS}/${n}`),
    ].map(binding));
    const mapping = Object.fromEntries(prepared.order.pairs.map(p => {
      const labels = coin() === 0 ? ["X", "Y"] : ["Y", "X"];
      return [p.caseId, Object.fromEntries(MODELS.map((m, i) => [m, labels[i]]))];
    }));
    const mapAsset = record("private/mapping.json", { comparisonId: ID, mapping });
    const authAsset = record("private/authorization.json", { comparisonId: ID, limits: LIMITS, bindings,
      predecessorSnapshot: prepared.predecessorSnapshot, decisionSha256: hash(encode(decision)),
      endpoint: ENDPOINT, method: "POST", credentialEnvironmentVariable: "OPENAI_API_KEY",
      frozenRequestSha256: prepared.freezeSha256, priorReviewsReused: false, h06ReferenceOnly: true,
      conditionedReportException: bindCode ? { proofPath: DRIFT, addendumPath: DRIFT_ADDENDUM,
        method: "seven-exact-allowlisted-presentation-paths-only;full-current-hash-and-16-identical-original-hash-blocks;reverified-every-action;never-generation-inputs" } : null });
    const events = [];
    append(events, "initialized", { comparisonId: ID, baselineTransmissions: 21, newMaxTransmissions: 21 }, [authAsset, mapAsset]);
    append(events, "opening-accounting-correction", {
      memo: bindings[0], previousLedger: `${RESUME}/private/events/000003.json`,
      previousResponse: `${RESUME}/private/events/000004.json`, oldQ10Ledger: `${OLD}/private/events/000003.json`,
      oldLedgersUnchanged: true, h06ReservationReplacedCentiMicroUSD: 10398500,
      h06RecognizedCentiMicroUSD: 3416400, releasedDifferenceCentiMicroUSD: 6982100,
      knownCentiMicroUSD: 6004300, unresolvedQ10CentiMicroUSD: 551250,
      completionStillUnproven: true, h06PairEligible: false,
    });
    return summary(events);
  }
  const requestFor = (p, a) => {
    const r = p.requests.requests.find(x => x.caseId === a.caseId)?.requests.find(x => x.model === a.model);
    reserve(r); return r;
  };
  function finish(events, prepared, attempt, result) {
    const companion = derive(events).attempts.find(a => a.caseId === attempt.caseId && a.attempt !== attempt.attempt);
    if (attempt.caseId === "C-H06") result.pairEligibility = { eligible: false, state: "independent-memo-reference-only-completion-unproven" };
    else if (companion?.result) {
      const prior = read(file(companion.result.diagnosticPath));
      const sampling = compareNativeSampling(prior.controls, result.controls);
      result.pairEligibility = { eligible: sampling.eligible && companion.result.technicalState === "completed-schema"
        && result.technicalState === "completed-schema", nativeSampling: sampling,
        metadataState: result.metadataState, allMetadataResolved: result.metadataState !== "metadata-unresolved",
        policy: "case-only-fairness-failure-never-global-stop;unknown-metadata-not-declared-harmless" };
      // Fairness does not suppress content grading or erase token charges.
    } else result.pairEligibility = { eligible: false, state: "awaiting-companion" };
    const label = read(file("private/mapping.json")).mapping[attempt.caseId][attempt.model];
    const stem = `${attempt.caseId}/${label}`;
    const { outputText, answer, ...diagnostic } = result;
    const diagnosticPath = `private/diagnostics/${stem}.json`, responsePath = `private/results/${stem}.json`;
    const diagnosticAsset = record(diagnosticPath, diagnostic);
    const contentAsset = record(responsePath, { technicalState: result.technicalState, outputText, answer });
    const packet = blindPacket(prepared, attempt, label, result), blindPath = `blind/${stem}/packet.json`;
    const packetAsset = record(blindPath, packet);
    append(events, "response-recorded", { attempt: attempt.attempt, responsePath, diagnosticPath, blindPath,
      blindPacketSha256: packetAsset.sha256, measured: result.measured, costAccounting: result.costAccounting,
      retainReservation: result.retainReservation, technicalState: result.technicalState,
      stopReasons: result.stopReasons, pairEligibility: result.pairEligibility }, [diagnosticAsset, contentAsset, packetAsset]);
    if (result.stopReasons.length) stop(events, "required_settings_or_accounting_failed");
    const state = derive(events);
    if (state.actual + state.unknown + state.pendingPairReserve > LIMITS.budgetCentiMicroUSD) stop(events, "budget_exceeded");
    return summary(events);
  }
  async function next() {
    const events = loadEvents(), p = verify(events), s = derive(events);
    assert(!s.closed && !s.stopped && !fs.existsSync(file("private/emergency-stop.json")), "continuation_stopped");
    assert(s.attempts.every(a => a.result && a.review), "previous_attempt_requires_review_or_recover");
    const index = s.attempts.length;
    assert(index < LIMITS.newMaxTransmissions && index < p.order.attempts.length
      && 21 + index < LIMITS.cumulativeMaxTransmissions, "transmission_limit");
    const planned = p.order.attempts[index];
    assert(planned.caseId !== "C-K10" && !(planned.caseId === "C-H06" && planned.model !== "gpt-5.6-luna"), "forbidden_regeneration");
    const request = requestFor(p, planned), body = JSON.stringify(request), projection = reserve(request);
    if (!events.some(e => e.type === "pair-reserved" && e.data.caseId === planned.caseId)) {
      const group = index === 0 ? [planned] : p.order.attempts.slice(index, index + 2);
      assert(index === 0 || index % 2 === 1 && group.length === 2 && group.every(a => a.caseId === planned.caseId), "pair_order_invalid");
      const projections = group.map(a => reserve(requestFor(p, a)));
      if (!canReserve(s, projections)) {
        stop(events, "B:cannot_reserve_whole_pair"); return summary(events);
      }
      append(events, "pair-reserved", { caseId: planned.caseId, startAttempt: index + 1, projections,
        singletonReason: index === 0 ? "h06-other-side-already-sent-reference-only" : null });
    }
    const reserved = derive(events);
    assert(reserved.actual + reserved.unknown + reserved.pendingPairReserve <= LIMITS.budgetCentiMicroUSD, "budget_reservation_invalid");
    const key = readCredential(); // Sole runtime credential read; never init/status.
    assert(typeof key === "string" && key.trim().length, "credential_not_available");
    const attempt = { attempt: index + 1, cumulativeTransmission: 22 + index, caseId: planned.caseId,
      model: planned.model, projection, requestSha256: hash(body), endpoint: ENDPOINT, method: "POST" };
    append(events, "transmission-reserved", attempt);
    const started = clock(); let result, rawResponseSha256 = null, httpStatus = null;
    try {
      const response = await fetchImpl(ENDPOINT, { method: "POST", redirect: "error",
        signal: AbortSignal.timeout(LIMITS.timeoutMs), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body });
      httpStatus = response.status;
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; assert(size <= 1048576, "response_too_large"); chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks); rawResponseSha256 = hash(raw);
      const parsed = JSON.parse(raw.toString("utf8"));
      assert(!containsCredential(parsed, key), "credential_echo");
      result = inspectResponse(parsed, request, projection, httpStatus, { credential: key });
    } catch {
      result = { measured: null, costAccounting: "unknown-retain-reservation", retainReservation: true,
        outputText: "", answer: null, technicalState: "technical-invalid", stopReasons: ["B:transport_or_response_unknown_no_retry"] };
    }
    return finish(events, p, attempt, { requestSha256: attempt.requestSha256, rawResponseSha256, httpStatus,
      elapsedMs: Math.max(0, Math.round(clock() - started)), ...result });
  }
  function review(caseId, label, source) {
    const events = loadEvents(); verify(events);
    const s = derive(events), attempt = s.attempts.at(-1);
    assert(!s.closed && attempt?.result && !attempt.review, "latest_attempt_not_reviewable");
    const bytes = fs.readFileSync(file(attempt.result.blindPath)), packet = JSON.parse(bytes);
    assert(packet.caseId === caseId && packet.label === label, "review_wrong_packet");
    let assessment; try { assessment = read(source); } catch { throw new Error("review_source_invalid"); }
    validateReview(assessment, packet, hash(bytes));
    const asset = record(`private/reviews/${caseId}/${label}.json`, assessment);
    append(events, "review-accepted", { attempt: attempt.attempt, caseId, label, decision: assessment.decision,
      blindPacketSha256: hash(bytes) }, [asset]);
    if (assessment.decision === "stop") stop(events, "explicit_reviewer_stop");
    return summary(events);
  }
  function recover() {
    const events = loadEvents(), p = verify(events), s = derive(events), a = s.attempts.at(-1);
    assert(!s.closed && a && !a.result, "no_unresolved_reservation");
    return finish(events, p, a, { measured: null, costAccounting: "unknown-retain-reservation", retainReservation: true,
      outputText: "", answer: null, technicalState: "technical-invalid", stopReasons: ["B:interrupted_write_ahead_never_resend"] });
  }
  function unmask(reason) {
    const events = loadEvents(), p = verify(events), s = derive(events);
    assert(!s.closed && typeof reason === "string" && reason.trim().length >= 8, "unmask_requires_reason");
    assert(s.attempts.every(a => a.result && a.review), "unmask_requires_all_frozen_reviews");
    const eligiblePairs = p.order.pairs.filter(pair => {
      if (pair.caseId === "C-H06") return false; // Fixed independent memo, not answer quality.
      const a = s.attempts.filter(a => a.caseId === pair.caseId);
      return a.length === 2 && a.every(a => a.review && a.result?.technicalState === "completed-schema")
        && a.at(-1).result.pairEligibility?.eligible === true;
    }).map(p => p.caseId);
    const closureReasonSha256 = hash(reason);
    const asset = record("unmasked/final.json", { comparisonId: ID, closureReasonSha256,
      mapping: read(file("private/mapping.json")).mapping, eligiblePairs, h06ReferenceOnly: true,
      priorReviewsReused: false, attempted: s.attempts, unexecuted: p.order.attempts.slice(s.attempts.length),
      accounting: { knownCentiMicroUSD: s.actual, unresolvedCentiMicroUSD: s.unknown, totalCentiMicroUSD: s.actual + s.unknown },
      evidenceBoundary: "AI-only; no clinical/source-adoption/publication/invoice approval" });
    append(events, "unmasked", { closureReasonSha256 }, [asset]);
    return { ...summary(events), unmaskedFile: asset.path };
  }
  function status() {
    const events = loadEvents();
    if (events.length) verify(events); else { validateDecision(decisionLoader()); loadPrepared(); }
    return summary(events);
  }
  const guard = fn => (...args) => withSharedLock(async () => {
    try { return await fn(...args); }
    catch (e) {
      if (fs.existsSync(file("private/authorization.json")) && !fs.existsSync(file("private/emergency-stop.json"))
        && !/^(already_initialized|run_not_initialized|continuation_stopped|previous_attempt_|transmission_limit|credential_not_available|latest_attempt_|review_|invalid_answer_|unmask_requires_|no_unresolved_)/.test(e.message))
        record("private/emergency-stop.json", { reason: "local_integrity_failure_no_automatic_resume" });
      throw e;
    }
  }, root);
  return Object.fromEntries(Object.entries({ initialize, status, next, review, recover, unmask }).map(([k, fn]) => [k, guard(fn)]));
}