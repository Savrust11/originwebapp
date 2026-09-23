import {
  evidenceApplicabilityPolicySchema,
  emptyDocumentApplicabilityPolicy,
  inputSchema,
  type ApplicabilityMatch,
  type EvidenceApplicabilityPolicy,
  type EvidenceRequiredContext,
  type EvidenceSearchResponse,
  type EvidenceSearchResult,
  type SearchInput,
} from "@shared/evidence";

/**
 * A structural subset of pg.Pool. Importing server/db here would create an
 * accidental production DB dependency and would make isolated retrieval tests
 * less safe.
 */
export interface EvidenceSearchPool {
  query(queryText: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface EvidenceRow extends Record<string, unknown> {
  source_id: string;
  source_test_only: boolean;
  version_id: string;
  section_id: string;
  original_text: string;
  title: string;
  publisher: string;
  original_language: "ja" | "en";
  original_url: string;
  source_location: string;
  section_type: string;
  heading: string | null;
  notes: string | null;
  version_label: string;
  document_type: string;
  authors: string[] | null;
  external_identifier: string | null;
  published_on: Date | string | null;
  revised_on: Date | string | null;
  age_scope: "unknown" | "all" | "range";
  age_min_months: number | null;
  age_max_months: number | null;
  region_scope: "unknown" | "all" | "list";
  regions: string[] | null;
  condition_scope: "unknown" | "all" | "list";
  conditions: string[] | null;
  exceptions: string[] | null;
  certainty_level: string | null;
  certainty_assessment_method: string | null;
  certainty_assessment_source: string | null;
  manual_reviewed: boolean;
  reviewer_name: string | null;
  reviewed_at: Date | string | null;
  adoption_reason: string | null;
  usage_terms: string | null;
  section_policy_defaults: unknown;
  applicability_policy: unknown;
  /** JSON assembled by the fixed query; undefined supports older pool mocks. */
  required_context?: unknown;
  context_limit?: unknown;
  context_incomplete?: unknown;
}

export class EvidenceSearchUnavailableError extends Error {
  constructor() {
    // Never include the request question, expanded terms, or database error.
    super("Evidence search is unavailable.");
  }
}

class RequiredContextIncompleteError extends Error {
  constructor() {
    super("required context is incomplete");
  }
}

class RequiredContextLimitError extends Error {
  constructor() {
    super("required context exceeded retrieval budget");
  }
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

type Policy = EvidenceApplicabilityPolicy;

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sourcePolicy(row: EvidenceRow): Policy {
  const parsed = evidenceApplicabilityPolicySchema.safeParse(row.section_policy_defaults);
  // A direct SQL write with malformed JSON must never produce permissive
  // retrieval. The caller rejects the row rather than silently repairing it.
  if (!parsed.success) throw new Error("invalid document section policy");
  return parsed.data;
}

function sectionPolicy(row: EvidenceRow): Policy {
  const parsed = evidenceApplicabilityPolicySchema.safeParse(row.applicability_policy);
  if (!parsed.success) throw new Error("invalid section applicability policy");
  return parsed.data;
}

function citation(row: EvidenceRow) {
  return {
    sourceId: row.source_id,
    versionId: row.version_id,
    title: row.title,
    publisher: row.publisher,
    language: row.original_language,
    originalUrl: row.original_url,
    version: row.version_label,
  };
}

function contextRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequiredContextIncompleteError();
  }
  return value as Record<string, unknown>;
}

function contextText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    // Do not expose database values, including malformed context, in errors.
    void name;
    throw new RequiredContextIncompleteError();
  }
  return value;
}

/**
 * The SQL always emits an array and a boolean. `undefined` is accepted only
 * for legacy structural pool mocks that predate this additive relationship;
 * a live query's null/malformed payload fails closed.
 */
