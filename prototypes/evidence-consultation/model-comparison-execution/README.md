# Isolated single-step comparison execution

No app/DB changes, model preflight, retries, SDK, external evaluator requests,
fallback model or automatic sending loop. Merely importing modules does not
read credentials or transmit. The tests inject an in-memory network mock and
write only removable OS temporary fixtures.

## CLI (workspace root)

```sh
node --test prototypes/evidence-consultation/model-comparison-execution/offline.test.mjs

# OFFLINE: explicit authorization ledger + cryptographically random PRIVATE mapping.
node prototypes/evidence-consultation/model-comparison-execution/cli.mjs init --authorize-24-43-usd1

# OFFLINE: verify all bound inputs/artifacts and print accounting / review path.
node prototypes/evidence-consultation/model-comparison-execution/cli.mjs status

# LIVE: sends AT MOST ONE packet, in frozen order. Never place this in a loop.
node prototypes/evidence-consultation/model-comparison-execution/cli.mjs next

# OFFLINE: accept a new-context AI's completed model-free judgment.
node prototypes/evidence-consultation/model-comparison-execution/cli.mjs review C-K10 X path/to/judgment.json

# OFFLINE: turn an unresolved write-ahead reservation into an unknown-outcome
# technical marker. Permanently stops the run, retains reserve, NEVER resends.
node prototypes/evidence-consultation/model-comparison-execution/cli.mjs recover

# OFFLINE: requires ALL attempted answers' reviews sealed; permanently closes.
node prototypes/evidence-consultation/model-comparison-execution/cli.mjs unmask "All attempted answers reviewed; remaining cases stopped for documented reason."
```

Do not execute `init` or `next` merely to test the tool. `next` alone reads
`OPENAI_API_KEY`, at runtime, only after admission checks. Its only network
destination is POST `https://api.openai.com/v1/responses`, with
`redirect:"error"`, 120-second timeout, one request in flight, zero retries.
The shared legacy lock is
`evidence-work/model-evaluation/.isolated-reading.lock`. Existing/stale locks
refuse; the tool never clears another holder's lock. After a process crash,
an operator must establish that no process/request remains in flight before
removing a stale lock and invoking **offline** `recover`. If artifacts were
partially written, integrity checks fail closed; do not delete/rewrite them
or attempt another transmission.

## Required inputs and frozen boundary

Frozen preparation:
`evidence-work/model-comparison-preparation/reading-comparison-01/`.
The exact final-freeze SHA-256 is pinned in code. Every listed file, all 36
preserved result files, all 142 prior protected files and the manifest's source
references are verified before execution actions. Old files/ledgers are read
only. Execution code is hash-bound during initialization.

Run root:
`evidence-work/model-comparison-runs/reading-comparison-01/`.
Main must supply these files **before init**:

* `preflight/current-pricing.json`: supplied verified pricing record, including
  `verifiedAt`, fixed `endpoint`, exact `models` pricing objects, cache-write
  multiplier 1.25 and explicit/no-breakpoint/no-cache policy.
* `preflight/official-0.md`, `official-1.md`, `official-2.md`: captured official
  model/pricing/cache documents. The tool reads and binds them, never fetches them.

Required rates (USD/million = microUSD/token):

| Model | uncached | cached read | cache write | output (including reasoning) |
|---|---:|---:|---:|---:|
| gpt-5.6-luna | .2 | .02 | .25 | 1.2 |
| gpt-5.6-sol | 4 | .4 | 5 | 20 |

Usage requires nonnegative integer `input_tokens`, `output_tokens`, `total_tokens`,
`input_tokens_details:{cached_tokens,cache_write_tokens}` and
`output_tokens_details:{reasoning_tokens}`. Unknown additional accounting
fields, missing write counts or inconsistent totals stop; no zero assumptions.
Known cache reads/writes are charged exactly but cause global stop because the
frozen explicit-cache requests contain no breakpoints.

Exact cost is held in integer **centiMicroUSD** (0.01 microUSD). Uncached count
is input minus cache-read and cache-write counts; reasoning is already included
in output and is not charged twice. History starts at 2,587,900 centiMicroUSD
($0.025879), 19 transmissions. Maximum 24 additional / 43 cumulative and
100,000,000 centiMicroUSD ($1) including history.

