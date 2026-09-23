# Evidence retrieval core contract

This is an additive, disabled-by-default catalog/search foundation. It does not
add an HTTP route or connect the catalog to the application database module.

## Public search boundary

`searchEvidence(pool, input)` is exported from `server/evidence/search.ts`.
`pool` is a structural PostgreSQL pool (only parameterized `query` is needed).
The request is validated by the strict `inputSchema` exported from
`shared/evidence.ts`:

```ts
{ question: string; ageMonths?: number; region?: string; limit?: number }
```

Questions are trimmed, required, and capped at 1,000 characters. `ageMonths`
is an integer from 0 through 1,200; `limit` is an integer from 1 through 20
and defaults to 10. Unknown keys are rejected. The response is always
`{ status: "results", results }` or `{ status: "no_results", results: [] }`.
When the maintained concept expansion exceeds 64 terms, it deliberately
returns the latter with `diagnostics: { reason: "expansion_limit" }`; it never
silently drops terms. Section results include their original section ID, type,
heading, and notes. Non-empty section notes keep conditions `unverified`, even
when source-level conditions are otherwise `all`.

Each root result is one original section. A checked translation or summary can
make its original section retrievable, but is never returned as another root
or substituted for the original excerpt. Ranking is match-count only; it has
no language or certainty weight and ties are ordered by source, version, then
section UUID.

## Catalog model

`evidence_sources` is the stable document identity and points to the current
published `evidence_versions` row. Versions hold source metadata, applicability,
review/adoption provenance, and the original language. Sections and derived
translations point to an exact source-version. Published version medical
content and every section/derivative for it are immutable; a replacement is a
new version and the source pointer changes. Published versions cannot be
deleted, including in the ephemeral cluster; deleting the owned cluster is the
fixture cleanup mechanism.

Keywords, dictionary concepts/terms, and section-keyword links are separate,
editable retrieval aids. They are not medical evidence and are not generated
automatically for fixtures.

`testOnly` is an explicit required boolean when creating a source, version,
keyword, or dictionary term. It has no false default, is immutable, and every
version must match its stable source flag; a test source can never later accept
a real (`false`) version. Publishing requires `expectedCurrentVersionId`
(`string | null`) so the catalog source row can be locked and stale publication
requests rejected.

Original URLs must be `http://` or `https://` URLs; non-web schemes including
`javascript:`, `data:`, and `file:` are rejected both by the catalog validator
and the migration constraint. English retrieval terms permit only
letters/digits/underscores with single word-separating spaces. This intentionally
rejects punctuation-rich terms such as `C++` rather than collapsing them during
token-boundary matching.

Apply `docs/evidence-search-migration.sql` only after review. It creates the
catalog and database-side publication/immutability guards. In particular,
test-only publication is possible only when PostgreSQL itself reports the
owned `/tmp/ephemeral-postgres-<random>/data` directory and a
`test_owner_<16hex>` session user; it is not based on `NODE_ENV` or a request
flag.