function requiredContext(row: EvidenceRow, document: Policy): EvidenceRequiredContext[] {
  if (row.required_context === undefined
    && row.context_limit === undefined
    && row.context_incomplete === undefined) return [];
  if (row.context_limit === true) throw new RequiredContextLimitError();
  if (row.context_incomplete !== false
    || row.context_limit !== false
    || !Array.isArray(row.required_context)) {
    throw new RequiredContextIncompleteError();
  }
  if (row.required_context.length > 16) throw new RequiredContextLimitError();

  const seen = new Set<string>();
  return row.required_context.map((value) => {
    const item = contextRecord(value);
    const sectionId = contextText(item.sectionId, "section ID");
    if (sectionId === row.section_id || seen.has(sectionId)) {
      throw new RequiredContextIncompleteError();
    }
    seen.add(sectionId);
    const rawPolicy = evidenceApplicabilityPolicySchema.safeParse(item.policy);
    if (!rawPolicy.success) throw new RequiredContextIncompleteError();
    const sectionType = contextText(item.sectionType, "section type");
    const heading = item.heading === null ? null : contextText(item.heading, "heading");
    const notes = item.notes === null ? null : contextText(item.notes, "notes");
    return {
      sectionId,
      role: contextText(item.role, "role"),
      originalText: contextText(item.originalText, "text"),
      citation: citation(row),
      sourceLocation: contextText(item.sourceLocation, "location"),
      notes,
      policy: rawPolicy.data,
      section: {
        originalSectionId: sectionId,
        type: sectionType,
        heading,
        notes,
        applicabilityPolicy: rawPolicy.data,
        resolvedApplicabilityPolicy: resolvedPolicy(document, rawPolicy.data),
        policyProvenance: policyProvenance(document, rawPolicy.data),
      },
    };
  });
}

function legacyDocumentPolicy(row: EvidenceRow): Policy {
  const legacy = structuredClone(emptyDocumentApplicabilityPolicy);
  if (row.age_scope !== "unknown") {
    legacy.weiku.age = {
      mode: "specific",
      scope: row.age_scope === "all" ? "all" : "range",
      minMonths: row.age_min_months,
      maxMonths: row.age_max_months,
    };
  }
  // Legacy schemas allow exclusions even where the positive condition scope is
  // unknown. Preserve those exclusions as a restriction without inventing a
  // known unrestricted positive scope.
  if (row.condition_scope !== "unknown" || (row.exceptions?.length ?? 0) > 0) {
    legacy.weiku.conditions = {
      mode: "specific",
      scope: row.condition_scope === "list" ? "list" : "all",
      values: row.condition_scope === "list" ? row.conditions ?? [] : [],
      exclusions: row.exceptions ?? [],
    };
  }
  return legacy;
}

/**
 * The old version columns remain an independent, restrictive document layer.
 * New JSON policy never replaces a known legacy constraint during migration.
 */
function documentPolicyWithLegacy(document: Policy, row: EvidenceRow): Policy {
  const legacy = legacyDocumentPolicy(row);
  const legacyAge = legacy.weiku.age;
  const documentAge = document.weiku.age;
  const agePolicies = [legacyAge, documentAge].filter((policy) => policy.mode === "specific");
  const ageRanges = agePolicies.filter((policy) => policy.scope === "range");
  const age = ageRanges.length
    ? {
      mode: "specific" as const,
      scope: "range" as const,
      minMonths: Math.max(...ageRanges.map((policy) => policy.minMonths ?? 0)),
      maxMonths: Math.min(...ageRanges.map((policy) => policy.maxMonths ?? 1_200)),
    }
    : agePolicies.length
      ? { mode: "specific" as const, scope: "all" as const, minMonths: null, maxMonths: null }
      : documentAge;
  const conditionPolicies = [legacy.weiku.conditions, document.weiku.conditions]
    .filter((policy) => policy.mode === "specific");
  return {
    ...document,
    weiku: {
      ...document.weiku,
      age,
      conditions: conditionPolicies.length
        ? {
          mode: "specific",
          scope: conditionPolicies.some((policy) => policy.scope === "list") ? "list" : "all",
          values: unique(conditionPolicies.flatMap((policy) => policy.values)),
          exclusions: unique(conditionPolicies.flatMap((policy) => policy.exclusions)),
        }
        : document.weiku.conditions,
    },
  };
}

