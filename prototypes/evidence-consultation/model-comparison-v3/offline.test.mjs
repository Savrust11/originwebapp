import "../model-comparison-v2/offline-lockdown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import dns from "node:dns";
import childProcess from "node:child_process";
import {
  inspectAnswerText,
  validateAnswer,
  validateAnswerStructure,
  validateAnswerCitations,
  validateAnswerIdentity,
  VALIDATOR_VERSION,
} from "./answer-validation.mjs";
import { inspectResponse, reserve } from "./controls.mjs";
import { validateAnswer as validateV1Answer } from "../model-comparison-execution/controls.mjs";

const packetsUrl = new URL(
  "../../../evidence-work/model-comparison-preparation/reading-comparison-01/request-packets.json",
  import.meta.url,
);
const packets = JSON.parse(fs.readFileSync(packetsUrl, "utf8"));
const sourceContent = JSON.parse(fs.readFileSync(new URL(
  "../../../evidence-work/model-comparison-preparation/reading-comparison-01/source-content.json",
  import.meta.url,
), "utf8"));
const packet = packets.requests.find(value => value.caseId === "C-K08");
const request = packet.requests[0];
const sourceIds = JSON.parse(request.input.find(value => value.role === "user").content)
  .original_evidence.map(value => value.original_id);
const riskId = "E03-C-RISK-OF-BIAS";

const answer = () => ({
  explanations: [{
    text: `${riskId} に記載された合成上の注意点を考慮する。`,
    original_ids: [riskId],
  }],
  limitations: [{
    text: "合成テストでは適用範囲を限定する。",
    original_ids: ["E03-C-LIMITATIONS"],
  }],
  abstention: { applies: false, text: "", original_ids: [] },
});

function envelope(value = answer()) {
  const { input, ...settings } = structuredClone(request);
  return {
    ...settings,
    id: "resp_SYNTHETIC",
    object: "response",
    created_at: 1,
    completed_at: 2,
    reasoning: {
      effort: "medium", summary: null, generate_summary: null,
      context: "all_turns", mode: null,
    },
    text: {
      ...settings.text,
      format: { ...settings.text.format, description: null },
      verbosity: "medium",
    },
    prompt_cache_options: {
      mode: "explicit", ttl: "30m", prewarm: false,
      comparison_response_id: null,
    },
    prompt_cache_key: null,
    prompt_cache_retention: "24h",
    prompt_cache_diagnostics: null,
    instructions: null,
    previous_response_id: null,
    conversation: null,
    prompt: null,
    moderation: null,
    safety_identifier: null,
    user: null,
    tool_choice: "auto",
    parallel_tool_calls: true,
    max_tool_calls: null,
    temperature: 1,
    top_p: 0.98,
    top_logprobs: 0,
    status: "completed",
    error: null,
    incomplete_details: null,
    metadata: {},
    billing: { pricing_details: { extra_value: "SYNTHETIC-BILLING" } },
    frequency_penalty: 0,
    presence_penalty: 0,
    routing_metadata: { protocol_version: "SYNTHETIC-VERSION" },
    output: [
      {
        id: "rs_SYNTHETIC", type: "reasoning", status: "completed",
        summary: [], content: [], encrypted_content: "SYNTHETIC-CIPHERTEXT",
      },
      {
        id: "msg_SYNTHETIC", type: "message", role: "assistant",
        status: "completed", phase: "final_answer",
        content: [{
          type: "output_text", annotations: [], logprobs: [],
          text: JSON.stringify(value),
        }],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 5 },
    },
  };
}

const inspect = (body, context = {}) =>
  inspectResponse(body, request, reserve(request), 200, context);

test("offline guard blocks fetch, sockets, listeners, child processes, and DNS", () => {
  const denied = /offline_network_or_process_forbidden/;
  assert.throws(() => fetch("https://invalid.example"), denied);
  assert.throws(() => net.connect(443, "invalid.example"), denied);
  assert.throws(() => net.createServer().listen(0), denied);
  assert.throws(() => childProcess.spawn("printf", ["no"]), denied);
  assert.throws(() => dns.lookup("invalid.example", () => {}), denied);
  assert.throws(() => dns.resolve("invalid.example", () => {}), denied);
  assert.throws(() => dns.promises.resolve4("invalid.example"), denied);
});

