import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
const CATALOG_PATH =
  "evidence-work/parent-reading-evaluation/fact-display-pilot-01/fact-catalog.json";
const SOURCE_CONTENT_PATH =
  "evidence-work/parent-reading-evaluation/execution-01/preflight/source-content.json";
const PACKETS_PATH =
  "evidence-work/parent-reading-evaluation/execution-01/preflight/request-packets.json";
const PLAN_PATH =
  "evidence-work/parent-reading-evaluation/preparation-01/plan.json";
const SOURCE_IDS = ["E02", "E03", "E04"];
const CASE_IDS = ["P01", "P04", "P06", "P10"];
const FACT_IDS = [
  "sleep-guidance",
  "interaction-results",
  "caregiver-mood",
  "screen-duration",
  "screen-sleep",
];
const UNITS = new Set([
  "hours",
  "SMD",
  "p_value",
  "percent_I2",
  "Cohens_d",
  "minutes_per_day",
  "studies",
  "interventions",
]);
const AGE_BASES = new Set([
  "個人の年齢帯（1〜2歳）",
  "研究集団の平均年齢（個人の年齢範囲ではない）",
]);
const NUMERIC_PROJECTION = {
  "sleep-guidance": [["推奨睡眠時間の下限", 11, "hours"], ["推奨睡眠時間の上限", 14, "hours"]],
  "interaction-results": [["統合標準化平均差", 0.39, "SMD"], ["95%信頼区間下限", 0.24, "SMD"], ["95%信頼区間上限", 0.53, "SMD"], ["異質性", 93, "percent_I2"]],
  "caregiver-mood": [["統合標準化平均差", -0.07, "SMD"], ["95%信頼区間下限", -0.16, "SMD"], ["95%信頼区間上限", 0.02, "SMD"], ["P値", 0.08, "p_value"], ["異質性", 76, "percent_I2"]],
  "screen-duration": [["統合効果量", -0.92, "Cohens_d"], ["平均差換算", 38, "minutes_per_day"], ["異質性", 96.56, "percent_I2"]],
  "screen-sleep": [["睡眠特性を報告した研究数", 5, "studies"], ["何らかの睡眠改善を報告した介入数", 3, "interventions"]],
};

function fail(message) {
  throw new Error(`fact-display-pilot validation failed: ${message}`);
}

function requireValue(value, message) {
  if (value === undefined || value === null || value === "") fail(message);
}

function requireText(value, message) {
  if (typeof value !== "string" || value.trim() === "") fail(message);
}

