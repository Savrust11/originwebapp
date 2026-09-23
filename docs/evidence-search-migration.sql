-- Bilingual evidence retrieval catalog. Review and apply manually only after a
-- target-DB backup. This is additive and deliberately creates no fixtures.
BEGIN;

CREATE TABLE evidence_sources (
  id uuid PRIMARY KEY,
  source_key varchar(128) NOT NULL UNIQUE,
  test_only boolean NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  current_published_version_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_sources_status_check
    CHECK (status IN ('draft', 'active', 'suspended')),
  CONSTRAINT evidence_sources_key_check
    CHECK (source_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  CONSTRAINT evidence_sources_test_only_explicit_check CHECK (test_only IN (true, false))
);

CREATE TABLE evidence_versions (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES evidence_sources(id) ON DELETE RESTRICT,
  version_label varchar(100) NOT NULL,
  publication_status varchar(16) NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  publisher text NOT NULL,
  authors text[] NOT NULL DEFAULT ARRAY[]::text[],
  original_url text NOT NULL,
  external_identifier varchar(512),
  document_type varchar(80) NOT NULL,
  original_language varchar(2) NOT NULL,
  published_on timestamp,
  revised_on timestamp,
  age_scope varchar(16) NOT NULL DEFAULT 'unknown',
  age_min_months integer,
  age_max_months integer,
  region_scope varchar(16) NOT NULL DEFAULT 'unknown',
  regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  condition_scope varchar(16) NOT NULL DEFAULT 'unknown',
  conditions text[] NOT NULL DEFAULT ARRAY[]::text[],
  exceptions text[] NOT NULL DEFAULT ARRAY[]::text[],
  certainty_level varchar(32),
  certainty_assessment_method text,
  certainty_assessment_source text,
  adoption_reason text,
  usage_terms text,
  manual_reviewed boolean NOT NULL DEFAULT false,
  reviewer_name varchar(160),
  reviewed_at timestamp,
  test_only boolean NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  published_at timestamp,
  CONSTRAINT evidence_versions_source_version_unique UNIQUE (source_id, version_label),
  CONSTRAINT evidence_versions_id_source_unique UNIQUE (id, source_id),
  CONSTRAINT evidence_versions_publication_status_check
    CHECK (publication_status IN ('draft', 'published')),
  CONSTRAINT evidence_versions_original_language_check
    CHECK (original_language IN ('ja', 'en')),
  CONSTRAINT evidence_versions_text_bounds_check
    CHECK (
      char_length(btrim(title)) BETWEEN 1 AND 500
      AND char_length(btrim(publisher)) BETWEEN 1 AND 300
      AND char_length(btrim(original_url)) BETWEEN 1 AND 2048
      AND original_url ~* '^https?://'
      AND char_length(btrim(document_type)) BETWEEN 1 AND 80
    ),
  -- Unknown age is distinct from all ages. A range has both inclusive bounds.
  CONSTRAINT evidence_versions_age_scope_check
    CHECK (
      (age_scope IN ('unknown', 'all') AND age_min_months IS NULL AND age_max_months IS NULL)
      OR (age_scope = 'range' AND age_min_months BETWEEN 0 AND 1200
          AND age_max_months BETWEEN 0 AND 1200 AND age_min_months <= age_max_months)
    ),
  CONSTRAINT evidence_versions_region_scope_check
    CHECK (
      (region_scope IN ('unknown', 'all') AND cardinality(regions) = 0)
      OR (region_scope = 'list' AND cardinality(regions) BETWEEN 1 AND 64)
    ),
  CONSTRAINT evidence_versions_condition_scope_check
    CHECK (
      (condition_scope IN ('unknown', 'all') AND cardinality(conditions) = 0)
      OR (condition_scope = 'list' AND cardinality(conditions) BETWEEN 1 AND 64)
    ),
  CONSTRAINT evidence_versions_array_bounds_check
    CHECK (cardinality(authors) <= 64 AND cardinality(exceptions) <= 64)
);

ALTER TABLE evidence_sources
  ADD CONSTRAINT evidence_sources_current_version_fk
  FOREIGN KEY (current_published_version_id) REFERENCES evidence_versions(id)
  ON DELETE RESTRICT;

CREATE INDEX evidence_versions_source_publication_idx
  ON evidence_versions (source_id, publication_status);

CREATE TABLE evidence_sections (
  id uuid PRIMARY KEY,
  source_version_id uuid NOT NULL
    REFERENCES evidence_versions(id) ON DELETE RESTRICT,
  section_type varchar(64) NOT NULL DEFAULT 'excerpt',
  heading text,
  original_text text NOT NULL,
  source_location text NOT NULL,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_sections_version_id_unique UNIQUE (source_version_id, id),
  CONSTRAINT evidence_sections_text_bounds_check
    CHECK (
      char_length(btrim(section_type)) BETWEEN 1 AND 64
      AND char_length(btrim(original_text)) BETWEEN 1 AND 20000
      AND char_length(btrim(source_location)) BETWEEN 1 AND 1000
    )
);

CREATE INDEX evidence_sections_version_idx ON evidence_sections (source_version_id);

CREATE TABLE evidence_derived_texts (
  id uuid PRIMARY KEY,
  source_version_id uuid NOT NULL
    REFERENCES evidence_versions(id) ON DELETE RESTRICT,
  original_section_id uuid NOT NULL,
  kind varchar(32) NOT NULL,
  language varchar(2) NOT NULL,
  content text NOT NULL,
  creation_method varchar(80) NOT NULL,
  review_status varchar(16) NOT NULL DEFAULT 'unchecked',
  reviewer_name varchar(160),
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_derived_texts_exact_section_version_fk
    FOREIGN KEY (source_version_id, original_section_id)
    REFERENCES evidence_sections(source_version_id, id) ON DELETE RESTRICT,
  CONSTRAINT evidence_derived_texts_kind_check
    CHECK (kind IN ('translation', 'summary')),
  CONSTRAINT evidence_derived_texts_language_check CHECK (language IN ('ja', 'en')),
  CONSTRAINT evidence_derived_texts_review_status_check
    CHECK (review_status IN ('unchecked', 'checked')),
  CONSTRAINT evidence_derived_texts_review_provenance_check
    CHECK (
      review_status = 'unchecked'
      OR (reviewer_name IS NOT NULL AND char_length(btrim(reviewer_name)) > 0 AND reviewed_at IS NOT NULL)
    ),
  CONSTRAINT evidence_derived_texts_text_bounds_check
    CHECK (
      char_length(btrim(content)) BETWEEN 1 AND 20000
      AND char_length(btrim(creation_method)) BETWEEN 1 AND 80
    )
);

CREATE INDEX evidence_derived_texts_section_review_idx
  ON evidence_derived_texts (source_version_id, original_section_id, review_status);

CREATE TABLE evidence_concepts (
  id uuid PRIMARY KEY,
  concept_key varchar(128) NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_concepts_key_check
    CHECK (concept_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
);

-- These are editable search aids, deliberately separate from medical content.
CREATE TABLE evidence_keywords (
  id uuid PRIMARY KEY,
  concept_id uuid REFERENCES evidence_concepts(id) ON DELETE SET NULL,
  term varchar(160) NOT NULL,
  language varchar(2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  test_only boolean NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_keywords_language_term_unique UNIQUE (language, term),
  CONSTRAINT evidence_keywords_language_check CHECK (language IN ('ja', 'en')),
  CONSTRAINT evidence_keywords_term_check CHECK (
    char_length(btrim(term)) BETWEEN 1 AND 160
    AND (language <> 'en' OR term ~ '^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$')
  )
);

CREATE INDEX evidence_keywords_concept_idx ON evidence_keywords (concept_id);

CREATE TABLE evidence_dictionary_terms (
  id uuid PRIMARY KEY,
  concept_id uuid NOT NULL REFERENCES evidence_concepts(id) ON DELETE CASCADE,
  term varchar(160) NOT NULL,
  language varchar(2) NOT NULL,
  test_only boolean NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_dictionary_terms_concept_language_term_unique
    UNIQUE (concept_id, language, term),
  CONSTRAINT evidence_dictionary_terms_language_check CHECK (language IN ('ja', 'en')),
  CONSTRAINT evidence_dictionary_terms_term_check CHECK (
    char_length(btrim(term)) BETWEEN 1 AND 160
    AND (language <> 'en' OR term ~ '^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$')
  )
);

CREATE INDEX evidence_dictionary_terms_language_term_idx
  ON evidence_dictionary_terms (language, term);

CREATE TABLE evidence_section_keywords (
  source_version_id uuid NOT NULL,
  section_id uuid NOT NULL,
  keyword_id uuid NOT NULL REFERENCES evidence_keywords(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_section_keywords_exact_section_version_fk
    FOREIGN KEY (source_version_id, section_id)
    REFERENCES evidence_sections(source_version_id, id) ON DELETE RESTRICT,
  CONSTRAINT evidence_section_keywords_unique
    UNIQUE (source_version_id, section_id, keyword_id)
);

CREATE INDEX evidence_section_keywords_keyword_idx
  ON evidence_section_keywords (keyword_id, source_version_id, section_id);

-- Do not use NODE_ENV, an application flag, or a caller-supplied setting as a
-- test-data authorization check. A failed configuration/privilege lookup is
-- false. `session_user` (not current_user) remains the launcher identity even
-- if a migration role uses SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION evidence_is_ephemeral_test_context()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  configured_data_directory text;
BEGIN
  SELECT setting INTO configured_data_directory
  FROM pg_catalog.pg_settings
  WHERE name = 'data_directory';

  RETURN configured_data_directory ~ '^/tmp/ephemeral-postgres-[A-Za-z0-9][A-Za-z0-9_-]*/data$'
    AND session_user ~ '^test_owner_[0-9a-f]{16}$';
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN false;
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION evidence_sources_current_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.test_only IS DISTINCT FROM NEW.test_only THEN
    RAISE EXCEPTION 'source test_only is immutable';
  END IF;
  IF NEW.test_only AND NOT public.evidence_is_ephemeral_test_context() THEN
    RAISE EXCEPTION 'test-only source requires the owned ephemeral database';
  END IF;

  IF NEW.current_published_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.evidence_versions AS version
    WHERE version.id = NEW.current_published_version_id
      AND version.source_id = NEW.id
      AND version.publication_status = 'published'
  ) THEN
    RAISE EXCEPTION 'current evidence version must be this source''s published version';
  END IF;

  IF NEW.current_published_version_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.evidence_versions AS version
    WHERE version.id = NEW.current_published_version_id
      AND version.test_only
  ) AND NOT public.evidence_is_ephemeral_test_context() THEN
    RAISE EXCEPTION 'test-only evidence cannot be selected outside the owned ephemeral database';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_sources_current_version_guard_trigger
BEFORE INSERT OR UPDATE ON evidence_sources
FOR EACH ROW EXECUTE FUNCTION evidence_sources_current_version_guard();

CREATE OR REPLACE FUNCTION evidence_versions_publication_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.publication_status <> 'published' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ever-published evidence versions cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.test_only IS DISTINCT FROM NEW.test_only THEN
    RAISE EXCEPTION 'test_only is immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.evidence_sources AS source
    WHERE source.id = NEW.source_id AND source.test_only = NEW.test_only
  ) THEN
    RAISE EXCEPTION 'a version test_only flag must match its stable source';
  END IF;

  -- An ever-published source version is a permanent citation record. Retiring
  -- it means changing evidence_sources.current_published_version_id or source
  -- status, never editing this row.
  IF TG_OP = 'UPDATE' AND OLD.publication_status = 'published' THEN
    RAISE EXCEPTION 'published evidence versions are immutable';
  END IF;

  IF NEW.publication_status = 'published' THEN
    IF NOT NEW.manual_reviewed
      OR NEW.reviewer_name IS NULL OR char_length(btrim(NEW.reviewer_name)) = 0
      OR NEW.reviewed_at IS NULL
      OR NEW.adoption_reason IS NULL OR char_length(btrim(NEW.adoption_reason)) = 0
      OR NEW.usage_terms IS NULL OR char_length(btrim(NEW.usage_terms)) = 0 THEN
      RAISE EXCEPTION 'publication requires manual review, adoption reason, and usage terms';
    END IF;
    IF NEW.test_only AND NOT public.evidence_is_ephemeral_test_context() THEN
      RAISE EXCEPTION 'test-only evidence cannot be published outside the owned ephemeral database';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_versions_publication_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON evidence_versions
FOR EACH ROW EXECUTE FUNCTION evidence_versions_publication_guard();

CREATE OR REPLACE FUNCTION evidence_sections_immutable_after_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE version_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.source_version_id IS DISTINCT FROM OLD.source_version_id THEN
    RAISE EXCEPTION 'sections cannot be reparented to another source version';
  END IF;
  version_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.source_version_id ELSE OLD.source_version_id END;
  IF EXISTS (
    SELECT 1 FROM public.evidence_versions
    WHERE id = version_id AND publication_status = 'published'
  ) THEN
    RAISE EXCEPTION 'sections of an ever-published version are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER evidence_sections_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON evidence_sections
FOR EACH ROW EXECUTE FUNCTION evidence_sections_immutable_after_publication();

CREATE OR REPLACE FUNCTION evidence_derived_texts_immutable_after_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE version_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.source_version_id IS DISTINCT FROM OLD.source_version_id THEN
    RAISE EXCEPTION 'derived text cannot be reparented to another source version';
  END IF;
  version_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.source_version_id ELSE OLD.source_version_id END;
  IF EXISTS (
    SELECT 1 FROM public.evidence_versions
    WHERE id = version_id AND publication_status = 'published'
  ) THEN
    RAISE EXCEPTION 'derived text of an ever-published version is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER evidence_derived_texts_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON evidence_derived_texts
FOR EACH ROW EXECUTE FUNCTION evidence_derived_texts_immutable_after_publication();

-- Test-only retrieval aids require the same database proof and their flag
-- cannot be toggled later. No function in the application auto-registers them.
CREATE OR REPLACE FUNCTION evidence_test_metadata_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.test_only IS DISTINCT FROM NEW.test_only THEN
    RAISE EXCEPTION 'test_only is immutable';
  END IF;
  IF NEW.test_only AND NOT public.evidence_is_ephemeral_test_context() THEN
    RAISE EXCEPTION 'test-only search metadata requires the owned ephemeral database';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_keywords_test_metadata_guard_trigger
BEFORE INSERT OR UPDATE ON evidence_keywords
FOR EACH ROW EXECUTE FUNCTION evidence_test_metadata_guard();

CREATE TRIGGER evidence_dictionary_terms_test_metadata_guard_trigger
BEFORE INSERT OR UPDATE ON evidence_dictionary_terms
FOR EACH ROW EXECUTE FUNCTION evidence_test_metadata_guard();

COMMIT;