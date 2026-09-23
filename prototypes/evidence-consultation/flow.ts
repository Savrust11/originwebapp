import type {
  AgeNotice,
  ChildInput,
  ConsultationInput,
  EvidenceGroup,
  HealthAnswer,
  TargetChoice,
} from "./contract";
import type { EvidenceSearchResponse } from "../../shared/evidence";

export type ConsultationValidation =
  | { ok: true; value: ConsultationInput; errors: [] }
  | { ok: false; errors: string[] };

export type ConsultationGroupPlan = {
  id: string;
  label: string;
  target?: "child" | "caregiver";
  child?: ChildInput;
};

const childIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const healthAnswers = new Set<HealthAnswer>(["unknown", "present", "absent"]);
const recognizedHealthTags = new Set([
  "diagnosed_illness_or_disability",
  "diagnosed_medical_condition_affecting_growth_development_or_behavior",
]);

function isNullableInteger(value: unknown, minimum: number, maximum: number) {
  return value === null || (typeof value === "number"
    && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates only explicit consultation values. In particular, an omitted
 * month is not converted to zero and no age is inferred from question prose.
 */
export function validateConsultationInput(input: unknown): ConsultationValidation {
  if (!isRecord(input)) return { ok: false, errors: ["相談内容の形式が正しくありません。"] };
  const errors: string[] = [];
  const question = input.question;
  if (typeof question !== "string" || !question.trim() || question.trim().length > 1_000) {
    errors.push("質問を入力してください。");
  }
  const target = input.target;
  if (!["child", "caregiver", "both", "unknown"].includes(target as string)) {
    errors.push("対象を選択してください。");
  }
  if (!Array.isArray(input.children) || input.children.length > 4) {
    errors.push("子どもの情報は4人までです。");
  }
  const children: ChildInput[] = [];
  const childIds = new Set<string>();
  if (Array.isArray(input.children)) {
    input.children.forEach((child, index) => {
      if (!isRecord(child) || typeof child.id !== "string" || !childIdPattern.test(child.id)
        || childIds.has(child.id)) {
        errors.push(`子ども${index + 1}の識別子が正しくありません。`);
        return;
      }
      childIds.add(child.id);
      if (!isNullableInteger(child.years, 0, 100) || !isNullableInteger(child.months, 0, 11)) {
        errors.push(`子ども${index + 1}の年齢が正しくありません。`);
        return;
      }
      children.push({ id: child.id, years: child.years as number | null, months: child.months as number | null });
    });
  }
  if ((target === "child" || target === "both") && children.length === 0) {
    errors.push("子どもを対象にする場合は子どもを1人以上追加してください。");
  }
  const health: Record<string, Record<string, HealthAnswer>> = {};
  if (!isRecord(input.health)) {
    errors.push("健康に関する回答の形式が正しくありません。");
  } else {
    for (const [groupId, answers] of Object.entries(input.health)) {
      if (!isRecord(answers)) {
        errors.push(`${groupId}の健康に関する回答の形式が正しくありません。`);
        continue;
      }
      health[groupId] = {};
      for (const [tag, answer] of Object.entries(answers)) {
        if (!recognizedHealthTags.has(tag)) {
          errors.push(`${groupId}の健康条件が認識できません。`);
          continue;
        }
        if (!healthAnswers.has(answer as HealthAnswer)) {
          errors.push(`${groupId}の${tag}への回答が正しくありません。`);
          continue;
        }
        health[groupId][tag] = answer as HealthAnswer;
      }
    }
  }
  if (typeof input.confirmed !== "boolean") errors.push("確認状態が正しくありません。");
  if (typeof input.ageConflictAcknowledged !== "boolean") errors.push("年齢確認状態が正しくありません。");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      question: (question as string).trim(),
      target: target as TargetChoice,
      children,
      health,
      confirmed: input.confirmed as boolean,
      ageConflictAcknowledged: input.ageConflictAcknowledged as boolean,
    },
    errors: [],
  };
}

type Mention = {
  text: string;
  years: number | null;
  months: number | null;
  start: number;
  end: number;
};

