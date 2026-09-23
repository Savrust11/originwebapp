import type { EvidenceSearchResult } from "../../shared/evidence.ts";
import { searchEvidence, type EvidenceSearchPool } from "../../server/evidence/search.ts";
import type {
  ConsultationInput,
  ConsultationResponse,
  EvidenceGroup,
  HealthPrompt,
  ResultState,
} from "./contract.ts";
import {
  ageMonthsForChild,
  ageNotice,
  classifyEvidence,
  emptyGroup,
  groupConsultation,
  validateConsultationInput,
  type ConsultationGroupPlan,
} from "./flow.ts";

const KNOWN_HEALTH_PROMPTS: Record<string, HealthPrompt> = {
  diagnosed_illness_or_disability: {
    key: "diagnosed_illness_or_disability",
    label: "この子ども、または支援する保護者に、診断された病気や障害がありますか？",
    explanation: "E03の対象条件は子どもと保護者の両方に関係します。いずれかに該当するときは「ある」、両方について該当しないと確認できたときだけ「ない」を選んでください。一方でも未確認なら「分からない」のままにできます。",
  },
  diagnosed_medical_condition_affecting_growth_development_or_behavior: {
    key: "diagnosed_medical_condition_affecting_growth_development_or_behavior",
    label: "この子どもに、成長・発達・行動に影響する診断済みの状態がありますか？",
    explanation: "E04の対象条件は子どもについてのものです。保護者自身の状態で代用しません。原文では自閉スペクトラム症やADHD等が例示されています。診断を求める質問ではなく、分からなければ未確認のままにできます。",
  },
};

const disclaimer = "表示するのは研究資料の原文・引用情報と適用条件です。個別の診断や医療上の助言ではありません。";

/**
 * The consultation-only expansion is a fixed vocabulary bridge, not a
 * classification of the child. The original question remains separately held
 * by the caller and is never replaced with a health fact.
 */
function expandedQuestion(question: string) {
  // Normalization only makes this fixed vocabulary bridge deterministic. It
  // does not classify the wording as a diagnosis or a health answer.
  const normalized = question.normalize("NFKC").trim();
  if (normalized.includes("発達障害")) {
    return {
      query: `${normalized} 親子 interactions depressive symptoms screen use`,
      notice: "発達障害に言及する質問について、関連する既知の研究用語（親子の相互作用、抑うつ症状、スクリーン利用）も検索しました。これは診断や病気の有無を示すものではありません。",
    };
  }
  return { query: question, notice: null };
}

function exclusionTags(results: EvidenceSearchResult[]) {
  const tags = new Set<string>();
  for (const result of results) {
    // Legacy source metadata can carry a checked exclusion while its raw JSON
    // policy remains unknown. It is still a known restriction of this exact
    // matching root/version and must prompt rather than disappear.
    for (const tag of result.source.conditions.exceptions) tags.add(tag);
    const policies = [
      result.source.applicabilityPolicy,
      result.section.applicabilityPolicy,
      result.section.resolvedApplicabilityPolicy,
    ];
    for (const policy of policies) {
      if (policy.weiku.conditions.mode === "specific") {
        for (const tag of policy.weiku.conditions.exclusions) tags.add(tag);
      }
    }
  }
  return [...tags].filter((tag) => Object.hasOwn(KNOWN_HEALTH_PROMPTS, tag)).sort();
}

function healthValidation(
  plan: ConsultationGroupPlan,
  input: ConsultationInput,
  prompts: HealthPrompt[],
) {
  const answers = input.health[plan.id] ?? {};
  const known = new Set(prompts.map((prompt) => prompt.key));
  const invalidTags = Object.keys(answers).filter((tag) => !known.has(tag));
  if (invalidTags.length) {
    return { error: "この結果グループに関係しない健康条件の回答は使用できません。" };
  }
  const conditions: string[] = [];
  const absentConditions: string[] = [];
  for (const prompt of prompts) {
    // Omission is explicitly unknown; it is never manufactured as “absent”.
    const answer = answers[prompt.key] ?? "unknown";
    if (answer === "present") conditions.push(prompt.key);
    if (answer === "absent") absentConditions.push(prompt.key);
  }
  return { conditions, absentConditions };
}

function overallState(groups: EvidenceGroup[]): ResultState {
  if (groups.some((group) => group.state === "incomplete")) return "incomplete";
  if (groups.some((group) => group.state === "no_vocabulary")) return "no_vocabulary";
  if (groups.every((group) => group.state === "no_matching")) return "no_matching";
  return groups.every((group) => group.state === "matched") ? "matched" : "unverified";
}

