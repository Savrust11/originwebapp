// Isolated, append-only, single-case runner. Importing this file has no side effects.
// Network and credential access exist only in next(), after a durable reservation.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { inspectControls, containsCredential } from "../model-comparison-v2/controls.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const PREFLIGHT = "evidence-work/parent-reading-evaluation/execution-01/preflight";
export const OUTPUT = "evidence-work/parent-reading-evaluation/execution-01/run";
export const ENDPOINT = "https://api.openai.com/v1/responses";
export const ORDER = ["P01", "P04", "P06", "P09", "P10"];
export const OPENING = Object.freeze({
  knownCentiMicroUSD: 36292260,
  unresolvedCentiMicroUSD: 551250,
  totalCentiMicroUSD: 36843510,
  historicalTransmissions: 42,
});
export const LIMITS = Object.freeze({
  newAuthorizationCentiMicroUSD: 5000000,
  cumulativeCentiMicroUSD: 100000000,
  maxNetworkAttempts: 5,
  timeoutMs: 120000,
});
export const RATES = Object.freeze({ input: 20, output: 120, cachedInput: 2, cacheWrite: 25 });
export const INPUT_OVERHEAD_TOKENS = 2048;
export const APPROVED_INPUT_ENVELOPE_TOKENS = 32000;

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const equivalent = (left, right) => {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return left === right;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left))
    return left.length === right.length && left.every((value, index) => equivalent(value, right[index]));
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equivalent(left[key], right[key]));
};
const assert = (condition, code) => { if (!condition) throw new Error(code); };
export const hash = value => createHash("sha256").update(value).digest("hex");
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

function safe(root, relative) {
  assert(typeof relative === "string" && relative.length && !path.isAbsolute(relative)
    && !relative.split(/[\\/]/).includes(".."), "unsafe_relative_path");
  const result = path.join(root, relative);
  for (let cursor = result; cursor.startsWith(root) && cursor !== root; cursor = path.dirname(cursor))
    if (fs.existsSync(cursor)) assert(!fs.lstatSync(cursor).isSymbolicLink(), "symlink_forbidden");
  return result;
}

