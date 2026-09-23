import { buildPendingRequest } from "./request-builder.mjs";
import { selectedMessage } from "./plan-adapter.mjs";

export function buildSceneTurn({ scene, messageId, previous = [] } = {}) {
  const selected = selectedMessage(scene, messageId);
  const knownFacts = new Set(scene.factRegistry.map(fact => fact.id));
  if (!selected.usedFactIds.every(id => knownFacts.has(id))) throw new Error("UNFROZEN_FACT_REFERENCE");
  return buildPendingRequest({
    sceneId: scene.id,
    parentMessageId: messageId,
    previousTurns: previous,
  });
}

export function continuationRecord({
  scene,
  classification,
  selectedFollowUpId = null,
  reason,
} = {}) {
  const allowed = new Set([
    "continue", "completed", "answer_quality_failure", "protocol_cannot_continue",
    "safety_stop", "transport_stop",
  ]);
  if (!allowed.has(classification) || typeof reason !== "string" || !reason.trim()) {
    throw new Error("INVALID_CONTINUATION_RECORD");
  }
  let factIdsChecked = [];
  if (classification === "continue") {
    const message = selectedMessage(scene, selectedFollowUpId);
    factIdsChecked = [...message.usedFactIds];
  } else if (selectedFollowUpId !== null) throw new Error("FOLLOWUP_ONLY_FOR_CONTINUE");
  return Object.freeze({
    classification,
    selectedFollowUpId,
    factIdsChecked: Object.freeze(factIdsChecked),
    reason,
  });
}