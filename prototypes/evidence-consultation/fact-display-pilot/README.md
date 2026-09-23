# Source-fact display pilot

This is an isolated, offline implementation, not a normal consultation route.
It imports no application, provider SDK, database, environment secret, or workflow.

- `projection.mjs`: reuse frozen sources/fragments/units and required context;
  validate the manually reviewed source-level projections. This is not a
  general-language semantic validator.
- `render.mjs`: one shared contextual bundle renderer, reused across four saved
  fictional scenarios. No quantity-only, personalization, synthesis, or AI call API.
- `seal-reviewed-catalog.mjs`: append-only record of reviewed bytes, **not**
  human/clinical/adoption approval.
- `verify-temporary.mjs`: clean-environment offline browser and negative tests;
  own temporary directory removed in `finally`, browser closed, no server started.
- `package-evidence.mjs`: package the preserved screenshots and verification as
  a self-contained static document after cleanup.

The frozen catalog and evidence are under
`evidence-work/parent-reading-evaluation/fact-display-pilot-01/`.
Outputs are write-once. Future iterations must use a new output revision rather
than overwrite this evidence or earlier model answers/scores.

The successful run used a clean environment with only PATH, locale and timezone
for the local browser. No production or normal-route integration is authorized.

## Important limits

Text/source hash matching is not semantic correctness. The first projection
incorrectly supplied a sleep aggregation definition; source reading caught and
corrected it before sealing. Existing unit `exclusions` can mix editorial use
restrictions with actual study exclusions; the projection separates these.

The negative semantic probe demonstrates that a shape-valid changed explanation
can pass structural validation. The unchanged seal refuses it because bytes
changed, not because its meaning was understood. Incorrectly reviewed and
resealed data remains a risk. Future AI free text is deliberately disconnected.