function policyProvenance(document: Policy, section: Policy) {
  const provenance = (documentMode: string, sectionMode: string) => {
    if (sectionMode === "unknown" && documentMode === "unknown") return "unknown" as const;
    if (sectionMode === "inherit") return documentMode === "unknown" ? "unknown" as const : "document" as const;
    if (sectionMode === "unknown") return "unknown" as const;
    return documentMode === "specific" ? "document_and_section" as const : "section" as const;
  };
  return {
    target: provenance(document.weiku.target.mode, section.weiku.target.mode),
    age: provenance(document.weiku.age.mode, section.weiku.age.mode),
    conditions: provenance(document.weiku.conditions.mode, section.weiku.conditions.mode),
    japan: provenance(document.weiku.japanApplicability.mode, section.weiku.japanApplicability.mode),
    researchParticipantAge: provenance(document.research.participantAge.mode, section.research.participantAge.mode),
    researchRegions: provenance(document.research.regions.mode, section.research.regions.mode),
    certainty: provenance(document.certainty.mode, section.certainty.mode),
    usage: provenance(document.usage.mode, section.usage.mode),
  };
}

function specific<T extends { mode: string }>(document: T, section: T): T[] {
  // Unknown and inherited policy never erase a known document restriction.
  return [document, section].filter((value) => value.mode === "specific");
}

function resolvedPolicy(document: Policy, section: Policy): Policy {
  const targetPolicies = specific(document.weiku.target, section.weiku.target);
  const targetValues = targetPolicies.length === 2
    ? targetPolicies[0].values.filter((target) => targetPolicies[1].values.includes(target))
    : targetPolicies[0]?.values ?? [];
  const agePolicies = specific(document.weiku.age, section.weiku.age);
  const ranges = agePolicies.filter((value) => value.scope === "range");
  const age = ranges.length
    ? {
      mode: "specific" as const,
      scope: "range" as const,
      minMonths: Math.max(...ranges.map((value) => value.minMonths ?? 0)),
      maxMonths: Math.min(...ranges.map((value) => value.maxMonths ?? 1_200)),
    }
    : agePolicies.length
      ? { mode: "specific" as const, scope: "all" as const, minMonths: null, maxMonths: null }
      : { mode: "unknown" as const, scope: null, minMonths: null, maxMonths: null };
  const conditionPolicies = specific(document.weiku.conditions, section.weiku.conditions);
  const required = unique(conditionPolicies.flatMap((value) => value.values));
  const exclusions = unique(conditionPolicies.flatMap((value) => value.exclusions));
  const choose = <T extends { mode: string }>(documentValue: T, sectionValue: T): T =>
    sectionValue.mode === "inherit" ? documentValue : sectionValue.mode === "specific" ? sectionValue : sectionValue;
  const researchAge = choose(document.research.participantAge, section.research.participantAge);
  const researchRegions = choose(document.research.regions, section.research.regions);
  const certainty = choose(document.certainty, section.certainty);
  const usagePolicies = specific(document.usage, section.usage);
  const usageTerms = usagePolicies.map((value) => value.terms).filter((value): value is string => value !== null);
  return {
    weiku: {
      target: targetValues.length ? { mode: "specific", values: targetValues } : { mode: "unknown", values: [] },
      age,
      conditions: conditionPolicies.length
        ? { mode: "specific", scope: required.length ? "list" : "all", values: required, exclusions }
        : { mode: "unknown", scope: null, values: [], exclusions: [] },
      japanApplicability: (() => {
        const values = specific(document.weiku.japanApplicability, section.weiku.japanApplicability)
          .map((value) => value.value);
        return values.includes("inapplicable")
          ? { mode: "specific" as const, value: "inapplicable" as const }
          : values.includes("applicable")
            ? { mode: "specific" as const, value: "applicable" as const }
            : { mode: "unknown" as const, value: null };
      })(),
    },
    research: { participantAge: researchAge, regions: researchRegions },
    certainty,
    usage: usagePolicies.length
      ? { mode: "specific", terms: usageTerms.length ? usageTerms.join("\n\n") : null, exceptions: unique(usagePolicies.flatMap((value) => value.exceptions)) }
      : { mode: "unknown", terms: null, exceptions: [] },
  };
}

