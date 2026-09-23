# Private candidate → topic-confirmed source information gate

This successor imports the frozen four-source / eleven-unit corpus into the
existing owned ephemeral PostgreSQL harness. It reuses the prior dictionary,
lexical exceptions and distinctive complementary-feeding keyword repair. No new
source, fact, classifier, question card or normal route is introduced.

## Before implementation

`test-plan.json` was written first. `plan-seal.json` records its SHA-256 and
that the implementation directory did not yet exist. Verification checks the
same seal before and after every run. Five known cases and seven newly authored
paraphrase/mixed cases have manually fixed relation maps and expected actions.
They are not a blind holdout: the implementer could read both sets.

## Reuse and gate

The prior vocabulary loader is transformed in memory to select this managed
non-app suite. Ownership, managed-child checks, schema and owner cleanup remain.
The previous connection gets narrowly asserted load-time additions:

- `candidateOnly` prevents `factHtml` and `evaluateSleep` from running.
- `allowedUnitIds` filters logical units before fact projection.

Candidate API responses contain only titles/links/logical unit IDs and prompts,
not quotes, fact HTML, sleep numbers or comparison results. Candidate membership,
age eligibility and topic confirmation are separate.

`gate.mts` issues an ephemeral session token bound to the exact consultation,
target, ages, health and optional sleep inputs. A current affirmative confirmation
or explicit upfront topic choice permits an actual canonical-topic re-search,
then topic-specific logical-unit filtering. No topic is inferred from keywords.
Reject/rephrase discard the token and outputs. Browser intake and optional-input
changes invalidate the choice, including an earlier upfront selection.

The topic catalog is a small source taxonomy, not an intent classifier. General
source information is not a question-specific conclusion or adequacy judgment.
Arithmetic retains all previous explicit age/day/sleep/nap/completeness conditions.
User-confirmed wrong topics are not automatically detected; the verifier records
that limitation with a deliberately wrong affirmative action.

## Run (owner only)

```
env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC \
 node --import ./prototypes/evidence-consultation/candidate-relevance-gate/register.mjs \
 --import tsx tests/run-ephemeral-tests.mjs candidate-relevance-gate
```

Only newly owned loopback PostgreSQL and an offline file-based browser run.
No app/HTTP server, workflow, old DB, model or external request is started.
Each attempt is append-only. Owner exit and residual directories must be checked
separately from the managed verifier success.

## Reading the metrics

Candidate relevance is manually labeled per question in the sealed plan.
Counts are per consultation, so a mixed case may have both related and unrelated
candidates. `neededConfirmationStopped` counts questions with unrelated
candidates paused before any projection; it is not an all-stops success score.
`initialPaused` is separated from `relatedQuestionIncorrectlyBlocked` (no related
unit after the planned valid confirmation). Extra confirmation actions are
counted separately from upfront topic selections. Optional-condition edits and
the need for repeated confirmation are measured separately in browser checks.

This is an interaction safety boundary, not a search-precision improvement.
It intentionally retains false-positive candidates and reports confirmation cost.