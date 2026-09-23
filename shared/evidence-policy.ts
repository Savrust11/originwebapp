import { z } from "zod";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const listItem = boundedText(500);

export const evidenceTargetSchema = z.enum(["child", "caregiver"]);
export const policyModeSchema = z.enum(["unknown", "inherit", "specific"]);

const emptyOnly = (value: unknown) => value === null || value === undefined;

export const scopedAgePolicySchema = z.object({
  mode: policyModeSchema,
  scope: z.enum(["all", "range"]).nullable().default(null),
  minMonths: z.number().int().min(0).max(1_200).nullable().default(null),
  maxMonths: z.number().int().min(0).max(1_200).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.mode !== "specific") {
    if (![value.scope, value.minMonths, value.maxMonths].every(emptyOnly)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "non-specific age policy cannot carry bounds" });
    }
  } else if (value.scope === "range") {
    if (value.minMonths === null || value.maxMonths === null || value.minMonths > value.maxMonths) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "range age policy needs ordered bounds" });
    }
  } else if (value.scope !== "all" || value.minMonths !== null || value.maxMonths !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "all age policy has no bounds" });
  }
});

export const targetPolicySchema = z.object({
  mode: policyModeSchema,
  values: z.array(evidenceTargetSchema).max(2).default([]),
}).strict().superRefine((value, context) => {
  if (value.mode === "specific" && value.values.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "specific target policy needs a value" });
  } else if (value.mode !== "specific" && value.values.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "non-specific target policy has no values" });
  }
});

export const conditionsPolicySchema = z.object({
  mode: policyModeSchema,
  scope: z.enum(["all", "list"]).nullable().default(null),
  values: z.array(listItem).max(64).default([]),
  exclusions: z.array(listItem).max(64).default([]),
}).strict().superRefine((value, context) => {
  if (value.mode !== "specific") {
    if (value.scope !== null || value.values.length || value.exclusions.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "non-specific conditions policy has no values" });
    }
  } else if (value.scope === "list" ? value.values.length === 0 : value.scope !== "all" || value.values.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "conditions policy scope and values disagree" });
  }
});

export const japanApplicabilityPolicySchema = z.object({
  mode: policyModeSchema,
  value: z.enum(["applicable", "inapplicable"]).nullable().default(null),
}).strict().superRefine((value, context) => {
  if ((value.mode === "specific") !== (value.value !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Japan applicability needs a value exactly when specific" });
  }
});

export const researchRegionsPolicySchema = z.object({
  mode: policyModeSchema,
  scope: z.enum(["all", "list"]).nullable().default(null),
  values: z.array(listItem).max(64).default([]),
}).strict().superRefine((value, context) => {
  if (value.mode !== "specific" && (value.scope !== null || value.values.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "non-specific research regions have no values" });
  }
  if (value.mode === "specific" && (value.scope === "list" ? value.values.length === 0 : value.scope !== "all" || value.values.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "research regions scope and values disagree" });
  }
});

export const researchAgePolicySchema = z.object({
  mode: policyModeSchema,
  scope: z.enum(["all", "range", "mean"]).nullable().default(null),
  minMonths: z.number().int().min(0).max(1_200).nullable().default(null),
  maxMonths: z.number().int().min(0).max(1_200).nullable().default(null),
  meanMonths: z.number().int().min(0).max(1_200).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.mode !== "specific") {
    if ([value.scope, value.minMonths, value.maxMonths, value.meanMonths].some((item) => !emptyOnly(item))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "non-specific research age has no values" });
    }
  } else if (value.scope === "range") {
    if (value.minMonths === null || value.maxMonths === null || value.minMonths > value.maxMonths || value.meanMonths !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "research range needs ordered bounds only" });
    }
  } else if (value.scope === "mean") {
    if (value.meanMonths === null || value.minMonths !== null || value.maxMonths !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "research mean is not a participant range" });
    }
  } else if (value.scope !== "all" || value.minMonths !== null || value.maxMonths !== null || value.meanMonths !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "research all age has no values" });
  }
});

export const certaintyPolicySchema = z.object({
  mode: policyModeSchema,
  level: boundedText(32).nullable().default(null),
  assessmentMethod: boundedText(2_000).nullable().default(null),
  assessmentSourceLocation: boundedText(2_000).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.mode !== "specific" && [value.level, value.assessmentMethod, value.assessmentSourceLocation].some((item) => item !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "non-specific certainty has no assessment" });
  }
});

export const usagePolicySchema = z.object({
  mode: policyModeSchema,
  terms: boundedText(4_000).nullable().default(null),
  exceptions: z.array(listItem).max(64).default([]),
}).strict().superRefine((value, context) => {
  if (value.mode !== "specific" && (value.terms !== null || value.exceptions.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "non-specific usage policy has no terms" });
  }
});

export const evidenceApplicabilityPolicySchema = z.object({
  weiku: z.object({
    target: targetPolicySchema,
    age: scopedAgePolicySchema,
    conditions: conditionsPolicySchema,
    japanApplicability: japanApplicabilityPolicySchema,
  }).strict(),
  research: z.object({
    participantAge: researchAgePolicySchema,
    regions: researchRegionsPolicySchema,
  }).strict(),
  certainty: certaintyPolicySchema,
  usage: usagePolicySchema,
}).strict();

export type EvidenceApplicabilityPolicy = z.infer<typeof evidenceApplicabilityPolicySchema>;

export const documentApplicabilityPolicySchema = evidenceApplicabilityPolicySchema.superRefine((value, context) => {
  const modes = [
    value.weiku.target.mode, value.weiku.age.mode, value.weiku.conditions.mode,
    value.weiku.japanApplicability.mode, value.research.participantAge.mode,
    value.research.regions.mode, value.certainty.mode, value.usage.mode,
  ];
  if (modes.includes("inherit")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "document policy cannot inherit" });
  }
});

export const emptyDocumentApplicabilityPolicy: EvidenceApplicabilityPolicy = {
  weiku: {
    target: { mode: "unknown", values: [] },
    age: { mode: "unknown", scope: null, minMonths: null, maxMonths: null },
    conditions: { mode: "unknown", scope: null, values: [], exclusions: [] },
    japanApplicability: { mode: "unknown", value: null },
  },
  research: {
    participantAge: { mode: "unknown", scope: null, minMonths: null, maxMonths: null, meanMonths: null },
    regions: { mode: "unknown", scope: null, values: [] },
  },
  certainty: { mode: "unknown", level: null, assessmentMethod: null, assessmentSourceLocation: null },
  usage: { mode: "unknown", terms: null, exceptions: [] },
};

export const emptySectionApplicabilityPolicy: EvidenceApplicabilityPolicy = emptyDocumentApplicabilityPolicy;