test("fixture covers every exact public source ID in the frozen requests", () => {
  const ids = new Set(packets.requests.flatMap(value => value.requests.flatMap(candidate => {
    const user = JSON.parse(candidate.input.find(item => item.role === "user").content);
    return user.original_evidence.map(evidence => evidence.original_id);
  })));
  assert.deepEqual([...ids].sort(), [
    "E02-F-S01-S02-SHARED",
    "E03-C-ELIGIBILITY",
    "E03-C-LIMITATIONS",
    "E03-C-RISK-OF-BIAS",
    "E03-C-STUDY-CHARACTERISTICS",
    "E03-F-S01",
    "E03-F-S02",
    "E04-C-ELIGIBILITY",
    "E04-C-METHODOLOGICAL-LIMITATIONS",
    "E04-C-PROTOCOL-DEVIATIONS",
    "E04-C-REVIEW-LIMITATIONS",
    "E04-C-STUDY-CHARACTERISTICS",
    "E04-F-S01",
    "E04-F-S02",
  ]);
  assert.equal(ids.size, 14);
  assert.deepEqual(Object.keys(sourceContent.originals).sort(), [...ids].sort());
});

test("pure validators keep structure, citation, identity, and JSON checks separate", () => {
  const unknown = answer();
  unknown.explanations[0].original_ids = ["E99-C-UNKNOWN"];
  assert.equal(validateAnswerStructure(unknown), unknown);
  assert.throws(() => validateAnswerCitations(unknown, sourceIds), /answer_citation_unknown/);

  const leaked = answer();
  leaked.limitations[0].text = "api key: SYNTHETIC";
  assert.equal(validateAnswerStructure(leaked), leaked);
  assert.equal(validateAnswerCitations(leaked, sourceIds), leaked);
  assert.throws(() => validateAnswerIdentity(leaked, sourceIds), /answer_secret_leak/);
  assert.throws(() => validateAnswer(leaked, sourceIds), /answer_secret_leak/);

  const malformed = inspectAnswerText("{ malformed", sourceIds);
  assert.deepEqual(malformed.checks, {
    json: "fail", structure: "not-run", citations: "not-run",
    secrets: "pass", modelIdentity: "pass",
  });
  assert.deepEqual(malformed.reasons, ["answer_json_invalid"]);

  const badShape = inspectAnswerText(JSON.stringify({ explanations: [] }), sourceIds);
  assert.equal(badShape.checks.json, "pass");
  assert.equal(badShape.checks.structure, "fail");
  assert.equal(badShape.checks.citations, "not-run");
  assert.ok(badShape.reasons.includes("answer_schema_invalid"));
});

test("normal answer cites and discusses the risk source and passes validation", () => {
  const diagnostic = inspectAnswerText(JSON.stringify(answer()), sourceIds);
  assert.equal(diagnostic.validatorVersion, VALIDATOR_VERSION);
  assert.equal(diagnostic.valid, true);
  assert.deepEqual(diagnostic.reasons, []);
  assert.deepEqual(diagnostic.checks, {
    json: "pass", structure: "pass", citations: "pass",
    secrets: "pass", modelIdentity: "pass",
  });
  assert.ok(diagnostic.answer.explanations[0].text.includes(riskId));
  assert.ok(diagnostic.answer.explanations[0].original_ids.includes(riskId));
});

test("frozen v1 false-positive remains demonstrated without changing its behavior", () => {
  assert.throws(() => validateV1Answer(answer(), sourceIds), /answer_identity_leak/);
  assert.doesNotThrow(() => validateAnswer(answer(), sourceIds));
});

test("unknown and cross-request IDs are rejected in every clause", async t => {
  for (const [name, mutate] of [
    ["explanation unknown", value => value.explanations[0].original_ids = ["E99-C-UNKNOWN"]],
    ["explanation cross-request", value => value.explanations[0].original_ids = ["E04-F-S01"]],
    ["limitation unknown", value => value.limitations[0].original_ids = ["E99-C-UNKNOWN"]],
    ["limitation cross-request", value => value.limitations[0].original_ids = ["E04-F-S01"]],
    ["abstention unknown", value => value.abstention.original_ids = ["E99-C-UNKNOWN"]],
    ["abstention cross-request", value => value.abstention.original_ids = ["E04-F-S01"]],
  ]) await t.test(name, () => {
    const value = answer();
    mutate(value);
    const result = inspectAnswerText(JSON.stringify(value), sourceIds);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes("answer_citation_unknown"));
    assert.equal(result.checks.citations, "fail");
  });
});

