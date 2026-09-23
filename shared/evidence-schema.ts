import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Evidence catalog tables are deliberately isolated from family and
 * consultation data. The SQL migration adds constraints/triggers that cannot
 * be represented by Drizzle alone; this module also lets the ephemeral schema
 * generator discover the additive tables.
 */
export const evidenceSources = pgTable("evidence_sources", {
  id: uuid("id").primaryKey(),
  sourceKey: varchar("source_key", { length: 128 }).notNull().unique(),
  testOnly: boolean("test_only").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  currentPublishedVersionId: uuid("current_published_version_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  check("evidence_sources_status_check", sql`${table.status} IN ('draft', 'active', 'suspended')`),
]);

export const evidenceVersions = pgTable("evidence_versions", {
  id: uuid("id").primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => evidenceSources.id, { onDelete: "restrict" }),
  versionLabel: varchar("version_label", { length: 100 }).notNull(),
  publicationStatus: varchar("publication_status", { length: 16 }).notNull().default("draft"),
  title: text("title").notNull(),
  publisher: text("publisher").notNull(),
  authors: text("authors").array().notNull().default([]),
  originalUrl: text("original_url").notNull(),
  externalIdentifier: varchar("external_identifier", { length: 512 }),
  documentType: varchar("document_type", { length: 80 }).notNull(),
  originalLanguage: varchar("original_language", { length: 2 }).notNull(),
  publishedOn: timestamp("published_on"),
  revisedOn: timestamp("revised_on"),
  ageScope: varchar("age_scope", { length: 16 }).notNull().default("unknown"),
  ageMinMonths: integer("age_min_months"),
  ageMaxMonths: integer("age_max_months"),
  regionScope: varchar("region_scope", { length: 16 }).notNull().default("unknown"),
  regions: text("regions").array().notNull().default([]),
  conditionScope: varchar("condition_scope", { length: 16 }).notNull().default("unknown"),
  conditions: text("conditions").array().notNull().default([]),
  exceptions: text("exceptions").array().notNull().default([]),
  certaintyLevel: varchar("certainty_level", { length: 32 }),
  certaintyAssessmentMethod: text("certainty_assessment_method"),
  certaintyAssessmentSource: text("certainty_assessment_source"),
  adoptionReason: text("adoption_reason"),
  usageTerms: text("usage_terms"),
  // Version bibliography is stable here; this is the conservative baseline
  // which an exact original-text section may explicitly inherit or refine.
  sectionPolicyDefaults: jsonb("section_policy_defaults").notNull(),
  manualReviewed: boolean("manual_reviewed").notNull().default(false),
  reviewerName: varchar("reviewer_name", { length: 160 }),
  reviewedAt: timestamp("reviewed_at"),
  testOnly: boolean("test_only").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  publishedAt: timestamp("published_at"),
}, (table) => [
  uniqueIndex("evidence_versions_source_version_unique").on(table.sourceId, table.versionLabel),
  uniqueIndex("evidence_versions_id_source_unique").on(table.id, table.sourceId),
  index("evidence_versions_source_publication_idx").on(table.sourceId, table.publicationStatus),
  check("evidence_versions_publication_status_check", sql`${table.publicationStatus} IN ('draft', 'published')`),
  check("evidence_versions_original_language_check", sql`${table.originalLanguage} IN ('ja', 'en')`),
  check("evidence_versions_age_scope_check", sql`
    (${table.ageScope} IN ('unknown', 'all') AND ${table.ageMinMonths} IS NULL AND ${table.ageMaxMonths} IS NULL)
    OR (${table.ageScope} = 'range' AND ${table.ageMinMonths} BETWEEN 0 AND 1200
        AND ${table.ageMaxMonths} BETWEEN 0 AND 1200 AND ${table.ageMinMonths} <= ${table.ageMaxMonths})
  `),
  check("evidence_versions_region_scope_check", sql`
    (${table.regionScope} IN ('unknown', 'all') AND cardinality(${table.regions}) = 0)
    OR (${table.regionScope} = 'list' AND cardinality(${table.regions}) > 0)
  `),
  check("evidence_versions_condition_scope_check", sql`
    (${table.conditionScope} IN ('unknown', 'all') AND cardinality(${table.conditions}) = 0)
    OR (${table.conditionScope} = 'list' AND cardinality(${table.conditions}) > 0)
  `),
]);

export const evidenceSections = pgTable("evidence_sections", {
  id: uuid("id").primaryKey(),
  sourceVersionId: uuid("source_version_id").notNull()
    .references(() => evidenceVersions.id, { onDelete: "restrict" }),
  sectionType: varchar("section_type", { length: 64 }).notNull().default("excerpt"),
  heading: text("heading"),
  originalText: text("original_text").notNull(),
  sourceLocation: text("source_location").notNull(),
  notes: text("notes"),
  applicabilityPolicy: jsonb("applicability_policy").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("evidence_sections_version_id_unique").on(table.sourceVersionId, table.id),
  index("evidence_sections_version_idx").on(table.sourceVersionId),
]);

