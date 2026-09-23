# Four-source inventory and lexical review (isolated successor)

This successor leaves the historical connection, corpus, approval records and
reports unchanged. It uses the existing owned temporary PostgreSQL harness,
existing real-corpus importer and dictionary APIs, existing consultation/search
functions, existing strict source-to-fact mapping and existing UI/fact renderer.
The load-time adapters assert their anchors and record original/adapted hashes.

Unlike the preceding E02–E04 run, all four prepared sources and eleven logical
units are imported here. Import skips publication simulation. The inherited
quarantine connection only selects owned allowlisted draft/test-only sources and
draft/unreviewed/test-only versions. Ordinary published search remains unchanged.

Aliases are attached to existing concepts, not question or case IDs. The narrow
lexical compound exclusions for ねんねアート and ねんねグッズ do not classify a
person or condition, and leave other search words intact. Other false positives
are measured and reported rather than described as solved semantic search.

The existing importer assigns its globally unique `離乳` keyword to the later
weaning concept. `補完食` therefore exposes an existing complementary-concept
linkage gap rather than missing original material. The supplementary technical
alias is tested before repair. A narrowly authorized temporary repair links the
unique phrase `離乳の開始`, verified literally against E01-S03, to the existing
complementary concept. It does not edit source text, applicability or approvals.
`ねんね` remains the principal daily-language example.

User-facing no-hit and missing-explanation messages are changed by a load-time
UI text adaptation only. Internal result states, exact originals, required
context and source references remain separate and preserved.

Run from workspace root:

```
env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC node --import ./prototypes/evidence-consultation/vocabulary-inventory-review/register.mjs --import tsx tests/run-ephemeral-tests.mjs vocabulary-inventory-review
```

No normal app/HTTP lifecycle is started. The browser reads a file URL with its
network disabled and uses a test-owned binding to actual SQL retrieval. The
original managed runner retains ownership, authorization, creation and cleanup
checks. Every invocation writes a new `attempt-NN` directory; no prior result is
overwritten. The parent must confirm the outer owner's exit and cleanup.