import { z } from "zod";
import {
  documentApplicabilityPolicySchema,
  emptyDocumentApplicabilityPolicy,
  emptySectionApplicabilityPolicy,
  evidenceApplicabilityPolicySchema,
  evidenceTargetSchema,
  type EvidenceApplicabilityPolicy,
} from "./evidence-policy";

export {
  documentApplicabilityPolicySchema,
  emptyDocumentApplicabilityPolicy,
  emptySectionApplicabilityPolicy,
  evidenceApplicabilityPolicySchema,
  evidenceTargetSchema,
} from "./evidence-policy";
export type { EvidenceApplicabilityPolicy } from "./evidence-policy";

const languageSchema = z.enum(["ja", "en"]);
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedListItem = boundedText(500);

/**
 * Fixed external search request contract. Routes must use safeParse/parse on
 * this schema before passing data to the retrieval service.
 */
export const inputSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  /**
   * Explicit retrieval context only. It is never derived from the question,
   * account, consultation, or other personal records.
   */
  context: z.object({
    target: evidenceTargetSchema.optional(),
    /** Conditions explicitly known to be present; omissions carry no meaning. */
    conditions: z.array(boundedListItem).max(64).optional(),
    /** Conditions explicitly confirmed absent; omissions carry no meaning. */
    absentConditions: z.array(boundedListItem).max(64).optional(),
    japanApplicability: z.boolean().optional(),
  }).strict().superRefine((value, context) => {
    const present = new Set((value.conditions ?? []).map((item) => item.toLocaleLowerCase()));
    if ((value.absentConditions ?? []).some((item) => present.has(item.toLocaleLowerCase()))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["absentConditions"],
        message: "a condition cannot be both present and absent",
      });
    }
  }).optional(),
  ageMonths: z.number().int().min(0).max(1_200).optional(),
  region: boundedText(120).optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).strict().superRefine((value, context) => {
  // `japanApplicability: false` means "do not assess Japan applicability",
  // not an assertion that the source applies outside Japan.
  if (value.context?.japanApplicability === false
    && value.region
    && /^(japan|日本)$/i.test(value.region)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["context", "japanApplicability"],
      message: "Japan region cannot be combined with japanApplicability false",
    });
  }
});

/** Request shape before `inputSchema` supplies its default limit. */
export interface SearchInput {
  question: string;
  context?: {
    target?: "child" | "caregiver";
    conditions?: string[];
    absentConditions?: string[];
    japanApplicability?: boolean;
  };
  ageMonths?: number;
  region?: string;
  limit?: number;
}

export type ApplicabilityMatch = "matched" | "mismatched" | "unverified";

export interface EvidenceAgeMetadata {
  scope: "unknown" | "all" | "range";
  minMonths: number | null;
  maxMonths: number | null;
}

export interface EvidenceRegionsMetadata {
  scope: "unknown" | "all" | "list";
  values: string[];
}

export interface EvidenceConditionsMetadata {
  scope: "unknown" | "all" | "list";
  values: string[];
  exceptions: string[];
}

export interface EvidenceCertaintyMetadata {
  level: string | null;
  assessmentMethod: string | null;
  assessmentSource: string | null;
}

export interface EvidenceReviewMetadata {
  manualReviewed: boolean;
  reviewerName: string | null;
  reviewedAt: string | null;
  adoptionReason: string | null;
}

/**
 * Stable bibliography for a source version. A required-context section is
 * always from this exact version, rather than becoming a separately ranked
 * source.
 */
export interface EvidenceSourceVersionCitation {
  sourceId: string;
  versionId: string;
  title: string;
  publisher: string;
  language: "ja" | "en";
  originalUrl: string;
  version: string;
}

/**
 * An original section that must accompany a returned original section. This is
 * relationship context, not an independently searchable/ranked result.
 */
export interface EvidenceRequiredContext {
  sectionId: string;
  role: string;
  originalText: string;
  citation: EvidenceSourceVersionCitation;
  sourceLocation: string;
  notes: string | null;
  /** Raw policy recorded on this exact context section. */
  policy: EvidenceApplicabilityPolicy;
  section: {
    originalSectionId: string;
    type: string;
    heading: string | null;
    notes: string | null;
    applicabilityPolicy: EvidenceApplicabilityPolicy;
    resolvedApplicabilityPolicy: EvidenceApplicabilityPolicy;
    policyProvenance: Record<string, "unknown" | "document" | "section" | "document_and_section">;
  };
}

