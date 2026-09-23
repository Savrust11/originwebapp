import { randomUUID } from "node:crypto";
import {
  evidenceConceptCreateSchema,
  evidenceDerivedTextCreateSchema,
  evidenceDictionaryTermUpsertSchema,
  evidenceKeywordUpsertSchema,
  evidencePublicationSchema,
  evidenceRequiredContextLinkSchema,
  evidenceReviewSchema,
  evidenceSectionKeywordLinkSchema,
  evidenceSourceCreateSchema,
  evidenceSourceStatusSchema,
  evidenceVersionIngestSchema,
  type EvidenceVersionIngestInput,
} from "@shared/evidence";

/**
 * This intentionally small structural type accepts pg.Pool without importing
 * the application DB singleton. Catalog functions are maintenance-only; no
 * route in this module exposes them to ordinary users.
 */
export interface EvidenceCatalogPool {
  query(queryText: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<EvidenceCatalogClient>;
}

export interface EvidenceCatalogClient {
  query(queryText: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

function toInsertSections(input: EvidenceVersionIngestInput, versionId: string) {
  return input.sections.map((section) => ({
    id: section.id ?? randomUUID(),
    sourceVersionId: versionId,
    sectionType: section.sectionType,
    heading: section.heading,
    originalText: section.originalText,
    sourceLocation: section.sourceLocation,
    notes: section.notes,
    applicabilityPolicy: section.applicabilityPolicy,
  }));
}

export async function createEvidenceSource(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceSourceCreateSchema.parse(rawInput);
  const id = input.id ?? randomUUID();
  const result = await pool.query(
    `INSERT INTO evidence_sources (id, source_key, test_only)
     VALUES ($1, $2, $3)
     RETURNING id, source_key, status, test_only`,
    [id, input.sourceKey, input.testOnly],
  );
  return result.rows[0];
}

/**
 * Ingestion only creates a draft version. Publication is a separate explicit
 * maintenance action after a reviewer records adoption and usage terms.
 * Sections are inserted in the same statement as the version so an invalid
 * section cannot leave a partial version behind.
 */
export async function ingestEvidenceVersion(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceVersionIngestSchema.parse(rawInput);
  const versionId = input.id ?? randomUUID();
  const sections = toInsertSections(input, versionId);
  const result = await pool.query(
    `WITH inserted_version AS (
       INSERT INTO evidence_versions (
         id, source_id, version_label, title, publisher, authors, original_url,
         external_identifier, document_type, original_language, published_on,
         revised_on, age_scope, age_min_months, age_max_months, region_scope,
          regions, condition_scope, conditions, exceptions, certainty_level,
          certainty_assessment_method, certainty_assessment_source,
          section_policy_defaults, test_only
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamp,
         $12::timestamp, $13, $14, $15, $16, $17::text[], $18, $19::text[],
          $20::text[], $21, $22, $23, $24::jsonb, $25
       )
       RETURNING id
     ), inserted_sections AS (
       INSERT INTO evidence_sections (
         id, source_version_id, section_type, heading, original_text,
          source_location, notes, applicability_policy
       )
       SELECT s.id, s.source_version_id, s.section_type, s.heading,
          s.original_text, s.source_location, s.notes, s.applicability_policy
        FROM jsonb_to_recordset($26::jsonb) AS s(
         id uuid,
         source_version_id uuid,
         section_type text,
         heading text,
         original_text text,
         source_location text,
          notes text,
          applicability_policy jsonb
       )
       CROSS JOIN inserted_version
       RETURNING id
     )
     SELECT id FROM inserted_version`,
    [
      versionId,
      input.sourceId,
      input.version,
      input.title,
      input.publisher,
      input.authors,
      input.originalUrl,
      input.externalIdentifier,
      input.documentType,
      input.language,
      input.publishedOn,
      input.revisedOn,
      input.age.scope,
      input.age.minMonths,
      input.age.maxMonths,
      input.regions.scope,
      input.regions.values,
      input.conditions.scope,
      input.conditions.values,
      input.conditions.exceptions,
      input.certainty.level,
      input.certainty.assessmentMethod,
      input.certainty.assessmentSource,
      input.documentApplicabilityPolicy,
      input.testOnly,
      JSON.stringify(sections.map((section) => ({
        id: section.id,
        source_version_id: section.sourceVersionId,
        section_type: section.sectionType,
        heading: section.heading,
        original_text: section.originalText,
        source_location: section.sourceLocation,
        notes: section.notes,
        applicability_policy: section.applicabilityPolicy,
      }))),
    ],
  );
  return { versionId, sectionIds: sections.map((section) => section.id), row: result.rows[0] };
}

export async function addEvidenceDerivedText(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceDerivedTextCreateSchema.parse(rawInput);
  const id = input.id ?? randomUUID();
  const result = await pool.query(
    `INSERT INTO evidence_derived_texts (
       id, source_version_id, original_section_id, kind, language, content,
       creation_method, review_status, reviewer_name, reviewed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamp)
     RETURNING id`,
    [
      id,
      input.sourceVersionId,
      input.originalSectionId,
      input.kind,
      input.language,
      input.content,
      input.creationMethod,
      input.reviewStatus,
      input.reviewerName,
      input.reviewedAt,
    ],
  );
  return result.rows[0];
}

export async function reviewEvidenceVersion(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceReviewSchema.parse(rawInput);
  const result = await pool.query(
    `UPDATE evidence_versions
     SET manual_reviewed = true, reviewer_name = $3, reviewed_at = $4::timestamp,
         adoption_reason = $5, usage_terms = $6
     WHERE id = $1 AND source_id = $2 AND publication_status = 'draft'
     RETURNING id`,
    [
      input.versionId,
      input.sourceId,
      input.reviewerName,
      input.reviewedAt,
      input.adoptionReason,
      input.usageTerms,
    ],
  );
  return result.rows[0] ?? null;
}

/**
 * The database trigger repeats every precondition (including the disposable
 * PostgreSQL check for test data), so callers cannot bypass it by calling SQL
 * directly. A dedicated pg client keeps publication and current-pointer change
 * in one transaction.
 */
export async function publishEvidenceVersion(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidencePublicationSchema.parse(rawInput);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock and compare before publishing. A reviewer can intentionally
    // supersede a reviewed draft by publishing another version, but a stale
    // maintenance request must not silently replace a newer current pointer.
    const lockedSource = await client.query(
      `SELECT id
       FROM evidence_sources
       WHERE id = $1
         AND current_published_version_id IS NOT DISTINCT FROM $2::uuid
       FOR UPDATE`,
      [input.sourceId, input.expectedCurrentVersionId],
    );
    if (!lockedSource.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const published = await client.query(
      `UPDATE evidence_versions
       SET publication_status = 'published', published_at = now()
       WHERE id = $1 AND source_id = $2 AND publication_status = 'draft'
       RETURNING id, source_id`,
      [input.versionId, input.sourceId],
    );
    if (!published.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const selected = await client.query(
      `UPDATE evidence_sources
       SET current_published_version_id = $2, status = 'active', updated_at = now()
       WHERE id = $1
       RETURNING id AS source_id`,
      [input.sourceId, input.versionId],
    );
    if (!selected.rows[0]) {
      // This cannot normally happen because source_id has an FK, but retain
      // all-or-nothing behavior if a privileged maintenance action races it.
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return { version_id: input.versionId, source_id: input.sourceId };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database failure without exposing its contents.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Suspends or re-enables the source pointer without editing any published content. */
export async function setEvidenceSourceStatus(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceSourceStatusSchema.parse(rawInput);
  const result = await pool.query(
    `UPDATE evidence_sources
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, status`,
    [input.sourceId, input.status],
  );
  return result.rows[0] ?? null;
}

export async function createEvidenceConcept(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceConceptCreateSchema.parse(rawInput);
  const id = input.id ?? randomUUID();
  const result = await pool.query(
    `INSERT INTO evidence_concepts (id, concept_key)
     VALUES ($1, $2)
     RETURNING id, concept_key`,
    [id, input.conceptKey],
  );
  return result.rows[0];
}

/** Explicit maintenance operation; fixtures are never registered implicitly. */
export async function upsertEvidenceKeyword(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceKeywordUpsertSchema.parse(rawInput);
  const id = input.id ?? randomUUID();
  const result = await pool.query(
    `INSERT INTO evidence_keywords (id, concept_id, term, language, active, test_only)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (language, term) DO UPDATE
       SET concept_id = EXCLUDED.concept_id, active = EXCLUDED.active,
           test_only = EXCLUDED.test_only, updated_at = now()
     RETURNING id`,
    [id, input.conceptId, input.term, input.language, input.active, input.testOnly],
  );
  return result.rows[0];
}

/** Explicit maintenance operation; it does not infer terms from source text. */
export async function upsertEvidenceDictionaryTerm(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceDictionaryTermUpsertSchema.parse(rawInput);
  const id = input.id ?? randomUUID();
  const result = await pool.query(
    `INSERT INTO evidence_dictionary_terms (id, concept_id, term, language, test_only)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (concept_id, language, term) DO UPDATE
       SET test_only = EXCLUDED.test_only, updated_at = now()
     RETURNING id`,
    [id, input.conceptId, input.term, input.language, input.testOnly],
  );
  return result.rows[0];
}

export async function linkEvidenceSectionKeyword(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceSectionKeywordLinkSchema.parse(rawInput);
  const result = await pool.query(
    `INSERT INTO evidence_section_keywords (source_version_id, section_id, keyword_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (source_version_id, section_id, keyword_id) DO NOTHING
     RETURNING section_id`,
    [input.sourceVersionId, input.sectionId, input.keywordId],
  );
  return result.rows[0] ?? null;
}

/**
 * Adds an editorial required-context relationship. The database repeats the
 * exact-version and published-version immutability checks, so this helper
 * cannot turn a context section into a publication or approval bypass.
 */
export async function linkEvidenceRequiredContext(pool: EvidenceCatalogPool, rawInput: unknown) {
  const input = evidenceRequiredContextLinkSchema.parse(rawInput);
  const result = await pool.query(
    `INSERT INTO evidence_section_required_context (
       source_version_id, section_id, required_section_id, role
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_version_id, section_id, required_section_id) DO NOTHING
     RETURNING section_id, required_section_id, role`,
    [input.sourceVersionId, input.sectionId, input.requiredSectionId, input.role],
  );
  return result.rows[0] ?? null;
}