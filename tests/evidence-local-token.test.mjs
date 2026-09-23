import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadO200k, O200K_SHA256 } from "../prototypes/evidence-consultation/evaluation/local-tokenizer.mjs";
import { buildLocalRequests } from "../prototypes/evidence-consultation/evaluation/local-token-request.mjs";

const root = new URL("../", import.meta.url);
const tokenizer = loadO200k(new URL(".local/evidence-tokenizer/o200k_base.tiktoken", root));

test("verified public data and official o200k cookbook vectors", () => {
  assert.equal(tokenizer.digest, O200K_SHA256);
  const vectors = [
    ["antidisestablishmentarianism", [493, 129901, 376, 160388, 21203, 2367]],
    ["2 + 2 = 4", [17, 659, 220, 17, 314, 220, 19]],
    ["お誕生日おめでとう", [8930, 9697, 243, 128225, 8930, 17693, 4344, 48669]],
  ];
  for (const [text, expected] of vectors) {
    const actual = tokenizer.encode(text);
    assert.deepEqual(actual, expected);
    assert.deepEqual(tokenizer.decodeBytes(actual), Buffer.from(text, "utf8"));
  }
});

test("rejects unsupported special literals, surrogates, and whitespace divergence", () => {
  for (const text of ["x<|endoftext|>y", "x<|endofprompt|>y", "\ud800", "\udc00", "\u001c", "\u0085", "\ufeff"]) {
    assert.throws(() => tokenizer.encode(text));
  }
});

test("Q01-Q11 payloads are complete, frozen in scope, and round trip", () => {
  const canonical = JSON.parse(
    readFileSync(
      new URL("evidence-work/model-evaluation/cases.json", root), "utf8",
    ),
  );
  const { fileValidation, requests } = buildLocalRequests({
    casesPath: new URL("evidence-work/model-evaluation/cases.json", root),
    sourceDirectory: new URL("evidence-work/v0.2", root).pathname.replace(/\/$/, ""),
  });
  assert.equal(Object.keys(fileValidation).length, 4);
  assert.deepEqual(requests.map((item) => item.case_id), [
    "Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11",
  ]);
  for (const item of requests) {
    const tokens = tokenizer.encode(item.request_serialized);
    assert.ok(tokens.length > 0);
    assert.deepEqual(tokenizer.decodeBytes(tokens), Buffer.from(item.request_serialized, "utf8"));
    assert.deepEqual(Object.keys(item.request).sort(), [
      "background", "input", "max_output_tokens", "model", "prompt_cache_options",
      "reasoning", "service_tier", "store", "text", "tools", "truncation",
    ].sort());
    assert.equal(item.request.model, "gpt-5.6-luna");
    assert.equal(item.request.background, false);
    assert.equal(item.request.store, false);
    assert.equal(item.request.max_output_tokens, 1500);
    assert.deepEqual(item.request.reasoning, { effort: "medium" });
    assert.deepEqual(item.request.prompt_cache_options, { mode: "explicit" });
    assert.equal(item.request.truncation, "disabled");
    assert.deepEqual(item.request.tools, []);
    assert.equal(item.request.service_tier, "default");
    assert.equal("max_input_tokens" in item.request, false);
    assert.equal("previous_response_id" in item.request, false);
    assert.equal(item.request_serialized.includes("prompt_cache_breakpoint"), false);
    const serialized = item.request_serialized;
    for (const forbidden of ["reviewer", "localdigest", "answer_key", "must_include", '"url"']) {
      assert.equal(serialized.includes(forbidden), false);
    }
    const body = JSON.parse(item.request.input[1].content);
    assert.deepEqual(Object.keys(body).sort(), [
      "fictional_target_conditions", "formatting_instructions", "question", "source_context",
    ].sort());
    const projection = body.fictional_target_conditions;
    assert.deepEqual(Object.keys(projection).sort(),
      item.case_id === "Q08" || item.case_id === "Q09"
        ? ["fictional", "source_required_caregiver_context", "target"].sort()
        : ["fictional", "target"].sort());
    assert.match(projection.target.subject_token,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal("id" in projection.target, false);
    assert.equal("persons" in projection, false);
    const sourceCase = canonical.cases.find(({ id }) => id === item.case_id);
    const sourceTarget = sourceCase.persons.find((person) =>
      sourceCase.target === "caregiver" ? person.role === "caregiver" : person.role === "child");
    assert.deepEqual(projection.target.age, sourceTarget.age);
    assert.deepEqual(projection.target.known, sourceTarget.known);
    assert.deepEqual(projection.target.unknown, sourceTarget.unknown);
    if (item.case_id === "Q08" || item.case_id === "Q09") {
      assert.deepEqual(projection.source_required_caregiver_context,
        { diagnosed_illness_or_disability: "absent" });
    }
    for (const citation of body.source_context.citations) {
      assert.deepEqual(Object.keys(citation).sort(), [
        "locator", "original_text", "revision_date", "section_id", "source_annotation",
        "source_id", "version", "version_of_record_date",
      ].sort());
      if (citation.source_id === "E02") assert.equal(citation.revision_date, "2024-09-18");
      if (citation.source_id === "E04") assert.equal(citation.version_of_record_date, "2026-07-16");
    }
    assert.deepEqual(new Set(item.mandatory_context_closure),
      new Set(sourceCase.necessary_citations));
    assert.deepEqual(Object.keys(item.mandatory_context_text_sha256).sort(),
      [...sourceCase.necessary_citations].sort());
  }
});

test("lockdown marker is present and network adapter is disabled", async () => {
  assert.equal(globalThis[Symbol.for("evidence-local-token.offline-lockdown")], true);
  await assert.rejects(fetch("https://example.invalid"), /LOCAL_TOKEN_NETWORK_BLOCKED/);
});