function incompleteResponse(input: unknown, diagnostics: string[]): ConsultationResponse {
  const safeInput = input && typeof input === "object" ? input as Partial<ConsultationInput> : {};
  const notice = ageNotice({
    question: typeof safeInput.question === "string" ? safeInput.question : "",
    children: Array.isArray(safeInput.children) ? safeInput.children.filter((child): child is ConsultationInput["children"][number] =>
      Boolean(child) && typeof child === "object"
        && typeof (child as { id?: unknown }).id === "string"
        && (((child as { years?: unknown }).years === null) || typeof (child as { years?: unknown }).years === "number")
        && (((child as { months?: unknown }).months === null) || typeof (child as { months?: unknown }).months === "number"),
    ) : [],
  });
  return {
    state: "incomplete",
    groups: [{ id: "invalid", label: "入力を確認", state: "incomplete", results: [], healthPrompts: [], diagnostics }],
    expansionNotice: null,
    ageNotice: notice,
    disclaimer,
  };
}

async function searchGroup(
  pool: EvidenceSearchPool,
  question: string,
  plan: ConsultationGroupPlan,
  conditions?: string[],
  absentConditions?: string[],
) {
  return searchEvidence(pool, {
    question,
    ageMonths: ageMonthsForChild(plan.child),
    context: {
      ...(plan.target ? { target: plan.target } : {}),
      ...(conditions?.length ? { conditions } : {}),
      ...(absentConditions?.length ? { absentConditions } : {}),
    },
  });
}

/**
 * Isolated prototype orchestration. This module has no route, persistence,
 * account, personal-record, external-AI, or logging dependency.
 */
export async function searchConsultation(
  pool: EvidenceSearchPool,
  input: ConsultationInput,
): Promise<ConsultationResponse> {
  const validated = validateConsultationInput(input);
  if (!validated.ok) return incompleteResponse(input, validated.errors);
  const value = validated.value;
  const notice = ageNotice(value);
  const expansion = expandedQuestion(value.question);
  const plans = groupConsultation(value);

  if (!value.confirmed || (notice.conflict && !value.ageConflictAcknowledged)) {
    const reason = !value.confirmed
      ? "検索前に入力内容を確認してください。"
      : "質問文の年齢表現を確認したことを明示してください。";
    const groups = plans.map((plan) => emptyGroup(plan, "incomplete", [reason]));
    return { state: "incomplete", groups, expansionNotice: expansion.notice, ageNotice: notice, disclaimer };
  }

  try {
    const groups: EvidenceGroup[] = [];
    for (const plan of plans) {
      // Preflight intentionally contains no health facts. It only discovers
      // exclusions recorded by a root/version already matching this group.
      const preflight = await searchGroup(pool, expansion.query, plan);
      const preflightState = classifyEvidence(preflight);
      if (preflightState === "incomplete" || preflightState === "no_vocabulary") {
        groups.push({
          ...emptyGroup(plan, preflightState, preflight.diagnostics ? [preflight.diagnostics.reason] : []),
          healthPrompts: [],
        });
        continue;
      }
      const relevantTags = exclusionTags(preflight.results);
      // These corpus eligibility facts involve a child (and E03 also their
      // caregiver). A caregiver-only or unidentified subject must not supply
      // their own health as a substitute for a child's condition.
      const prompts = plan.target === "child"
        ? relevantTags.map((tag) => KNOWN_HEALTH_PROMPTS[tag]) : [];
      const health = healthValidation(plan, value, prompts);
      if (typeof health.error === "string") {
        groups.push({ ...emptyGroup(plan, "incomplete", [health.error]), healthPrompts: prompts });
        continue;
      }
      const response = await searchGroup(pool, expansion.query, plan, health.conditions, health.absentConditions);
      groups.push({
        id: plan.id,
        label: plan.label,
        state: classifyEvidence(response),
        results: response.results,
        healthPrompts: prompts,
        diagnostics: [
          ...(response.diagnostics ? [response.diagnostics.reason] : []),
          ...(relevantTags.length > 0 && plan.target !== "child"
            ? ["この研究には子どもに関する対象条件もあります。保護者自身の状態だけでは確認できないため未確認としています。必要なら「両方」または「子どもについて」を選び、子どもごとに確認してください。"] : []),
        ],
      });
    }
    return { state: overallState(groups), groups, expansionNotice: expansion.notice, ageNotice: notice, disclaimer };
  } catch {
    // searchEvidence deliberately hides database causes. Do the same here:
    // this prototype returns only an incomplete result, never raw errors.
    const groups = plans.map((plan) => emptyGroup(plan, "incomplete", ["検索を完了できませんでした。"]));
    return { state: "incomplete", groups, expansionNotice: expansion.notice, ageNotice: notice, disclaimer };
  }
}