export const evidenceDerivedTexts = pgTable("evidence_derived_texts", {
  id: uuid("id").primaryKey(),
  sourceVersionId: uuid("source_version_id").notNull()
    .references(() => evidenceVersions.id, { onDelete: "restrict" }),
  originalSectionId: uuid("original_section_id").notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  language: varchar("language", { length: 2 }).notNull(),
  content: text("content").notNull(),
  creationMethod: varchar("creation_method", { length: 80 }).notNull(),
  reviewStatus: varchar("review_status", { length: 16 }).notNull().default("unchecked"),
  reviewerName: varchar("reviewer_name", { length: 160 }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "evidence_derived_texts_exact_section_version_fk",
    columns: [table.sourceVersionId, table.originalSectionId],
    foreignColumns: [evidenceSections.sourceVersionId, evidenceSections.id],
  }).onDelete("restrict"),
  index("evidence_derived_texts_section_review_idx")
    .on(table.sourceVersionId, table.originalSectionId, table.reviewStatus),
  check("evidence_derived_texts_kind_check", sql`${table.kind} IN ('translation', 'summary')`),
  check("evidence_derived_texts_language_check", sql`${table.language} IN ('ja', 'en')`),
  check("evidence_derived_texts_review_status_check", sql`${table.reviewStatus} IN ('unchecked', 'checked')`),
]);

export const evidenceConcepts = pgTable("evidence_concepts", {
  id: uuid("id").primaryKey(),
  conceptKey: varchar("concept_key", { length: 128 }).notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * A keyword is a maintained retrieval label, never a claim about the evidence
 * in a section. Terms may be linked to a bilingual concept for expansion.
 */
export const evidenceKeywords = pgTable("evidence_keywords", {
  id: uuid("id").primaryKey(),
  conceptId: uuid("concept_id").references(() => evidenceConcepts.id, { onDelete: "set null" }),
  term: varchar("term", { length: 160 }).notNull(),
  language: varchar("language", { length: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  testOnly: boolean("test_only").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("evidence_keywords_language_term_unique").on(table.language, table.term),
  index("evidence_keywords_concept_idx").on(table.conceptId),
  check("evidence_keywords_language_check", sql`${table.language} IN ('ja', 'en')`),
]);

export const evidenceDictionaryTerms = pgTable("evidence_dictionary_terms", {
  id: uuid("id").primaryKey(),
  conceptId: uuid("concept_id").notNull().references(() => evidenceConcepts.id, { onDelete: "cascade" }),
  term: varchar("term", { length: 160 }).notNull(),
  language: varchar("language", { length: 2 }).notNull(),
  testOnly: boolean("test_only").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("evidence_dictionary_terms_concept_language_term_unique")
    .on(table.conceptId, table.language, table.term),
  index("evidence_dictionary_terms_language_term_idx").on(table.language, table.term),
  check("evidence_dictionary_terms_language_check", sql`${table.language} IN ('ja', 'en')`),
]);

export const evidenceSectionKeywords = pgTable("evidence_section_keywords", {
  sourceVersionId: uuid("source_version_id").notNull(),
  sectionId: uuid("section_id").notNull(),
  keywordId: uuid("keyword_id").notNull().references(() => evidenceKeywords.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "evidence_section_keywords_exact_section_version_fk",
    columns: [table.sourceVersionId, table.sectionId],
    foreignColumns: [evidenceSections.sourceVersionId, evidenceSections.id],
  }).onDelete("restrict"),
  uniqueIndex("evidence_section_keywords_unique").on(table.sourceVersionId, table.sectionId, table.keywordId),
  index("evidence_section_keywords_keyword_idx").on(table.keywordId, table.sourceVersionId, table.sectionId),
]);

/**
 * Editorial mandatory context between original sections. Composite foreign
 * keys make both endpoints belong to the declared version.
 */
export const evidenceSectionRequiredContext = pgTable("evidence_section_required_context", {
  sourceVersionId: uuid("source_version_id").notNull(),
  sectionId: uuid("section_id").notNull(),
  requiredSectionId: uuid("required_section_id").notNull(),
  role: varchar("role", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "evidence_section_required_context_root_fk",
    columns: [table.sourceVersionId, table.sectionId],
    foreignColumns: [evidenceSections.sourceVersionId, evidenceSections.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "evidence_section_required_context_required_fk",
    columns: [table.sourceVersionId, table.requiredSectionId],
    foreignColumns: [evidenceSections.sourceVersionId, evidenceSections.id],
  }).onDelete("restrict"),
  uniqueIndex("evidence_section_required_context_unique")
    .on(table.sourceVersionId, table.sectionId, table.requiredSectionId),
  index("evidence_section_required_context_required_idx")
    .on(table.sourceVersionId, table.requiredSectionId),
  check("evidence_section_required_context_not_self_check", sql`${table.sectionId} <> ${table.requiredSectionId}`),
  check("evidence_section_required_context_role_check", sql`
    char_length(btrim(${table.role})) BETWEEN 1 AND 64
  `),
]);

export type EvidenceSourceRow = typeof evidenceSources.$inferSelect;
export type EvidenceVersionRow = typeof evidenceVersions.$inferSelect;
export type EvidenceSectionRow = typeof evidenceSections.$inferSelect;
export type EvidenceDerivedTextRow = typeof evidenceDerivedTexts.$inferSelect;
export type EvidenceSectionRequiredContextRow = typeof evidenceSectionRequiredContext.$inferSelect;