test("each explanation requires at least one citation", () => {
  const value = answer();
  value.explanations.push({ text: "根拠のない合成説明。", original_ids: [] });
  const result = inspectAnswerText(JSON.stringify(value), sourceIds);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("answer_citation_missing"));
  assert.equal(result.checks.structure, "pass");
  assert.equal(result.checks.citations, "fail");
});

test("secret forms in decoded clause values and keys are rejected", async t => {
  for (const [name, mutate] of [
    ["synthetic sk prefix", value => value.explanations[0].text = "sk-synthetic"],
    ["bearer tab", value => value.limitations[0].text = "Bearer\tSYNTHETIC"],
    ["bearer newline", value => value.abstention.text = "Bearer\nSYNTHETIC"],
    ["api key label", value => value.explanations[0].text = "API key: SYNTHETIC"],
    ["api_key key", value => value.limitations[0].api_key = "SYNTHETIC"],
  ]) await t.test(name, () => {
    const result = inspectAnswerText(JSON.stringify(mutateAndReturn(answer(), mutate)), sourceIds);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes("answer_secret_leak"));
    assert.equal(result.checks.secrets, "fail");
  });
});

test("model identity is rejected in every clause location, including invalid schema keys", async t => {
  for (const [name, mutate] of [
    ["explanation text", value => value.explanations[0].text = "gpt-9"],
    ["explanation ID", value => value.explanations[0].original_ids = ["openai"]],
    ["limitation text", value => value.limitations[0].text = "Luna"],
    ["limitation ID", value => value.limitations[0].original_ids = ["Sol"]],
    ["abstention text", value => value.abstention.text = "ルナ"],
    ["abstention ID", value => value.abstention.original_ids = ["ソル"]],
    ["extra-field key", value => value.explanations[0]["openai-model"] = "synthetic"],
  ]) await t.test(name, () => {
    const value = answer();
    mutate(value);
    const result = inspectAnswerText(JSON.stringify(value), sourceIds);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes("answer_model_identity_leak"));
    assert.equal(result.checks.modelIdentity, "fail");
    if (name === "extra-field key") {
      assert.ok(result.reasons.includes("answer_schema_invalid"));
      assert.equal(result.checks.structure, "fail");
    }
  });
});

test("public ID exemptions are exact and never exempt an exact credential", () => {
  const exactCredential = inspectAnswerText(JSON.stringify(answer()), sourceIds, {
    credential: riskId,
  });
  assert.ok(exactCredential.reasons.includes("answer_secret_leak"));

  for (const tampered of [`sk-${riskId}`, `${riskId}-api-key`, `prefix_${riskId}`]) {
    const value = answer();
    value.explanations[0].text = tampered;
    const result = inspectAnswerText(JSON.stringify(value), sourceIds);
    assert.ok(result.reasons.includes("answer_secret_leak"), tampered);
  }
});

test("full good response passes with answer diagnostics but no answer copy in diagnostics", () => {
  const result = inspect(envelope());
  assert.deepEqual(result.stopReasons, []);
  assert.deepEqual(result.caseReasons, []);
  assert.equal(result.technicalState, "completed-schema");
  assert.equal(result.answerValidation.valid, true);
  assert.equal(result.answerValidation.validatorVersion, VALIDATOR_VERSION);
  assert.equal(Object.hasOwn(result.answerValidation, "answer"), false);
  assert.deepEqual(result.answer, answer());
  assert.ok(result.measured);
});

test("rejected answers are removed while detailed case reasons remain", async t => {
  for (const [name, outputText, reason] of [
    ["JSON", "{ invalid", "answer_json_invalid"],
    ["schema", JSON.stringify({ explanations: [] }), "answer_schema_invalid"],
    ["citation", JSON.stringify(mutateAndReturn(answer(),
      value => value.explanations[0].original_ids = ["E99-C-UNKNOWN"])), "answer_citation_unknown"],
  ]) await t.test(name, () => {
    const body = envelope();
    body.output[1].content[0].text = outputText;
    const result = inspect(body);
    assert.equal(result.outputText, "");
    assert.equal(result.answer, null);
    assert.equal(result.technicalState, "technical-invalid");
    assert.ok(result.caseReasons.includes(reason));
    assert.ok(result.answerValidation.reasons.includes(reason));
  });
});

