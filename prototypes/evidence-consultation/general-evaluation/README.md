# Six-case general-audience evaluation controller

This controller is separate from every historical run. It does not initialize
or send by itself. The owning agent must invoke one explicit action at a time.

```sh
node prototypes/evidence-consultation/general-evaluation/run.mjs \
  init general-audience-six-01
node prototypes/evidence-consultation/general-evaluation/run.mjs \
  preview general-audience-six-01 G-Q05
node prototypes/evidence-consultation/general-evaluation/run.mjs \
  send general-audience-six-01 G-Q05
node prototypes/evidence-consultation/general-evaluation/run.mjs \
  review general-audience-six-01 G-Q05 path/to/bound-review-candidate.json
```

Cases must be processed in this order:

`G-Q05, G-Q06, G-Q08, G-Q09, G-Q10, G-Q11`.

Each `send` reserves and performs at most one POST. A reservation is an attempt
even if authentication, transport, or parsing fails. There is no retry or
metadata/authentication preflight. The sixth attempt is cumulative transmission
19; transmission 20 is inaccessible by design.

The runner:

- uses `gpt-5.6-luna`, default tier, no tools, no storage, no background job,
  no truncation, medium reasoning, explicit cache mode, and a 1,500-token cap;
- shares `.isolated-reading.lock` with the older paid controllers;
- binds the old 13-entry ledger, a history snapshot, and every preparation file;
- writes only below
  `evidence-work/general-audience-evaluation/general-audience-six-01/`;
- globally stops on unknown usage/outcome, wrong model/tier/cache, unexpected
  tool output/cost, or changed history/preparation;
- permits a known case-quality failure to advance only after an independent,
  response- and app-display-bound review.

## Review candidate

The JSON requires:

- `runId`, `caseId`, `rubricSha256`, `responseSha256`;
- `appDisplayFile` below the run's `app-displays/` directory and its
  `appDisplaySha256`;
- separate `bodyVerdict`, `appVerdict`, and `screenVerdict`;
- `checkedBy: "agent-source-comparison-not-clinical-review"`;
- nonempty `findings`, plus `recurrence` and `newIssues` arrays;
- one `{criterionId, met, finding}` for every frozen global/case rubric leaf,
  with the criterion ID included in its finding.

A screen pass requires both body and app passes and every criterion met.
App display cannot override a body failure. A failed reviewed case may continue
without retry; a global failure may not.

Offline accounting tests:

```sh
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC \
  node --import ./prototypes/evidence-consultation/general-evaluation/offline-lockdown.mjs \
  --test tests/evidence-general-six-accounting.test.mjs
```