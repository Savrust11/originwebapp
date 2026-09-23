import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, outputDirectory, verifyHistory, hashBytes } from "./history-integrity.mjs";
import { buildVerifiedConditionCatalog } from "./verified-catalog.mjs";
import { digest, evaluateConditionDisplay } from "./display-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const historicalRoot = path.join(root, "evidence-work/model-evaluation");
const titles = {
  Q05: "1歳8か月の睡眠の目安。夜間だけの時間ですか？",
  Q06: "4歳2か月の睡眠の目安から、昼寝禁止と言えますか？",
  Q07: "新生児を育てる養育者の睡眠について、資料は何を述べていますか？",
  Q08: "親子の関わりに関する研究は、個別の親子に何を示しますか？",
  Q09: "有意な減少がなかったことは、効果ゼロの証明ですか？",
  Q10: "研究の38分という結果を、毎日の動画の上限にできますか？",
  Q11: "スクリーン時間を減らすと、必ず睡眠がよくなりますか？",
};
const normalizeBody = answer => [
  ...answer.explanations.map((claim, index) => ({ id: `explanation-${index}`,
    text: claim.text, originalIds: claim.original_ids })),
  ...answer.limitations.map((claim, index) => ({ id: `limitation-${index}`,
    text: claim.text, originalIds: claim.original_ids })),
  ...(answer.abstention.text ? [{ id: "abstention", text: answer.abstention.text,
    originalIds: answer.abstention.original_ids }] : []),
];

export function assertCatalogReview(catalog, review) {
  if (review?.checkedBy !== "agent-source-comparison-not-clinical-review"
    || review.catalogSha256 !== digest(catalog))
    throw new Error("CATALOG_REQUIRES_NEW_EXPLICIT_SOURCE_REVIEW");
  for (const [id, conditionCase] of Object.entries(catalog.cases)) {
    const assessment = review.cases?.[id];
    if (assessment?.verdict !== "pass"
      || assessment.bodySha256 !== digest(conditionCase.sampleBody)
      || assessment.blocksSha256 !== digest(conditionCase.blocks))
      throw new Error(`EXAMPLE_REQUIRES_NEW_EXPLICIT_SOURCE_REVIEW:${id}`);
  }
}

