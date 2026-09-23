const object = value => value && typeof value === "object" && !Array.isArray(value);
const exact = (value, required, optional = []) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const nonempty = value => typeof value === "string" && value.length > 0;

export function validatePlanBundle({ scenes, sources, budget } = {}) {
  if (!exact(scenes, [
    "format", "status", "label", "modelInputExclusions", "continuationPolicy",
    "evaluationPerAnswer", "rawAnswerRecord", "scenes",
  ]) || scenes.format !== "weiku.private-parenting-model-trial.offline-plan.v1"
    || !Array.isArray(scenes.scenes) || scenes.scenes.length !== 5) throw new Error("SCENE_PLAN_SCHEMA");
  const sceneIds = new Set();
  for (const scene of scenes.scenes) {
    if (!exact(scene, ["id", "title", "sourceUnitIds", "plannedUserTurns", "stopInsteadOfContinuing"])
      || !nonempty(scene.id) || !nonempty(scene.title) || sceneIds.has(scene.id)
      || !Array.isArray(scene.sourceUnitIds) || !scene.sourceUnitIds.every(nonempty)
      || !Array.isArray(scene.plannedUserTurns) || scene.plannedUserTurns.length < 1
      || scene.plannedUserTurns.length > 3 || !Array.isArray(scene.stopInsteadOfContinuing)) {
      throw new Error("SCENE_PLAN_SCHEMA");
    }
    sceneIds.add(scene.id);
    for (const turn of scene.plannedUserTurns) {
      if (!exact(turn, ["turn", "text", "purpose"], ["sendOnlyIf"])
        || !Number.isSafeInteger(turn.turn) || !nonempty(turn.text) || !nonempty(turn.purpose)
        || turn.sendOnlyIf !== undefined && !nonempty(turn.sendOnlyIf)) throw new Error("SCENE_TURN_SCHEMA");
    }
  }

  if (!exact(sources, [
    "format", "checkedAt", "status", "decisionRule", "providerFacts", "canonicalBindings",
    "retrievalFixture", "sources", "scenes", "strictExclusions", "defaultExecution", "nextDecision",
  ]) || sources.format !== "weiku.private-parenting-model-trial.source-plan.v1"
    || !Array.isArray(sources.sources) || !Array.isArray(sources.scenes)
    || sources.scenes.length !== 5) throw new Error("SOURCE_PLAN_SCHEMA");
  for (const source of sources.sources) {
    if (!exact(source, [
      "id", "unitIds", "sourceId", "versionId", "permissionStatus",
      "externalAIEligible", "reason", "evidencePaths", "statusEvidence", "ageScope",
    ], ["requiredContext", "unresolvedDelta"]) || !nonempty(source.id) || !Array.isArray(source.unitIds)
      || typeof source.externalAIEligible !== "boolean" || !nonempty(source.reason)) {
      throw new Error("SOURCE_PLAN_SCHEMA");
    }
  }
  for (const scene of sources.scenes) {
    if (!exact(scene, ["sceneId", "requiredSources", "externalAIEligibleNow", "blockingSources"])
      || !sceneIds.has(scene.sceneId) || typeof scene.externalAIEligibleNow !== "boolean"
      || !Array.isArray(scene.requiredSources) || !Array.isArray(scene.blockingSources)) {
      throw new Error("SOURCE_SCENE_SCHEMA");
    }
  }

  if (!exact(budget, [
    "format", "status", "defaultExecution", "preparedAt", "providerEndpoint", "model", "proposedControls",
    "futureRunMaximums", "savedPriceBasis", "costEstimateAtMaximum", "authorization", "closedArchive",
  ]) || budget.format !== "weiku.private-parenting-model-trial.budget-proposal.v1"
    || budget.status !== "proposal_only_no_execution_no_authorization"
    || budget.model?.id !== "gpt-5.6-luna"
    || budget.futureRunMaximums?.maximumNewApiTransmissions !== 15
    || budget.futureRunMaximums?.maximumInputTokensPerTransmission !== 8_000
    || budget.futureRunMaximums?.maximumOutputTokensPerTransmissionIncludingReasoning !== 1_500
    || budget.proposedControls?.retries !== 0
    || budget.authorization?.authorizedNewTransmissionsNow !== 0) throw new Error("BUDGET_PLAN_SCHEMA");

  const eligibility = sources.scenes.map(scene => Object.freeze({
    sceneId: scene.sceneId,
    eligible: scene.externalAIEligibleNow,
    blockers: Object.freeze([...scene.blockingSources]),
  }));
  if (eligibility.some(item => item.eligible || item.blockers.length === 0)) {
    throw new Error("CURRENT_PLAN_MUST_REMAIN_BLOCKED");
  }
  return Object.freeze({
    sceneCount: sceneIds.size,
    eligibility: Object.freeze(eligibility),
    actualRequestCandidates: Object.freeze([]),
    blockedReason: "all_source_bodies_external_ai_not_authorized",
  });
}

export function validateProviderFacts(provider) {
  if (!exact(provider, [
    "format", "status", "assembledOfflineAt", "provider", "endpoint", "preservationRule",
    "datedConfirmedFacts", "notEstablishedBySavedReceipts", "sourceDeltaRule",
    "currentExecution", "receipts",
  ]) || provider.format !== "weiku.private-parenting-model-trial.provider-facts.v1"
    || !Array.isArray(provider.datedConfirmedFacts) || !Array.isArray(provider.notEstablishedBySavedReceipts)
    || !Array.isArray(provider.receipts) || provider.currentExecution?.authorizedTransmissions !== 0
    || provider.currentExecution?.modelRequestBodiesPrepared !== false
    || provider.currentExecution?.networkCalls !== 0) throw new Error("PROVIDER_FACTS_SCHEMA");
  for (const fact of provider.datedConfirmedFacts) {
    if (!exact(fact, ["asOf", "fact", "evidence", "scopeLimit"])
      || !nonempty(fact.asOf) || !nonempty(fact.fact) || !nonempty(fact.evidence) || !nonempty(fact.scopeLimit)) {
      throw new Error("PROVIDER_FACTS_SCHEMA");
    }
  }
  for (const receipt of provider.receipts) {
    if (!exact(receipt, ["path", "sha256"]) || !nonempty(receipt.path)
      || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error("PROVIDER_FACTS_SCHEMA");
  }
  return Object.freeze({
    status: provider.status,
    datedFacts: provider.datedConfirmedFacts.length,
    currentAuthorizedTransmissions: 0,
  });
}