function ageMentions(question: string): Mention[] {
  const found: Mention[] = [];
  const add = (
    text: string,
    start: number,
    yearsText: string | undefined,
    monthsText?: string,
    maximumMonths = 11,
  ) => {
    const years = yearsText === undefined ? null : Number(yearsText);
    const months = monthsText === undefined ? null : Number(monthsText);
    if ((years === null || (Number.isSafeInteger(years) && years >= 0 && years <= 100))
      && (years !== null || months !== null)
      && (months === null || (Number.isSafeInteger(months) && months >= 0 && months <= maximumMonths))) {
      found.push({ text, years, months, start, end: start + text.length });
    }
  };
  // These patterns deliberately identify only explicit year/month candidates.
  // They are warnings, never a source of selected age data.
  const japanese = /(\d{1,3})\s*歳(?:\s*(\d{1,2})\s*(?:か月|ヶ月|ヵ月))?/gu;
  const english = /\b(\d{1,3})\s*(?:years?|yrs?)(?:\s*(\d{1,2})\s*(?:months?|mos?))?\b/giu;
  for (const match of question.matchAll(japanese)) add(match[0], match.index, match[1], match[2]);
  for (const match of question.matchAll(english)) add(match[0], match.index, match[1], match[2]);
  // Month-only wording is common and is an explicit warning candidate, but
  // never selected age data. Do not double-count the month inside “2歳3か月”.
  const monthOnly = /(?:月齢\s*(\d{1,2})(?:\s*(?:か月|ヶ月|ヵ月))?|生後\s*(\d{1,2})\s*(?:か月|ヶ月|ヵ月)|(\d{1,2})\s*(?:か月|ヶ月|ヵ月))/gu;
  for (const match of question.matchAll(monthOnly)) {
    const start = match.index;
    const end = start + match[0].length;
    if (found.some((mention) => start < mention.end && end > mention.start)) continue;
    add(match[0], start, undefined, match[1] ?? match[2] ?? match[3], 1_200);
  }
  return Array.from(new Map(found.map((mention) => [
    `${mention.years ?? "month"}:${mention.months ?? "range"}`, mention,
  ])).values());
}

function mentionMatchesSelectedAge(mention: Mention, child: ChildInput) {
  if (mention.years === null) {
    // A month-only expression is exact only when the selected years and
    // months together establish that same total. A partial input stays
    // unknown rather than being silently completed.
    return mention.months !== null
      && child.years !== null && child.months !== null
      && child.years * 12 + child.months === mention.months;
  }
  if (child.years !== mention.years) return false;
  // A year-only expression describes that whole year, rather than an exact
  // month. It is therefore compatible with any explicitly selected month.
  return mention.months === null || child.months === mention.months;
}

/** Deterministic age-prose warning only; it never assigns an age. */
export function ageNotice(input: Pick<ConsultationInput, "question" | "children">): AgeNotice {
  const mentions = ageMentions(input.question.normalize("NFKC"));
  // A partial selected age is still a selected value to compare against prose;
  // it must never be treated as if no value had been selected.
  const selected = input.children.filter((child) => child.years !== null || child.months !== null);
  const unmatched = mentions.filter((mention) => !selected.some((child) => mentionMatchesSelectedAge(mention, child)));
  // There is no reliable way to map question prose to one child in a
  // multi-child consultation. Require an explicit acknowledgement instead of
  // auto-associating otherwise matching values.
  const multipleChildAmbiguity = input.children.length > 1 && mentions.length > 0;
  const conflict = multipleChildAmbiguity || (selected.length > 0 ? unmatched.length > 0 : unmatched.length > 1);
  return {
    mentions: mentions.map((mention) => mention.text),
    conflict,
    message: !conflict
      ? null
      : multipleChildAmbiguity
        ? "複数の子どもと年齢表現があるため、自動対応付けは行いません。対象ごとの年齢を確認してください。"
        : "質問文中の年齢表現と選択した年齢を確認してください。年齢は自動では設定されません。",
  };
}

/** Builds distinct result groups; a caregiver is never given a child's age. */
export function groupConsultation(input: ConsultationInput): ConsultationGroupPlan[] {
  const childGroups = input.children.map((child, index) => ({
    id: `child:${child.id}`,
    label: `子ども${index + 1}`,
    target: "child" as const,
    child,
  }));
  if (input.target === "child") return childGroups;
  if (input.target === "caregiver") return [{ id: "caregiver", label: "保護者", target: "caregiver" as const }];
  if (input.target === "both") {
    return [...childGroups, { id: "caregiver", label: "保護者", target: "caregiver" as const }];
  }
  return [{ id: "unknown", label: "対象未指定", target: undefined }];
}

export function ageMonthsForChild(child: ChildInput | undefined): number | undefined {
  // A partial explicit age is retained as partial information, not rounded to
  // an invented exact month for retrieval.
  return child?.years !== null && child?.years !== undefined
    && child.months !== null && child.months !== undefined
    ? child.years * 12 + child.months
    : undefined;
}

/** Converts core retrieval output into the prototype's conservative states. */
export function classifyEvidence(response: EvidenceSearchResponse): EvidenceGroup["state"] {
  if (response.diagnostics) {
    return response.diagnostics.reason === "no_vocabulary" ? "no_vocabulary" : "incomplete";
  }
  if (response.results.length === 0) return "no_matching";
  return response.results.some((result) => Object.values(result.applicability).includes("unverified"))
    ? "unverified"
    : "matched";
}

export function emptyGroup(plan: ConsultationGroupPlan, state: EvidenceGroup["state"], diagnostics: string[]): EvidenceGroup {
  return { id: plan.id, label: plan.label, state, results: [], healthPrompts: [], diagnostics };
}