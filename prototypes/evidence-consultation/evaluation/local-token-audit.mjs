import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadO200k, O200K_SHA256 } from "./local-tokenizer.mjs";
import { buildLocalRequests } from "./local-token-request.mjs";

if (globalThis[Symbol.for("evidence-local-token.offline-lockdown")] !== true) {
  throw new Error("LOCAL_TOKEN_OFFLINE_LOCKDOWN_REQUIRED");
}

const root = new URL("../../../", import.meta.url);
const tokenizer = loadO200k(new URL(".local/evidence-tokenizer/o200k_base.tiktoken", root));
const { fileValidation, requests } = buildLocalRequests({
  casesPath: new URL("evidence-work/model-evaluation/cases.json", root),
  sourceDirectory: new URL("evidence-work/v0.2", root).pathname.replace(/\/$/, ""),
});

function exact(text) {
  const tokens = tokenizer.encode(text);
  const bytes = Buffer.from(text, "utf8");
  if (!tokenizer.decodeBytes(tokens).equals(bytes)) throw new Error("LOCAL_TOKEN_ROUNDTRIP_FAILED");
  return { exact_local_text_tokens: tokens.length, utf8_byte_upper_bound: bytes.length };
}

const perQ = requests.map((item) => ({
  case_id: item.case_id,
  fixed_instructions: exact(item.components.fixed_instructions),
  question_context_conditions: exact(item.components.question_context_conditions),
  formatting_instructions: exact(item.components.formatting_instructions),
  schema_serialized: exact(item.components.schema_serialized),
  full_request_json: exact(item.request_serialized),
  protocol_overhead_tokens: null,
  full_api_input_bound_guaranteed: false,
  cost_admissible: false,
}));

const payloadArtifact = {
  classification: "internal local-only proposed payloads; never transmitted",
  provider_calls: 0,
  requests: requests.map(({ case_id, request }) => ({ case_id, request })),
};
const payloadBytes = Buffer.from(`${JSON.stringify(payloadArtifact, null, 2)}\n`, "utf8");
const payloadSha256 = createHash("sha256").update(payloadBytes).digest("hex");

const report = {
  schema_version: "local-o200k-text-audit-v1",
  generated_by: "offline local computation; no provider call",
  cases: "Q01-Q11",
  model_prefix_mapping: { model: "gpt-5.6-luna", encoding: "o200k_base", proves_server_serialization: false },
  frozen_payload_file_sha256: payloadSha256,
  tokenizer_data: { sha256: tokenizer.digest, expected_sha256: O200K_SHA256, byte_rank_coverage: 256 },
  source_file_validation: fileValidation,
  per_case: perQ,
  mandatory_context_closure: Object.fromEntries(requests.map((item) => [
    item.case_id, {
      validated: true,
      section_ids: item.mandatory_context_closure,
      text_sha256: item.mandatory_context_text_sha256,
    },
  ])),
  limits: {
    exact_counts_scope: "Each named, locally serialized text only; not an API usage count.",
    utf8_bound_scope: "Local encoded text only. Since all 256 single-byte ranks exist, BPE emits at most one token per UTF-8 byte.",
    protocol_overhead_tokens: null,
    full_api_bound: null,
    blocking_gap: "No official documentation fixes the Responses API server framing, hidden protocol/schema serialization, or its token overhead for this model. Prefix-to-encoding mapping does not define wire serialization.",
    output_parameter: "max_output_tokens includes visible output and reasoning; no max_input_tokens request parameter was found in the cached official parameter reference.",
    context_ceiling_exploration: "A 1,050,000-token context ceiling does not cure unknown framing and does not prove admission. Testing above 272,000 input tokens would exceed the authorized $0.08 budget under the supplied long-context multipliers (worst case above $0.40), so no API test was made.",
    special_tokens: "The literals <|endoftext|> and <|endofprompt|> are rejected.",
    unsupported_text: "Unpaired UTF-16 surrogates and Python/ECMAScript whitespace-difference code points U+001C..U+001F, U+0085, and U+FEFF are rejected rather than estimated.",
  },
};

writeFileSync(new URL("evidence-work/model-evaluation/local-token-payloads.json", root), payloadBytes);
writeFileSync(new URL("evidence-work/model-evaluation/local-token-audit.json", root), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