/**
 * `originalText` is always the original section. `source` carries complete
 * source applicability, certainty, reviewer and usage provenance rather than
 * flattening claims into a search score.
 */
export interface EvidenceSearchResult {
  sourceId: string;
  versionId: string;
  sectionId: string;
  originalText: string;
  title: string;
  publisher: string;
  language: "ja" | "en";
  originalUrl: string;
  sourceLocation: string;
  version: string;
  /** Version-level bibliography for this original-section citation. */
  citation: EvidenceSourceVersionCitation;
  /** Required same-version original sections, attached only to this root. */
  requiredContext: EvidenceRequiredContext[];
  section: {
    /** Repeats sectionId to make the original-section binding explicit. */
    originalSectionId: string;
    type: string;
    heading: string | null;
    notes: string | null;
    /** Raw per-section policy, before inheriting document defaults. */
    applicabilityPolicy: EvidenceApplicabilityPolicy;
    /** Conservative effective policy and provenance for this exact section. */
    resolvedApplicabilityPolicy: EvidenceApplicabilityPolicy;
    policyProvenance: Record<string, "unknown" | "document" | "section" | "document_and_section">;
  };
  applicability: {
    target: ApplicabilityMatch;
    age: ApplicabilityMatch;
    region: ApplicabilityMatch;
    conditions: ApplicabilityMatch;
    japan: ApplicabilityMatch;
  };
  source: {
    testOnly: boolean;
    documentType: string;
    authors: string[];
    externalIdentifier: string | null;
    publishedOn: string | null;
    revisedOn: string | null;
    age: EvidenceAgeMetadata;
    regions: EvidenceRegionsMetadata;
    conditions: EvidenceConditionsMetadata;
    certainty: EvidenceCertaintyMetadata;
    review: EvidenceReviewMetadata;
    usageTerms: string | null;
    /** Raw document policy; document citation/bibliography remains version-level. */
    applicabilityPolicy: EvidenceApplicabilityPolicy;
  };
}

export interface EvidenceSearchResponse {
  status: "results" | "no_results";
  results: EvidenceSearchResult[];
  diagnostics?: {
    reason: "no_vocabulary" | "expansion_limit" | "candidate_scan_limit" | "context_incomplete" | "context_limit";
  };
}

export const evidenceSourceCreateSchema = z.object({
  id: z.string().uuid().optional(),
  sourceKey: z.string().trim().min(1).max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "sourceKey must be an opaque catalog key"),
  testOnly: z.boolean(),
}).strict();

export const evidenceVersionIngestSchema = z.object({
  id: z.string().uuid().optional(),
  sourceId: z.string().uuid(),
  version: boundedText(100),
  title: boundedText(500),
  publisher: boundedText(300),
  authors: z.array(boundedText(300)).max(64).default([]),
  originalUrl: z.string().url().max(2_048)
    .refine((value) => /^https?:\/\//i.test(value), "originalUrl must use http or https"),
  externalIdentifier: z.string().trim().min(1).max(512).nullable().default(null),
  documentType: boundedText(80),
  language: languageSchema,
  publishedOn: z.string().trim().min(1).max(40).nullable().default(null),
  revisedOn: z.string().trim().min(1).max(40).nullable().default(null),
  age: z.object({
    scope: z.enum(["unknown", "all", "range"]),
    minMonths: z.number().int().min(0).max(1_200).nullable().default(null),
    maxMonths: z.number().int().min(0).max(1_200).nullable().default(null),
  }).strict(),
  regions: z.object({
    scope: z.enum(["unknown", "all", "list"]),
    values: z.array(boundedListItem).max(64).default([]),
  }).strict(),
  conditions: z.object({
    scope: z.enum(["unknown", "all", "list"]),
    values: z.array(boundedListItem).max(64).default([]),
    exceptions: z.array(boundedListItem).max(64).default([]),
  }).strict(),
  certainty: z.object({
    level: z.string().trim().min(1).max(32).nullable().default(null),
    assessmentMethod: z.string().trim().min(1).max(2_000).nullable().default(null),
    assessmentSource: z.string().trim().min(1).max(2_000).nullable().default(null),
  }).strict().default({ level: null, assessmentMethod: null, assessmentSource: null }),
  documentApplicabilityPolicy: documentApplicabilityPolicySchema
    .default(emptyDocumentApplicabilityPolicy),
  testOnly: z.boolean(),
  sections: z.array(z.object({
    id: z.string().uuid().optional(),
    sectionType: boundedText(64).default("excerpt"),
    heading: z.string().trim().min(1).max(2_000).nullable().default(null),
    originalText: boundedText(20_000),
    sourceLocation: boundedText(1_000),
    notes: z.string().trim().min(1).max(4_000).nullable().default(null),
    applicabilityPolicy: evidenceApplicabilityPolicySchema
      .default(emptySectionApplicabilityPolicy),
  }).strict()).min(1).max(200),
}).strict().superRefine((value, context) => {
  const { age } = value;
  if (age.scope === "range") {
    if (age.minMonths === null || age.maxMonths === null || age.minMonths > age.maxMonths) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["age"], message: "range age needs ordered bounds" });
    }
  } else if (age.minMonths !== null || age.maxMonths !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["age"], message: "unknown/all age has no bounds" });
  }
  if ((value.regions.scope === "list") !== (value.regions.values.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["regions"], message: "list regions need values" });
  }
  if ((value.conditions.scope === "list") !== (value.conditions.values.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["conditions"], message: "list conditions need values" });
  }
});

