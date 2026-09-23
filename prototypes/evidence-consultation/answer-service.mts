import type {
  AnswerGroup,
  AnswerRequest,
  AnswerResponse,
  CandidateAnswer,
} from "./answer-contract.ts";
import type { ConsultationInput, ConsultationResponse, EvidenceGroup, HealthPrompt } from "./contract.ts";
import { groupConsultation, validateConsultationInput, type ConsultationGroupPlan } from "./flow.ts";
import { searchConsultation } from "./service.mts";
import type { EvidenceSearchPool } from "../../server/evidence/search.ts";
import {
  EMERGENCY_HEURISTIC_LIMITATION,
  EMERGENCY_STOP_NOTICE,
  buildAnswerPacket,
  type ConfirmedPersonConditions,
  createFreshPersonToken,
  packetIsFresh,
  requiredQuestionsForUnverifiedGroup,
  snapshotDigest,
  urgentStopReason,
} from "./answer-policy.mts";
import {
  CandidateExecutionError,
  executeCandidate,
  type CandidateProvider,
  type PrivacyReviewedPermit,
} from "./answer-provider.mts";

export type AnswerRequestValidation =
  | { ok: true; value: AnswerRequest }
  | { ok: false; errors: string[] };

export interface OfflineAnswerOptions {
  signal?: AbortSignal;
}

export interface FutureCandidateOptions extends OfflineAnswerOptions {
  timeoutMs?: number;
  /**
   * A separately recorded human semantic review binding. This structural
   * prototype check is not evidence that a person actually reviewed content.
   */
  humanSemanticReviewPermit?: HumanSemanticReviewPermit;
  /**
   * Reserved for a future real-adapter boundary. The present code has no real
   * adapter and does not treat this field as permission to send external data.
   */
  privacyReviewed?: PrivacyReviewedPermit;
}

export interface HumanSemanticReviewPermit {
  kind: "human_semantic_review";
  reviewed: true;
  snapshotDigest: string;
  candidateDigest: string;
}

export type FutureCandidateResult =
  | { status: "accepted"; candidate: CandidateAnswer }
  | { status: "cancelled" | "rejected" | "review_required" };

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const healthKeys = new Set([
  "diagnosed_illness_or_disability",
  "diagnosed_medical_condition_affecting_growth_development_or_behavior",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function safeRequestId(value: unknown) {
  return typeof value === "string" && requestIdPattern.test(value) ? value : "invalid";
}

/**
 * Derives exactly one person's external context from explicit consultation
 * fields and the server-created group plan. It never derives age, target, or
 * health from the question or a model. Only health tags made relevant by that
 * group's retrieval preflight are retained, with omission represented as
 * `unknown`.
 */
export function deriveConfirmedPersonConditions(
  consultation: ConsultationInput,
  plan: ConsultationGroupPlan,
  relevantPrompts: readonly HealthPrompt[],
): ConfirmedPersonConditions {
  const health: ConfirmedPersonConditions["health"] = {};
  for (const prompt of relevantPrompts) {
    if (prompt.key === "diagnosed_illness_or_disability"
      || prompt.key === "diagnosed_medical_condition_affecting_growth_development_or_behavior") {
      health[prompt.key] = consultation.health[plan.id]?.[prompt.key] ?? "unknown";
    }
  }
  if (plan.target === "child" && plan.child) {
    return { target: "child", years: plan.child.years, months: plan.child.months, health };
  }
  return { target: plan.target === "caregiver" ? "caregiver" : "unknown", health };
}

/**
 * Strictly accepts only the explicit answer contract. In particular, callers
 * cannot attach client-side evidence, history, records, profiles, or arbitrary
 * nested fields for this isolated prototype to read.
 */
export function validateAnswerRequest(input: unknown): AnswerRequestValidation {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["requestId", "consultation", "urgentConcern"])) {
    return { ok: false, errors: ["回答要求の形式が正しくありません。"] };
  }
  if (typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)
    || !["yes", "no", "unknown"].includes(input.urgentConcern as string)) {
    return { ok: false, errors: ["回答要求の形式が正しくありません。"] };
  }
  const consultation = input.consultation;
  if (!isPlainRecord(consultation)
    || !hasExactKeys(consultation, ["question", "target", "children", "health", "confirmed", "ageConflictAcknowledged"])
    || !Array.isArray(consultation.children) || !isPlainRecord(consultation.health)) {
    return { ok: false, errors: ["相談入力に許可されない項目があります。"] };
  }
  if (consultation.children.some((child) =>
    !isPlainRecord(child) || !hasExactKeys(child, ["id", "years", "months"]),
  )) {
    return { ok: false, errors: ["子どもの入力に許可されない項目があります。"] };
  }
  for (const answers of Object.values(consultation.health)) {
    if (!isPlainRecord(answers) || Object.keys(answers).some((key) => !healthKeys.has(key))) {
      return { ok: false, errors: ["健康に関する入力に許可されない項目があります。"] };
    }
  }
  const checked = validateConsultationInput(consultation);
  if (!checked.ok) return checked;
  const groupIds = new Set(groupConsultation(checked.value).map((group) => group.id));
  if (Object.keys(checked.value.health).some((groupId) => !groupIds.has(groupId))) {
    return { ok: false, errors: ["他の対象者の健康条件は使用できません。"] };
  }
  return {
    ok: true,
    value: {
      requestId: input.requestId,
      consultation: checked.value,
      urgentConcern: input.urgentConcern as AnswerRequest["urgentConcern"],
    },
  };
}

