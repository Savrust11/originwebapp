import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { buildPendingRequest } from "../private-parenting-trial-11/request-builder.mjs";
import { loadPlans, selectedMessage } from "../private-parenting-trial-11/plan-adapter.mjs";
import {
  ROOT, ENDPOINT, MODEL, SCENES, LIMITS, RATES, RESERVE_PER_ATTEMPT,
} from "./policy.mjs";
import {
  sha, encode, writeOnce, appendEvent, readEvents, validatePreflight,
} from "./preflight.mjs";

const run = path.join(ROOT, "run");
const eventsDir = path.join(run, "private/events");
const lockPath = path.join(ROOT, ".single-run.lock");
const safeCode = error => /^[A-Z0-9_:.-]+$/.test(error?.message ?? "") ? error.message : "OPERATION_FAILED";
function assertLiveGo() {
  const value = JSON.parse(fs.readFileSync(path.join(ROOT, "preflight/main-live-go.json"), "utf8"));
  if (value?.format !== "weiku.private-parenting-trial-12.main-live-go.v1"
    || value.approvedByMain !== true
    || value.maximumAttempts !== 8 || value.maximumCostUSD !== 0.03
    || value.serialOnly !== true || value.retries !== 0
    || value.sceneIds?.join("|") !== Object.keys(SCENES).join("|")) {
    throw Error("MAIN_LIVE_GO_INVALID");
  }
}
const asset = (relative, bytes) => {
  const file = path.join(ROOT, relative);
  writeOnce(file, bytes);
  return { path: relative, sha256: sha(bytes) };
};
const locked = async action => {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(lockPath, "wx", 0o600);
  try { fs.writeFileSync(fd, `${process.pid}\n`); fs.fsyncSync(fd); return await action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lockPath); }
};
const attempts = events => events.filter(event => event.type === "transmission-reserved");
const responses = events => events.filter(event => event.type === "response-recorded");
const stopped = events => events.some(event => event.type === "global-stop");
const closed = events => events.some(event => event.type === "authorization-closed");
function sceneAttempts(events, sceneId) {
  return attempts(events).filter(event => event.data.sceneId === sceneId);
}
function summary(events) {
  const reserved = attempts(events).reduce((sum, event) => sum + event.data.reservationCentiMicroUSD, 0);
  let known = 0, unresolved = 0;
  for (const event of attempts(events)) {
    const response = responses(events).find(item => item.data.attempt === event.data.attempt);
    if (!response?.data.measuredCentiMicroUSD && response?.data.measuredCentiMicroUSD !== 0)
      unresolved += event.data.reservationCentiMicroUSD;
    else {
      known += response.data.measuredCentiMicroUSD;
      if (response.data.retainReservation)
        unresolved += Math.max(0, event.data.reservationCentiMicroUSD - response.data.measuredCentiMicroUSD);
    }
  }
  const latest = [...responses(events)].reverse().find(event => event.data.usableConversationAnswer);
  let latestAnswer = null;
  if (latest?.data.metadataPath) {
    const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, latest.data.metadataPath), "utf8"));
    latestAnswer = {
      sceneId: metadata.sceneId,
      parentMessageId: metadata.parentMessageId,
      text: metadata.extractedVisibleText,
      usage: metadata.usage,
    };
  }
  const haltedScenes = events.filter(event => event.type === "scene-halted")
    .map(event => ({ sceneId: event.data.sceneId, reason: event.data.reason }));
  return {
    currentHistoricalCumulative: 47,
    newAttempts: attempts(events).length,
    cumulativeAttempts: 47 + attempts(events).length,
    maximumNewAttempts: LIMITS.attempts,
    reservedCentiMicroUSD: reserved,
    knownCentiMicroUSD: known,
    unresolvedCentiMicroUSD: unresolved,
    stopped: stopped(events),
    closed: closed(events),
    latestAnswer,
    haltedScenes,
    nextRequiresExplicitCommand: true,
  };
}
function stop(events, reason) {
  if (!stopped(events)) appendEvent(eventsDir, events, "global-stop", { reason });
}
function outputText(body) {
  const messages = Array.isArray(body?.output) ? body.output.filter(item => item?.type === "message") : [];
  if (messages.length !== 1 || messages[0].role !== "assistant") throw Error("RESPONSE_MESSAGE_INVALID");
  const content = messages[0].content;
  if (!Array.isArray(content) || content.some(item => item?.type !== "output_text" || typeof item.text !== "string"))
    throw Error("RESPONSE_CONTENT_INVALID");
  const text = content.map(item => item.text).join("\n");
  if (!text.trim()) throw Error("RESPONSE_TEXT_EMPTY");
  return text;
}
function validateEchoedControls(body) {
  if (body?.model !== MODEL
    || body.service_tier !== "default"
    || body.store !== false
    || body.background !== false
    || body.truncation !== "disabled"
    || body.max_output_tokens !== LIMITS.outputTokens
    || !Array.isArray(body.tools) || body.tools.length !== 0
    || body.reasoning?.effort !== "medium"
    || body.prompt_cache_options?.mode !== "explicit") {
    throw Error("ECHOED_CONTROLS_UNKNOWN_OR_MISMATCHED");
  }
}
function usageCost(body) {
  const usage = body?.usage;
  if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens)
    || usage.input_tokens < 0 || usage.output_tokens < 0
    || usage.input_tokens > LIMITS.inputTokens || usage.output_tokens > LIMITS.outputTokens)
    throw Error("USAGE_UNKNOWN");
  const cached = usage.input_tokens_details?.cached_tokens;
  const write = usage.input_tokens_details?.cache_write_tokens;
  if (!Number.isSafeInteger(cached) || !Number.isSafeInteger(write)) throw Error("CACHE_USAGE_UNKNOWN");
  if (cached !== 0 || write !== 0) throw Error("CACHE_PRICE_UNEXPECTED");
  const centiMicroUSD = usage.input_tokens * RATES.inputCentiMicroUSD
    + usage.output_tokens * RATES.outputCentiMicroUSD;
  if (centiMicroUSD > RESERVE_PER_ATTEMPT) throw Error("COST_EXCEEDS_RESERVATION");
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, centiMicroUSD };
}
function sendExact(bytes, credential) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT);
    const request = https.request({
      protocol: url.protocol, hostname: url.hostname, port: 443, path: url.pathname,
      method: "POST", timeout: LIMITS.timeoutMs,
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        "Content-Length": bytes.length,
      },
      agent: false,
    }, response => {
      const chunks = []; let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > LIMITS.responseBytes) request.destroy(Error("RESPONSE_TOO_LARGE"));
        else chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
    });
    request.on("timeout", () => request.destroy(Error("TRANSPORT_TIMEOUT")));
    request.on("error", reject);
    request.end(bytes);
  });
}
function buildRequest(events, sceneId, parentMessageId) {
  const initial = buildPendingRequest({ sceneId, parentMessageId: "initial", previousTurns: [] });
  const packet = structuredClone(initial.packet);
  const conversation = [];
  const plans = loadPlans();
  const scene = plans.scenes.scenes.find(item => item.id === sceneId);
  for (const attempt of sceneAttempts(events, sceneId)) {
    const recorded = responses(events).find(item => item.data.attempt === attempt.data.attempt);
    if (!recorded?.data.usableConversationAnswer) throw Error("PRIOR_RESPONSE_NOT_USABLE");
    conversation.push({ role: "user", content: selectedMessage(scene, attempt.data.parentMessageId).text });
    const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, recorded.data.metadataPath), "utf8"));
    if (metadata.classification !== "actual_model_raw_response"
      || metadata.requestSha256 !== attempt.data.requestSha256
      || metadata.rawSha256 !== sha(fs.readFileSync(path.join(ROOT, recorded.data.rawPath)))) {
      throw Error("PRIOR_RESPONSE_RECEIPT_INVALID");
    }
    conversation.push({ role: "assistant", content: metadata.extractedVisibleText });
  }
  conversation.push({ role: "user", content: selectedMessage(scene, parentMessageId).text });
  packet.input = [...packet.input.slice(0, 2), ...conversation];
  const serialized = JSON.stringify(packet);
  const utf8Bytes = Buffer.byteLength(serialized);
  return {
    packet, serialized, sha256: sha(Buffer.from(serialized)),
    inputMeasurement: { utf8Bytes },
    syntheticOfflineOnly: false,
    attributionSidecar: initial.sidecar.sourceAttribution,
  };
}
function assertParentMessage(sceneId, messageId, count) {
  const scene = loadPlans().scenes.scenes.find(item => item.id === sceneId);
  if (!scene || !Object.hasOwn(SCENES, sceneId)) throw Error("SCENE_NOT_AUTHORIZED");
  selectedMessage(scene, messageId);
  if ((count === 0) !== (messageId === "initial")) throw Error("PARENT_MESSAGE_ORDER_INVALID");
  if (count >= SCENES[sceneId]) throw Error("SCENE_ATTEMPT_LIMIT");
}
export function createRunner({ transport = sendExact, readCredential = () => process.env.OPENAI_API_KEY } = {}) {
  async function initialize() {
    if (fs.existsSync(path.join(run, "private/authorization.json"))) throw Error("ALREADY_INITIALIZED");
    const prepared = validatePreflight();
    const authorization = {
      format: "weiku.private-parenting-trial-12.authorization.v1",
      status: "authorized-not-yet-transmitted",
      endpoint: ENDPOINT, model: MODEL,
      ...prepared.authorization,
      publicSpecSha256: prepared.publicSpec.sha256,
      frozenPlanHashes: prepared.plans.hashes,
      oldLedgersModified: false,
    };
    const authAsset = asset("run/private/authorization.json", Buffer.from(encode(authorization)));
    const events = [];
    appendEvent(eventsDir, events, "initialized", {
      authorizedSceneIds: Object.keys(SCENES),
      maximumAttempts: LIMITS.attempts,
      maximumReserveCentiMicroUSD: prepared.authorization.maximumReserveCentiMicroUSD,
    }, [authAsset]);
    return summary(events);
  }
  async function status() {
    const events = readEvents(eventsDir);
    if (events.length) validatePreflight();
    return summary(events);
  }
  async function send(sceneId, parentMessageId) {
    const events = readEvents(eventsDir);
    if (!events.length || stopped(events) || closed(events)) throw Error("RUN_NOT_CONTINUABLE");
    validatePreflight();
    const unmatched = attempts(events).find(event =>
      !responses(events).some(response => response.data.attempt === event.data.attempt));
    if (unmatched) {
      stop(events, "UNMATCHED_RESERVATION_UNKNOWN_OUTCOME");
      return summary(events);
    }
    assertLiveGo();
    const all = attempts(events), prior = sceneAttempts(events, sceneId);
    if (events.some(event => event.type === "scene-halted" && event.data.sceneId === sceneId))
      throw Error("SCENE_ALREADY_HALTED");
    assertParentMessage(sceneId, parentMessageId, prior.length);
    if (prior.some(event => event.data.parentMessageId === parentMessageId))
      throw Error("PARENT_MESSAGE_ALREADY_USED");
    if (all.length >= LIMITS.attempts) throw Error("ATTEMPT_LIMIT");
    const pending = buildRequest(events, sceneId, parentMessageId);
    if (pending.syntheticOfflineOnly || pending.inputMeasurement.utf8Bytes + LIMITS.requestFramingTokens > LIMITS.inputTokens)
      throw Error("REQUEST_NOT_SENDABLE");
    const credential = readCredential();
    if (typeof credential !== "string" || !credential.trim())
      throw Error("CREDENTIAL_UNAVAILABLE_PRE_RESERVATION");
    const requestBytes = Buffer.from(JSON.stringify(pending.packet));
    const requestAsset = asset(`run/private/requests/${String(all.length + 1).padStart(2, "0")}.json`, requestBytes);
    const sidecarAsset = asset(`run/private/requests/${String(all.length + 1).padStart(2, "0")}.sidecar.json`,
      Buffer.from(encode({
        sceneId, parentMessageId, requestSha256: sha(requestBytes),
        attributionRenderedOutsideModelAnswer: true,
        sourceAttribution: pending.attributionSidecar,
      })));
    const attempt = all.length + 1;
    appendEvent(eventsDir, events, "transmission-reserved", {
      attempt, sceneId, parentMessageId, requestSha256: sha(requestBytes),
      reservationCentiMicroUSD: RESERVE_PER_ATTEMPT,
    }, [requestAsset, sidecarAsset]);
    let raw = null, rawAsset = null, statusCode = null, measured = null, display = null;
    let stopReason = null, retainReservation = false;
    try {
      const response = await transport(requestBytes, credential);
      statusCode = response.status;
      raw = response.bytes;
      rawAsset = asset(`run/private/raw/${String(attempt).padStart(2, "0")}.bin`, raw);
      let body;
      try { body = JSON.parse(raw.toString("utf8")); } catch { throw Error("RESPONSE_JSON_UNKNOWN"); }
      if (!(statusCode >= 200 && statusCode < 300) || body?.error) throw Error("MODEL_UNAVAILABLE_OR_HTTP_ERROR");
      measured = usageCost(body);
      validateEchoedControls(body);
      const outputLimited = body.status === "incomplete"
        && body.incomplete_details?.reason === "max_output_tokens";
      if (body.status !== "completed" && !outputLimited) throw Error("MODEL_OR_STATUS_UNEXPECTED");
      if (outputLimited) {
        const metadata = {
          classification: "actual_model_incomplete_output_limit", immutableRaw: true,
          sceneId, parentMessageId, requestSha256: sha(requestBytes),
          rawSha256: rawAsset.sha256, providerResponseId: body.id,
          model: body.model, usage: body.usage, extractedVisibleText: null,
        };
        const metadataAsset = asset(`run/private/responses/${String(attempt).padStart(2, "0")}.json`,
          Buffer.from(encode(metadata)));
        appendEvent(eventsDir, events, "response-recorded", {
          attempt, sceneId, parentMessageId, rawPath: rawAsset.path,
          metadataPath: metadataAsset.path, httpStatus: statusCode,
          measuredCentiMicroUSD: measured.centiMicroUSD, retainReservation: false,
          usableConversationAnswer: false, stopReason: "OUTPUT_LIMIT_NO_RETRY",
        }, [rawAsset, metadataAsset]);
        appendEvent(eventsDir, events, "scene-halted", {
          sceneId, reason: "OUTPUT_LIMIT_NO_RETRY", attempt,
        });
        return summary(events);
      }
      display = outputText(body);
      const metadata = {
        classification: "actual_model_raw_response", immutableRaw: true,
        sceneId, parentMessageId, requestSha256: sha(requestBytes),
        rawSha256: rawAsset.sha256, providerResponseId: body.id,
        model: body.model, usage: body.usage, extractedVisibleText: display,
      };
      const metadataAsset = asset(`run/private/responses/${String(attempt).padStart(2, "0")}.json`,
        Buffer.from(encode(metadata)));
      appendEvent(eventsDir, events, "response-recorded", {
        attempt, sceneId, parentMessageId, rawPath: rawAsset.path,
        metadataPath: metadataAsset.path, httpStatus: statusCode,
        measuredCentiMicroUSD: measured.centiMicroUSD, retainReservation: false,
        usableConversationAnswer: true,
      }, [rawAsset, metadataAsset]);
    } catch (error) {
      stopReason = safeCode(error);
      retainReservation = true;
      const assets = [];
      let rawPath = null;
      if (rawAsset) {
        assets.push(rawAsset); rawPath = rawAsset.path;
      } else if (raw) {
        rawAsset = asset(`run/private/raw/${String(attempt).padStart(2, "0")}.bin`, raw);
        assets.push(rawAsset); rawPath = rawAsset.path;
      }
      appendEvent(eventsDir, events, "response-recorded", {
        attempt, sceneId, parentMessageId, rawPath, metadataPath: null,
        httpStatus: statusCode, measuredCentiMicroUSD: measured?.centiMicroUSD ?? null,
        retainReservation, usableConversationAnswer: false, stopReason,
      }, assets);
      stop(events, stopReason);
    }
    return summary(events);
  }
  async function close(reason) {
    const events = readEvents(eventsDir);
    if (!events.length || closed(events) || typeof reason !== "string" || reason.trim().length < 8)
      throw Error("CLOSURE_INVALID");
    appendEvent(eventsDir, events, "authorization-closed", {
      reasonSha256: sha(Buffer.from(reason)),
      unusedAuthorizationNotReusable: true,
      noOldSlotReused: true,
    });
    return summary(events);
  }
  return {
    initialize: () => locked(initialize),
    status: () => locked(status),
    send: (scene, message) => locked(() => send(scene, message)),
    close: reason => locked(() => close(reason)),
  };
}