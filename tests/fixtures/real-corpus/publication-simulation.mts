/**
 * A deliberately narrow test-only publication simulator. It is installed only
 * into the PostgreSQL cluster already proven owned by require-managed. The
 * production publication guard function is not edited: a temporary clone is
 * bound to the trigger and restored before this helper returns.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};
type PoolWithConnections = Queryable & {
  connect(): Promise<Queryable & { release(): void }>;
};

export const REAL_CORPUS_SIMULATION_MARKER = "real-corpus-v0.2-test-only-publication";
const CLONE_FUNCTION = "evidence_versions_real_corpus_test_publication_guard";
const SIMULATION_TABLE = "evidence_test_publication_simulations";

async function atomicDDL(pool: PoolWithConnections, operation: (client: Queryable) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await operation(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function quoteIdentifier(identifier: string) {
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/u.test(identifier), "unsafe internal SQL identifier");
  return `"${identifier}"`;
}

async function assertOwnedContext(pool: Queryable) {
  const context = await pool.query<{ allowed: boolean; session_user: string }>(
    "SELECT public.evidence_is_ephemeral_test_context() AS allowed, session_user",
  );
  assert.equal(context.rows[0]?.allowed, true, "simulation requires PostgreSQL-owned ephemeral context");
  assert.match(context.rows[0]?.session_user ?? "", /^test_owner_[0-9a-f]{16}$/u, "simulation requires the generated test owner");
}

async function installSimulationTable(pool: Queryable) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.${SIMULATION_TABLE} (
      source_version_id uuid PRIMARY KEY REFERENCES public.evidence_versions(id) ON DELETE RESTRICT,
      approval_state text NOT NULL CHECK (approval_state = 'test_only_simulated_publication'),
      test_marker text NOT NULL CHECK (test_marker = '${REAL_CORPUS_SIMULATION_MARKER}'),
      owner_session_user name NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
}

async function originalGuardDefinition(pool: Queryable) {
  const definition = await pool.query<{ definition: string; trigger_definition: string }>(`
    SELECT
      pg_get_functiondef('public.evidence_versions_publication_guard()'::regprocedure) AS definition,
      pg_get_triggerdef(trigger.oid, true) AS trigger_definition
    FROM pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.evidence_versions'::regclass
      AND trigger.tgname = 'evidence_versions_publication_guard_trigger'
      AND NOT trigger.tgisinternal`);
  const row = definition.rows[0];
  assert(row?.definition?.includes("publication requires manual review"), "original publication guard definition is not present");
  assert(row.trigger_definition.includes("evidence_versions_publication_guard"), "original publication trigger is not bound to the production guard");
  return row.definition;
}

async function bindClone(pool: Queryable) {
  const clone = quoteIdentifier(CLONE_FUNCTION);
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.${clone}()
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
      IF TG_OP = 'UPDATE' AND OLD.publication_status = 'published' THEN
        RAISE EXCEPTION 'published evidence versions are immutable';
      END IF;

      IF NEW.publication_status = 'published' THEN
        IF NEW.test_only
          AND public.evidence_is_ephemeral_test_context()
          AND EXISTS (
            SELECT 1
            FROM public.${SIMULATION_TABLE} AS simulation
            WHERE simulation.source_version_id = NEW.id
              AND simulation.approval_state = 'test_only_simulated_publication'
              AND simulation.test_marker = '${REAL_CORPUS_SIMULATION_MARKER}'
              AND simulation.owner_session_user = session_user
          ) THEN
          RETURN NEW;
        END IF;
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
    DROP TRIGGER evidence_versions_publication_guard_trigger ON public.evidence_versions;
    CREATE TRIGGER evidence_versions_publication_guard_trigger
      BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_versions
      FOR EACH ROW EXECUTE FUNCTION public.${clone}();`);
}

async function restoreOriginalGuard(pool: Queryable, definition: string) {
  await pool.query(`
    DROP TRIGGER IF EXISTS evidence_versions_publication_guard_trigger ON public.evidence_versions;
    CREATE TRIGGER evidence_versions_publication_guard_trigger
      BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_versions
      FOR EACH ROW EXECUTE FUNCTION public.evidence_versions_publication_guard();
    DROP FUNCTION IF EXISTS public.${quoteIdentifier(CLONE_FUNCTION)}();`);
  assert.equal(await originalGuardDefinition(pool), definition, "the production guard function must remain unchanged");
}

async function assertCloneStillFailsClosed(pool: PoolWithConnections, version: { sourceId: string; versionId: string }) {
  // No simulation row is present at this point. The clone must retain the
  // normal human-review requirement for every record other than the precisely
  // marker-bound exception.
  await assert.rejects(
    pool.query(
      `UPDATE public.evidence_versions
       SET publication_status = 'published', published_at = now()
       WHERE id = $1 AND source_id = $2`,
      [version.versionId, version.sourceId],
    ),
    /publication requires manual review/u,
    "the clone must not publish an ordinary unapproved test-only record",
  );

  await pool.query(
    `INSERT INTO public.${SIMULATION_TABLE}
       (source_version_id, approval_state, test_marker, owner_session_user)
     VALUES ($1, 'test_only_simulated_publication', $2, session_user)`,
    [version.versionId, REAL_CORPUS_SIMULATION_MARKER],
  );
  const role = `real_corpus_guard_${randomUUID().replaceAll("-", "")}`;
  const quotedRole = quoteIdentifier(role);
  let client: (Queryable & { release(): void }) | null = null;
  try {
    await pool.query(`CREATE ROLE ${quotedRole} NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
    await pool.query(`GRANT SELECT, UPDATE ON public.evidence_versions TO ${quotedRole}`);
    await pool.query(`GRANT SELECT ON public.evidence_sources, public.${SIMULATION_TABLE} TO ${quotedRole}`);
    client = await pool.connect();
    await client.query(`SET SESSION AUTHORIZATION ${quotedRole}`);
    const context = await client.query<{ allowed: boolean }>(
      "SELECT public.evidence_is_ephemeral_test_context() AS allowed",
    );
    assert.equal(context.rows[0]?.allowed, false, "a non-owner session must fail the owned-context proof");
    await assert.rejects(
      client.query(
        `UPDATE public.evidence_versions
         SET publication_status = 'published', published_at = now()
         WHERE id = $1`,
        [version.versionId],
      ),
      /publication requires manual review/u,
      "marker rows must not broaden publication to another database role",
    );
  } finally {
    if (client) {
      try {
        await client.query("RESET SESSION AUTHORIZATION");
      } finally {
        client.release();
      }
    }
  }
}

export async function assertNormalPublicationRefused(pool: Queryable, versionId: string) {
  await assert.rejects(
    pool.query(
      `UPDATE public.evidence_versions
       SET publication_status = 'published', published_at = now()
       WHERE id = $1`,
      [versionId],
    ),
    /publication requires manual review/u,
    "an unapproved real-corpus draft must be refused before simulation",
  );
  const persisted = await pool.query<{
    publication_status: string;
    manual_reviewed: boolean;
    reviewer_name: string | null;
    reviewed_at: string | null;
  }>(
    `SELECT publication_status, manual_reviewed, reviewer_name, reviewed_at
     FROM public.evidence_versions WHERE id = $1`,
    [versionId],
  );
  assert.deepEqual(persisted.rows[0], {
    publication_status: "draft",
    manual_reviewed: false,
    reviewer_name: null,
    reviewed_at: null,
  }, "normal refusal must leave the unapproved draft untouched");
}

export async function simulateTestOnlyPublication(
  pool: PoolWithConnections,
  versions: Array<{ sourceId: string; versionId: string }>,
) {
  assert(versions.length > 0, "simulation needs at least one owned draft");
  await assertOwnedContext(pool);
  await installSimulationTable(pool);
  const originalDefinition = await originalGuardDefinition(pool);
  let cloneBound = false;
  try {
    await atomicDDL(pool, bindClone);
    cloneBound = true;
    await assertCloneStillFailsClosed(pool, versions[0]);
    for (const [index, version] of versions.entries()) {
      // The first marker was intentionally inserted by the clone-negative
      // check. All later rows are created here, with the same fixed state.
      if (index !== 0) {
      await pool.query(
        `INSERT INTO public.${SIMULATION_TABLE}
           (source_version_id, approval_state, test_marker, owner_session_user)
         VALUES ($1, 'test_only_simulated_publication', $2, session_user)`,
        [version.versionId, REAL_CORPUS_SIMULATION_MARKER],
      );
      }
      const published = await pool.query<{ id: string }>(
        `UPDATE public.evidence_versions
         SET publication_status = 'published', published_at = now()
         WHERE id = $1
           AND source_id = $2
           AND publication_status = 'draft'
         RETURNING id`,
        [version.versionId, version.sourceId],
      );
      assert.equal(published.rows[0]?.id, version.versionId, "only marker-bound test drafts may simulate publication");
      await pool.query(
        `UPDATE public.evidence_sources
         SET current_published_version_id = $2, status = 'active', updated_at = now()
         WHERE id = $1`,
        [version.sourceId, version.versionId],
      );
    }
  } finally {
    if (cloneBound) {
      await atomicDDL(pool, (client) => restoreOriginalGuard(client, originalDefinition));
    }
  }
}