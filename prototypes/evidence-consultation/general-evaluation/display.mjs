// Offline-only assembly of source-verified condition cards. This module does
// not assess prose semantics and cannot make a model answer pass.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const RUN_ID = "general-audience-six-01";
export const CASE_IDS = Object.freeze([
  "G-Q05", "G-Q06", "G-Q08", "G-Q09", "G-Q10", "G-Q11",
]);
const BASE_CASES = new Set(["Q05", "Q06", "Q08", "Q09", "Q10", "Q11"]);
const VERIFIED_APP_CATALOG_SHA256 =
  "479331096620f6eaf8c617b7577695603c512c8d64c27951135174149df18c00";
const REVIEWER = "agent-source-comparison-not-clinical-review";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const base = path.join(root, "evidence-work/general-audience-evaluation", RUN_ID);
const prepDirectory = path.join(base, "preparation");
const resultsDirectory = path.join(base, "results");
const appDisplaysDirectory = path.join(base, "app-displays");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
export const digest = value => createHash("sha256")
  .update(typeof value === "string" || Buffer.isBuffer(value)
    ? value : JSON.stringify(value)).digest("hex");

function appCatalogValue(value) {
  return value?.catalog?.cases ? value.catalog : value;
}
function preparedId(value) {
  return value?.caseId ?? value?.case_id;
}
function baseId(value) {
  return value?.baseCaseId ?? value?.base_case_id;
}
function selectedOriginalIds(value) {
  const ids = value?.originalIds ?? value?.original_ids
    ?? value?.retrieved_original_ids;
  if (!Array.isArray(ids) || !ids.length
    || ids.some(id => typeof id !== "string" || !id)
    || new Set(ids).size !== ids.length) {
    throw new Error("GENERAL_DISPLAY_SELECTED_ORIGINALS_REQUIRED");
  }
  return ids;
}
function validSupport(support, selected) {
  return object(support)
    && typeof support.originalId === "string" && selected.has(support.originalId)
    && typeof support.sourceId === "string" && support.originalId.startsWith(`${support.sourceId}-`)
    && typeof support.title === "string" && support.title
    && typeof support.version === "string" && support.version
    && typeof support.locator === "string" && support.locator
    && typeof support.url === "string" && /^https?:\/\//.test(support.url)
    && /^[a-f0-9]{64}$/.test(support.originalTextSha256)
    && typeof support.quote === "string" && support.quote
    && Number.isSafeInteger(support.quoteStart) && support.quoteStart >= 0
    && Number.isSafeInteger(support.quoteEnd)
    && support.quoteEnd === support.quoteStart + support.quote.length;
}
function verifyConditionCase(preparedCase, appCatalog) {
  const catalog = appCatalogValue(appCatalog);
  if (!object(catalog) || catalog.schemaVersion !== 1
    || digest(catalog) !== VERIFIED_APP_CATALOG_SHA256
    || catalog.provenance?.status !== "offline_agent_source_text_comparison"
    || catalog.provenance?.modelOutput !== false
    || catalog.provenance?.clinicalReview !== false
    || catalog.provenance?.adoptionApproval !== false
    || catalog.provenance?.historicalEvaluationChanged !== false) {
    throw new Error("GENERAL_DISPLAY_FROZEN_APP_CATALOG_CHANGED");
  }
  const id = preparedId(preparedCase);
  const baseCaseId = baseId(preparedCase);
  if (!CASE_IDS.includes(id) || !BASE_CASES.has(baseCaseId)
    || id !== `G-${baseCaseId}`) throw new Error("GENERAL_DISPLAY_CASE_BINDING_INVALID");
  const conditionCase = catalog.cases?.[baseCaseId];
  const selected = new Set(selectedOriginalIds(preparedCase));
  if (!object(conditionCase) || conditionCase.caseId !== baseCaseId
    || !Array.isArray(conditionCase.blocks) || !conditionCase.blocks.length) {
    throw new Error("GENERAL_DISPLAY_CONDITION_CASE_MISSING");
  }
  const blockIds = new Set();
  for (const block of conditionCase.blocks) {
    if (!object(block) || typeof block.id !== "string" || !block.id
      || blockIds.has(block.id)
      || !["mandatory", "conditional", "optional"].includes(block.tier)
      || !["population", "eligibility", "exclusion", "limitation",
        "numericMeaning", "researchDetail"].includes(block.kind)
      || typeof block.text !== "string" || !block.text
      || !Array.isArray(block.supports) || !block.supports.length
      || block.supports.some(support => !validSupport(support, selected))) {
      throw new Error(`GENERAL_DISPLAY_CONDITION_BLOCK_INVALID:${block?.id ?? "unknown"}`);
    }
    blockIds.add(block.id);
  }
  if (!conditionCase.blocks.some(block => block.tier === "mandatory"))
    throw new Error("GENERAL_DISPLAY_MANDATORY_CONDITIONS_REQUIRED");
  return clone(conditionCase);
}
function rawAnswer(result) {
  const answer = result?.answer ?? result?.contract?.answer ?? null;
  if (answer === null) return null;
  if (!object(answer) || !Array.isArray(answer.explanations)
    || !Array.isArray(answer.limitations) || !object(answer.abstention)) {
    throw new Error("GENERAL_DISPLAY_RAW_ANSWER_INVALID");
  }
  return clone(answer);
}
function claimsOf(answer) {
  if (!answer) return [];
  const result = [];
  const add = (section, values) => values.forEach((claim, index) => {
    const originalIds = claim?.original_ids ?? claim?.originalIds;
    if (!object(claim) || typeof claim.text !== "string" || !claim.text
      || !Array.isArray(originalIds)
      || originalIds.some(id => typeof id !== "string" || !id)) {
      throw new Error(`GENERAL_DISPLAY_CLAIM_INVALID:${section}:${index}`);
    }
    result.push({ section, index, text: claim.text, originalIds: [...originalIds] });
  });
  add("explanations", answer.explanations);
  add("limitations", answer.limitations);
  if (answer.abstention?.applies && answer.abstention.text)
    add("abstention", [answer.abstention]);
  return result;
}
function uniqueSupports(blocks) {
  const result = [];
  const seen = new Set();
  for (const block of blocks) for (const support of block.supports) {
    const key = `${support.originalId}:${support.quoteStart}:${support.quoteEnd}`;
    if (!seen.has(key)) {
      result.push(clone(support));
      seen.add(key);
    }
  }
  return result;
}