function asBlockedGroup(group: EvidenceGroup): AnswerGroup {
  if (group.state === "unverified") {
    return {
      id: group.id, label: group.label, status: "needs_confirmation",
      message: "資料の適用条件に未確認事項があります。個別の助言は表示しません。",
      questions: requiredQuestionsForUnverifiedGroup(group),
      claims: [], sources: group.results,
    };
  }
  if (group.state === "incomplete") {
    return {
      id: group.id, label: group.label, status: "incomplete",
      message: "検索または入力が未完了です。回答は表示しません。", questions: [], claims: [], sources: [],
    };
  }
  if (group.state === "no_matching" || group.state === "no_vocabulary") {
    return {
      id: group.id, label: group.label, status: "insufficient",
      message: "今回の収録資料だけでは回答を作成できません。", questions: [], claims: [], sources: [],
    };
  }
  return {
    id: group.id, label: group.label, status: "connection_unconfigured",
    message: "外部モデル接続は構成されていません。原文と必須文脈のみを確認してください。",
    questions: [], claims: [], sources: group.results,
  };
}

function rejectedResponse(requestId: string, message: string): AnswerResponse {
  return {
    requestId, mode: "offline", modelUsed: false, status: "rejected",
    groups: [{ id: "invalid", label: "入力を確認", status: "rejected", message, questions: [], claims: [], sources: [] }],
    notices: ["この試作は外部モデルを使用しません。"],
  };
}

function cancelledResponse(requestId: string): AnswerResponse {
  return {
    requestId, mode: "offline", modelUsed: false, status: "cancelled", groups: [],
    notices: ["確認を中止しました。"],
  };
}

/**
 * Deployed offline path: always starts a fresh server-side consultation search,
 * never accepts client evidence/history, and never invokes a provider.
 */