function writeOnce(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  const directory = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

export async function withSharedLock(action, root = ROOT) {
  const lock = safe(root, "evidence-work/model-evaluation/.isolated-reading.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(lock, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    fs.fsyncSync(descriptor);
    return await action();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

export function assertRequest(request) {
  const topLevel = ["model", "service_tier", "reasoning", "max_output_tokens", "tools", "store",
    "background", "truncation", "prompt_cache_options", "input", "text"];
  const exactKeys = (value, expected) => object(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
  const expectedSchema = {
    type: "object",
    properties: {
      answer: { type: "string" },
      citations: { type: "array", items: { type: "string" } },
    },
    required: ["answer", "citations"],
    additionalProperties: false,
  };
  assert(exactKeys(request, topLevel)
    && request.model === "gpt-5.6-luna"
    && request.service_tier === "default"
    && exactKeys(request.reasoning, ["effort"]) && request.reasoning.effort === "medium"
    && request.max_output_tokens === 1500
    && request.store === false
    && request.background === false
    && Array.isArray(request.tools) && request.tools.length === 0
    && request.truncation === "disabled"
    && exactKeys(request.prompt_cache_options, ["mode"]) && request.prompt_cache_options.mode === "explicit"
    && Array.isArray(request.input) && request.input.length === 2
    && request.input.every((message, index) => exactKeys(message, ["role", "content"])
      && message.role === ["system", "user"][index]
      && typeof message.content === "string" && message.content.length > 0)
    && exactKeys(request.text, ["format"])
    && exactKeys(request.text.format, ["type", "name", "strict", "schema"])
    && request.text.format.type === "json_schema"
    && request.text.format.name === "parent_reading_answer"
    && request.text.format.strict === true
    && equivalent(request.text.format.schema, expectedSchema),
  "request_controls_or_shape_changed");
}

function sourceIds(request) {
  const user = request.input?.find(item => item?.role === "user");
  assert(typeof user?.content === "string", "request_user_payload_invalid");
  const payload = JSON.parse(user.content);
  const sources = payload.originalEvidence ?? payload.original_evidence;
  assert(Array.isArray(sources) && sources.length, "request_sources_invalid");
  const ids = sources.map(source => source?.originalId ?? source?.original_id);
  assert(ids.every(id => typeof id === "string" && id.length && id.length <= 500)
    && new Set(ids).size === ids.length, "request_source_ids_invalid");
  return ids;
}

export function validatePackets(document) {
  assert(object(document) && document.schemaVersion === 1
    && Array.isArray(document.packets) && document.packets.length === ORDER.length
    && object(document.pricing), "packet_document_invalid");
  const pricing = document.pricing;
  assert(pricing.endpoint === ENDPOINT && pricing.model === "gpt-5.6-luna"
    && !Number.isNaN(Date.parse(pricing.verifiedAt))
    && JSON.stringify(pricing.ratesCentiMicroUSDPerToken) === JSON.stringify(RATES)
    && pricing.cachePolicy === "explicit-no-reads-or-writes", "pricing_invalid");
  document.packets.forEach((packet, index) => {
    const derivedMinimum = Buffer.byteLength(JSON.stringify(packet?.request), "utf8")
      + INPUT_OVERHEAD_TOKENS;
    assert(object(packet) && packet.caseId === ORDER[index] && object(packet.localInputEstimate)
      && integer(packet.localInputEstimate.tokenBound)
      && packet.localInputEstimate.tokenBound >= derivedMinimum
      && packet.localInputEstimate.tokenBound <= APPROVED_INPUT_ENVELOPE_TOKENS
      && typeof packet.localInputEstimate.method === "string"
      && packet.localInputEstimate.method.length > 0
      && integer(packet.reserveCentiMicroUSD), "packet_invalid");
    assertRequest(packet.request);
    sourceIds(packet.request);
    const requiredReserve = packet.localInputEstimate.tokenBound * RATES.cacheWrite
      + packet.request.max_output_tokens * RATES.output;
    assert(Number.isSafeInteger(requiredReserve)
      && packet.reserveCentiMicroUSD === requiredReserve, "reservation_calculation_invalid");
  });
  const authorized = document.packets.reduce((sum, packet) => sum + packet.reserveCentiMicroUSD, 0);
  assert(Number.isSafeInteger(authorized)
    && authorized <= LIMITS.newAuthorizationCentiMicroUSD
    && OPENING.totalCentiMicroUSD + authorized <= LIMITS.cumulativeCentiMicroUSD,
  "authorization_budget_invalid");
  return document;
}

function validateManifest(root, preflight, manifest, packetBytes) {
  assert(object(manifest) && manifest.schemaVersion === 1
    && manifest.audit?.decision === "authorized"
    && typeof manifest.audit?.completedAt === "string"
    && !Number.isNaN(Date.parse(manifest.audit.completedAt))
    && Array.isArray(manifest.bindings) && manifest.bindings.length > 0, "manifest_invalid");
  assert(JSON.stringify(manifest.historicalClosure) === JSON.stringify(OPENING),
    "historical_closure_accounting_changed");
  const roles = new Set();
  const seen = new Set();
  for (const binding of manifest.bindings) {
    assert(object(binding) && typeof binding.path === "string"
      && /^[a-f0-9]{64}$/.test(binding.sha256)
      && ["protocol", "source", "price", "payload", "controlcode", "historical-closure"].includes(binding.role)
      && !seen.has(binding.path), "manifest_binding_invalid");
    const bytes = fs.readFileSync(safe(root, binding.path));
    assert(hash(bytes) === binding.sha256, "bound_preflight_changed");
    roles.add(binding.role);
    seen.add(binding.path);
  }
  for (const role of ["protocol", "source", "price", "payload", "controlcode", "historical-closure"])
    assert(roles.has(role), `manifest_role_missing:${role}`);
  const packetPath = `${preflight}/request-packets.json`;
  assert(manifest.bindings.some(binding => binding.path === packetPath
    && binding.role === "payload" && binding.sha256 === hash(packetBytes)), "packets_not_hashbound");
  return manifest;
}

function measureUsage(usage) {
  const exactKeys = (value, names) => object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());
  assert(exactKeys(usage, ["input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details"])
    && exactKeys(usage.input_tokens_details, ["cached_tokens", "cache_write_tokens"])
    && exactKeys(usage.output_tokens_details, ["reasoning_tokens"]), "usage_schema_or_price_unknown");
  const input = usage.input_tokens, output = usage.output_tokens;
  const read = usage.input_tokens_details.cached_tokens;
  const write = usage.input_tokens_details.cache_write_tokens;
  const reasoning = usage.output_tokens_details.reasoning_tokens;
  assert([input, output, read, write, reasoning, usage.total_tokens].every(integer)
    && read + write <= input && reasoning <= output
    && usage.total_tokens === input + output, "usage_inconsistent_or_price_unknown");
  const uncached = input - read - write;
  const centiMicroUSD = uncached * RATES.input + read * RATES.cachedInput
    + write * RATES.cacheWrite + output * RATES.output;
  assert(integer(centiMicroUSD), "usage_cost_overflow");
  return { input, output, uncached, read, write, reasoning, centiMicroUSD };
}

function validateAnswer(value, ids) {
  assert(object(value) && Object.keys(value).length === 2
    && typeof value.answer === "string" && value.answer.trim().length > 0
    && Array.isArray(value.citations)
    && value.citations.every(id => typeof id === "string" && ids.includes(id)),
  "answer_schema_or_citation_invalid");
  return { answer: value.answer, citations: value.citations };
}

function outputText(body, globalReasons, caseReasons) {
  const output = Array.isArray(body?.output) ? body.output : [];
  if (!Array.isArray(body?.output)) caseReasons.push("missing_output");
  if (output.some(item => !["message", "reasoning"].includes(item?.type)))
    globalReasons.push("control:unexpected_tool_or_output_type");
  for (const item of output.filter(item => item?.type === "reasoning"))
    if ((Array.isArray(item.summary) && item.summary.length)
      || (Object.hasOwn(item, "content") && item.content !== null
        && (!Array.isArray(item.content) || item.content.length)))
      caseReasons.push("unexpected_reasoning_content");
  const messages = output.filter(item => item?.type === "message");
  const texts = [];
  for (const message of messages) {
    if (message.role !== "assistant") globalReasons.push("control:unexpected_message_role");
    if (message.status !== "completed") caseReasons.push("incomplete_message");
    if (!Array.isArray(message.content)) { caseReasons.push("invalid_message_content"); continue; }
    for (const content of message.content) {
      if (content?.type !== "output_text" || typeof content.text !== "string"
        || (content.annotations !== undefined && (!Array.isArray(content.annotations) || content.annotations.length)))
        caseReasons.push("invalid_output_content");
      else texts.push(content.text);
    }
  }
  if (messages.length !== 1) caseReasons.push("message_count_invalid");
  return texts.join("\n");
}

export function inspectResponse(body, request, reservation, httpStatus, credential = "") {
  assert(!containsCredential(body, credential), "credential_echo");
  const globalReasons = [], caseReasons = [];
  let measured = null;
  try { measured = measureUsage(body?.usage); }
  catch { globalReasons.push("price:usage_unusable"); }
  if (!(httpStatus >= 200 && httpStatus < 300) || body?.error != null)
    globalReasons.push("provider:http_or_error");
  if (body?.model !== request.model) globalReasons.push("control:actual_model_differs");
  if (body?.service_tier !== "default") globalReasons.push("price:service_tier_unknown");
  const controlEvidence = inspectControls(body, request, { credential });
  globalReasons.push(...controlEvidence.violations.map(reason => `control:${reason}`));
  globalReasons.push(...controlEvidence.evidenceFailures.map(reason => `control-evidence:${reason}`));
  if (body?.status === "incomplete" || body?.status === "completed" && body?.incomplete_details != null)
    caseReasons.push("incomplete_output");
  else if (body?.status !== "completed") globalReasons.push("provider:unexpected_status");
  const text = outputText(body, globalReasons, caseReasons);
  let answer = null;
  try { answer = validateAnswer(JSON.parse(text), sourceIds(request)); }
  catch { caseReasons.push("answer_schema_or_citation_invalid"); }
  let retainReservation = !measured;
  if (measured) {
    if (measured.read || measured.write) {
      globalReasons.push("control:unexpected_cache_reads_or_writes");
      retainReservation = true;
    }
    if (measured.input > reservation.localInputTokenBound
      || measured.output > request.max_output_tokens
      || measured.centiMicroUSD > reservation.centiMicroUSD) {
      globalReasons.push("budget:reservation_bound_exceeded");
      retainReservation = true;
    }
  }
  return {
    safeControlValues: controlEvidence.fields,
    metadata: {
      state: controlEvidence.unknown.length || controlEvidence.unresolved.length
        ? "metadata-unresolved-harmless-unless-impact-proven" : "no-unresolved-additions-observed",
      unknown: controlEvidence.unknown,
      unresolved: controlEvidence.unresolved,
    },
    providerStatus: ["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"].includes(body?.status)
      ? body.status : "unrecognized",
    usage: measured ? {
      input_tokens: measured.input, output_tokens: measured.output,
      total_tokens: measured.input + measured.output,
      input_tokens_details: { cached_tokens: measured.read, cache_write_tokens: measured.write },
      output_tokens_details: { reasoning_tokens: measured.reasoning },
    } : null,
    measured,
    retainReservation,
    costAccounting: measured ? "known-total" : "unknown-retain-reservation",
    answer: caseReasons.length ? null : answer,
    technicalState: !caseReasons.length && !globalReasons.length ? "completed-schema" : "technical-invalid",
    caseReasons: [...new Set(caseReasons)],
    stopReasons: [...new Set(globalReasons)],
  };
}

export function derive(events) {
  const attempts = events.filter(event => event.type === "transmission-reserved").map(event => {
    const result = events.find(candidate => candidate.type === "response-recorded"
      && candidate.data.attempt === event.data.attempt)?.data;
    return { ...event.data, result };
  });
  let newKnownCentiMicroUSD = 0, newUnresolvedCentiMicroUSD = 0;
  for (const attempt of attempts) {
    if (!attempt.result || attempt.result.costAccounting !== "known-total")
      newUnresolvedCentiMicroUSD += attempt.reservation.centiMicroUSD;
    else {
      const charged = attempt.result.measured.centiMicroUSD;
      newKnownCentiMicroUSD += charged;
      if (attempt.result.retainReservation)
        newUnresolvedCentiMicroUSD += Math.max(0, attempt.reservation.centiMicroUSD - charged);
    }
  }
  const knownCentiMicroUSD = OPENING.knownCentiMicroUSD + newKnownCentiMicroUSD;
  const unresolvedCentiMicroUSD = OPENING.unresolvedCentiMicroUSD + newUnresolvedCentiMicroUSD;
  return {
    attempts, newKnownCentiMicroUSD, newUnresolvedCentiMicroUSD,
    knownCentiMicroUSD, unresolvedCentiMicroUSD,
    totalCentiMicroUSD: knownCentiMicroUSD + unresolvedCentiMicroUSD,
    stopped: events.some(event => event.type === "global-stop")
      || attempts.some(attempt => !attempt.result || attempt.result.stopReasons?.length),
    closed: events.some(event => event.type === "authorization-closed"),
  };
}

export function createRunner({
  root = ROOT, preflight = PREFLIGHT, output = OUTPUT,
  fetchImpl = (...arguments_) => fetch(...arguments_),
  readCredential = () => process.env.OPENAI_API_KEY,
  now = () => new Date().toISOString(),
} = {}) {
  const base = safe(root, output);
  const out = relative => safe(base, relative);
  const record = (relative, value) => {
    const bytes = encode(value);
    writeOnce(out(relative), bytes);
    return { path: relative, sha256: hash(bytes) };
  };
  const loadEvents = () => {
    const directory = out("private/events");
    if (!fs.existsSync(directory)) return [];
    let previousSha256 = null;
    return fs.readdirSync(directory).sort().map((name, index) => {
      assert(name === `${String(index + 1).padStart(6, "0")}.json`, "event_sequence_broken");
      const bytes = fs.readFileSync(path.join(directory, name));
      const event = JSON.parse(bytes);
      assert(event.sequence === index + 1 && event.previousSha256 === previousSha256,
        "event_chain_broken");
      for (const asset of event.assets ?? [])
        assert(hash(fs.readFileSync(out(asset.path))) === asset.sha256, "sealed_asset_changed");
      previousSha256 = hash(bytes);
      return { ...event, sha256: previousSha256 };
    });
  };
  const append = (events, type, data, assets = []) => {
    const event = { sequence: events.length + 1, previousSha256: events.at(-1)?.sha256 ?? null,
      at: now(), type, data, assets };
    const asset = record(`private/events/${String(event.sequence).padStart(6, "0")}.json`, event);
    events.push({ ...event, sha256: asset.sha256 });
  };
  const loadPreflight = () => {
    const packetPath = safe(root, `${preflight}/request-packets.json`);
    const packetBytes = fs.readFileSync(packetPath);
    const packets = validatePackets(JSON.parse(packetBytes));
    const manifestPath = safe(root, `${preflight}/preflight-manifest.json`);
    const manifestBytes = fs.readFileSync(manifestPath);
    const manifest = validateManifest(root, preflight, JSON.parse(manifestBytes), packetBytes);
    return { packets, manifest, manifestSha256: hash(manifestBytes) };
  };
  const verify = events => {
    assert(events[0]?.type === "initialized", "run_not_initialized");
    const prepared = loadPreflight();
    const authorization = readJson(out("private/authorization.json"));
    assert(authorization.preflightManifestSha256 === prepared.manifestSha256
      && JSON.stringify(authorization.opening) === JSON.stringify(OPENING)
      && JSON.stringify(authorization.limits) === JSON.stringify(LIMITS), "authorization_changed");
    return prepared;
  };
  const stop = (events, reason) => {
    if (!events.some(event => event.type === "global-stop"))
      append(events, "global-stop", { reason });
  };
  const summary = events => {
    const state = derive(events);
    return {
      initialized: events.length > 0,
      order: ORDER,
      newNetworkAttempts: state.attempts.length,
      historicalTransmissionsForReportOnly: OPENING.historicalTransmissions,
      cumulativeTransmissionsForReportOnly: OPENING.historicalTransmissions + state.attempts.length,
      nextCaseId: !state.stopped && !state.closed ? ORDER[state.attempts.length] ?? null : null,
      stopped: state.stopped,
      closed: state.closed,
      accounting: {
        opening: OPENING,
        newKnownCentiMicroUSD: state.newKnownCentiMicroUSD,
        newUnresolvedCentiMicroUSD: state.newUnresolvedCentiMicroUSD,
        knownCentiMicroUSD: state.knownCentiMicroUSD,
        unresolvedCentiMicroUSD: state.unresolvedCentiMicroUSD,
        totalCentiMicroUSD: state.totalCentiMicroUSD,
      },
      nextRequiresExplicitCommand: true,
    };
  };

  function initialize() {
    assert(!fs.existsSync(out("private/authorization.json")), "already_initialized");
    const prepared = loadPreflight();
    const authorized = prepared.packets.packets.reduce((sum, packet) => sum + packet.reserveCentiMicroUSD, 0);
    const authorization = record("private/authorization.json", {
      schemaVersion: 1,
      endpoint: ENDPOINT,
      method: "POST",
      credentialEnvironmentVariable: "OPENAI_API_KEY",
      preflightManifestSha256: prepared.manifestSha256,
      opening: OPENING,
      limits: LIMITS,
      authorizedMaximumCentiMicroUSD: authorized,
      noRepurpose: true,
      historicalCallsAreNotSlots: true,
    });
    const events = [];
    append(events, "initialized", {
      exactOrder: ORDER, maxNetworkAttempts: LIMITS.maxNetworkAttempts,
      authorizedMaximumCentiMicroUSD: authorized,
    }, [authorization]);
    return summary(events);
  }

  async function next() {
    const events = loadEvents();
    const prepared = verify(events);
    let state = derive(events);
    assert(!state.closed && !state.stopped, "continuation_stopped");
    assert(state.attempts.length < ORDER.length
      && state.attempts.length < LIMITS.maxNetworkAttempts, "network_attempt_limit");
    const packet = prepared.packets.packets[state.attempts.length];
    assert(packet.caseId === ORDER[state.attempts.length]
      && !state.attempts.some(attempt => attempt.caseId === packet.caseId), "order_or_duplicate_invalid");
    const projectedNew = state.newKnownCentiMicroUSD + state.newUnresolvedCentiMicroUSD
      + packet.reserveCentiMicroUSD;
    if (projectedNew > LIMITS.newAuthorizationCentiMicroUSD
      || OPENING.totalCentiMicroUSD + projectedNew > LIMITS.cumulativeCentiMicroUSD) {
      stop(events, "budget:cannot_reserve");
      return summary(events);
    }
    const requestBytes = encode(packet.request);
    const requestAsset = record(`private/requests/${packet.caseId}.json`, packet.request);
    const attempt = {
      attempt: state.attempts.length + 1,
      caseId: packet.caseId,
      endpoint: ENDPOINT,
      method: "POST",
      requestSha256: hash(requestBytes),
      reservation: {
        centiMicroUSD: packet.reserveCentiMicroUSD,
        localInputTokenBound: packet.localInputEstimate.tokenBound,
      },
    };
    append(events, "transmission-reserved", attempt, [requestAsset]);
    const credential = readCredential();
    if (typeof credential !== "string" || !credential.trim()) {
      stop(events, "credential_unavailable_after_reservation");
      return summary(events);
    }
    let result, rawResponseSha256 = null, httpStatus = null;
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(LIMITS.timeoutMs),
        headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        body: JSON.stringify(packet.request),
      });
      httpStatus = response.status;
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        assert(size <= 1048576, "response_too_large");
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks);
      rawResponseSha256 = hash(raw);
      result = inspectResponse(JSON.parse(raw.toString("utf8")), packet.request,
        attempt.reservation, httpStatus, credential);
    } catch {
      result = {
        safeControlValues: [], metadata: { state: "unavailable", unknown: [], unresolved: [] },
        providerStatus: "unavailable", usage: null, measured: null,
        retainReservation: true, costAccounting: "unknown-retain-reservation",
        answer: null, technicalState: "technical-invalid", caseReasons: [],
        stopReasons: ["transport_or_response_unknown_no_retry"],
      };
    }
    const safeResponse = {
      caseId: packet.caseId,
      requestSha256: attempt.requestSha256,
      rawResponseSha256,
      httpStatus,
      ...result,
    };
    const responseAsset = record(`private/responses/${packet.caseId}.json`, safeResponse);
    append(events, "response-recorded", {
      attempt: attempt.attempt,
      caseId: packet.caseId,
      responsePath: responseAsset.path,
      measured: result.measured,
      costAccounting: result.costAccounting,
      retainReservation: result.retainReservation,
      technicalState: result.technicalState,
      caseReasons: result.caseReasons,
      stopReasons: result.stopReasons,
    }, [responseAsset]);
    state = derive(events);
    if (result.stopReasons.length) stop(events, result.stopReasons[0]);
    if (state.newKnownCentiMicroUSD + state.newUnresolvedCentiMicroUSD > LIMITS.newAuthorizationCentiMicroUSD
      || state.totalCentiMicroUSD > LIMITS.cumulativeCentiMicroUSD)
      stop(events, "budget:post_response_limit_exceeded");
    return summary(events);
  }

  function status() {
    const events = loadEvents();
    if (events.length) verify(events);
    else loadPreflight();
    return summary(events);
  }

  function close(reason) {
    const events = loadEvents();
    const prepared = verify(events);
    const state = derive(events);
    assert(!state.closed && typeof reason === "string" && reason.trim().length >= 8,
      "closure_reason_invalid");
    const authorized = prepared.packets.packets.reduce((sum, packet) => sum + packet.reserveCentiMicroUSD, 0);
    append(events, "authorization-closed", {
      reasonSha256: hash(reason),
      spentOrRetainedCentiMicroUSD: state.newKnownCentiMicroUSD + state.newUnresolvedCentiMicroUSD,
      unspentAuthorizationCentiMicroUSD: Math.max(0,
        authorized - state.newKnownCentiMicroUSD - state.newUnresolvedCentiMicroUSD),
      noRepurpose: true,
    });
    return summary(events);
  }

  const guarded = function_ => (...arguments_) => withSharedLock(() => function_(...arguments_), root);
  return {
    initialize: guarded(initialize),
    status: guarded(status),
    next: guarded(next),
    close: guarded(close),
  };
}