function requireTextArray(value, message, allowEmpty = false) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    fail(message);
  }
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readJson(root, relativePath) {
  let text;
  try {
    text = readFileSync(path.resolve(root, relativePath), "utf8");
  } catch (error) {
    fail(`cannot read ${relativePath}: ${error.message}`);
  }
  try {
    return { value: JSON.parse(text), text };
  } catch (error) {
    fail(`invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function validateFactShape(fact) {
  for (const key of [
    "id",
    "title",
    "sourceId",
    "unitId",
    "summary",
    "result",
  ]) {
    requireText(fact[key], `${fact.id || "fact"}.${key} must be text`);
  }
  if (!FACT_IDS.includes(fact.id)) fail(`unexpected fact id ${fact.id}`);
  if (!fact.summary.includes("編集固定文")) {
    fail(`${fact.id}.summary must identify the fixed editorial description`);
  }
  if (!Array.isArray(fact.quantities) || fact.quantities.length === 0) {
    fail(`${fact.id}.quantities must not be empty`);
  }
  for (const [index, quantity] of fact.quantities.entries()) {
    requireText(quantity.label, `${fact.id}.quantities[${index}].label missing`);
    if (typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) {
      fail(`${fact.id}.quantities[${index}].value must be a finite number`);
    }
    if (!UNITS.has(quantity.unit)) {
      fail(`${fact.id}.quantities[${index}] has unsupported unit ${quantity.unit}`);
    }
    requireText(quantity.measurementTarget, `${fact.id}.quantities[${index}].measurementTarget missing`);
    requireText(quantity.aggregationScope, `${fact.id}.quantities[${index}].aggregationScope missing`);
    if (
      quantity.ageBasis !== undefined &&
      !AGE_BASES.has(quantity.ageBasis)
    ) {
      fail(`${fact.id}.quantities[${index}].ageBasis is unsupported`);
    }
  }
  const population = fact.population;
  if (!population || typeof population !== "object") {
    fail(`${fact.id}.population missing`);
  }
  requireText(population.description, `${fact.id}.population.description missing`);
  if (!AGE_BASES.has(population.ageBasis)) {
    fail(`${fact.id}.population.ageBasis is unsupported`);
  }
  requireTextArray(population.conditions, `${fact.id}.population.conditions missing`);
  requireTextArray(
    population.exclusions,
    `${fact.id}.population.exclusions must be a text array`,
    fact.id === "sleep-guidance",
  );
  if (
    population.ageBasis.startsWith("研究集団の平均年齢") &&
    !/平均年齢|集団平均年齢/.test(population.description)
  ) {
    fail(`${fact.id} must describe research age as a population average`);
  }
  if (
    population.ageBasis.startsWith("研究集団の平均年齢") &&
    !/個人|参加者全員/.test(population.description)
  ) {
    fail(`${fact.id} must state that research average age is not individual age`);
  }
  const authority = fact.authority;
  if (!authority || typeof authority !== "object") {
    fail(`${fact.id}.authority missing`);
  }
  requireText(authority.issuer, `${fact.id}.authority.issuer missing`);
  requireText(authority.attributionKind, `${fact.id}.authority.attributionKind missing`);
  if (
    authority.attributedRecommender !== null &&
    (typeof authority.attributedRecommender !== "string" ||
      authority.attributedRecommender.trim() === "")
  ) {
    fail(`${fact.id}.authority.attributedRecommender must be text or null`);
  }
  if (
    fact.sourceId !== "E02" &&
    (authority.attributedRecommender !== null ||
      authority.attributionKind !== "publisher_of_research_not_recommender")
  ) {
    fail(`${fact.id} must distinguish a research publisher from a recommender`);
  }
  requireTextArray(fact.uncertainty, `${fact.id}.uncertainty missing`);
  requireTextArray(fact.limitations, `${fact.id}.limitations missing`);
  requireTextArray(fact.usageRestrictions, `${fact.id}.usageRestrictions missing`);
  requireTextArray(fact.unknowns, `${fact.id}.unknowns missing`);
  if (!fact.unknowns.includes("科学的確実性")) {
    fail(`${fact.id}.unknowns must retain unknown scientific certainty`);
  }
  const provenance = fact.provenance;
  if (
    !provenance ||
    provenance.reviewStatus !== "manual_source_checked_candidate" ||
    provenance.editorialMode !==
      "source-reviewed fixed description; no model generation" ||
    provenance.adoptionClaim !== false
  ) {
    fail(`${fact.id}.provenance must remain a non-adopted checked candidate`);
  }
  requireText(provenance.fragmentId, `${fact.id}.provenance.fragmentId missing`);
  requireText(provenance.sourceFileSha256, `${fact.id}.provenance.sourceFileSha256 missing`);
  requireTextArray(provenance.required_context_ids, `${fact.id}.provenance.required_context_ids missing`);
  if (!Array.isArray(fact.supports) || fact.supports.length === 0) {
    fail(`${fact.id}.supports missing`);
  }
  const verification = fact.verification;
  if (
    !verification ||
    verification.textMatch !== "verified_exact" ||
    verification.adoption !== "not_approved" ||
    verification.publication !== "not_published" ||
    verification.scientificCertainty !== "unknown"
  ) {
    fail(`${fact.id}.verification must retain checked text and current workflow statuses`);
  }
  const expectedNumbers = NUMERIC_PROJECTION[fact.id];
  const actualNumbers = fact.quantities.map(({ label, value, unit }) => [
    label,
    value,
    unit,
  ]);
  if (!sameJson(actualNumbers, expectedNumbers)) {
    fail(`${fact.id}.quantities differ from the selected preserved original`);
  }
  if (
    fact.id === "sleep-guidance" &&
    fact.quantities.some(
      (quantity) =>
        quantity.aggregationScope !== "unknown" ||
        !quantity.measurementTarget.includes("定義は未確認"),
    )
  ) {
    fail("sleep-guidance must not infer a 24-hour or nap-inclusive aggregation");
  }
  if (
    fact.population.exclusions.some((item) =>
      /処方|保証|治療への使用|日本.*主張|上限への転用/.test(item),
    )
  ) {
    fail(`${fact.id} mixes usage restrictions into research exclusions`);
  }
}

function validateBinding(fact, sourceDocument, savedOriginals) {
  const unit = sourceDocument.units.find((item) => item.id === fact.unitId);
  if (!unit || unit.source_id !== fact.sourceId) {
    fail(`${fact.id} has no matching source/unit binding`);
  }
  if (
    unit.fragment_id !== fact.provenance.fragmentId ||
    !sameJson(unit.required_context_ids, fact.provenance.required_context_ids)
  ) {
    fail(`${fact.id} changed its fragment or required-context binding`);
  }
  const requiredIds = [unit.fragment_id, ...unit.required_context_ids];
  const supportIds = fact.supports.map((support) => support.originalId);
  if (
    requiredIds.length !== supportIds.length ||
    requiredIds.some((id) => !supportIds.includes(id))
  ) {
    fail(`${fact.id} does not have full required-context coverage`);
  }
  for (const support of fact.supports) {
    const fragment = sourceDocument.fragments.find(
      (item) => item.id === support.originalId,
    );
    const saved = savedOriginals[support.originalId];
    if (!fragment || !saved || fragment.source_id !== fact.sourceId) {
      fail(`${fact.id} support ${support.originalId} is not source-bound`);
    }
    if (
      support.quote !== fragment.original_text ||
      support.quote !== saved.originalText ||
      support.originalTextSha256 !== fragment.text_sha256 ||
      support.originalTextSha256 !== saved.originalTextSha256 ||
      sha256(support.quote) !== support.originalTextSha256
    ) {
      fail(`${fact.id} support ${support.originalId} is not an exact hashed quote`);
    }
    if (!sameJson(support.locator, fragment.locator)) {
      fail(`${fact.id} support ${support.originalId} locator changed`);
    }
  }
}

function savedQuestion(packet) {
  const input = packet?.request?.input?.find((item) => item.role === "user");
  requireText(input?.content, `${packet?.caseId || "packet"} saved question missing`);
  let payload;
  try {
    payload = JSON.parse(input.content);
  } catch {
    fail(`${packet.caseId} saved user payload is invalid JSON`);
  }
  requireText(payload.question, `${packet.caseId} saved question missing`);
  return payload.question;
}

export function loadValidatedCatalog(root = process.cwd()) {
  const { value: catalog } = readJson(root, CATALOG_PATH);
  const { value: saved } = readJson(root, SOURCE_CONTENT_PATH);
  const { value: packets } = readJson(root, PACKETS_PATH);
  const { value: plan } = readJson(root, PLAN_PATH);
  const sources = SOURCE_IDS.map((id) =>
    readJson(root, `evidence-work/v0.2/${id}.json`),
  );

  if (catalog.schemaVersion !== 1 || catalog.aiConnected !== false) {
    fail("catalog must be schema version 1 and offline");
  }
  requireText(catalog.notice, "catalog.notice missing");
  if (!/採用・公開・科学的承認を示しません/.test(catalog.notice)) {
    fail("catalog.notice must explicitly deny adoption/publication/approval");
  }
  if (
    !Array.isArray(catalog.facts) ||
    catalog.facts.length !== FACT_IDS.length ||
    FACT_IDS.some((id) => !catalog.facts.some((fact) => fact.id === id))
  ) {
    fail("catalog fact set is incomplete or unexpected");
  }
  const sourceDocuments = Object.fromEntries(
    SOURCE_IDS.map((id, index) => [id, sources[index].value]),
  );
  SOURCE_IDS.forEach((id, index) => {
    const expected = saved.provenance?.sourceFiles?.[id]?.sha256;
    requireValue(expected, `saved full-file hash for ${id} missing`);
    if (sha256(sources[index].text) !== expected) {
      fail(`${id} full source file hash differs from frozen source-content`);
    }
  });
  for (const fact of catalog.facts) {
    validateFactShape(fact);
    if (
      fact.provenance.sourceFileSha256 !==
      saved.provenance.sourceFiles[fact.sourceId].sha256
    ) {
      fail(`${fact.id} provenance has the wrong full source-file hash`);
    }
    validateBinding(fact, sourceDocuments[fact.sourceId], saved.originals);
    fact.sourceTitle = sourceDocuments[fact.sourceId].sources.find(
      source => source.id === fact.sourceId,
    )?.title;
    requireText(fact.sourceTitle, `${fact.id} source title unavailable`);
  }
  if (
    !Array.isArray(catalog.scenarios) ||
    catalog.scenarios.length !== CASE_IDS.length
  ) {
    fail("scenario set must contain exactly P01/P04/P06/P10");
  }
  for (const scenario of catalog.scenarios) {
    if (!CASE_IDS.includes(scenario.caseId)) fail(`unexpected case ${scenario.caseId}`);
    const packet = packets.packets.find((item) => item.caseId === scenario.caseId);
    const planned = plan.cases?.find((item) => item.id === scenario.caseId);
    if (
      !packet ||
      !planned ||
      scenario.question !== savedQuestion(packet) ||
      scenario.question !== planned.question
    ) {
      fail(`${scenario.caseId} question differs from the exact saved plan/question`);
    }
    requireTextArray(scenario.factIds, `${scenario.caseId}.factIds missing`);
    if (scenario.factIds.some((id) => !FACT_IDS.includes(id))) {
      fail(`${scenario.caseId} maps to an unknown reusable fact`);
    }
  }
  if (new Set(catalog.scenarios.map(s => s.caseId)).size !== CASE_IDS.length) fail("duplicate scenarios");
  return catalog;
}