export async function checkOfflineAnswer(
  pool: EvidenceSearchPool,
  request: unknown,
  options: OfflineAnswerOptions = {},
): Promise<AnswerResponse> {
  const validated = validateAnswerRequest(request);
  const requestId = safeRequestId(isPlainRecord(request) ? request.requestId : undefined);
  if (!validated.ok) return rejectedResponse(requestId, "入力を確認してください。");
  if (options.signal?.aborted) return cancelledResponse(validated.value.requestId);
  if (urgentStopReason(validated.value.consultation.question, validated.value.urgentConcern)) {
    return {
      requestId: validated.value.requestId, mode: "offline", modelUsed: false, status: "emergency_stop", groups: [],
      notices: [EMERGENCY_STOP_NOTICE, EMERGENCY_HEURISTIC_LIMITATION],
    };
  }
  let response: ConsultationResponse;
  try {
    response = await searchConsultation(pool, validated.value.consultation);
  } catch {
    return rejectedResponse(validated.value.requestId, "検索を完了できませんでした。");
  }
  if (options.signal?.aborted) return cancelledResponse(validated.value.requestId);
  return {
    requestId: validated.value.requestId,
    mode: "offline",
    modelUsed: false,
    status: "checked",
    groups: response.groups.map(asBlockedGroup),
    notices: [
      "この試作は外部モデルを使用しません。個別の診断・治療・助言は表示しません。",
      ...(response.expansionNotice ? [response.expansionNotice] : []),
      ...(response.ageNotice.message ? [response.ageNotice.message] : []),
    ],
  };
}

/**
 * Future-only provider-neutral seam. It is not imported by the deployed route:
 * a caller must inject a transport and this function re-reads the complete
 * consultation response before returning a validated candidate. The comparison
 * detects a changed snapshot but cannot repair the documented non-atomic
 * publication/body-update race.
 */
export async function executeFreshCandidate(
  pool: EvidenceSearchPool,
  request: unknown,
  provider: CandidateProvider,
  options: FutureCandidateOptions = {},
): Promise<FutureCandidateResult> {
  const validated = validateAnswerRequest(request);
  if (!validated.ok || options.signal?.aborted) return { status: options.signal?.aborted ? "cancelled" : "rejected" };
  if (urgentStopReason(validated.value.consultation.question, validated.value.urgentConcern)) return { status: "rejected" };
  const initial = await searchConsultation(pool, validated.value.consultation);
  if (options.signal?.aborted) return { status: "cancelled" };
  // The same conservative gate used by the offline response applies to this
  // future seam: no model candidate is requested for an unverified person or
  // for a retrieval state that cannot support an answer.
  if (initial.groups.length !== 1 || initial.groups[0].state !== "matched") {
    return { status: "rejected" };
  }
  const localGroupId = initial.groups[0].id;
  const plan = groupConsultation(validated.value.consultation).find((item) => item.id === localGroupId);
  if (!plan) return { status: "rejected" };
  const confirmedConditions = deriveConfirmedPersonConditions(
    validated.value.consultation,
    plan,
    initial.groups[0].healthPrompts,
  );
  const packet = buildAnswerPacket(
    validated.value.consultation.question,
    initial.groups[0],
    createFreshPersonToken(),
    confirmedConditions,
  );
  try {
    const candidate = await executeCandidate(provider, packet, options);
    if (options.signal?.aborted) return { status: "cancelled" };
    const fresh = await searchConsultation(pool, validated.value.consultation);
    if (options.signal?.aborted) return { status: "cancelled" };
    const freshGroup = fresh.groups.find((group) => group.id === localGroupId);
    if (!freshGroup || !packetIsFresh(packet, freshGroup)) return { status: "rejected" };
    const candidateDigest = snapshotDigest(candidate);
    const permit = options.humanSemanticReviewPermit;
    // Citations, lexical guards, and snapshot equality cannot establish that
    // wording is clinically safe or faithful. Do not expose the candidate
    // without a separately supplied human-review binding.
    if (!permit || permit.kind !== "human_semantic_review" || permit.reviewed !== true
      || permit.snapshotDigest !== packet.snapshotDigest || permit.candidateDigest !== candidateDigest) {
      return { status: "review_required" };
    }
    return { status: "accepted", candidate };
  } catch (error) {
    return { status: error instanceof CandidateExecutionError && error.code === "cancelled" ? "cancelled" : "rejected" };
  }
}