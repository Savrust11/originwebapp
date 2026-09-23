import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ClaimCitationError,
  assembleClaimCitations,
  transformLegacyCitationDisplay,
  validateClaimAnswer,
} from "../prototypes/evidence-consultation/evaluation/claim-citations.mjs";
import {
  AASM_SUPPLEMENT_DECISION,
  buildRoleSeparatedRequests,
  CLAIM_OUTPUT_SCHEMA,
} from "../prototypes/evidence-consultation/evaluation/role-separated-request.mjs";

const casesPath = "evidence-work/model-evaluation/cases.json";
const sourceDirectory = "evidence-work/v0.2";
const prepared = () => buildRoleSeparatedRequests({ casesPath, sourceDirectory });
const answer = {
  explanations: [{ text: "AASMは1〜2歳児に11〜14時間を推奨しています。", original_ids: ["E02-F-S01-S02-SHARED"] }],
  limitations: [{ text: "提示原文だけでは夜間のみか24時間合計か確認できません。", original_ids: [] }],
  abstention: { applies: true, text: "時間の集計範囲については回答を控えます。", original_ids: [] },
};

test("Q05-Q11 requests retain provider controls and separate information roles", () => {
  const { requests } = prepared();
  assert.deepEqual(requests.map(item => item.case_id), ["Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11"]);
  for (const item of requests) {
    assert.equal(item.request.model, "gpt-5.6-luna");
    assert.equal(item.request.max_output_tokens, 1500);
    assert.equal(item.request.store, false);
    assert.equal(item.request.background, false);
    assert.equal(item.request.truncation, "disabled");
    assert.deepEqual(item.request.tools, []);
    const payload = JSON.parse(item.request.input[1].content);
    assert(Array.isArray(payload.original_evidence));
    assert(payload.applicability);
    assert(Array.isArray(payload.applicability.persons));
    assert(payload.applicability.persons.every(person =>
      person.health && Array.isArray(person.known) && Array.isArray(person.unknown)));
    assert(!("expected_output_note" in payload));
    assert(Array.isArray(payload.applicability.source_applicability));
    assert(item.administrative_ids.length > 0);
    assert(item.administrative_ids.every(id => !item.request_serialized.includes(`"${id}"`)));
    assert(!item.request_serialized.includes("editorial_notes"));
    assert(!item.request_serialized.includes("allowed_role"));
    assert(!item.request_serialized.includes("verification_reference_ids"));
    assert(!item.request_serialized.includes("publication_status"));
    assert(!item.request_serialized.includes("診断には使用しない"));
    for (const original of payload.original_evidence)
      assert.deepEqual(Object.keys(original).sort(), ["original_id", "original_text"]);
  }
  assert.equal(CLAIM_OUTPUT_SCHEMA.properties.explanations.items.properties.original_ids.minItems, 1);
});

test("Q05 is conservative without a separately licensed AASM original", () => {
  const { catalog, requests } = prepared();
  const q05 = requests.find(item => item.case_id === "Q05");
  const payload = JSON.parse(q05.request.input[1].content);
  assert.deepEqual(q05.retrieved_original_ids, ["E02-F-S01-S02-SHARED"]);
  assert.equal(q05.reference_metadata[0].metadata_id, "E02-C-REFERENCE-5");
  assert.equal(q05.reference_metadata[0].citable, false);
  assert.match(q05.reference_metadata[0].original_text, /Paruthi S/);
  assert.match(q05.reference_metadata[0].locator, /参考文献5/);
  assert.equal(catalog["E02-C-REFERENCE-5"].citable, false);
  assert.equal(AASM_SUPPLEMENT_DECISION.model_input, "no_aasm_prose");
  assert.match(AASM_SUPPLEMENT_DECISION.status, /^pending_rights/);
  assert(!("expected_output_note" in payload));
  assert(!q05.request_serialized.includes("昼寝を含む24時間合計"));
});

test("Q06 does not turn an editorial nap note into evidence", () => {
  const q06 = prepared().requests.find(item => item.case_id === "Q06");
  const payload = JSON.parse(q06.request.input[1].content);
  assert(!("expected_output_note" in payload));
  assert(!q06.request_serialized.includes("時間は昼寝を含む24時間合計"));
});

test("supplements remain disabled pending a separate full ingestion review", () => {
  assert.throws(() => buildRoleSeparatedRequests({
    casesPath, sourceDirectory, caseIds: ["Q05"],
    supplementalOriginalEvidence: { Q05: [{ original_id: "AASM-X", original_text: "text" }] },
  }), /ROLE_SUPPLEMENTS_DISABLED/);
  assert.throws(() => buildRoleSeparatedRequests({
    casesPath, sourceDirectory, caseIds: ["Q05"],
    supplementalOriginalEvidence: { Q05: [{
      original_id: "AASM-X",
      original_text: "text",
      rights_status: "verified_for_text_extraction",
      external_ai_use_status: "verified",
      text_sha256: "claimed-but-caller-controlled",
      rights_review_provenance: "claimed-but-caller-controlled",
      catalog_metadata: {
        source_id: "AASM",
        title: "title",
        version: "version",
        locator: "locator",
        url: "https://example.invalid",
      },
    }] },
  }), /ROLE_SUPPLEMENTS_DISABLED/);
});