function targetApplicability(document: Policy, section: Policy, target: "child" | "caregiver" | undefined): ApplicabilityMatch {
  const constraints = specific(document.weiku.target, section.weiku.target);
  if (constraints.length === 2 && !constraints[0].values.some((value) => constraints[1].values.includes(value))) {
    return "mismatched";
  }
  if (target && constraints.length && !constraints.every((policy) => policy.values.includes(target))) return "mismatched";
  if (!constraints.length || section.weiku.target.mode === "unknown" || !target) return "unverified";
  return "matched";
}

function ageApplicability(document: Policy, section: Policy, ageMonths: number | undefined): ApplicabilityMatch {
  const constraints = specific(document.weiku.age, section.weiku.age);
  const ranges = constraints.filter((policy) => policy.scope === "range");
  if (ranges.some((policy) => policy.minMonths === null || policy.maxMonths === null
    || policy.minMonths > policy.maxMonths)) {
    return "mismatched";
  }
  if (ranges.length === 2 && (
    (ranges[0].minMonths ?? 0) > (ranges[1].maxMonths ?? 1_200)
    || (ranges[1].minMonths ?? 0) > (ranges[0].maxMonths ?? 1_200)
  )) {
    return "mismatched";
  }
  if (ageMonths !== undefined && constraints.length && !constraints.every((policy) => policy.scope === "all"
    || (policy.minMonths !== null && policy.maxMonths !== null && ageMonths >= policy.minMonths && ageMonths <= policy.maxMonths))) {
    return "mismatched";
  }
  if (!constraints.length || section.weiku.age.mode === "unknown" || ageMonths === undefined) return "unverified";
  return "matched";
}

function regionApplicability(row: EvidenceRow, region: string | undefined): ApplicabilityMatch {
  if (region === undefined || row.region_scope === "unknown") return "unverified";
  if (row.region_scope === "all") return "matched";
  const candidate = region.toLocaleLowerCase();
  return (row.regions ?? []).some((item) => item.toLocaleLowerCase() === candidate)
    ? "matched"
    : "mismatched";
}

function conditionsApplicability(
  document: Policy,
  section: Policy,
  presentValues: string[] | undefined,
  absentValues: string[] | undefined,
  documentPositiveScopeKnown: boolean,
): ApplicabilityMatch {
  const policies = specific(document.weiku.conditions, section.weiku.conditions);
  const required = policies.flatMap((policy) => policy.values.map((value) => value.toLocaleLowerCase()));
  const excluded = policies.flatMap((policy) => policy.exclusions.map((value) => value.toLocaleLowerCase()));
  if (required.some((value) => excluded.includes(value))) return "mismatched";
  if (!policies.length) return "unverified";
  const present = new Set((presentValues ?? []).map((value) => value.toLocaleLowerCase()));
  const absent = new Set((absentValues ?? []).map((value) => value.toLocaleLowerCase()));
  // Only explicit facts can establish a mismatch. An omitted condition is
  // neither present nor absent and must not be guessed from the question.
  if (excluded.some((value) => present.has(value))) return "mismatched";
  if (required.some((value) => absent.has(value))) return "mismatched";
  if (required.some((value) => !present.has(value))
    || excluded.some((value) => !absent.has(value))) return "unverified";
  if (section.weiku.conditions.mode === "unknown") return "unverified";
  if (section.weiku.conditions.mode === "inherit" && !documentPositiveScopeKnown) return "unverified";
  // Even an explicit unrestricted policy is left unverified when no condition
  // context is supplied. Empty lists are not a claim of absent conditions.
  if (!(presentValues?.length) && !(absentValues?.length)) return "unverified";
  return "matched";
}

function japanApplicability(document: Policy, section: Policy, requested: boolean | undefined): ApplicabilityMatch {
  const policies = specific(document.weiku.japanApplicability, section.weiku.japanApplicability);
  if (requested !== true) return "unverified";
  if (policies.some((policy) => policy.value === "inapplicable")) return "mismatched";
  if (!policies.length || section.weiku.japanApplicability.mode === "unknown") return "unverified";
  return "matched";
}

