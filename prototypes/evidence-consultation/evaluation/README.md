# Offline small-evaluation budget scaffold

**Dry-run mocks only. Real execution is unconditionally not implemented.**
No SDK, HTTP adapter, secret/env lookup, DB/application import, server, or real
model/pricing default is enabled. Existing answer-provider/policy files are
unchanged. Test data and prices are synthetic, not quotes or production data.
The main agent verified the additional proposed rate card against official
OpenAI pricing, model and prompt-caching pages on **2026-09-18**. It is not
approved for execution or selected by default; account/connection is untested.

## Hard local limits

- One sequential global ledger: at most **20 adapter invocations**, including
  each separate person/group. One packet must have exactly one group.
- **Zero retries**, including errors, timeout and cancellation. Injected mocks
  must not retry/fan out internally.
- Per attempt: **8,000 input / 1,500 output tokens**; cumulative reserved maxima
  **160,000 input / 30,000 output**. The entire packet is serialized unchanged.
  Oversize input is refused, never shortened by dropping originals/context.
- Offline input bound is UTF-8 byte count of that exact serialized string
  (one byte per token upper-bound vocabulary), **not characters divided by 4**.
  This is NOT proof for an arbitrary model/chat encoding. A future integration
  needs a trusted model tokenizer including framing/special tokens or a proved
  byte bound including all overhead. No such integration is enabled here.
- Caller supplies a trusted exact-model allowlist, immutable rate snapshot ID
  and positive safe-integer **microUSD per million tokens**, plus a positive
  integer microUSD spending ceiling no higher than **80,000 ($0.08)**.
  No dynamic rate discovery or defaults.
  Each reservation includes the full 8,000/1,500 maximum, rounded upward using
  integer arithmetic. Reservations are **never refunded**, even on success.
- Reported output tokens must explicitly include reasoning tokens; reasoning
  is a subset, not added twice. No cached-input discount is assumed unless
  complete measured, mutually exclusive uncached/cache-write/cached-read counts
  and trusted corresponding rates are supplied. Cache WRITE replaces the input
  rate for those tokens, never adds to it. Missing breakdown uses the maximum
  input rate and is labeled `input_upper_bound`; measured breakdown is labeled
  `reported_breakdown`. Both are **estimates, not exact invoices**.
  Unknown model/rate/usage, partial/malformed/oversized output, invalid token
  counts, errors or persistence failures stop the runner permanently.
  Buffered output has an additional 24,000-byte limit.

Provider console budget **alerts are not a hard stop** and may arrive late.
These local reservations precede invocation, but cannot constrain independent
callers, provider misreporting, out-of-band charges, or a malicious injected
function. There is no claim of a provider-account-wide invoice ceiling.

### Proposed Standard short-context rate card

`proposed-rates.mjs` records the main-agent-verified `gpt-5.6-luna` alias: uncached
input $0.20/M, cache write $0.25/M (replacement rate), cached read $0.02/M,
and output including reasoning $1.20/M. Reservation uses **$0.25/M input** and
**$1.20/M output**. The proposed cap is **$0.08 = 80,000 microUSD**:
20 × (8,000 × 0.25 + 1,500 × 1.20) / 1,000,000 = **$0.076**.
The catalog alias is not a confirmed immutable snapshot; account availability
is untested. Future approval must specify the exact permitted model string.
Using `prompt_cache_options` explicit mode without any breakpoints to avoid
cache writes remains a proposal until a future adapter validates its semantics.
This scaffold sends no such provider option and does not assume the saving.

## Durable journal and one-shot lock

`createOfflineJournal(absoluteNewDirectory)` exclusively creates a private
directory and journal, fsyncs directory metadata, then writes and fsyncs each
reservation **before invoking the mock**. A second runner cannot claim the
same journal. Concurrent attempts fail rather than queue.

Existing directories always fail: no automatic recovery, stale-lock removal,
resume, read/reset, or refund after a crash, timeout, cancellation, or I/O
failure. Closing leaves the permanent directory lock. A crash between durable
reservation and invocation conservatively consumes capacity. New paths mean
new offline plans; callers must not use them to bypass the intended global
limit. Cross-plan/account coordination is a future prerequisite, not shipped.
Durability assumes a trusted, non-tampered local filesystem honoring fsync;
filesystem rollback, remote filesystems and malicious local writers are not
addressed. Never use a pre-existing user/development-data directory.

Journal entries contain only counters/token usage, limits/prices/rate snapshot,
opaque run/attempt IDs, synthetic `case-NNNN` IDs, and the plan fingerprint.
No request, original, response, person ID, personal text, provider error, stack,
or secret is recorded. Caller-owned case/model/rate identifiers must themselves
be non-sensitive. No response is returned unless usage journaling succeeds.

## Relationship to answer contracts / remaining gates

This is a separate accounting envelope, **not** a replacement for
`executeCandidate`, `validateCandidate`, packet freshness, urgency/applicability
checks, or privacy review. No generated answer is displayed/integrated.
The existing AnswerPacket contains exactly one anonymized group but question
text may still contain PII. Tests use synthetic packets only. Approved originals
and mandatory context remain the policy builder's responsibility.

A 64-hex plan fingerprint is required to identify the offline plan; syntax does
not mean approval. Future real execution requires an independently approved,
authenticated fingerprint binding corpus/cases, prompt/rules, exact model,
tokenization, trusted prices, limits and privacy review. It also needs verified
no-retry transport behavior, billing/usage semantics (including reasoning),
bounded streaming/buffering, real cancellation semantics and account-wide
coordination. Neither a privacy permit nor a fingerprint unlocks real mode.

## Pure local tests

For the owning agent to run (not run during this implementation):

```sh
env -i PATH="$PATH" LANG=C LC_ALL=C TZ=UTC \
  node --import ./prototypes/evidence-consultation/evaluation/offline-lockdown.mjs \
  --test tests/evidence-evaluation-budget.test.mjs
```

The dedicated allowlist blocks network/socket/process/application/DB imports;
fetch and WebSocket are blocked too. No dependencies are installed. Tests use
only mocked transport and newly owned temporary `/tmp` directories, which they
remove themselves. The normal development DB contains protected existing data:
it is never accessed, copied, seeded, cleaned up or used as a fallback.
These tests cover local guard behavior, not a sandbox against hostile code,
provider correctness, filesystem power-loss guarantees, or external billing.

The factory additionally requires the runtime marker installed by this
dedicated offline-lockdown preload; ordinary application runtime is refused.
This lightweight accidental-use guard is not authentication against malicious
code. An arbitrary injected function cannot be sandboxed by an `offline-mock`
kind label. If a mock ignores abort, timeout/cancellation permanently stop the
accounting runner but cannot undo or stop that function's side effects.
There is no real adapter in this scaffold.