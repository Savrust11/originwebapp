// Pure app-side attribution display. Raw model output remains distinct and is
// never repaired or regraded by this presentation step.

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const ASSESSMENT_STATUS = "structurally_applicable_semantic_review_still_required";

function validateAnswer(answer) {
  if (!object(answer) || !Array.isArray(answer.explanations)
    || !Array.isArray(answer.limitations) || !object(answer.abstention)) {
    throw new Error("ATTRIBUTION_RAW_ANSWER_INVALID");
  }
}

/**
 * Attach a verified relationship only where an explicit offline assessment
 * identifies a specific explanation. Merely citing the same original ID does
 * not attach attribution, and limitations are never decorated.
 */
export function assembleAttributionDisplay(rawAnswer, {
  caseId,
  relations,
  assessments = [],
} = {}) {
  validateAnswer(rawAnswer);
  if (typeof caseId !== "string" || !object(relations) || !Array.isArray(assessments)) {
    throw new Error("ATTRIBUTION_DISPLAY_INPUT_INVALID");
  }
  const raw = clone(rawAnswer);
  const display = clone(rawAnswer);
  display.explanations = display.explanations.map(item => ({
    ...item,
    app_attributions: [],
  }));

  const occupied = new Set();
  for (const assessment of assessments) {
    if (!object(assessment) || assessment.case_id !== caseId
      || assessment.section !== "explanations"
      || !Number.isSafeInteger(assessment.claim_index) || assessment.claim_index < 0
      || typeof assessment.relation_id !== "string"
      || assessment.status !== ASSESSMENT_STATUS
      || typeof assessment.assessed_by !== "string" || !assessment.assessed_by
      || typeof assessment.finding !== "string" || !assessment.finding) {
      throw new Error("ATTRIBUTION_EXPLICIT_ASSESSMENT_INVALID");
    }
    const key = `${assessment.section}:${assessment.claim_index}:${assessment.relation_id}`;
    if (occupied.has(key)) throw new Error("ATTRIBUTION_ASSESSMENT_DUPLICATE");
    occupied.add(key);
    const relation = relations[assessment.relation_id];
    const claim = raw.explanations[assessment.claim_index];
    if (!relation || !claim || !relation.eligible_cases?.includes(caseId)) {
      throw new Error("ATTRIBUTION_RELATION_NOT_ELIGIBLE");
    }
    if (assessment.original_id !== relation.support?.original_id
      || !claim.original_ids?.includes(assessment.original_id)) {
      throw new Error("ATTRIBUTION_CLAIM_SUPPORT_MISMATCH");
    }
    display.explanations[assessment.claim_index].app_attributions.push({
      relation_id: relation.relation_id,
      text: relation.display_text,
      document_publisher: relation.document.publisher,
      recommendation_origin: relation.recommendation_origin.name_ja,
      supporting_original_id: relation.support.original_id,
      provenance: "app_attached_verified_relationship_not_model_output",
      model_supplied: false,
      semantic_approval: false,
      semantic_review_required: true,
      assessment: {
        status: assessment.status,
        assessed_by: assessment.assessed_by,
        finding: assessment.finding,
      },
      qualification: relation.qualification,
    });
  }

  return {
    raw_model_answer: raw,
    app_display: display,
    separation: {
      raw_model_answer_mutated: false,
      app_attribution_is_model_output: false,
      app_attribution_changes_semantic_verdict: false,
    },
    semantic_review_required: true,
  };
}

export function q05SavedAnswerAttributionAssessment() {
  return [{
    case_id: "Q05",
    section: "explanations",
    claim_index: 0,
    relation_id: "ATTR-E02-GUIDE-INTRODUCES-AASM-SLEEP-DURATION",
    original_id: "E02-F-S01-S02-SHARED",
    status: ASSESSMENT_STATUS,
    assessed_by: "offline-source-relationship-display-check",
    finding:
      "説明0は1〜2歳児の11〜14時間を述べ、帰属関係を明記する同一の収録原文IDを選択している。表示補完は構造上の隣接表示であり、生回答の帰属省略を修正または合格扱いしない。",
  }];
}