test("all fictional people and source-required health context are preserved", () => {
  const requests = prepared().requests;
  const q08 = JSON.parse(requests.find(item => item.case_id === "Q08").request.input[1].content);
  assert.equal(q08.applicability.persons.length, 2);
  assert.equal(q08.applicability.persons[0].health.diagnosed_illness_or_disability, "absent");
  assert.equal(q08.applicability.persons[1].health.diagnosed_illness_or_disability, "absent");
  assert.equal(q08.applicability.source_required_target_health.diagnosed_illness_or_disability, "absent");
  assert.equal(q08.applicability.source_required_caregiver_context.diagnosed_illness_or_disability, "absent");
  const q10 = JSON.parse(requests.find(item => item.case_id === "Q10").request.input[1].content);
  assert.equal(
    q10.applicability.source_required_target_health
      .diagnosed_medical_condition_affecting_growth_development_or_behavior,
    "absent",
  );
});

test("diagnostic constraints are app-owned notices, not source conclusions", () => {
  const q05 = prepared().requests.find(item => item.case_id === "Q05");
  assert(q05.service_notices.some(text => text.includes("睡眠障害の診断")));
  assert(!q05.request_serialized.includes("睡眠障害の診断"));
  const q08 = prepared().requests.find(item => item.case_id === "Q08");
  const payload = JSON.parse(q08.request.input[1].content);
  assert(payload.applicability.source_applicability[0].population_exclusions
    .some(text => text.includes("diagnosed illness/disability populations")));
});

test("English exclusions preserve comma-delimited medical-condition phrases", () => {
  const q10 = prepared().requests.find(item => item.case_id === "Q10");
  const payload = JSON.parse(q10.request.input[1].content);
  assert(payload.applicability.source_applicability[0].population_exclusions.includes(
    "children with a diagnosed medical condition affecting growth, development, or behavior",
  ));
  assert(!payload.applicability.source_applicability[0].population_exclusions.includes("development"));
  assert(q10.service_notices.some(text => text.includes("individual treatment advice")));
});

test("app validates IDs and assembles verified numbered metadata per claim", () => {
  const { catalog } = prepared();
  const rendered = assembleClaimCitations(answer, catalog, {
    retrievedOriginalIds: ["E02-F-S01-S02-SHARED"],
    administrativeIds: ["E02-S01"],
    serviceNotices: ["診断や個別助言を行うサービスではありません。"],
  });
  assert.deepEqual(rendered.explanations[0].citation_numbers, [1]);
  assert.equal(rendered.references[0].title, "健康づくりのための睡眠ガイド2023");
  assert.match(rendered.references[0].locator, /印刷p\.15/);
  assert.match(rendered.references[0].url, /^https:/);
  assert.equal(rendered.service_notices[0].provenance, "service_policy_not_source_conclusion");
  assert.equal(rendered.abstention.applies, true);
  assert.equal(rendered.semantic_review_required, true);
});

test("unknown, administrative, unretrieved and empty factual IDs are rejected", () => {
  const base = { retrievedOriginalIds: ["ORIGINAL"], catalogOriginalIds: ["ORIGINAL"], administrativeIds: ["ADMIN"] };
  const withIds = ids => ({ ...answer, explanations: [{ text: "fact", original_ids: ids }] });
  for (const [ids, code] of [
    [[], "factual_claim_requires_original_id"],
    [["MISSING"], "unknown_original_id"],
    [["ADMIN"], "administrative_id_not_citable"],
  ]) assert.throws(() => validateClaimAnswer(withIds(ids), base),
    error => error instanceof ClaimCitationError && error.code === code);
  assert.throws(() => validateClaimAnswer(withIds(["ORIGINAL"]), {
    ...base, retrievedOriginalIds: [],
  }), error => error.code === "unretrieved_original_id");
});

test("the preserved Q05 failure is rejected rather than reinterpreted", () => {
  const failed = JSON.parse(readFileSync("evidence-work/model-evaluation/operational-results/Q05.json"));
  assert.throws(() => validateClaimAnswer(failed.answer, {
    retrievedOriginalIds: ["E02-F-S01-S02-SHARED"],
    catalogOriginalIds: ["E02-F-S01-S02-SHARED"],
    administrativeIds: ["E02-S01"],
  }), error => error.code === "claim_answer_schema_invalid");
  assert.equal(failed.answer.citations[1].section_id, "E02-S01");
});

test("legacy Q03 display is transformed without fabricated claim attribution", () => {
  const q03 = JSON.parse(readFileSync("evidence-work/model-evaluation/operational-results/Q03.json"));
  const { catalog } = prepared();
  const display = transformLegacyCitationDisplay(q03.answer, catalog);
  assert.equal(display.provenance, "legacy_answer_level_citations_only");
  assert.equal(display.claim_links, null);
  assert.equal(display.references.length, 3);
  assert.match(display.warning, /後付けしていません/);
  assert.equal(display.semantic_review_required, true);
});