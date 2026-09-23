import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ATTRIBUTION_RELATION_ID,
  buildVerifiedAttributionRelations,
} from "../prototypes/evidence-consultation/evaluation/attribution-data.mjs";
import {
  assembleAttributionDisplay,
  q05SavedAnswerAttributionAssessment,
} from "../prototypes/evidence-consultation/evaluation/attribution-display.mjs";

const e02 = () => JSON.parse(readFileSync("evidence-work/v0.2/E02.json"));
const q05 = () => JSON.parse(readFileSync(
  "evidence-work/model-evaluation/revision-results/source-roles-20260918/Q05.json",
));

test("publisher and recommendation body are distinct and verified by exact E02 text", () => {
  const relation = buildVerifiedAttributionRelations(e02())[ATTRIBUTION_RELATION_ID];
  assert.equal(relation.document.publisher, "厚生労働省");
  assert.equal(relation.recommendation_origin.organization_id, "AASM");
  assert.notEqual(relation.document.publisher, relation.recommendation_origin.name_ja);
  assert.equal(relation.support.original_id, "E02-F-S01-S02-SHARED");
  assert.equal(relation.support.quote_span_utf16.start, 0);
  assert.match(relation.support.quote, /米国睡眠医学会.*推奨しています/);
  assert.match(relation.qualification, /AASM本文は未収録/);
  assert.match(relation.qualification, /24時間合計かを支える関係ではない/);
});

test("tampered source text cannot create the attribution relationship", () => {
  const changed = e02();
  changed.fragments.find(item => item.id === "E02-F-S01-S02-SHARED").original_text += "変更";
  assert.throws(() => buildVerifiedAttributionRelations(changed),
    /ATTRIBUTION_E02_ORIGINAL_MISMATCH/);
});

test("saved Q05 receives adjacent app attribution without changing raw answer or verdict", () => {
  const result = q05();
  const before = JSON.stringify(result.answer);
  const rendered = assembleAttributionDisplay(result.answer, {
    caseId: "Q05",
    relations: buildVerifiedAttributionRelations(e02()),
    assessments: q05SavedAnswerAttributionAssessment(),
  });
  assert.equal(JSON.stringify(result.answer), before);
  assert.deepEqual(rendered.raw_model_answer, result.answer);
  const attached = rendered.app_display.explanations[0].app_attributions[0];
  assert.equal(attached.text, "このガイドが紹介する米国睡眠医学会（AASM）の推奨");
  assert.equal(attached.document_publisher, "厚生労働省");
  assert.equal(attached.recommendation_origin, "米国睡眠医学会");
  assert.equal(attached.model_supplied, false);
  assert.equal(attached.semantic_approval, false);
  assert.equal(rendered.app_display.limitations[0].app_attributions, undefined);
  const review = JSON.parse(readFileSync(
    "evidence-work/model-evaluation/revision-results/source-roles-20260918/Q05-review.json",
  ));
  assert.equal(review.verdict, "stop");
});

test("same ID never causes automatic or limitation attribution", () => {
  const result = q05();
  const relations = buildVerifiedAttributionRelations(e02());
  const withoutAssessment = assembleAttributionDisplay(result.answer, {
    caseId: "Q05", relations,
  });
  assert.deepEqual(withoutAssessment.app_display.explanations[0].app_attributions, []);
  assert.throws(() => assembleAttributionDisplay(result.answer, {
    caseId: "Q05",
    relations,
    assessments: [{
      ...q05SavedAnswerAttributionAssessment()[0],
      section: "limitations",
    }],
  }), /ATTRIBUTION_EXPLICIT_ASSESSMENT_INVALID/);
});

test("unrelated cases, unsupported claims and invented relations fail closed", () => {
  const result = q05();
  const relations = buildVerifiedAttributionRelations(e02());
  for (const assessment of [
    { ...q05SavedAnswerAttributionAssessment()[0], case_id: "Q07" },
    { ...q05SavedAnswerAttributionAssessment()[0], original_id: "E02-F-S03" },
    { ...q05SavedAnswerAttributionAssessment()[0], relation_id: "ATTR-INVENTED" },
  ]) {
    assert.throws(() => assembleAttributionDisplay(result.answer, {
      caseId: assessment.case_id,
      relations,
      assessments: [assessment],
    }));
  }
});

test("Q06 is eligible only through a future explicit claim assessment", () => {
  const relations = buildVerifiedAttributionRelations(e02());
  const q06Answer = {
    explanations: [{
      text: "3〜5歳児は10〜13時間です。",
      original_ids: ["E02-F-S01-S02-SHARED"],
    }],
    limitations: [],
    abstention: { applies: false, text: "", original_ids: [] },
  };
  const noInference = assembleAttributionDisplay(q06Answer, {
    caseId: "Q06", relations,
  });
  assert.deepEqual(noInference.app_display.explanations[0].app_attributions, []);
  const explicit = {
    ...q05SavedAnswerAttributionAssessment()[0],
    case_id: "Q06",
    finding: "Q06説明0について同じ収録原文の帰属関係を明示的に確認した。",
  };
  assert.equal(assembleAttributionDisplay(q06Answer, {
    caseId: "Q06", relations, assessments: [explicit],
  }).app_display.explanations[0].app_attributions.length, 1);
});

test("offline Q05 display record binds the unchanged failed response and review", () => {
  const record = JSON.parse(readFileSync(
    "evidence-work/model-evaluation/independent-preparation/independent-cases-20260918/Q05-display-verification.json",
  ));
  const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(digest(record.inputs.savedResultFile), record.inputs.savedResultSha256);
  assert.equal(digest(record.inputs.savedReviewFile), record.inputs.savedReviewSha256);
  const result = q05();
  assert.equal(
    createHash("sha256").update(JSON.stringify(result.answer)).digest("hex"),
    record.inputs.rawModelAnswerSha256,
  );
  assert.equal(record.rawModelRecord.semanticVerdict, "stop");
  assert.equal(record.rawModelRecord.semanticVerdictChangedByDisplay, false);
  assert.equal(record.appDisplayVerification.modelSupplied, false);
  assert.equal(record.appDisplayVerification.semanticApproval, false);
  assert.equal(record.appDisplayVerification.notAttachedToLimitation, true);
  assert.match(record.verifiedRelationship.qualification, /24時間合計かを支える関係ではない/);
});