function toResult(row: EvidenceRow, input: SearchInput): EvidenceSearchResult {
  const rawDocument = sourcePolicy(row);
  const document = documentPolicyWithLegacy(rawDocument, row);
  const rawSection = sectionPolicy(row);
  const resolved = resolvedPolicy(document, rawSection);
  return {
    sourceId: row.source_id,
    versionId: row.version_id,
    sectionId: row.section_id,
    originalText: row.original_text,
    title: row.title,
    publisher: row.publisher,
    language: row.original_language,
    originalUrl: row.original_url,
    sourceLocation: row.source_location,
    version: row.version_label,
    citation: citation(row),
    requiredContext: requiredContext(row, document),
    section: {
      originalSectionId: row.section_id,
      type: row.section_type,
      heading: row.heading,
      notes: row.notes,
      applicabilityPolicy: rawSection,
      resolvedApplicabilityPolicy: resolved,
      policyProvenance: policyProvenance(document, rawSection),
    },
    applicability: {
      target: targetApplicability(document, rawSection, input.context?.target),
      age: ageApplicability(document, rawSection, input.ageMonths),
      region: regionApplicability(row, input.region),
      conditions: conditionsApplicability(
        document,
        rawSection,
        input.context?.conditions,
        input.context?.absentConditions,
        rawDocument.weiku.conditions.mode === "specific" || row.condition_scope !== "unknown",
      ),
      japan: japanApplicability(document, rawSection, input.context?.japanApplicability),
    },
    source: {
      testOnly: row.source_test_only,
      documentType: row.document_type,
      authors: row.authors ?? [],
      externalIdentifier: row.external_identifier,
      publishedOn: asIso(row.published_on),
      revisedOn: asIso(row.revised_on),
      age: {
        scope: row.age_scope,
        minMonths: row.age_min_months,
        maxMonths: row.age_max_months,
      },
      regions: {
        scope: row.region_scope,
        values: row.regions ?? [],
      },
      conditions: {
        scope: row.condition_scope,
        values: row.conditions ?? [],
        exceptions: row.exceptions ?? [],
      },
      certainty: {
        level: row.certainty_level,
        assessmentMethod: row.certainty_assessment_method,
        assessmentSource: row.certainty_assessment_source,
      },
      review: {
        manualReviewed: row.manual_reviewed,
        reviewerName: row.reviewer_name,
        reviewedAt: asIso(row.reviewed_at),
        adoptionReason: row.adoption_reason,
      },
      usageTerms: row.usage_terms,
      applicabilityPolicy: rawDocument,
    },
  };
}

function isEligible(result: EvidenceSearchResult): boolean {
  return !Object.values(result.applicability).includes("mismatched");
}

/*
 * The query reads only the catalog tables and has fixed SQL text. `$1` is the
 * sole question parameter; it is never interpolated into SQL, a regular
 * expression, diagnostics, or an error. Japanese term detection intentionally
 * uses substring matching. English input detection normalizes separators (but
 * retains `_` as an English token character) to spaces, enforcing word
 * boundaries instead of substring hits.
 *
 * `evidence_is_ephemeral_test_context()` is installed by the additive
 * migration. It returns false on privilege/configuration failures, so test-only
 * terms and versions are excluded unless PostgreSQL itself proves the owned
 * disposable database/session.
 */