Each packet reserves `(UTF8 bytes of full JSON payload + 2048) * cacheWriteRate
+ 1500 * outputRate` in microUSD. No unverified 8000-token assumption or local
tokenizer count is used as a bound. This conservative operational estimate is
not a provider invoice guarantee. Both complete packets must fit before a pair
starts; known actual costs release unused reserves for later pairs. Unknown
outcomes retain the attempted reservation and stop. Actual usage exceeding
the reservation stops. If the next full pair cannot fit, remaining pairs are
omitted, never source text. No paired second response bypasses review.

A valid default-rate token subtotal is **not** treated as the total bill for an
unexpected model, tier, tool, cache configuration or other unpriced control.
Those records retain observed token counts but set `measured:null` and
`costAccounting:"unknown-retain-reservation"`; the entire attempted reservation
remains held. No default-rate subtotal is added to known total cost. Explicitly
priced cache reads/writes and known-cost bound overruns retain their full exact
charge instead. **Every** global-stop/control anomaly makes the comparator
answer `technical-invalid`, even if its JSON otherwise validates. The blind
packet exposes only the same generic technical marker, never the cause.

## Append-only JSON artifacts

All generated files are exclusive-create, fsync'd, private (0600 files, 0700
created directories); none is rewritten. Each event binds its predecessor's
SHA-256 and all referenced artifact bytes. Every command checks the chain and
all sealed assets. The final map/report must not reach the scorer prematurely.

* `private/authorization.json`: `{schemaVersion,comparisonId,authorizedAt,
  authorization,limits,endpoint,method,credentialEnvironmentVariable,
  legacyUnusedTwentiethSlotForbidden,preparedFreezeSha256,pricingBindings,
  mappingSha256,codeBindings,localReservationsAreNotProviderInvoiceGuarantees}`.
* `private/mapping.json`: `{comparisonId,mapping:{[caseId]:
  {"gpt-5.6-luna":"X"|"Y","gpt-5.6-sol":"Y"|"X"}}}`. Each case uses a new random
  coin against a canonical model list, independently of frozen generation order.
* `private/events/000001.json`, ...:
  `{sequence,previousSha256,at,type,data,assets:[{path,sha256}]}`.
  Types: `initialized`, `pair-reserved`, `transmission-reserved`,
  `response-recorded`, `review-accepted`, `global-stop`, `unmasked`.
  Transmission reservations include attempt/cumulative counters, model,
  caseId, request hash and projection and are durably written **before fetch**.
* `private/responses/<caseId>/<X|Y>.json`: request/raw-response hashes,
  HTTP status, elapsed ms, sanitized model/status/tier, incomplete reason,
  error type/code, usage, observed usage-field names, exact measured breakdown,
  output text/types, reasoning-item count, parsed answer or null, costAccounting,
  costUnknownReasons,
  `technicalState`, `stopReasons`. Raw HTTP response/headers are never saved.
  The sanitized artifact's SHA-256 is bound in `response-recorded`.
* `blind/<caseId>/<X|Y>/packet.json`: `{schemaVersion,caseId,label,reviewerType,
  instructions,question,originalEvidence,applicationTemplate,rubric:{global,case},
  answer}`. `answer` is `{kind:"completed-schema",content:<exact valid answer>}`
  or `{kind:"technical-invalid",marker:<generic invalid marker>}`. No generation
  index, model identity, cost, latency, usage or prior answers. Templates and
  complete source originals are copied exactly from frozen preparation.
* `private/reviews/<caseId>/<X|Y>.json`: validated review object below, frozen
  by its file hash and the associated blind-packet hash in `review-accepted`.
* `private/emergency-stop.json`: sticky fail-closed marker for an unexpected
  local/integrity failure. No automatic resume. Invalid/missing review inputs
  simply refuse acceptance and do not create this marker.
* `unmasked/final.json`: `{schemaVersion,comparisonId,closedAt,closureReason,
  mapping,summary,attempted,unexecuted,safety}`. Every unexecuted frozen packet
  has a case/model and explanation. Unknown reserves remain visible.

