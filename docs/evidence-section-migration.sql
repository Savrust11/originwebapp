-- Add section-level applicability without altering an existing citation or
-- publishing it. Apply manually after docs/evidence-search-migration.sql.
BEGIN;

-- PostgreSQL has jsonb_array_length but no portable object-length primitive
-- across supported versions. Exact-key comparison also rejects an omitted
-- required member rather than merely counting keys.
CREATE OR REPLACE FUNCTION evidence_jsonb_has_exact_keys(value jsonb, expected text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND ARRAY(SELECT jsonb_object_keys(value) ORDER BY 1)
      = ARRAY(SELECT unnest(expected) ORDER BY 1);
$$;

CREATE OR REPLACE FUNCTION evidence_section_policy_is_valid(policy jsonb, allow_inherit boolean)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  mode text;
  value jsonb;
  item jsonb;
BEGIN
  -- Every path is mandatory. This intentionally rejects malformed direct SQL
  -- writes instead of treating a missing field as unrestricted.
  IF NOT evidence_jsonb_has_exact_keys(policy, ARRAY['weiku', 'research', 'certainty', 'usage'])
    OR NOT evidence_jsonb_has_exact_keys(policy->'weiku', ARRAY['target', 'age', 'conditions', 'japanApplicability'])
    OR NOT evidence_jsonb_has_exact_keys(policy->'research', ARRAY['participantAge', 'regions'])
    OR NOT evidence_jsonb_has_exact_keys(policy->'certainty', ARRAY['mode', 'level', 'assessmentMethod', 'assessmentSourceLocation'])
    OR NOT evidence_jsonb_has_exact_keys(policy->'usage', ARRAY['mode', 'terms', 'exceptions']) THEN
    RETURN false;
  END IF;

  FOREACH value IN ARRAY ARRAY[
    policy#>'{weiku,target}', policy#>'{weiku,age}', policy#>'{weiku,conditions}',
    policy#>'{weiku,japanApplicability}', policy#>'{research,participantAge}',
    policy#>'{research,regions}', policy->'certainty', policy->'usage'
  ] LOOP
    mode := value->>'mode';
    IF jsonb_typeof(value) <> 'object'
      OR jsonb_typeof(value->'mode') <> 'string'
      OR mode NOT IN ('unknown', 'inherit', 'specific')
      OR (mode = 'inherit' AND NOT allow_inherit) THEN
      RETURN false;
    END IF;
  END LOOP;

  IF NOT evidence_jsonb_has_exact_keys(policy#>'{weiku,target}', ARRAY['mode', 'values'])
    OR jsonb_typeof(policy#>'{weiku,target,values}') <> 'array'
    OR jsonb_array_length(policy#>'{weiku,target,values}') > 2
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(policy#>'{weiku,target,values}') x
               WHERE jsonb_typeof(x) <> 'string' OR trim(both '"' FROM x::text) NOT IN ('child', 'caregiver'))
    OR (policy#>>'{weiku,target,mode}' = 'specific' AND jsonb_array_length(policy#>'{weiku,target,values}') = 0)
    OR (policy#>>'{weiku,target,mode}' <> 'specific' AND jsonb_array_length(policy#>'{weiku,target,values}') <> 0) THEN
    RETURN false;
  END IF;

  -- Applicable age and participant age are deliberately separate. A mean is
  -- descriptive only and can never be a range.
  IF NOT evidence_section_policy_age_valid(policy#>'{weiku,age}', false)
    OR NOT evidence_section_policy_age_valid(policy#>'{research,participantAge}', true) THEN
    RETURN false;
  END IF;

  IF NOT evidence_section_policy_list_valid(policy#>'{weiku,conditions}', true)
    OR NOT evidence_section_policy_list_valid(policy#>'{research,regions}', false) THEN
    RETURN false;
  END IF;

  IF NOT evidence_jsonb_has_exact_keys(policy#>'{weiku,japanApplicability}', ARRAY['mode', 'value'])
    OR (policy#>>'{weiku,japanApplicability,mode}' = 'specific'
      AND (jsonb_typeof(policy#>'{weiku,japanApplicability,value}') <> 'string'
        OR policy#>>'{weiku,japanApplicability,value}' NOT IN ('applicable', 'inapplicable')))
    OR (policy#>>'{weiku,japanApplicability,mode}' <> 'specific'
      AND policy#>'{weiku,japanApplicability,value}' <> 'null'::jsonb) THEN
    RETURN false;
  END IF;

  IF (policy->'certainty'->'level' <> 'null'::jsonb AND jsonb_typeof(policy->'certainty'->'level') <> 'string')
    OR (policy->'certainty'->'assessmentMethod' <> 'null'::jsonb AND jsonb_typeof(policy->'certainty'->'assessmentMethod') <> 'string')
    OR (policy->'certainty'->'assessmentSourceLocation' <> 'null'::jsonb AND jsonb_typeof(policy->'certainty'->'assessmentSourceLocation') <> 'string')
    OR (policy->'usage'->'terms' <> 'null'::jsonb AND jsonb_typeof(policy->'usage'->'terms') <> 'string')
    OR (policy->'certainty'->'level' <> 'null'::jsonb AND char_length(btrim(policy->'certainty'->>'level')) NOT BETWEEN 1 AND 32)
    OR (policy->'certainty'->'assessmentMethod' <> 'null'::jsonb AND char_length(btrim(policy->'certainty'->>'assessmentMethod')) NOT BETWEEN 1 AND 2000)
    OR (policy->'certainty'->'assessmentSourceLocation' <> 'null'::jsonb AND char_length(btrim(policy->'certainty'->>'assessmentSourceLocation')) NOT BETWEEN 1 AND 2000)
    OR (policy->'usage'->'terms' <> 'null'::jsonb AND char_length(btrim(policy->'usage'->>'terms')) NOT BETWEEN 1 AND 4000)
    OR jsonb_typeof(policy#>'{usage,exceptions}') <> 'array'
    OR jsonb_array_length(policy#>'{usage,exceptions}') > 64
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(policy#>'{usage,exceptions}') x
              WHERE jsonb_typeof(x) <> 'string' OR char_length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 500)
    OR (policy#>>'{certainty,mode}' <> 'specific' AND (
      policy->'certainty'->'level' <> 'null'::jsonb
      OR policy->'certainty'->'assessmentMethod' <> 'null'::jsonb
      OR policy->'certainty'->'assessmentSourceLocation' <> 'null'::jsonb
    ))
    OR (policy#>>'{usage,mode}' <> 'specific' AND (
      policy->'usage'->'terms' <> 'null'::jsonb
      OR jsonb_array_length(policy#>'{usage,exceptions}') <> 0
    )) THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- Supporting validators are created after the principal function body so they
-- can be independently reviewed; PostgreSQL resolves them at invocation.
CREATE OR REPLACE FUNCTION evidence_section_policy_age_valid(value jsonb, research boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE mode text := value->>'mode'; scope text := value->>'scope';
BEGIN
  IF NOT evidence_jsonb_has_exact_keys(value, CASE WHEN research
    THEN ARRAY['mode', 'scope', 'minMonths', 'maxMonths', 'meanMonths']
    ELSE ARRAY['mode', 'scope', 'minMonths', 'maxMonths'] END) THEN RETURN false; END IF;
  IF mode <> 'specific' THEN
    RETURN value->'scope' = 'null'::jsonb AND value->'minMonths' = 'null'::jsonb
      AND value->'maxMonths' = 'null'::jsonb AND (NOT research OR value->'meanMonths' = 'null'::jsonb);
  END IF;
  IF scope IS NULL OR scope NOT IN ('all', 'range', 'mean') OR (NOT research AND scope = 'mean') THEN RETURN false; END IF;
  IF scope = 'all' THEN RETURN value->'minMonths' = 'null'::jsonb AND value->'maxMonths' = 'null'::jsonb AND (NOT research OR value->'meanMonths' = 'null'::jsonb); END IF;
  IF scope = 'range' THEN RETURN jsonb_typeof(value->'minMonths') = 'number' AND jsonb_typeof(value->'maxMonths') = 'number'
    AND (value->>'minMonths')::numeric BETWEEN 0 AND 1200 AND (value->>'maxMonths')::numeric BETWEEN 0 AND 1200
    AND trunc((value->>'minMonths')::numeric) = (value->>'minMonths')::numeric
    AND trunc((value->>'maxMonths')::numeric) = (value->>'maxMonths')::numeric
    AND (value->>'minMonths')::numeric <= (value->>'maxMonths')::numeric AND (NOT research OR value->'meanMonths' = 'null'::jsonb); END IF;
  RETURN research AND scope = 'mean' AND jsonb_typeof(value->'meanMonths') = 'number'
    AND (value->>'meanMonths')::numeric BETWEEN 0 AND 1200
    AND trunc((value->>'meanMonths')::numeric) = (value->>'meanMonths')::numeric
    AND value->'minMonths' = 'null'::jsonb AND value->'maxMonths' = 'null'::jsonb;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION evidence_section_policy_list_valid(value jsonb, conditions boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE mode text := value->>'mode'; scope text := value->>'scope'; items jsonb := value->'values';
BEGIN
  IF NOT evidence_jsonb_has_exact_keys(value, CASE WHEN conditions
      THEN ARRAY['mode', 'scope', 'values', 'exclusions']
      ELSE ARRAY['mode', 'scope', 'values'] END)
    OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) > 64
    OR (conditions AND (jsonb_typeof(value->'exclusions') <> 'array' OR jsonb_array_length(value->'exclusions') > 64)) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(items) x WHERE jsonb_typeof(x) <> 'string' OR char_length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 500)
    OR (conditions AND EXISTS (SELECT 1 FROM jsonb_array_elements(value->'exclusions') x
      WHERE jsonb_typeof(x) <> 'string' OR char_length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 500)) THEN RETURN false; END IF;
  IF mode <> 'specific' THEN RETURN value->'scope' = 'null'::jsonb AND jsonb_array_length(items) = 0 AND (NOT conditions OR jsonb_array_length(value->'exclusions') = 0); END IF;
  IF scope IS NULL OR scope NOT IN ('all', 'list') THEN RETURN false; END IF;
  RETURN (scope = 'all' AND jsonb_array_length(items) = 0) OR (scope = 'list' AND jsonb_array_length(items) > 0);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

ALTER TABLE evidence_versions
  ADD COLUMN section_policy_defaults jsonb NOT NULL DEFAULT
  '{"weiku":{"target":{"mode":"unknown","values":[]},"age":{"mode":"unknown","scope":null,"minMonths":null,"maxMonths":null},"conditions":{"mode":"unknown","scope":null,"values":[],"exclusions":[]},"japanApplicability":{"mode":"unknown","value":null}},"research":{"participantAge":{"mode":"unknown","scope":null,"minMonths":null,"maxMonths":null,"meanMonths":null},"regions":{"mode":"unknown","scope":null,"values":[]}},"certainty":{"mode":"unknown","level":null,"assessmentMethod":null,"assessmentSourceLocation":null},"usage":{"mode":"unknown","terms":null,"exceptions":[]}}'::jsonb,
  ADD CONSTRAINT evidence_versions_section_policy_defaults_valid
    CHECK (evidence_section_policy_is_valid(section_policy_defaults, false));

ALTER TABLE evidence_sections
  ADD COLUMN applicability_policy jsonb NOT NULL DEFAULT
  '{"weiku":{"target":{"mode":"unknown","values":[]},"age":{"mode":"unknown","scope":null,"minMonths":null,"maxMonths":null},"conditions":{"mode":"unknown","scope":null,"values":[],"exclusions":[]},"japanApplicability":{"mode":"unknown","value":null}},"research":{"participantAge":{"mode":"unknown","scope":null,"minMonths":null,"maxMonths":null,"meanMonths":null},"regions":{"mode":"unknown","scope":null,"values":[]}},"certainty":{"mode":"unknown","level":null,"assessmentMethod":null,"assessmentSourceLocation":null},"usage":{"mode":"unknown","terms":null,"exceptions":[]}}'::jsonb,
  ADD CONSTRAINT evidence_sections_applicability_policy_valid
    CHECK (evidence_section_policy_is_valid(applicability_policy, true));

COMMIT;