const EXPANSION_COUNT_SQL = `
WITH ephemeral_context AS (
  SELECT evidence_is_ephemeral_test_context() AS allowed
),
vocabulary AS (
  SELECT keyword.id AS keyword_id, keyword.concept_id, keyword.term, keyword.language
  FROM evidence_keywords AS keyword
  CROSS JOIN ephemeral_context AS context
  WHERE keyword.active AND (NOT keyword.test_only OR context.allowed)
  UNION ALL
  SELECT NULL::uuid AS keyword_id, dictionary.concept_id, dictionary.term, dictionary.language
  FROM evidence_dictionary_terms AS dictionary
  CROSS JOIN ephemeral_context AS context
  WHERE NOT dictionary.test_only OR context.allowed
),
matched_vocabulary AS (
  SELECT vocabulary.keyword_id, vocabulary.concept_id
  FROM vocabulary
  WHERE (
    vocabulary.language = 'ja'
    AND strpos(lower($1), lower(vocabulary.term)) > 0
  ) OR (
    vocabulary.language = 'en'
    AND strpos(
      ' ' || regexp_replace(lower($1), '[^[:alnum:]_]+', ' ', 'g') || ' ',
      ' ' || lower(vocabulary.term) || ' '
    ) > 0
  )
),
matched_concepts AS (
  SELECT DISTINCT concept_id FROM matched_vocabulary WHERE concept_id IS NOT NULL
),
matched_keyword_ids AS (
  SELECT DISTINCT keyword_id FROM matched_vocabulary WHERE keyword_id IS NOT NULL
),
search_terms_unbounded AS (
  SELECT ('k:' || keyword.id::text) AS id
  FROM evidence_keywords AS keyword
  CROSS JOIN ephemeral_context AS context
  WHERE keyword.active
    AND (NOT keyword.test_only OR context.allowed)
    AND (
      keyword.id IN (SELECT keyword_id FROM matched_keyword_ids)
      OR keyword.concept_id IN (SELECT concept_id FROM matched_concepts)
    )
  UNION
  SELECT ('d:' || dictionary.id::text) AS id
  FROM evidence_dictionary_terms AS dictionary
  CROSS JOIN ephemeral_context AS context
  WHERE (NOT dictionary.test_only OR context.allowed)
    AND dictionary.concept_id IN (SELECT concept_id FROM matched_concepts)
)
SELECT count(*)::integer AS expansion_count FROM search_terms_unbounded`;

