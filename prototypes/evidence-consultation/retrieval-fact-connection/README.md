# Private retrieval → source-bound facts connection

## Decision and resolved harness boundary

The original owned runner has no file-only callback branch. The parent explicitly
authorized a load-time-only adaptation of lifecycle dispatch, retaining all
ownership, managed-child authorization, isolated configuration, schema, signal,
process and cleanup checks. Its original owned PostgreSQL loopback listener is
accepted; no HTTP/application server is launched. Original files stay unchanged.

`adapter-loader.mjs` makes uniquely asserted replacements and records original
and adapted hashes under the new evidence output directory:

1. Existing owner dispatches a new managed **non-app** group instead of an HTTP
   lifecycle. The owner still creates/checks/destroys its own `/tmp` cluster.
2. Existing managed runner registers that group and uses the same private
   context, descendant check and generated environment for the verifier.
3. Existing real-corpus importer retains E02/E03/E04 and their unchanged original
   fragments, prepared units, policies, keyword/concept declarations and required
   context. It omits publication simulation; all candidate versions remain
   `draft`, `manual_reviewed=false`. Managed entry and SQL ownership checks remain.
4. Existing `factHtml` is exported at load time without changing its body.

No fake managed context, normal database, published clone, human approval,
alternate SQL-row fixture, package change, workflow or model is used.

## Reused runtime boundaries

- `service.mts` → `searchConsultation`, `flow.ts` input validation/grouping and
  explicit nullable ages/health confirmation contract.
- `server/evidence/search.ts` → real canonical SQL dictionary, candidate search,
  original/checked-derived matching, required context and applicability logic.
- `tests/fixtures/real-corpus/setup.mts` and `corpus.mts` → existing corpus and
  vocabulary mapping (no new synonyms or question-intent classifier).
- `fact-display-pilot/projection.mjs` → immutable validated fact catalog.
- `fact-display-pilot/render.mjs` → unmodified common `factHtml` function.
- `p01-aggregation-addendum/model.mjs` → conditional arithmetic and comparison;
  existing renderer validates the sealed supplement before it can be linked.

The only retrieval SQL adaptation replaces the published-pointer, published
version-status and active-source predicates with an explicit owned-source
allowlist and draft/unreviewed/test-only predicates. Other canonical SQL is
unchanged. The same DB with the
ordinary pool must return zero results through unchanged canonical SQL.

The first runtime attempt correctly returned no hits: the initial adapter had
left the canonical `source.status='active'` condition in place, while the
unchanged importer creates sources as `draft`. The failed attempt is preserved.
The correction requires `draft` test-only sources in the quarantined SQL rather
than activating their metadata; it changes no age/target/health eligibility,
vocabulary or normal SQL.

Search hits map through actual source/version/section IDs, original/context
hashes and logical unit ID. E02's shared physical excerpt does not imply the
1–2-year fact belongs to the 3–5-year logical unit. Research mean age is not an
individual applicability cutoff. Missing fact projections are visibly marked.

The new minimal HTML controls adapt the existing input/service contract; they
do not reuse the React component itself. Each child has independent explicit
health/sleep input. Inputs do not default sleep numbers, unknown ages to zero,
or infer facts from the consultation text. Changing consultation/age/target
clears confirmations; changing optional conditions immediately invalidates the
previous comparison until resubmission. General facts do not require diagnosis
answers. No case IDs or whole-question equality switches are used.

## Main-owned execution command

From workspace root, with no workspace environment/secrets inherited:

```sh
env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC \
  node --import ./prototypes/evidence-consultation/retrieval-fact-connection/register.mjs \
  --import tsx tests/run-ephemeral-tests.mjs retrieval-fact-connection
```

The command starts only the newly owned PostgreSQL cluster and an offline
file-based Chromium session. `exposeBinding` connects input to real SQL service;
there is no HTTP server. The original owner and managed runner remove their own
temporary resources. The verifier closes its browser/pool and removes its HTML
directory in `finally`. Main must check the owner exit/cleanup, not interpret the
child's success as proof that outer cleanup completed.

`verification.json` contains synthetic test inputs/results, screenshots,
conditions and failures (no DSN). Parent's `preservation-baseline.json` is never
overwritten. This directory does not package or publish the final report.

## Exports

- `createConnection(pool, initialized)` → `{search(payload), normalControl(),
  quarantine, getSqlCalls()}`. Requires existing importer result and SQL-proven
  owned ephemeral context.
- `search({input: ConsultationInput, sleep: {[groupId]: {night, nap, actual,
  sameDay, complete, napIncluded, link}}})` returns group-specific searched units,
  existing fact HTML, optional source-only health prompts and sleep comparison.
- `renderInputPage()` → self-contained HTML requiring the explicit local
  `searchEvidenceBridge` binding. Without it, an error is shown, not fake results.

## Limits

Normal HTTP routes, approval/publication, DB, AI, embeddings, automatic condition
extraction and automatic fact creation are intentionally unconnected. CDC is
not indexed. Minutes clarify only 1–2-year aggregation, not an independent study.

`no_vocabulary` is a search limitation, not evidence that no material exists.
Other empty searches may reflect eligibility or coverage and are not silently
classified as a scientific knowledge gap. The explicit audit knows this
evaluation includes E02/E03/E04 only; feeding material is outside this retained
scope, while "ねんね" can miss known sleep material through the existing lexicon.