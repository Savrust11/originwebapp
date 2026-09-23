// Isolated, append-only, one-transmission state machine. Production has one fixed
// endpoint and no SDK, DB, model preflight, fallback, retry or automatic send loop.
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ID, ENDPOINT, MODELS, LIMITS, hash, encode, assert, assertRequest, validatePricing,
  reserve, inspectResponse, blindPacket, validateReview,
} from "./controls.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const PREPARATION = `evidence-work/model-comparison-preparation/${ID}`;
export const OUTPUT = `evidence-work/model-comparison-runs/${ID}`;
const FROZEN_HASH = "fb8af8e6c6546ce43d7f1cbd57e541bb86ebae009989dcc37646e2db8b2681b0";
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const relativeSafe = (root, relative) => {
  assert(typeof relative === "string" && !path.isAbsolute(relative)
    && !relative.split(/[\\/]/).includes(".."), "unsafe_relative_path");
  const result = path.join(root, relative);
  // Existing ancestors must not redirect private artifacts through symbolic links.
  for (let p = result; p.startsWith(root) && p !== root; p = path.dirname(p))
    if (fs.existsSync(p)) assert(!fs.lstatSync(p).isSymbolicLink(), "symlink_forbidden");
  return result;
};

export function writeOnce(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  const dir = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

export function loadPreparation(root = ROOT) {
  const base = path.join(root, PREPARATION);
  const bytes = fs.readFileSync(path.join(base, "final-freeze.json"));
  assert(hash(bytes) === FROZEN_HASH, "final_freeze_changed");
  const frozen = JSON.parse(bytes);
  const verify = item => {
    const content = fs.readFileSync(relativeSafe(root, item.path));
    assert(hash(content) === item.sha256 && (item.bytes === undefined || content.length === item.bytes),
      "frozen_or_historical_hash_changed");
  };
  frozen.files.forEach(verify);
  const preserved = read(path.join(base, "preserved-results.json"));
  preserved.files.forEach(verify);
  const history = read(path.join(root, "evidence-work/general-audience-evaluation/general-audience-six-01/history-snapshot.json"));
  history.preservedFiles.forEach(verify);
  const manifest = read(path.join(base, "manifest.json"));
  Object.entries(manifest.frozenReferences).forEach(([p, sha256]) => verify({ path: p, sha256 }));
  const prepared = {
    freezeSha256: FROZEN_HASH, requests: read(path.join(base, "request-packets.json")),
    order: read(path.join(base, "execution-order.json")),
    displays: read(path.join(base, "app-display-templates.json")),
    rubric: read(path.join(base, "rubric.json")),
  };
  assert(prepared.order.attempts.length === 24 && prepared.order.pairs.length === 12, "frozen_order_invalid");
  prepared.requests.requests.forEach(item => item.requests.forEach(assertRequest));
  return prepared;
}

// Dependency injection exists for OFFLINE tests only. CLI supplies none.
export function createRunner({
  root = ROOT, output = OUTPUT, loadPrepared = () => loadPreparation(root),
  fetchImpl = (...args) => fetch(...args),
  readCredential = () => process.env.OPENAI_API_KEY,
  coin = () => randomInt(2), now = () => new Date().toISOString(),
  clock = () => performance.now(), bindCode = true,
} = {}) {
  const base = relativeSafe(root, output);
  const file = p => relativeSafe(base, p);
  const record = (p, value) => {
    const bytes = encode(value); writeOnce(file(p), bytes);
    return { path: p, sha256: hash(bytes) };
  };
  const bind = p => ({ path: p, sha256: hash(fs.readFileSync(file(p))) });
  const loadEvents = () => {
    const dir = file("private/events");
    if (!fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir).sort();
    let previousSha256 = null;
    return names.map((name, index) => {
      assert(name === `${String(index + 1).padStart(6, "0")}.json`, "event_sequence_broken");
      const bytes = fs.readFileSync(path.join(dir, name)), event = JSON.parse(bytes);
      assert(event.sequence === index + 1 && event.previousSha256 === previousSha256, "event_chain_broken");
      for (const asset of event.assets ?? [])
        assert(hash(fs.readFileSync(file(asset.path))) === asset.sha256, "sealed_artifact_changed");
      previousSha256 = hash(bytes);
      return { ...event, eventSha256: previousSha256 };
    });
  };
  const append = (events, type, data, assets = []) => {
    const event = {
      sequence: events.length + 1, previousSha256: events.at(-1)?.eventSha256 ?? null,
      at: now(), type, data, assets,
    };
    const asset = record(`private/events/${String(event.sequence).padStart(6, "0")}.json`, event);
    events.push({ ...event, eventSha256: asset.sha256 });
    return events.at(-1);
  };
  const derive = events => {
    const attempts = events.filter(e => e.type === "transmission-reserved").map(e => {
      const reservation = e.data;
      const result = events.find(v => v.type === "response-recorded" && v.data.attempt === reservation.attempt)?.data;
      const review = events.find(v => v.type === "review-accepted" && v.data.attempt === reservation.attempt)?.data;
      return { ...reservation, result, review };
    });
    const knownTotal = a => a.result?.costAccounting === "known-total" && a.result?.measured;
    const actual = LIMITS.historicalCostCentiMicroUSD + attempts.reduce((sum, a) =>
      sum + (knownTotal(a) ? a.result.measured.centiMicroUSD : 0), 0);
    const unknown = attempts.filter(a => !knownTotal(a)).reduce((sum, a) => sum + a.projection.centiMicroUSD, 0);
    const closed = events.some(e => e.type === "unmasked");
    const pendingPairReserve = closed ? 0 : events.filter(e => e.type === "pair-reserved")
      .reduce((sum, e) => sum + e.data.projections.reduce((remaining, projection, i) =>
        remaining + (attempts.some(a => a.attempt === e.data.startAttempt + i) ? 0 : projection.centiMicroUSD), 0), 0);
    return {
      attempts, actual, unknown, pendingPairReserve,
      stopped: events.some(e => e.type === "global-stop") || fs.existsSync(file("private/emergency-stop.json")),
      closed,
    };
  };
  const verifyBound = events => {
    assert(events[0]?.type === "initialized", "run_not_initialized");
    const auth = read(file("private/authorization.json"));
    assert(JSON.stringify(auth.limits) === JSON.stringify(LIMITS), "authorization_changed");
    for (const item of auth.codeBindings ?? [])
      assert(hash(fs.readFileSync(relativeSafe(root, item.path))) === item.sha256, "execution_code_changed");
    validatePricing(read(file("preflight/current-pricing.json")));
    return loadPrepared();
  };
  const stop = (events, reason) => {
    if (!events.some(e => e.type === "global-stop")) append(events, "global-stop", { reason });
  };
  const requestFor = (prepared, attempt) => {
    const request = prepared.requests.requests.find(item => item.caseId === attempt.caseId)
      ?.requests.find(item => item.model === attempt.model);
    assertRequest(request);
    return request;
  };
  const summary = events => {
    const state = derive(events), last = state.attempts.at(-1);
    return {
      comparisonId: ID, newTransmissions: state.attempts.length,
      cumulativeTransmissions: LIMITS.historicalTransmissions + state.attempts.length,
      knownCostCentiMicroUSD: state.actual, knownCostMicroUSD: state.actual / 100,
      unknownAttemptReserveCentiMicroUSD: state.unknown,
      untransmittedPairReserveCentiMicroUSD: state.pendingPairReserve,
      accountedAndReservedCentiMicroUSD: state.actual + state.unknown + state.pendingPairReserve,
      stopped: state.stopped, closed: state.closed,
      awaitingReview: last && !last.review ? last.result?.blindPath ?? "unresolved-reservation-use-recover" : null,
      latestBlindPacketSha256: last?.result?.blindPacketSha256 ?? null,
      nextRequiresExplicitCommand: true,
    };
  };

  function initialize() {
    const prepared = loadPrepared();
    assert(!fs.existsSync(file("private/authorization.json")), "already_initialized");
    const pricing = read(file("preflight/current-pricing.json")); validatePricing(pricing);
    const pricingBindings = ["preflight/current-pricing.json", "preflight/official-0.md",
      "preflight/official-1.md", "preflight/official-2.md"].map(bind);
    const mapping = {};
    // Fixed canonical model list, NOT modelOrder or attempt position.
    for (const pair of prepared.order.pairs) {
      const labels = coin() === 0 ? ["X", "Y"] : ["Y", "X"];
      mapping[pair.caseId] = Object.fromEntries(MODELS.map((model, i) => [model, labels[i]]));
    }
    const mappingAsset = record("private/mapping.json", { comparisonId: ID, mapping });
    const codeBindings = bindCode ? ["controls.mjs", "runner.mjs", "cli.mjs"].map(name => {
      const p = `prototypes/evidence-consultation/model-comparison-execution/${name}`;
      return { path: p, sha256: hash(fs.readFileSync(relativeSafe(root, p))) };
    }) : [];
    const authAsset = record("private/authorization.json", {
      schemaVersion: 1, comparisonId: ID, authorizedAt: now(),
      authorization: "explicit-user-24-additional-43-cumulative-USD1-including-history",
      limits: LIMITS, endpoint: ENDPOINT, method: "POST", credentialEnvironmentVariable: "OPENAI_API_KEY",
      legacyUnusedTwentiethSlotForbidden: true, preparedFreezeSha256: prepared.freezeSha256,
      pricingBindings, mappingSha256: mappingAsset.sha256, codeBindings,
      localReservationsAreNotProviderInvoiceGuarantees: true,
    });
    const events = [];
    append(events, "initialized", { comparisonId: ID }, [authAsset, mappingAsset, ...pricingBindings]);
    return summary(events);
  }

  function finishResponse(events, prepared, attempt, result) {
    const mapping = read(file("private/mapping.json")).mapping;
    const label = mapping[attempt.caseId][attempt.model];
    const privatePath = `private/responses/${attempt.caseId}/${label}.json`;
    const responseAsset = record(privatePath, result);
    const packet = blindPacket(prepared, attempt, label, result);
    const blindPath = `blind/${attempt.caseId}/${label}/packet.json`;
    const packetAsset = record(blindPath, packet);
    append(events, "response-recorded", {
      attempt: attempt.attempt, responsePath: privatePath, responseSha256: responseAsset.sha256,
      rawResponseSha256: result.rawResponseSha256,
      blindPath, blindPacketSha256: packetAsset.sha256,
      measured: result.measured, technicalState: result.technicalState,
      costAccounting: result.costAccounting ?? "unknown-retain-reservation",
      costUnknownReasons: result.costUnknownReasons ?? result.stopReasons,
      stopReasons: result.stopReasons,
    }, [responseAsset, packetAsset]);
    if (result.stopReasons.length) stop(events, result.stopReasons.join(","));
    return summary(events);
  }

  async function next() {
    const events = loadEvents(), prepared = verifyBound(events), state = derive(events);
    assert(!state.stopped && !state.closed, "globally_stopped_no_resume");
    assert(state.attempts.every(a => a.result && a.review), "previous_attempt_requires_frozen_blind_review");
    assert(state.attempts.length < 24, "transmission_limit");
    const index = state.attempts.length, planned = prepared.order.attempts[index];
    const request = requestFor(prepared, planned), projection = reserve(request);
    let pair = events.find(e => e.type === "pair-reserved" && e.data.caseId === planned.caseId)?.data;
    if (!pair) {
      assert(index % 2 === 0, "pair_reservation_missing");
      const companion = prepared.order.attempts[index + 1];
      assert(companion.caseId === planned.caseId, "pair_order_invalid");
      const projections = [projection, reserve(requestFor(prepared, companion))];
      const total = projections.reduce((sum, p) => sum + p.centiMicroUSD, 0);
      if (state.actual + state.unknown + total > LIMITS.budgetCentiMicroUSD) {
        stop(events, "remaining_budget_cannot_reserve_complete_pair_sources_not_reduced");
        return summary(events);
      }
      pair = { caseId: planned.caseId, startAttempt: index + 1, projections, centiMicroUSD: total };
      append(events, "pair-reserved", pair);
    }
    assert(state.actual + state.unknown + projection.centiMicroUSD <= LIMITS.budgetCentiMicroUSD,
      "budget_reservation_invalid");
    // The credential is accessed only in this one explicit sending action, after
    // all offline admission/review/hash controls. Never log it or persist headers.
    const key = readCredential();
    assert(typeof key === "string" && key.trim().length > 0, "credential_not_available");
    const attempt = {
      attempt: index + 1, cumulativeTransmission: 20 + index,
      caseId: planned.caseId, model: planned.model, projection,
      requestSha256: hash(JSON.stringify(request)), endpoint: ENDPOINT, method: "POST",
      pairReservedCentiMicroUSD: pair.centiMicroUSD,
    };
    append(events, "transmission-reserved", attempt); // fsync BEFORE the ONLY fetch.
    let result;
    let observedHttpStatus = null, observedRawHash = null;
    const started = clock();
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(LIMITS.timeoutMs),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      observedHttpStatus = response.status;
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        assert(length <= 1048576, "response_too_large");
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks), rawResponseSha256 = hash(raw);
      observedRawHash = rawResponseSha256;
      const body = JSON.parse(raw.toString("utf8"));
      // If the provider echoes a credential, never persist it, even as answer text.
      let redacted = false;
      const sanitize = value => {
        if (typeof value === "string") {
          if (value.includes(key)) { redacted = true; return value.replaceAll(key, "[REDACTED]"); }
          return value;
        }
        if (Array.isArray(value)) return value.map(sanitize);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
          .filter(([name]) => !name.includes(key)).map(([name, v]) => [name, sanitize(v)]));
        return value;
      };
      result = {
        schemaVersion: 1, caseId: planned.caseId, requestSha256: attempt.requestSha256,
        rawResponseSha256, httpStatus: response.status, elapsedMs: Math.max(0, Math.round(clock() - started)),
        ...inspectResponse(sanitize(body), request, projection, response.status),
      };
      if (redacted) {
        result.stopReasons.push("provider_echoed_credential"); result.answer = null;
        result.technicalState = "technical-invalid";
      }
    } catch {
      result = {
        schemaVersion: 1, caseId: planned.caseId, requestSha256: attempt.requestSha256,
        rawResponseSha256: observedRawHash, httpStatus: observedHttpStatus,
        elapsedMs: Math.max(0, Math.round(clock() - started)),
        model: null, status: null, serviceTier: null, usage: null, measured: null,
        incompleteReason: null, errorType: null, errorCode: null, outputText: "", answer: null,
        technicalState: "technical-invalid", stopReasons: ["transport_or_response_unknown_no_retry"],
      };
    }
    return finishResponse(events, prepared, attempt, result);
  }

  function acceptReview(caseId, label, source) {
    const events = loadEvents(); verifyBound(events);
    const state = derive(events), attempt = state.attempts.at(-1);
    assert(!state.closed && attempt?.result && !attempt.review, "latest_attempt_not_reviewable");
    const packetBytes = fs.readFileSync(file(attempt.result.blindPath)), packet = JSON.parse(packetBytes);
    assert(caseId === packet.caseId && label === packet.label, "review_wrong_blind_answer");
    let assessment;
    try { assessment = read(source); }
    catch { throw new Error("review_source_invalid"); }
    validateReview(assessment, packet, hash(packetBytes));
    const asset = record(`private/reviews/${caseId}/${label}.json`, assessment);
    append(events, "review-accepted", {
      attempt: attempt.attempt, caseId, label, reviewSha256: asset.sha256,
      blindPacketSha256: hash(packetBytes), decision: assessment.decision,
    }, [asset]);
    if (assessment.decision === "stop") stop(events, "blind_reviewer_requested_stop");
    return summary(events);
  }

  function recover() {
    const events = loadEvents(), prepared = verifyBound(events), state = derive(events);
    const attempt = state.attempts.at(-1);
    assert(attempt && !attempt.result, "no_unresolved_reservation");
    stop(events, "interrupted_after_write_ahead_reservation_never_retry");
    return finishResponse(events, prepared, attempt, {
      schemaVersion: 1, caseId: attempt.caseId, requestSha256: attempt.requestSha256,
      rawResponseSha256: null, httpStatus: null, elapsedMs: null, usage: null, measured: null,
      status: null, incompleteReason: null, outputText: "", answer: null,
      technicalState: "technical-invalid", stopReasons: ["reserved_transmission_outcome_unknown_no_retry"],
    });
  }

  function unmask(reason) {
    const events = loadEvents(), prepared = verifyBound(events), state = derive(events);
    assert(!state.closed && typeof reason === "string" && reason.trim().length >= 8, "unmask_requires_closure_reason");
    assert(state.attempts.every(a => a.result && a.review), "unmask_requires_all_attempted_reviews_frozen");
    const mapping = read(file("private/mapping.json")).mapping;
    const asset = record("unmasked/final.json", {
      schemaVersion: 1, comparisonId: ID, closedAt: now(), closureReason: reason,
      mapping, summary: { ...summary(events), closed: true,
        untransmittedPairReserveCentiMicroUSD: 0, accountedAndReservedCentiMicroUSD: state.actual + state.unknown },
      attempted: state.attempts,
      unexecuted: prepared.order.attempts.slice(state.attempts.length).map(attempt => ({
        caseId: attempt.caseId, model: attempt.model,
        explanation: state.stopped ? "global-stop; " + reason : "operator-closed-without-transmitting; " + reason,
      })),
      safety: "AI evaluation only; no clinical, adoption, publication or normal-gate approval changes.",
    });
    append(events, "unmasked", { reason, file: asset.path }, [asset]);
    return { ...summary(events), unmaskedFile: asset.path };
  }

  function status() {
    const events = loadEvents(); verifyBound(events);
    return summary(events);
  }
  function emergencyStop() {
    if (fs.existsSync(file("private/authorization.json")) && !fs.existsSync(file("private/emergency-stop.json")))
      record("private/emergency-stop.json", { reason: "integrity_or_unexpected_local_failure_no_resume", at: now() });
  }
  return { initialize, next, acceptReview, recover, unmask, status, emergencyStop };
}

// The legacy lock is deliberately shared. No old ledger is modified. An existing
// or stale lock fails closed; never automatically delete someone else's lock.
export async function withSharedLock(action, root = ROOT) {
  const lockPath = path.join(root, "evidence-work/model-evaluation/.isolated-reading.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(lockPath, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${process.pid}\n`); fs.fsyncSync(fd);
    return await action();
  } finally { fs.closeSync(fd); fs.unlinkSync(lockPath); }
}