const SEARCH_SQL = `
WITH ephemeral_context AS (
  SELECT evidence_is_ephemeral_test_context() AS allowed
),
vocabulary AS (
  SELECT keyword.id AS keyword_id, keyword.concept_id, keyword.term, keyword.language
  FROM evidence_keywords AS keyword
  CROSS JOIN ephemeral_context AS context
  WHERE keyword.active
    AND (NOT keyword.test_only OR context.allowed)
  UNION ALL
  SELECT NULL::uuid AS keyword_id, dictionary.concept_id, dictionary.term, dictionary.language
  FROM evidence_dictionary_terms AS dictionary
  CROSS JOIN ephemeral_context AS context
  WHERE NOT dictionary.test_only OR context.allowed
),
matched_vocabulary AS (
  SELECT vocabulary.keyword_id, vocabulary.concept_id
  FROM vocabulary
  WHERE (
    vocabulary.language = 'ja'
    AND strpos(lower($1), lower(vocabulary.term)) > 0
  ) OR (
    vocabulary.language = 'en'
    AND strpos(
      ' ' || regexp_replace(lower($1), '[^[:alnum:]_]+', ' ', 'g') || ' ',
      ' ' || lower(vocabulary.term) || ' '
    ) > 0
  )
),
matched_concepts AS (
  SELECT DISTINCT concept_id
  FROM matched_vocabulary
  WHERE concept_id IS NOT NULL
),
matched_keyword_ids AS (
  SELECT DISTINCT keyword_id
  FROM matched_vocabulary
  WHERE keyword_id IS NOT NULL
),
search_terms_unbounded AS (
  SELECT ('k:' || keyword.id::text) AS id, keyword.id AS keyword_id, keyword.concept_id, keyword.term, keyword.language
  FROM evidence_keywords AS keyword
  CROSS JOIN ephemeral_context AS context
  WHERE keyword.active
    AND (NOT keyword.test_only OR context.allowed)
    AND (
      keyword.id IN (SELECT keyword_id FROM matched_keyword_ids)
      OR keyword.concept_id IN (SELECT concept_id FROM matched_concepts)
    )
  UNION
  SELECT ('d:' || dictionary.id::text) AS id, NULL::uuid AS keyword_id, dictionary.concept_id, dictionary.term, dictionary.language
  FROM evidence_dictionary_terms AS dictionary
  CROSS JOIN ephemeral_context AS context
  WHERE (NOT dictionary.test_only OR context.allowed)
    AND dictionary.concept_id IN (SELECT concept_id FROM matched_concepts)
),
search_terms AS (
  SELECT id, keyword_id, concept_id, term, language
  FROM search_terms_unbounded
  ORDER BY id
  LIMIT 64
),
matched_sections AS (
  SELECT
    source.id AS source_id,
    source.test_only AS source_test_only,
    version.id AS version_id,
    section.id AS section_id,
    section.original_text,
    section.section_type,
    section.heading,
    section.notes,
    version.title,
    version.publisher,
    version.original_language,
    version.original_url,
    section.source_location,
    version.version_label,
    version.document_type,
    version.authors,
    version.external_identifier,
    version.published_on,
    version.revised_on,
    version.age_scope,
    version.age_min_months,
    version.age_max_months,
    version.region_scope,
    version.regions,
    version.condition_scope,
    version.conditions,
    version.exceptions,
    version.certainty_level,
    version.certainty_assessment_method,
    version.certainty_assessment_source,
    version.manual_reviewed,
    version.reviewer_name,
    version.reviewed_at,
    version.adoption_reason,
    version.usage_terms,
    version.section_policy_defaults,
    section.applicability_policy,
    count(DISTINCT term.id)::integer AS match_count
  FROM evidence_sources AS source
  JOIN evidence_versions AS version
    ON version.id = source.current_published_version_id
    AND version.source_id = source.id
    AND version.publication_status = 'published'
  JOIN evidence_sections AS section
    ON section.source_version_id = version.id
  LEFT JOIN evidence_section_keywords AS section_keyword
    ON section_keyword.source_version_id = section.source_version_id
    AND section_keyword.section_id = section.id
  LEFT JOIN evidence_keywords AS linked_keyword
    ON linked_keyword.id = section_keyword.keyword_id
  JOIN search_terms AS term ON (
    section_keyword.keyword_id = term.keyword_id
    OR (term.concept_id IS NOT NULL AND linked_keyword.concept_id = term.concept_id)
  )
  CROSS JOIN ephemeral_context AS context
  WHERE source.status = 'active'
    AND (NOT version.test_only OR context.allowed)
    -- A section's maintained keyword link permits this concept, but the
    -- literal original text or a checked derivative must still contain the
    -- search term. A tag alone cannot make an unchecked translation searchable.
    AND (
      (
      term.language = 'ja'
      AND strpos(lower(concat_ws(' ', section.heading, section.original_text)), lower(term.term)) > 0
      )
      OR (
      term.language = 'en'
      AND to_tsvector('simple', lower(concat_ws(' ', section.heading, section.original_text)))
        @@ plainto_tsquery('simple', lower(term.term))
      )
      OR EXISTS (
      SELECT 1
      FROM evidence_derived_texts AS derived
      WHERE derived.source_version_id = section.source_version_id
        AND derived.original_section_id = section.id
        AND derived.review_status = 'checked'
        AND (
          (term.language = 'ja' AND strpos(lower(derived.content), lower(term.term)) > 0)
          OR (
            term.language = 'en'
            AND to_tsvector('simple', lower(derived.content))
              @@ plainto_tsquery('simple', lower(term.term))
          )
        )
      )
    )
  GROUP BY
    source.id, version.id, section.id,
    version.title, version.publisher, version.original_language,
    version.original_url, version.version_label, version.document_type,
    version.authors, version.external_identifier, version.published_on,
    version.revised_on, version.age_scope, version.age_min_months,
    version.age_max_months, version.region_scope, version.regions,
    version.condition_scope, version.conditions, version.exceptions,
    version.certainty_level, version.certainty_assessment_method,
    version.certainty_assessment_source, version.manual_reviewed, version.reviewer_name,
    version.reviewed_at, version.adoption_reason, version.usage_terms,
    version.section_policy_defaults, section.applicability_policy
),
-- Page roots before any context traversal. The closure helper has a bounded
-- queue/visited set, so fanout and cycles cannot create path enumeration work.
paged_matched_sections AS (
  SELECT *
  FROM matched_sections
  ORDER BY match_count DESC, source_id ASC, version_id ASC, section_id ASC
  LIMIT $2::integer OFFSET $3::integer
),
required_context_payload AS (
  SELECT
    matched.version_id,
    matched.section_id AS root_section_id,
    jsonb_agg(
      jsonb_build_object(
        'sectionId', section.id,
        'role', closure.role,
        'originalText', section.original_text,
        'sourceLocation', section.source_location,
        'notes', section.notes,
        'policy', section.applicability_policy,
        'sectionType', section.section_type,
        'heading', section.heading
      )
      ORDER BY closure.depth, closure.required_section_id, closure.role
    ) FILTER (
      WHERE closure.required_section_id IS NOT NULL
        AND section.id IS NOT NULL
    ) AS required_context,
    COALESCE(bool_or(closure.context_limit), false) AS context_limit,
    COALESCE(bool_or(
      closure.required_section_id IS NOT NULL
      AND section.id IS NULL
    ), false) AS context_incomplete
  FROM paged_matched_sections AS matched
  LEFT JOIN LATERAL evidence_required_context_closure(
    matched.version_id,
    matched.section_id
  ) AS closure ON true
  LEFT JOIN evidence_sections AS section
    ON section.source_version_id = matched.version_id
   AND section.id = closure.required_section_id
  GROUP BY matched.version_id, matched.section_id
)
SELECT
  matched.*,
  COALESCE(required_context_payload.required_context, '[]'::jsonb) AS required_context,
  COALESCE(required_context_payload.context_limit, false) AS context_limit,
  COALESCE(required_context_payload.context_incomplete, false) AS context_incomplete
FROM paged_matched_sections AS matched
LEFT JOIN required_context_payload
  ON required_context_payload.version_id = matched.version_id
 AND required_context_payload.root_section_id = matched.section_id
ORDER BY match_count DESC, source_id ASC, version_id ASC, section_id ASC`;

