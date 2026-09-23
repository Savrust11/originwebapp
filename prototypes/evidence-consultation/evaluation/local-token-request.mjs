import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const FIXED_INSTRUCTIONS = [
  "回答は日本語で、提示された資料本文だけに忠実に基づいてください。",
  "個別の診断、治療、助言、採用・承認の判断をせず、資料の一般的説明または根拠ある回答差控えに限定してください。",
  "外部知識を使わず、数値、否定、不確実性、対象条件、例外、限界を省略・変更しないでください。",
  "各主張には提示された source_id、version、section_id、locator を引用してください。",
].join("\n");

export const OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    answer_ja: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_id: { type: "string" },
          version: { type: "string" },
          section_id: { type: "string" },
          locator: { type: "string" },
        },
        required: ["source_id", "version", "section_id", "locator"],
      },
    },
    abstained: { type: "boolean" },
  },
  required: ["answer_ja", "citations", "abstained"],
});

const FORMAT_INSTRUCTIONS = "指定されたJSON Schemaに厳密に従い、JSON以外を出力しないでください。";
const sourceIds = ["E01", "E02", "E03", "E04"];

export function buildLocalRequests({ casesPath, sourceDirectory }) {
  const casesBytes = readFileSync(casesPath);
  const plan = JSON.parse(casesBytes);
  const selectedCases = plan.cases.filter(({ id }) => /^Q(?:0[1-9]|1[01])$/.test(id));
  if (selectedCases.length !== 11) throw new Error("LOCAL_TOKEN_EXPECTED_Q01_Q11");

  const sources = new Map();
  const fragments = new Map();
  const units = new Map();
  const unitByPrimaryFragment = new Map();
  const fileValidation = {};
  for (const id of sourceIds) {
    const path = `${sourceDirectory}/${id}.json`;
    const bytes = readFileSync(path);
    const actual = sha256(bytes);
    const expected = plan.source_registry[id].file_sha256;
    if (actual !== expected) throw new Error(`LOCAL_TOKEN_SOURCE_FILE_HASH_${id}`);
    const parsed = JSON.parse(bytes);
    const source = parsed.sources.find((item) => item.id === id);
    if (!source || source.version !== plan.source_registry[id].version
      || (source.revision_date ?? null) !== (plan.source_registry[id].revision_date ?? null)
      || (source.version_of_record_date ?? null)
        !== (plan.source_registry[id].version_of_record_date ?? null)) {
      throw new Error(`LOCAL_TOKEN_SOURCE_VERSION_${id}`);
    }
    sources.set(id, source);
    for (const fragment of parsed.fragments) {
      if (sha256(Buffer.from(fragment.original_text, "utf8")) !== fragment.text_sha256) {
        throw new Error(`LOCAL_TOKEN_FRAGMENT_HASH_${fragment.id}`);
      }
      fragments.set(fragment.id, fragment);
    }
    for (const unit of parsed.units) {
      units.set(unit.id, unit);
      unitByPrimaryFragment.set(unit.fragment_id, unit);
    }
    fileValidation[id] = {
      expected_sha256: expected,
      actual_sha256: actual,
      version: source.version,
      revision_date: source.revision_date ?? null,
      version_of_record_date: source.version_of_record_date ?? null,
    };
  }

  const requests = selectedCases.map((entry) => {
    const closure = new Set();
    const visitedUnits = new Set();
    const includeUnit = (id) => {
      if (visitedUnits.has(id)) return;
      visitedUnits.add(id);
      const unit = units.get(id);
      if (!unit) throw new Error(`LOCAL_TOKEN_UNIT_MISSING_${id}`);
      closure.add(unit.fragment_id);
      for (const contextId of unit.required_context_ids) {
        closure.add(contextId);
        const linked = unitByPrimaryFragment.get(contextId);
        if (linked) includeUnit(linked.id);
      }
    };
    for (const id of entry.units) includeUnit(id);
    const declared = new Set(entry.necessary_citations);
    if (closure.size !== declared.size || [...closure].some((id) => !declared.has(id))) {
      throw new Error(`LOCAL_TOKEN_MANDATORY_CONTEXT_CLOSURE_${entry.id}`);
    }
    const citations = entry.necessary_citations.map((id) => {
      const fragment = fragments.get(id);
      if (!fragment) throw new Error(`LOCAL_TOKEN_CITATION_MISSING_${id}`);
      const source = sources.get(fragment.source_id);
      return {
        source_id: fragment.source_id,
        version: source.version,
        revision_date: source.revision_date,
        version_of_record_date: source.version_of_record_date,
        section_id: fragment.id,
        locator: typeof fragment.locator === "string"
          ? fragment.locator
          : JSON.stringify(fragment.locator),
        original_text: fragment.original_text,
        source_annotation: fragment.extraction_record ?? fragment.change_record,
      };
    });
    const sourceNotes = entry.units.map((id) => {
      const unit = units.get(id);
      if (!unit) throw new Error(`LOCAL_TOKEN_UNIT_MISSING_${id}`);
      return {
        unit_id: id,
        population: unit.population,
        conditions: unit.conditions,
        exclusions: unit.exclusions,
        allowed_role: unit.allowed_role,
        editorial_notes: unit.editorial_notes,
        age_range_months: unit.age_range_months,
        research_age: unit.research_age,
        certainty_grade: unit.certainty_grade,
        japan_applicability: unit.japan_applicability,
        ...(unit.verification_reference_ids ? {
          verification_reference_ids: unit.verification_reference_ids,
        } : {}),
      };
    });
    const target = entry.persons.find((person) =>
      entry.target === "caregiver" ? person.role === "caregiver" : person.role === "child");
    if (!target) throw new Error(`LOCAL_TOKEN_TARGET_MISSING_${entry.id}`);
    const requiredHealth = {};
    if (entry.units.some((id) => id.startsWith("E03-"))) {
      requiredHealth.diagnosed_illness_or_disability =
        target.health.diagnosed_illness_or_disability;
    }
    if (entry.units.some((id) => id.startsWith("E04-"))) {
      requiredHealth.diagnosed_medical_condition_affecting_growth_development_or_behavior =
        target.health.diagnosed_medical_condition_affecting_growth_development_or_behavior;
    }
    const conditions = {
      fictional: true,
      target: {
        subject_token: randomUUID(),
        role: target.role,
        age: target.age,
        known: target.known,
        unknown: target.unknown,
        ...(Object.keys(requiredHealth).length ? { source_required_health: requiredHealth } : {}),
      },
      ...(entry.units.some((id) => id.startsWith("E03-")) ? {
        source_required_caregiver_context: {
          diagnosed_illness_or_disability: entry.persons.find(
            (person) => person.role === "caregiver",
          )?.health.diagnosed_illness_or_disability ?? "unknown",
        },
      } : {}),
    };
    const context = { citations, source_notes: sourceNotes };
    const input = [
      { role: "developer", content: FIXED_INSTRUCTIONS },
      {
        role: "user",
        content: JSON.stringify({
          question: entry.question_ja,
          fictional_target_conditions: conditions,
          source_context: context,
          formatting_instructions: FORMAT_INSTRUCTIONS,
        }),
      },
    ];
    const request = {
      model: "gpt-5.6-luna",
      input,
      background: false,
      store: false,
      max_output_tokens: 1500,
      reasoning: { effort: "medium" },
      prompt_cache_options: { mode: "explicit" },
      truncation: "disabled",
      tools: [],
      service_tier: "default",
      text: { format: { type: "json_schema", name: "source_explanation", strict: true, schema: OUTPUT_SCHEMA } },
    };
    return {
      case_id: entry.id,
      components: {
        fixed_instructions: FIXED_INSTRUCTIONS,
        question_context_conditions: JSON.stringify({
          question: entry.question_ja,
          fictional_target_conditions: conditions,
          source_context: context,
        }),
        formatting_instructions: FORMAT_INSTRUCTIONS,
        schema_serialized: JSON.stringify(OUTPUT_SCHEMA),
      },
      request,
      request_serialized: JSON.stringify(request),
      mandatory_context_closure: [...closure],
      mandatory_context_text_sha256: Object.fromEntries(
        [...closure].map((id) => [id, fragments.get(id).text_sha256]),
      ),
    };
  });
  return { fileValidation, requests };
}
