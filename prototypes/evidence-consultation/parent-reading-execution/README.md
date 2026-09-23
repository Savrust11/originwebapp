# Parent-reading isolated execution runner

This directory is a new append-only runner. It never imports a CLI, SDK, application,
workflow, database, or old ledger. Importing `runner.mjs` performs no action.

## Preflight inputs

Both files live under
`evidence-work/parent-reading-evaluation/execution-01/preflight`.

`request-packets.json`:

```json
{
  "schemaVersion": 1,
  "packets": [{
    "caseId": "P01",
    "request": {},
    "reserveCentiMicroUSD": 200000,
    "localInputEstimate": {
      "tokenBound": 2800,
      "method": "UTF-8 serialized payload byte length plus 2048 operational proxy; not an invoice guarantee"
    }
  }],
  "pricing": {
    "endpoint": "https://api.openai.com/v1/responses",
    "model": "gpt-5.6-luna",
    "verifiedAt": "ISO-8601 timestamp",
    "ratesCentiMicroUSDPerToken": {
      "input": 20,
      "output": 120,
      "cachedInput": 2,
      "cacheWrite": 25
    },
    "cachePolicy": "explicit-no-reads-or-writes"
  }
}
```

There must be exactly five packets in order `P01, P04, P06, P09, P10`. Each request
must use Luna/default/medium, `max_output_tokens:1500`, `store:false`,
`background:false`, empty tools, disabled truncation, and
`prompt_cache_options:{"mode":"explicit"}`. The only permitted top-level keys are
`model`, `service_tier`, `reasoning`, `max_output_tokens`, `tools`, `store`,
`background`, `truncation`, `prompt_cache_options`, `input`, and `text`. Input is
exactly two `{role,content}` plain-string messages, system then user, with no extra
message keys or link objects. Reasoning and cache objects contain only their required
single fields.

The user string is JSON with `question` and nonempty `original_evidence`; corpus
records may contain `original_id`, `original_text`, `source_id`, `title`, and other
source data. `originalEvidence`/`originalId` is also accepted for source-ID
extraction. The text format is exactly named `parent_reading_answer`, strict JSON
schema, object properties `answer` (string) and `citations` (array of strings),
required `answer,citations`, and `additionalProperties:false`. No
`previous_response_id`, conversation, cache key/retention, temperature, top-p, or
other request field is admitted.

`tokenBound` must be at least
`Buffer.byteLength(JSON.stringify(request), "utf8") + 2048` and at most 32,000.
This is a conservative legacy operational proxy, not an invoice guarantee. Each
reservation is exactly `tokenBound * 25 + 1500 * 120` centiMicroUSD. All five
maximum reservations are admitted before initialization and together must not exceed
5,000,000 centiMicroUSD ($0.05). The cumulative ceiling is 100,000,000 ($1).

`preflight-manifest.json`:

```json
{
  "schemaVersion": 1,
  "audit": { "decision": "authorized", "completedAt": "ISO-8601 timestamp" },
  "historicalClosure": {
    "knownCentiMicroUSD": 36292260,
    "unresolvedCentiMicroUSD": 551250,
    "totalCentiMicroUSD": 36843510,
    "historicalTransmissions": 42
  },
  "bindings": [{
    "path": "root-relative/path",
    "sha256": "64 lowercase hex characters",
    "role": "protocol"
  }]
}
```

Bindings are unique root-relative immutable files. The roles `protocol`, `source`,
`price`, `payload`, `controlcode`, and `historical-closure` must all occur. The
request-packets file itself must be a `payload` binding. Include every new protocol,
source, price, payload, control-code file and the immutable historical closure.
Initialization stores the manifest hash and rechecks all bindings on every command.
The manifest is prepared only after the independent audit authorizes execution.

## Commands

```sh
node prototypes/evidence-consultation/parent-reading-execution/cli.mjs init
node prototypes/evidence-consultation/parent-reading-execution/cli.mjs status
node prototypes/evidence-consultation/parent-reading-execution/cli.mjs next
node prototypes/evidence-consultation/parent-reading-execution/cli.mjs close "operator closure reason"
```

Each `next` can make exactly one network attempt. There is no loop, retry,
replacement model, cache tool, fallback, or extra API call. A durable reservation
and sealed request precede the sole fetch. Only that live path reads
`OPENAI_API_KEY`. Transport, provider, control, price, uncertain usage, cache, and
budget failures retain the reservation and globally stop. Invalid/empty JSON,
unsupported citations, and incomplete content are case failures and permit the next
explicit case when usage and controls remain certain. Unknown inert metadata is
hash/digest evidence rather than a stop. `close` releases unspent authorization with
`noRepurpose:true`; historical calls are report-only and never become slots.
