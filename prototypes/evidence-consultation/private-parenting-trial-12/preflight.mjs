import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildPendingRequest } from "../private-parenting-trial-11/request-builder.mjs";
import { loadPlans } from "../private-parenting-trial-11/plan-adapter.mjs";
import {
  ROOT, ENDPOINT, MODEL, SCENES, LIMITS, RATES, RESERVE_PER_ATTEMPT,
  AUTHORIZATION_TEXT, PLAN_HASHES, PUBLIC_DOC_HASHES,
} from "./policy.mjs";

export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const encode = value => `${JSON.stringify(value, null, 2)}\n`;
export function writeOnce(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
export function appendEvent(directory, events, type, data, assets = []) {
  const event = {
    sequence: events.length + 1,
    previousSha256: events.at(-1)?.sha256 ?? null,
    at: new Date().toISOString(),
    type, data, assets,
  };
  const bytes = Buffer.from(encode(event));
  const relative = `${String(event.sequence).padStart(6, "0")}.json`;
  writeOnce(path.join(directory, relative), bytes);
  events.push({ ...event, sha256: sha(bytes) });
}
export function readEvents(directory) {
  if (!fs.existsSync(directory)) return [];
  let previous = null;
  return fs.readdirSync(directory).sort().map((name, index) => {
    if (name !== `${String(index + 1).padStart(6, "0")}.json`) throw Error("EVENT_SEQUENCE_BROKEN");
    const bytes = fs.readFileSync(path.join(directory, name));
    const event = JSON.parse(bytes);
    if (event.sequence !== index + 1 || event.previousSha256 !== previous) throw Error("EVENT_CHAIN_BROKEN");
    for (const asset of event.assets ?? []) {
      const actual = sha(fs.readFileSync(path.join(ROOT, asset.path)));
      if (actual !== asset.sha256) throw Error("SEALED_ASSET_CHANGED");
    }
    previous = sha(bytes);
    return { ...event, sha256: previous };
  });
}
function assertPlanHashes() {
  const plans = loadPlans();
  const mapping = {
    scenes: plans.hashes["scenes.json"], rubric: plans.hashes["evaluation-rubric.json"],
    budget: plans.hashes["model-budget.json"], history: plans.hashes["history-reconciliation.json"],
    rights: sha(fs.readFileSync("evidence-work/private-parenting-trial-11/plan/rights-plan.json")),
  };
  if (Object.keys(PLAN_HASHES).some(key => mapping[key] !== PLAN_HASHES[key]))
    throw Error("FROZEN_PLAN_HASH_CHANGED");
  for (const trial of plans.history.trials ?? []) {
    for (const evidence of trial.evidence ?? []) {
      if (sha(fs.readFileSync(evidence.path)) !== evidence.sha256)
        throw Error("HISTORICAL_LEDGER_EVIDENCE_CHANGED");
    }
  }
  return plans;
}
export function loadPublicSpec(directory = path.join(ROOT, "public-docs")) {
  for (const [name, expected] of Object.entries(PUBLIC_DOC_HASHES)) {
    if (sha(fs.readFileSync(path.join(directory, name))) !== expected) throw Error("PUBLIC_DOC_HASH_CHANGED");
  }
  const bytes = fs.readFileSync(path.join(directory, "verification.json"));
  const spec = JSON.parse(bytes);
  if (spec?.method !== "public-official-documentation-no-authenticated-api"
    || spec.model !== MODEL || spec.endpoint !== ENDPOINT
    || spec.inputUsdPerMillion !== 0.2 || spec.outputUsdPerMillion !== 1.2
    || spec.cachedReadUsdPerMillion !== 0.02 || spec.cacheWriteUsdPerMillion !== 0.25
    || spec.serviceTier !== "default" || spec.reasoningEffort !== "medium"
    || spec.inputTokenCeiling !== LIMITS.inputTokens
    || spec.maxOutputTokensIncludingReasoning !== LIMITS.outputTokens
    || spec.promptCacheMode !== "explicit" || spec.explicitBreakpoints !== 0
    || spec.maxAttempts !== LIMITS.attempts || spec.userCostCeilingUsd !== 0.03
    || spec.totalReservationCeilingUsd !== 0.0272) {
    throw Error("PUBLIC_SPEC_NOT_APPROVED");
  }
  return { spec, bytes, sha256: sha(bytes) };
}
export function createInitialPacket(sceneId) {
  if (!Object.hasOwn(SCENES, sceneId)) throw Error("SCENE_NOT_AUTHORIZED");
  return buildPendingRequest({ sceneId, parentMessageId: "initial", previousTurns: [] });
}
export function validatePreflight() {
  const plans = assertPlanHashes();
  const publicSpec = loadPublicSpec();
  const packets = Object.keys(SCENES).map(sceneId => createInitialPacket(sceneId));
  if (packets.some(packet => packet.syntheticOfflineOnly
    || packet.externalStatus !== "blocked_current_authorization_zero"
    || packet.inputMeasurement.configuredTokenLimit !== LIMITS.inputTokens
    || packet.inputMeasurement.utf8Bytes + LIMITS.requestFramingTokens > LIMITS.inputTokens)) {
    throw Error("INITIAL_PACKET_NOT_SAFE");
  }
  const totalReserve = RESERVE_PER_ATTEMPT * LIMITS.attempts;
  if (RESERVE_PER_ATTEMPT !== 340_000 || totalReserve !== 2_720_000
    || totalReserve > LIMITS.authorizedCentiMicroUSD) throw Error("BUDGET_NOT_AUTHORIZED");
  if (plans.history.currentCumulativeProviderTransmissions !== 47) throw Error("HISTORY_NOT_47");
  return {
    plans, publicSpec, packets,
    authorization: {
      exactUserScope: AUTHORIZATION_TEXT,
      maximumAttempts: LIMITS.attempts,
      reservePerAttemptCentiMicroUSD: RESERVE_PER_ATTEMPT,
      maximumReserveCentiMicroUSD: totalReserve,
      maximumReserveUSD: totalReserve / 100_000_000,
      closedSlotsReusable: false,
    },
  };
}