export async function searchEvidence(
  pool: EvidenceSearchPool,
  rawInput: SearchInput,
): Promise<EvidenceSearchResponse> {
  const input = inputSchema.parse(rawInput);
  const rows: EvidenceRow[] = [];
  let candidateScanLimited = false;
  try {
    const expansion = await pool.query(EXPANSION_COUNT_SQL, [input.question]);
    const expansionCount = Number(expansion.rows[0]?.expansion_count);
    if (!Number.isSafeInteger(expansionCount) || expansionCount < 0) {
      throw new Error("invalid expansion count");
    }
    if (expansionCount === 0) {
      return {
        status: "no_results",
        results: [],
        diagnostics: { reason: "no_vocabulary" },
      };
    }
    if (expansionCount > 64) {
      return {
        status: "no_results",
        results: [],
        diagnostics: { reason: "expansion_limit" },
      };
    }
    // Eligibility is evaluated from the exact section policy, not in a
    // source-level SQL WHERE clause. Page a bounded candidate window so the
    // result limit is applied only after known mismatches are removed.
    const pageSize = 100;
    const maximumPages = 20;
    for (let page = 0; page < maximumPages; page += 1) {
      const result = await pool.query(SEARCH_SQL, [
        input.question,
        pageSize,
        page * pageSize,
      ]);
      const pageRows = result.rows as EvidenceRow[];
      rows.push(...pageRows);
      if (pageRows.length < pageSize) break;
      if (page === maximumPages - 1) candidateScanLimited = true;
    }
  } catch {
    throw new EvidenceSearchUnavailableError();
  }

  const results: EvidenceSearchResult[] = [];
  let contextIncomplete = false;
  let contextLimited = false;
  for (const row of rows) {
    try {
      const candidate = toResult(row, input);
      if (isEligible(candidate)) results.push(candidate);
      if (results.length === input.limit) break;
    } catch (error) {
      if (error instanceof RequiredContextLimitError) contextLimited = true;
      else if (error instanceof RequiredContextIncompleteError) contextIncomplete = true;
      // Invalid direct-SQL policy metadata fails closed. It is not repaired,
      // guessed from prose, or surfaced as an eligible result.
    }
  }
  const diagnostics = contextLimited
    ? { reason: "context_limit" as const }
    : contextIncomplete
      ? { reason: "context_incomplete" as const }
      : candidateScanLimited
        ? { reason: "candidate_scan_limit" as const }
        : undefined;
  return {
    status: results.length > 0 ? "results" : "no_results",
    results,
    ...(diagnostics ? { diagnostics } : {}),
  };
}