test("exact credential anywhere in the body returns only a safe rejected answer surface", async t => {
  const credential = "SYNTHETIC-CREDENTIAL-DO-NOT-RETAIN";
  for (const [name, mutate] of [
    ["value", body => body.metadata.note = credential],
    ["decoded key", body => body.metadata[`prefix-${credential}`] = "synthetic"],
    ["generated answer", body => body.output[1].content[0].text =
      JSON.stringify(mutateAndReturn(answer(), value => value.limitations[0].text = credential))],
  ]) await t.test(name, () => {
    const body = envelope();
    mutate(body);
    const result = inspect(body, { credential });
    assert.deepEqual(result.caseReasons, ["answer_secret_leak"]);
    assert.deepEqual(result.stopReasons, ["B:credential_echo"]);
    assert.equal(result.outputText, "");
    assert.equal(result.answer, null);
    assert.equal(JSON.stringify(result).includes(credential), false);
  });
});

test("stored diagnostic serialization retains safe causes but no rejected text", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "comparison-v3-diagnostic-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const offending = "api key: SYNTHETIC-OFFENDING-VALUE";
  const leaked = answer();
  leaked.explanations[0].text = offending;
  const result = inspect(envelope(leaked));
  const serialized = JSON.stringify(result.answerValidation);
  assert.equal(serialized.includes(offending), false);
  assert.equal(serialized.includes("SYNTHETIC-OFFENDING-VALUE"), false);
  assert.equal(Object.hasOwn(result.answerValidation, "answer"), false);
  const diagnosticPath = path.join(temporary, "failure.json");
  fs.writeFileSync(diagnosticPath, `${JSON.stringify(result, null, 2)}\n`);
  const stored = JSON.parse(fs.readFileSync(diagnosticPath, "utf8"));
  assert.ok(stored.caseReasons.includes("answer_secret_leak"));
  assert.ok(stored.answerValidation.reasons.includes("answer_secret_leak"));
  assert.equal(stored.outputText, "");
  assert.equal(stored.answer, null);
  assert.equal(JSON.stringify(stored).includes(offending), false);
  assert.equal(JSON.stringify(stored).includes("SYNTHETIC-OFFENDING-VALUE"), false);

  const malformedBody = envelope();
  const malformed = '{"SYNTHETIC-PARSER-MARKER":';
  malformedBody.output[1].content[0].text = malformed;
  const parserResult = inspect(malformedBody);
  const parserSerialized = JSON.stringify(parserResult.answerValidation);
  assert.equal(parserSerialized.includes("SYNTHETIC-PARSER-MARKER"), false);
  assert.deepEqual(parserResult.answerValidation.reasons, ["answer_json_invalid"]);
});

test("completion, control-failure, and cost behavior remain independent", () => {
  const incompleteBody = envelope();
  incompleteBody.status = "incomplete";
  incompleteBody.incomplete_details = { reason: "max_output_tokens" };
  const incomplete = inspect(incompleteBody);
  assert.ok(incomplete.caseReasons.includes("not_completed"));
  assert.deepEqual(incomplete.stopReasons, []);
  assert.ok(incomplete.measured);
  assert.equal(incomplete.answer, null);

  const controlBody = envelope();
  controlBody.store = true;
  const control = inspect(controlBody);
  assert.ok(control.stopReasons.some(reason => reason.startsWith("A:")));
  assert.ok(control.measured);
  assert.equal(control.answer, null);

  const noUsageBody = envelope();
  delete noUsageBody.usage;
  const noUsage = inspect(noUsageBody);
  assert.ok(noUsage.stopReasons.some(reason => reason.startsWith("B:")));
  assert.equal(noUsage.measured, null);
  assert.equal(noUsage.retainReservation, true);
  assert.equal(noUsage.answer, null);
});

function mutateAndReturn(value, mutate) {
  mutate(value);
  return value;
}