`status` prints cumulative/new transmissions, known exact cost, unknown attempted
reserves, untransmitted pair reserves, stopped/closed flags and the single
`awaitingReview` path plus its SHA-256. Do **not** expose status, filenames'
creation times, execution context, private artifacts, or the directory listing
to the scorer. Give a fresh-context AI **only the one requested packet's
contents and its hash**. Independent content blinding does not eliminate
possible stylistic guesses.

CLI stdout is private operator data: the main agent must filter it and must
not surface current cost/usage summaries to the user until scoring is frozen.
Do not paste execution summaries into user-visible progress updates before
that point. This does not alter the CLI's private summary schema.

## Exact accepted judgment schema

Every object rejects additional fields. All reasons, elements and limitations
must be nonempty. Model identities/credential patterns are rejected anywhere.
No API evaluator is invoked by the review command.

```json
{
  "schemaVersion": 1,
  "caseId": "C-K10",
  "label": "X",
  "blindPacketSha256": "<SHA-256 of exact packet.json bytes>",
  "reviewerType": "AI",
  "contextIsolation": {
    "freshContext": true,
    "modelIdentityKnown": false,
    "priorAnswersSeen": false
  },
  "technicalAcknowledged": true,
  "decision": "continue",
  "criteria": [
    {"group":"mandatory","index":0,"verdict":"pass","reason":"<grounded rationale>"}
  ],
  "layers": {
    "bodyMeaning": {"verdict":"pass","reason":"<rationale>"},
    "bodyQuestionCoverage": {"verdict":"pass","reason":"<rationale>"},
    "bodyAttributionPresence": {"verdict":"correct","reason":"<rationale>"},
    "bodyCompleteness": {"verdict":"complete","reason":"<rationale>"},
    "appDisplay": {"verdict":"pass","reason":"<rationale>"},
    "wholeScreenMeaning": {"verdict":"pass","reason":"<rationale>"},
    "surfaceQuality": {"verdict":"pass","reason":"<rationale>"}
  },
  "questionCoverage": [
    {"element":"<each directly requested element>","verdict":"answered","reason":"<rationale>"}
  ],
  "readability": [
    {"dimension":"日英混在","verdict":"pass","reason":"<actual expression and rationale>"},
    {"dimension":"専門用語の曖昧な訳","verdict":"pass","reason":"<actual expression and rationale>"},
    {"dimension":"係り受け","verdict":"pass","reason":"<actual expression and rationale>"},
    {"dimension":"一般向けの自然さ","verdict":"pass","reason":"<actual expression and rationale>"}
  ],
  "limitations": "<context isolation and limitations; no model guesses>"
}
```

This illustrates fields, not an actual judgment. `criteria` must include exactly
one entry for **every** zero-based criterion in every group present in that
case rubric (`mandatory`, `conditional`, `completeness`, `forbidden`), not just
the single example above. Forbidden `pass` means no forbidden claim observed.

Enums:

* decision: `continue | stop` (continue never clears a global stop).
* criterion: `pass | fail | not-applicable | not-assessable`.
* bodyMeaning/bodyQuestionCoverage/appDisplay/wholeScreenMeaning/surfaceQuality:
  `pass | fail | not-assessable`.
* bodyAttributionPresence:
  `correct | absent | false-or-unsupported | not-applicable | not-assessable`.
* bodyCompleteness: `complete | partial | missing | not-assessable`.
* questionCoverage: `answered | missing | not-applicable | not-assessable`.
* readability: `pass | minor | major | not-assessable`.

Technical-invalid packets require all body/screen/surface layers, criteria,
question coverage and readability to be `not-assessable`; appDisplay remains
independently assessable. They still require full reasoned acknowledgment.
Completed-schema answers are not automatically semantic passes.
Whole-screen pass requires bodyMeaning and appDisplay pass; surface pass also
requires no major/unassessable readability dimension.

Scoring correctness, policy decisions and final comparative reporting remain
with the main agent; code checks completeness/binding, not the truth of a
judge's reasoning. AI assessment is not clinical evaluation or adoption approval.