export const evidenceDerivedTextCreateSchema = z.object({
  id: z.string().uuid().optional(),
  sourceVersionId: z.string().uuid(),
  originalSectionId: z.string().uuid(),
  kind: z.enum(["translation", "summary"]),
  language: languageSchema,
  content: boundedText(20_000),
  creationMethod: boundedText(80),
  reviewStatus: z.enum(["unchecked", "checked"]).default("unchecked"),
  reviewerName: z.string().trim().min(1).max(160).nullable().default(null),
  reviewedAt: z.string().trim().min(1).max(40).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.reviewStatus === "checked" && (!value.reviewerName || !value.reviewedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "checked derived text needs reviewer provenance" });
  }
});

export const evidenceReviewSchema = z.object({
  sourceId: z.string().uuid(),
  versionId: z.string().uuid(),
  reviewerName: boundedText(160),
  reviewedAt: z.string().trim().min(1).max(40),
  adoptionReason: boundedText(4_000),
  usageTerms: boundedText(4_000),
}).strict();

export const evidencePublicationSchema = z.object({
  sourceId: z.string().uuid(),
  versionId: z.string().uuid(),
  expectedCurrentVersionId: z.string().uuid().nullable(),
}).strict();

export const evidenceSourceStatusSchema = z.object({
  sourceId: z.string().uuid(),
  status: z.enum(["draft", "active", "suspended"]),
}).strict();

export const evidenceConceptCreateSchema = z.object({
  id: z.string().uuid().optional(),
  conceptKey: z.string().trim().min(1).max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "conceptKey must be an opaque catalog key"),
}).strict();

function englishRetrievalTermIsSafe(value: { language: "ja" | "en"; term: string }): boolean {
  // The SQL English boundary matcher deliberately preserves only letters,
  // digits, underscores, and word-separating spaces. Reject C++/punctuation
  // terms rather than silently collapsing them into a different concept.
  return value.language !== "en" || /^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/.test(value.term);
}

export const evidenceKeywordUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  conceptId: z.string().uuid().nullable().default(null),
  term: boundedText(160),
  language: languageSchema,
  active: z.boolean().default(true),
  testOnly: z.boolean(),
}).strict().refine(englishRetrievalTermIsSafe, {
  message: "English retrieval terms must be token-safe and not punctuation-only",
  path: ["term"],
});

export const evidenceDictionaryTermUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  conceptId: z.string().uuid(),
  term: boundedText(160),
  language: languageSchema,
  testOnly: z.boolean(),
}).strict().refine(englishRetrievalTermIsSafe, {
  message: "English retrieval terms must be token-safe and not punctuation-only",
  path: ["term"],
});

export const evidenceSectionKeywordLinkSchema = z.object({
  sourceVersionId: z.string().uuid(),
  sectionId: z.string().uuid(),
  keywordId: z.string().uuid(),
}).strict();

/**
 * A required relationship between two original sections in one source version.
 * The role is an editorial label, not an eligibility claim or a rank signal.
 */
export const evidenceRequiredContextLinkSchema = z.object({
  sourceVersionId: z.string().uuid(),
  sectionId: z.string().uuid(),
  requiredSectionId: z.string().uuid(),
  role: boundedText(64),
}).strict().superRefine((value, context) => {
  if (value.sectionId === value.requiredSectionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredSectionId"],
      message: "a section cannot require itself as context",
    });
  }
});

export type EvidenceVersionIngestInput = z.infer<typeof evidenceVersionIngestSchema>;
export type EvidenceRequiredContextLinkInput = z.infer<typeof evidenceRequiredContextLinkSchema>;