/**
 * Conditions are selected only by the frozen case mapping. No question/answer
 * prose or cited-ID match is used to infer applicability. Every claim receives
 * the complete mandatory case context so a short model answer cannot hide it.
 * This structural display says nothing about whether the claim follows from
 * those sources; the separately bound semantic review decides that.
 */
export function assembleGeneralDisplay(result, preparedCase, appCatalog) {
  const conditionCase = verifyConditionCase(preparedCase, appCatalog);
  const answer = rawAnswer(result);
  const allClaims = claimsOf(answer);
  const mandatory = conditionCase.blocks.filter(block => block.tier === "mandatory");
  const conditional = conditionCase.blocks.filter(block => block.tier === "conditional");
  const optional = conditionCase.blocks.filter(block => block.tier === "optional");
  const claims = allClaims.map(claim => ({ ...claim, blocks: clone(mandatory) }));
  const completed = answer !== null && result?.status === "completed"
    && result?.classification?.globalFailure !== true;
  const noAnswerReason = answer ? null
    : (result?.classification?.globalFailure ? "global-technical-failure"
      : result?.status === "pending" ? "pending" : "no-contract-answer");
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    caseId: preparedId(preparedCase),
    baseCaseId: baseId(preparedCase),
    rawAnswer: answer,
    rawOutputText: typeof result?.outputText === "string" ? result.outputText : "",
    responseStatus: result?.status ?? "unknown",
    noAnswerReason,
    appDisplay: {
      claims,
      researchDetails: clone(conditional),
      optionalBackground: clone(optional),
      sourceSupports: uniqueSupports(conditionCase.blocks),
      relationship: ["Q05", "Q06"].includes(baseId(preparedCase))
        ? clone(appCatalogValue(appCatalog).provenance.e02Relationship) : null,
    },
    conditionBlockSetSha256: digest(conditionCase.blocks),
    conditionIntegrityPassed: true,
    bodySemanticsAssessed: false,
    bodySemanticsPassed: null,
    completedResponseAvailable: completed,
    notices: [
      "アプリ側の条件表示とモデル本文の正確さは別々に採点します。",
      "確認済み条件カードは、本文の誤り・矛盾・未支持説明を修正せず、本文の合格を保証しません。",
      "条件は質問・回答の自由記述や原文ID一致から推測せず、送信前に固定したケース対応だけで表示しています。",
      "対象条件の適合はこの評価では確認していません。個別助言は表示しません。",
      "評価はAIによる原文比較であり、人による採用審査・臨床評価ではありません。",
      ...(["Q05", "Q06"].includes(baseId(preparedCase)) ? [
        "AASM本文は未収録です。選定したガイド原文は、昼寝を含む24時間合計を確認する根拠ではありません。",
      ] : []),
    ],
    diagnosticOnly: true,
    userReady: false,
    individualAdviceBlocked: true,
    semanticReviewerRequired: REVIEWER,
  };
}

function writeExclusiveOrVerify(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  try {
    fs.writeFileSync(file, bytes, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (!fs.readFileSync(file).equals(bytes))
      throw new Error(`GENERAL_DISPLAY_IMMUTABLE_FILE_CHANGED:${path.basename(file)}`);
  }
  return digest(bytes);
}
function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function requestFor(prepared, caseId) {
  const item = prepared?.requests?.find(request => preparedId(request) === caseId);
  if (!item) throw new Error("GENERAL_DISPLAY_PREPARED_CASE_MISSING");
  return item;
}
export function writeCaseDisplay(caseId) {
  if (!CASE_IDS.includes(caseId)) throw new Error("GENERAL_DISPLAY_CASE_NOT_AUTHORIZED");
  const prepared = loadJson(path.join(prepDirectory, "prepared-package.json"));
  const preparedCase = requestFor(prepared, caseId);
  const appCatalog = loadJson(path.join(prepDirectory, "app-catalog.json"));
  const responseFile = path.join(resultsDirectory, `${caseId}.json`);
  const responseBytes = fs.readFileSync(responseFile);
  const result = JSON.parse(responseBytes);
  const display = assembleGeneralDisplay(result, preparedCase, appCatalog);
  const record = {
    ...display,
    responseFile: path.relative(root, responseFile),
    responseFileSha256: digest(responseBytes),
    preparedCaseSha256: digest(JSON.stringify(preparedCase)),
    generatedOffline: true,
    networkUsed: false,
  };
  fs.mkdirSync(appDisplaysDirectory, { recursive: true });
  const file = path.join(appDisplaysDirectory, `${caseId}.json`);
  const appDisplaySha256 = writeExclusiveOrVerify(file, record);
  return { caseId, file: path.relative(root, file), appDisplaySha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const caseId = process.argv[2];
  console.log(JSON.stringify(writeCaseDisplay(caseId)));
}