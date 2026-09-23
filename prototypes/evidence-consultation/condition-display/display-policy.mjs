import { createHash } from "node:crypto";

const MODES = new Set(["saved-evaluation", "fictional-example", "individual-advice"]);
const APPLICABILITY = new Set(["matched", "unknown", "mismatched"]);
const GATES = new Set(["blocked", "confirmation-required", "allowed"]);
const VERDICTS = new Set(["pass", "fail"]);
const REVIEW_KINDS = new Set(["offline-editorial-example", "saved-model-review"]);
const HISTORICAL_VERDICTS = new Set(["pass", "fail", "stop"]);
const BLOCK_KINDS = new Set([
  "population", "eligibility", "exclusion", "limitation",
  "numericMeaning", "researchDetail",
]);
const BLOCK_TIERS = new Set(["mandatory", "conditional", "optional"]);
const object = value => value !== null && typeof value === "object"
  && !Array.isArray(value);
const nonempty = value => typeof value === "string" && value.length > 0;
const unique = values => new Set(values).size === values.length;
const clone = value => JSON.parse(JSON.stringify(value));

/**
 * This intentionally hashes JSON.stringify(value), rather than canonicalizing
 * or interpreting it. The assessment is therefore bound to the exact ordered
 * body/blocks representation supplied to this isolated display gate.
 */
export const digest = value =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function validStringArray(value, { nonEmpty = false } = {}) {
  return Array.isArray(value) && (!nonEmpty || value.length > 0)
    && value.every(nonempty) && unique(value);
}