// Case assignments are explicit. They do not parse a question or infer facts.
// All mandatory conditions of the selected study apply to its result discussion.
function assessmentFor(caseId, body, conditionCase, review, kind) {
  return {
    caseId, bodySha256: digest(body), blocksSha256: digest(conditionCase.blocks),
    verdict: review.bodyVerdict,
    checkedBy: "agent-source-comparison-not-clinical-review",
    findings: review.findings,
    contradictions: review.contradictions,
    unsupportedClaims: review.unsupportedClaims,
    claimBindings: body.map(claim => ({
      claimId: claim.id,
      blockIds: conditionCase.blocks.filter(block => block.tier === "mandatory").map(block => block.id),
    })),
    kind,
  };
}
export function buildDisplayRecords() {
  const preservation = verifyHistory();
  const ledger = json(path.join(historicalRoot, "api-call-ledger.json"));
  const sourceInputs = Object.fromEntries(["E02", "E03", "E04"].map(id =>
    [id, json(path.join(root, `evidence-work/v0.2/${id}.json`))]));
  const catalog = buildVerifiedConditionCatalog(sourceInputs);
  const catalogReview = json(path.join(here, "verified-display-review.json"));
  assertCatalogReview(catalog, catalogReview);
  const reviews = json(path.join(here, "body-reviews.json"));
  const cases = Object.keys(titles).map(caseId => {
    const entry = ledger.entries.filter(item => item.caseId === caseId).at(-1);
    const responseBytes = fs.readFileSync(path.join(root, entry.responseFile));
    const response = JSON.parse(responseBytes);
    const review = reviews.cases[caseId];
    if (!review || hashBytes(responseBytes) !== review.responseFileSha256
      || review.historicalVerdict !== entry.review.verdict)
      throw new Error(`SAVED_BODY_REVIEW_BINDING_CHANGED:${caseId}`);
    const conditionCase = catalog.cases[caseId];
    const body = normalizeBody(response.answer);
    const context = { mode: "saved-evaluation", applicability: "unknown",
      existingGate: "blocked", adoptionApproved: false, publicationApproved: false };
    const assessment = assessmentFor(caseId, body, conditionCase, review, "saved-model-review");
    const savedEvaluation = evaluateConditionDisplay({
      caseId, body, conditionCase, context, assessment, historicalVerdict: entry.review.verdict,
    });
    const sampleBody = conditionCase.sampleBody;
    const sampleReview = {
      bodyVerdict: catalogReview.cases[caseId].verdict, contradictions: [], unsupportedClaims: [],
      findings: ["収録原文との対応を確認した短い編集例。保存済みモデル回答ではなく、個別助言・臨床承認・採用公開承認でもない。"],
    };
    const sampleAssessment = assessmentFor(caseId, sampleBody, conditionCase,
      sampleReview, "offline-editorial-example");
    const sampleEvaluation = evaluateConditionDisplay({
      caseId, body: sampleBody, conditionCase,
      context: { ...context, mode: "fictional-example" }, assessment: sampleAssessment,
    });
    const gateScenarios = ["unknown", "mismatched", "matched"].map(applicability => ({
      applicability,
      evaluation: evaluateConditionDisplay({
        caseId, body: sampleBody, conditionCase,
        context: { ...context, mode: "individual-advice", applicability,
          existingGate: applicability === "unknown" ? "confirmation-required" : "blocked" },
        assessment: sampleAssessment,
      }),
    }));
    return {
      caseId, title: titles[caseId], fictional: true,
      historical: {
        verdict: entry.review.verdict, responseFile: entry.responseFile,
        responseFileSha256: hashBytes(responseBytes),
        measuredMicroUSD: entry.measuredMicroUSD,
        outputText: response.outputText, review: entry.review,
        rawResult: response,
      },
      conditionCase, bodyReview: review, assessment, savedEvaluation,
      sample: { provenance: "offline-editorial-illustration-not-model-answer",
        body: sampleBody, assessment: sampleAssessment, evaluation: sampleEvaluation },
      gateScenarios,
      serviceNotices: [
        "これは架空データによる研究説明の画面例です。診断・治療・個別助言には使用できません。",
        "対象者の条件は未確認。日本への適用はunknown。資料の採用・公開は未承認です（アプリ管理情報であり原著の結論ではありません）。",
        ...(["Q05", "Q06"].includes(caseId) ? [
          "AASM本文は未収録。選定したガイド原文だけでは夜間のみか24時間合計か、昼寝の扱いは確認できません（取得範囲についてのアプリ注記）。",
        ] : []),
      ],
    };
  });
  // Historical original Q05 remains accessible but is not silently re-reviewed.
  const originalQ05 = ledger.entries.filter(item => item.caseId === "Q05")[0];
  const result = {
    schemaVersion: 1, evaluationType: "new-offline-display-not-historical-regrading",
    externalModelCalls: 0, modelAnswersRewritten: false, userReady: false,
    preservation, catalogReview, proposal: json(path.join(here, "evaluation-proposal.json")),
    cases, originalQ05: { ...originalQ05,
      rawResult: json(path.join(root, originalQ05.responseFile)) },
    constraints: {
      noNormalRouteIntegration: true, noDatabaseAccess: true, noRealUserData: true,
      sourceApprovalChanged: false, publicationChanged: false,
      semanticCheck: "explicit-source-review-bound-to-body-and-conditions-not-universal-NLP",
    },
  };
  verifyHistory();
  fs.writeFileSync(path.join(outputDirectory, "verified-condition-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "display-evaluation.json"),
    `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildDisplayRecords();
  console.log(JSON.stringify({ additionalApiCalls: 0, preservation: result.preservation,
    cases: result.cases.map(row => ({
      caseId: row.caseId, historicalVerdict: row.historical.verdict,
      conditions: row.savedEvaluation.conditionIntegrityPassed,
      bodySupport: row.savedEvaluation.bodyReviewPassed,
      userReady: row.savedEvaluation.userReady,
    })) }, null, 2));
}