-- Mandatory original-section context. Apply manually only after
-- docs/evidence-search-migration.sql and docs/evidence-section-migration.sql.
-- This is additive: it neither changes publication approval nor rewrites
-- existing evidence.
BEGIN;

CREATE TABLE evidence_section_required_context (
  source_version_id uuid NOT NULL,
  section_id uuid NOT NULL,
  required_section_id uuid NOT NULL,
  role varchar(64) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT evidence_section_required_context_root_fk
    FOREIGN KEY (source_version_id, section_id)
    REFERENCES evidence_sections(source_version_id, id) ON DELETE RESTRICT,
  CONSTRAINT evidence_section_required_context_required_fk
    FOREIGN KEY (source_version_id, required_section_id)
    REFERENCES evidence_sections(source_version_id, id) ON DELETE RESTRICT,
  -- One edge per pair prevents duplicate attached context even if editorial
  -- labels are later standardized.
  CONSTRAINT evidence_section_required_context_unique
    UNIQUE (source_version_id, section_id, required_section_id),
  CONSTRAINT evidence_section_required_context_not_self_check
    CHECK (section_id <> required_section_id),
  CONSTRAINT evidence_section_required_context_role_check
    CHECK (char_length(btrim(role)) BETWEEN 1 AND 64)
);

CREATE INDEX evidence_section_required_context_required_idx
  ON evidence_section_required_context (source_version_id, required_section_id);

-- A bounded, breadth-first closure for one matched root. The queue and global
-- visited set avoid recursive path enumeration: each reachable section is
-- considered once, cycles are harmless, and no more than 16 context sections
-- are returned. Reading a seventeenth edge at any node, an unseen child beyond
-- depth four, or a seventeenth unique node is an explicit limit condition.
CREATE OR REPLACE FUNCTION evidence_required_context_closure(
  requested_version_id uuid,
  root_section_id uuid
)
RETURNS TABLE (
  required_section_id uuid,
  role text,
  depth integer,
  context_limit boolean
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  queue_sections uuid[] := ARRAY[root_section_id];
  queue_depths integer[] := ARRAY[0];
  visited_sections uuid[] := ARRAY[root_section_id];
  result_sections uuid[] := ARRAY[]::uuid[];
  result_roles text[] := ARRAY[]::text[];
  result_depths integer[] := ARRAY[]::integer[];
  queue_length integer;
  result_length integer;
  item_index integer;
  child_count integer;
  current_section uuid;
  current_depth integer;
  child record;
  did_limit boolean := false;
BEGIN
  WHILE COALESCE(array_length(queue_sections, 1), 0) > 0 AND NOT did_limit LOOP
    queue_length := array_length(queue_sections, 1);
    current_section := queue_sections[1];
    current_depth := queue_depths[1];
    IF queue_length = 1 THEN
      queue_sections := ARRAY[]::uuid[];
      queue_depths := ARRAY[]::integer[];
    ELSE
      queue_sections := queue_sections[2:queue_length];
      queue_depths := queue_depths[2:queue_length];
    END IF;

    child_count := 0;
    FOR child IN
      SELECT link.required_section_id, link.role
      FROM public.evidence_section_required_context AS link
      WHERE link.source_version_id = requested_version_id
        AND link.section_id = current_section
      ORDER BY link.required_section_id, link.role
      LIMIT 17
    LOOP
      child_count := child_count + 1;
      -- The seventeenth row is intentionally not traversed. This detects an
      -- over-budget fanout before queueing unbounded work.
      IF child_count = 17 THEN
        did_limit := true;
        EXIT;
      END IF;
      IF child.required_section_id = ANY(visited_sections) THEN
        CONTINUE;
      END IF;
      IF current_depth >= 4 THEN
        did_limit := true;
        EXIT;
      END IF;

      visited_sections := array_append(visited_sections, child.required_section_id);
      result_sections := array_append(result_sections, child.required_section_id);
      result_roles := array_append(result_roles, child.role);
      result_depths := array_append(result_depths, current_depth + 1);
      result_length := array_length(result_sections, 1);
      IF result_length > 16 THEN
        did_limit := true;
        EXIT;
      END IF;
      queue_sections := array_append(queue_sections, child.required_section_id);
      queue_depths := array_append(queue_depths, current_depth + 1);
    END LOOP;
  END LOOP;

  FOR item_index IN 1..COALESCE(array_length(result_sections, 1), 0) LOOP
    required_section_id := result_sections[item_index];
    role := result_roles[item_index];
    depth := result_depths[item_index];
    context_limit := did_limit;
    RETURN NEXT;
  END LOOP;

  -- A limit can occur before a context section is appended (for example at an
  -- invalidly deep fanout). Return a sentinel so the caller still fails closed.
  IF did_limit AND COALESCE(array_length(result_sections, 1), 0) = 0 THEN
    required_section_id := NULL;
    role := NULL;
    depth := NULL;
    context_limit := true;
    RETURN NEXT;
  END IF;
END;
$$;

-- The section trigger already protects section text/policy. Relationships also
-- form part of the published citation unit and must not be rewritten after
-- publication. Reparenting is forbidden even for a draft because both
-- composite FKs intentionally bind one exact source version.
CREATE OR REPLACE FUNCTION evidence_required_context_immutable_after_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  version_id uuid;
  publication_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.source_version_id IS DISTINCT FROM OLD.source_version_id THEN
    RAISE EXCEPTION 'required context cannot be reparented to another source version';
  END IF;

  version_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.source_version_id ELSE OLD.source_version_id END;
  -- Take a compatible lock before testing publication. A concurrent publish
  -- updates this exact row, so it either waits for this draft-link mutation or
  -- completes first and makes the mutation fail; the check cannot race it.
  SELECT version.publication_status INTO publication_status
  FROM public.evidence_versions AS version
  WHERE version.id = version_id
  FOR SHARE;
  IF publication_status = 'published' THEN
    RAISE EXCEPTION 'required context of an ever-published version is immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER evidence_required_context_immutable_trigger
BEFORE INSERT OR UPDATE OR DELETE ON evidence_section_required_context
FOR EACH ROW EXECUTE FUNCTION evidence_required_context_immutable_after_publication();

COMMIT;