function validSupport(support) {
  if (!object(support)
    || !nonempty(support.originalId)
    || !nonempty(support.sourceId)
    || !nonempty(support.title)
    || !nonempty(support.version)
    || !nonempty(support.locator)
    || !nonempty(support.url)
    || !/^[a-f0-9]{64}$/.test(support.originalTextSha256)
    || !nonempty(support.quote)
    || !Number.isSafeInteger(support.quoteStart) || support.quoteStart < 0
    || !Number.isSafeInteger(support.quoteEnd)
    || support.quoteEnd !== support.quoteStart + support.quote.length) {
    return false;
  }
  try {
    const url = new URL(support.url);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function inspectInputs({
  caseId, body, conditionCase, context, assessment, historicalVerdict,
}) {
  const reasons = [];
  const bodyValid = Array.isArray(body) && body.length > 0
    && body.every(claim => object(claim)
      && nonempty(claim.id) && nonempty(claim.text)
      && validStringArray(claim.originalIds))
    && unique(body.map(claim => claim.id));
  if (!bodyValid) reasons.push("body_structure_invalid");

  const blocks = conditionCase?.blocks;
  const blocksValid = nonempty(caseId)
    && object(conditionCase) && conditionCase.caseId === caseId
    && Array.isArray(blocks) && blocks.length > 0
    && blocks.every(block => object(block)
      && nonempty(block.id)
      && BLOCK_KINDS.has(block.kind)
      && BLOCK_TIERS.has(block.tier)
      && nonempty(block.text)
      && Array.isArray(block.supports) && block.supports.length > 0
      && block.supports.every(validSupport)
      && unique(block.supports.map(support =>
        `${support.sourceId}:${support.originalId}:${support.quoteStart}:${support.quoteEnd}`)))
    && unique(blocks.map(block => block.id));
  if (!blocksValid) reasons.push("condition_source_integrity_invalid");

  const contextValid = object(context)
    && MODES.has(context.mode)
    && APPLICABILITY.has(context.applicability)
    && GATES.has(context.existingGate)
    && typeof context.adoptionApproved === "boolean"
    && typeof context.publicationApproved === "boolean";
  if (!contextValid) reasons.push("context_invalid");

  if (historicalVerdict !== undefined
    && !HISTORICAL_VERDICTS.has(historicalVerdict)) {
    reasons.push("historical_verdict_invalid");
  }

  const assessmentShapeValid = object(assessment)
    && assessment.caseId === caseId
    && nonempty(assessment.bodySha256)
    && nonempty(assessment.blocksSha256)
    && VERDICTS.has(assessment.verdict)
    && assessment.checkedBy === "agent-source-comparison-not-clinical-review"
    && validStringArray(assessment.findings, { nonEmpty: true })
    && validStringArray(assessment.contradictions)
    && validStringArray(assessment.unsupportedClaims)
    && Array.isArray(assessment.claimBindings)
    && REVIEW_KINDS.has(assessment.kind);
  if (!assessmentShapeValid) reasons.push("explicit_bound_assessment_required");
  if (contextValid && assessmentShapeValid
    && ((context.mode === "saved-evaluation"
      && assessment.kind !== "saved-model-review")
      || (context.mode === "fictional-example"
        && assessment.kind !== "offline-editorial-example"))) {
    reasons.push("assessment_kind_mode_mismatch");
  }
  if (contextValid && context.mode === "saved-evaluation"
    && !HISTORICAL_VERDICTS.has(historicalVerdict)) {
    reasons.push("saved_evaluation_requires_historical_verdict");
  }

  let bindingValid = false;
  let hashesMatch = false;
  if (bodyValid && blocksValid && assessmentShapeValid) {
    hashesMatch = assessment.bodySha256 === digest(body)
      && assessment.blocksSha256 === digest(blocks);
    if (!hashesMatch) reasons.push("assessment_binding_changed");

    const claimIds = new Set(body.map(claim => claim.id));
    const blockIds = new Set(blocks.map(block => block.id));
    const bindings = assessment.claimBindings;
    bindingValid = bindings.length === body.length
      && bindings.every(binding => object(binding)
        && Object.keys(binding).sort().join(",") === "blockIds,claimId"
        && claimIds.has(binding.claimId)
        && validStringArray(binding.blockIds, { nonEmpty: true })
        && binding.blockIds.every(id => blockIds.has(id)))
      && unique(bindings.map(binding => binding.claimId));

    if (bindingValid) {
      const attached = new Set(bindings.flatMap(binding => binding.blockIds));
      bindingValid = blocks
        .filter(block => block.tier === "mandatory")
        .every(block => attached.has(block.id));
    }
    if (!bindingValid) reasons.push("explicit_claim_condition_bindings_incomplete");

    const hasReviewIssue = assessment.contradictions.length > 0
      || assessment.unsupportedClaims.length > 0;
    if ((assessment.verdict === "pass" && hasReviewIssue)
      || (assessment.verdict === "fail" && !hasReviewIssue)) {
      reasons.push("assessment_verdict_inconsistent");
    }
  }

  return {
    reasons,
    bodyValid,
    blocksValid,
    contextValid,
    assessmentShapeValid,
    bindingValid,
    hashesMatch,
  };
}

/**
 * Assemble source-confirmed condition blocks after an explicit, hash-bound
 * source-comparison review.
 *
 * This is not a natural-language contradiction detector. It never infers a
 * condition from prose or from matching original IDs. New or modified text
 * needs a new assessment, and contradictions/unsupported claims must be
 * explicitly recorded by that assessment.
 *
 * This module is an isolated experiment, not an integration gate. It therefore
 * never reports real-user readiness or unlocks individual advice.
 */
export function evaluateConditionDisplay(input = {}) {
  const {
    caseId, body, conditionCase, context, assessment, historicalVerdict,
  } = input;
  const inspected = inspectInputs(input);
  const blockingReasons = [...inspected.reasons];
  const conditionIntegrityPassed = inspected.blocksValid;
  const explicitReviewPassed = inspected.assessmentShapeValid
    && inspected.hashesMatch
    && inspected.bindingValid
    && assessment.verdict === "pass"
    && assessment.contradictions.length === 0
    && assessment.unsupportedClaims.length === 0
    && !blockingReasons.includes("assessment_verdict_inconsistent")
    && !blockingReasons.includes("assessment_kind_mode_mismatch")
    && !blockingReasons.includes("saved_evaluation_requires_historical_verdict");
  const historicalFailure = historicalVerdict === "fail"
    || historicalVerdict === "stop";
  if (historicalFailure) blockingReasons.push("historical_failure_preserved");

  const contradictionFree = inspected.assessmentShapeValid
    && inspected.hashesMatch
    && assessment.contradictions.length === 0;
  const bodyReviewPassed = explicitReviewPassed && !historicalFailure;
  const mode = inspected.contextValid ? context.mode : null;
  const diagnosticOnly = mode !== "individual-advice" || historicalFailure;

  if (inspected.contextValid && context.applicability === "unknown")
    blockingReasons.push("applicability_confirmation_required");
  if (inspected.contextValid && context.applicability === "mismatched")
    blockingReasons.push("applicability_mismatched");
  if (inspected.contextValid && context.existingGate !== "allowed")
    blockingReasons.push(`existing_gate_${context.existingGate}`);
  if (inspected.contextValid && !context.adoptionApproved)
    blockingReasons.push("source_adoption_not_approved");
  if (inspected.contextValid && !context.publicationApproved)
    blockingReasons.push("publication_not_approved");
  if (mode === "individual-advice")
    blockingReasons.push("isolated_experimental_module_not_integrated");
  if (!bodyReviewPassed) blockingReasons.push("body_review_not_passed");

  const deduplicatedReasons = [...new Set(blockingReasons)];
  const canShowClaims = inspected.bodyValid && inspected.blocksValid
    && inspected.assessmentShapeValid && inspected.hashesMatch
    && inspected.bindingValid
    && mode !== "individual-advice";
  const blocksById = new Map((conditionCase?.blocks ?? [])
    .map(block => [block.id, block]));
  const bindingByClaim = new Map((assessment?.claimBindings ?? [])
    .map(binding => [binding.claimId, binding.blockIds]));
  const adjacentClaims = canShowClaims ? body.map(claim => ({
    ...clone(claim),
    blocks: bindingByClaim.get(claim.id).map(id => clone(blocksById.get(id))),
  })) : [];

  const notices = [
    "条件表示は確認済み原文との関係を示すもので、本文の未支持説明や矛盾を修正しません。",
    "この判定は明示的な原文比較に依存し、自由記述から条件や矛盾を自動推測しません。",
  ];
  if (mode === "saved-evaluation")
    notices.push("保存済み回答は評価用表示であり、利用者向けの完成回答ではありません。");
  if (mode === "fictional-example")
    notices.push("架空データによるオフライン画面例です。実利用者への助言や公開承認ではありません。");
  if (inspected.contextValid && context.applicability !== "matched")
    notices.push("対象条件は未確認または不適合です。既存の停止・確認処理を維持してください。");
  if (mode === "individual-advice")
    notices.push("この隔離モジュールから個別助言は表示できません。");

  let displayStatus = "blocked";
  if (mode === "saved-evaluation" && canShowClaims)
    displayStatus = historicalFailure || !explicitReviewPassed
      ? "diagnostic-failed" : "diagnostic-reviewed";
  else if (mode === "fictional-example" && canShowClaims)
    displayStatus = explicitReviewPassed ? "fictional-example" : "diagnostic-failed";

  return {
    caseId: nonempty(caseId) ? caseId : null,
    displayStatus,
    conditionIntegrityPassed,
    bodyReviewPassed,
    contradictionFree,
    diagnosticOnly,
    userReady: false,
    blockingReasons: deduplicatedReasons,
    adjacentClaims,
    notices,
  };
}