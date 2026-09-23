import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MODEL } from "./operational-accounting.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const CASE_IDS = new Set(["Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11"]);
const ADMIN_FIELDS = new Set([
  "editorial_notes", "allowed_role", "verification_reference_ids", "search_terms_ja_en",
  "human_approval", "publication_status", "status", "hold_reason",
]);
const SERVICE_NOTICES = [
  "この表示は隔離された資料読解評価であり、診断、治療、個別助言、資料の採用・公開承認ではありません。",
];

export const AASM_SUPPLEMENT_DECISION = Object.freeze({
  status: "pending_rights_for_text_extraction_and_external_ai_use",
  reason: "出版社ページに権利許諾への導線はあるが、本文抽出および外部AI利用を許諾する表示を確認できない。",
  model_input: "no_aasm_prose",
});

export const CLAIM_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    explanations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          original_ids: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["text", "original_ids"],
      },
    },
    limitations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          original_ids: { type: "array", items: { type: "string" } },
        },
        required: ["text", "original_ids"],
      },
    },
    abstention: {
      type: "object",
      additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        text: { type: "string" },
        original_ids: { type: "array", items: { type: "string" } },
      },
      required: ["applies", "text", "original_ids"],
    },
  },
  required: ["explanations", "limitations", "abstention"],
});

export const CLAIM_INSTRUCTIONS = [
  "提示された original_evidence の本文だけに忠実に、日本語で説明してください。",
  "各事実説明を explanations の別要素にし、それを直接支える original_id だけを original_ids に指定してください。",
  "資料名、版、ページ、URL、引用番号は出力しないでください。これらはアプリが照合済みデータから表示します。",
  "applicability は対象条件と適用制限であり、それ自体を原文として引用しないでください。",
  "原文にない条件は補完せず limitations または abstention で明示してください。",
  "外部知識、編集メモ、管理情報を使わず、存在しないIDを作らないでください。",
].join("\n");

const readJsonVerified = (path, expectedHash, code) => {
  const bytes = readFileSync(path);
  if (expectedHash && sha256(bytes) !== expectedHash) throw new Error(code);
  return JSON.parse(bytes);
};

const isBibliographicOnly = fragment =>
  fragment.role === "required_context" && /(?:^|-)REFERENCE-/.test(fragment.id);

export function buildVerifiedOriginalCatalog({ casesPath, sourceDirectory }) {
  const plan = JSON.parse(readFileSync(casesPath));
  const catalog = {};
  const fragments = new Map();
  const units = new Map();
  for (const [sourceId, registry] of Object.entries(plan.source_registry)) {
    const data = readJsonVerified(
      `${sourceDirectory}/${sourceId}.json`,
      registry.file_sha256,
      `ROLE_SOURCE_FILE_HASH_${sourceId}`,
    );
    const source = data.sources.find(item => item.id === sourceId);
    if (!source || source.version !== registry.version) throw new Error(`ROLE_SOURCE_VERSION_${sourceId}`);
    for (const fragment of data.fragments) {
      if (sha256(Buffer.from(fragment.original_text, "utf8")) !== fragment.text_sha256) {
        throw new Error(`ROLE_FRAGMENT_HASH_${fragment.id}`);
      }
      fragments.set(fragment.id, fragment);
      catalog[fragment.id] = {
        citable: !isBibliographicOnly(fragment),
        kind: isBibliographicOnly(fragment) ? "bibliographic_metadata" : "original_evidence",
        title: registry.title,
        version: registry.version,
        locator: typeof fragment.locator === "string"
          ? fragment.locator
          : JSON.stringify(fragment.locator),
        url: fragment.url ?? registry.url,
        attribution: fragment.attribution ?? registry.attribution ?? null,
        text_sha256: fragment.text_sha256,
      };
    }
    for (const unit of data.units) units.set(unit.id, unit);
  }
  return { plan, catalog, fragments, units };
}

// Explicit normalization avoids guessing at punctuation. In particular,
// English commas inside "growth, development, or behavior" are not separators.
const NORMALIZED_RESTRICTIONS = Object.freeze({
  "E02-S01": {
    raw: "乳児、保護者、睡眠障害の診断。",
    population: ["乳児", "保護者"],
    evidenceScope: [],
    service: ["睡眠障害の診断"],
  },
  "E02-S02": {
    raw: "6歳以上、乳児、昼寝禁止の根拠、睡眠障害の診断。",
    population: ["6歳以上", "乳児"],
    evidenceScope: ["昼寝禁止の根拠"],
    service: ["睡眠障害の診断"],
  },
  "E02-S03": {
    raw: "子どもの必要睡眠時間、夜泣きへの待機介入。",
    population: [],
    evidenceScope: ["子どもの必要睡眠時間", "夜泣きへの待機介入"],
    service: [],
  },
  "E03-S01": {
    raw: "Do not use for diagnosed illness/disability populations, individual developmental diagnosis, or as evidence that the result applies in Japan.",
    population: ["diagnosed illness/disability populations"],
    evidenceScope: ["evidence that the result applies in Japan"],
    service: ["individual developmental diagnosis"],
  },
  "E03-S02": {
    raw: "Do not use as mental-health diagnosis or treatment evidence, or as evidence that the result applies in Japan.",
    population: [],
    evidenceScope: ["evidence that the result applies in Japan"],
    service: ["mental-health diagnosis or treatment evidence"],
  },
  "E04-S01": {
    raw: "Do not use for children with a diagnosed medical condition affecting growth, development, or behavior; education-setting interventions; individual treatment advice; or Japan-specific effect claims.",
    population: [
      "children with a diagnosed medical condition affecting growth, development, or behavior",
      "education-setting interventions",
    ],
    evidenceScope: ["Japan-specific effect claims"],
    service: ["individual treatment advice"],
  },
  "E04-S02": {
    raw: "Do not use for sleep treatment, to guarantee improvement, for diagnosed medical-condition populations, or as evidence that the result applies in Japan.",
    population: ["diagnosed medical-condition populations"],
    evidenceScope: ["guarantee improvement", "evidence that the result applies in Japan"],
    service: ["sleep treatment"],
  },
});

function applicabilityFor(entry, units) {
  const serviceNotices = [];
  const sourceApplicability = entry.units.map(id => {
    const unit = units.get(id);
    if (!unit) throw new Error(`ROLE_UNIT_MISSING_${id}`);
    const normalized = NORMALIZED_RESTRICTIONS[id];
    if (!normalized || unit.exclusions !== normalized.raw) {
      throw new Error(`ROLE_RESTRICTION_MAPPING_REQUIRED_${id}`);
    }
    const service = normalized.service;
    if (service.length) {
      serviceNotices.push(`サービス上の制限：${service.join("、")}には使用しません。`);
    }
    const result = {
      population: unit.population ?? null,
      conditions: unit.conditions ?? null,
      population_exclusions: [...normalized.population],
      evidence_scope_exclusions: [...normalized.evidenceScope],
    };
    if (Object.keys(result).some(key => ADMIN_FIELDS.has(key))) throw new Error("ROLE_ADMIN_FIELD_LEAK");
    return result;
  });
  const target = entry.persons.find(person =>
    entry.target === "caregiver" ? person.role === "caregiver" : person.role === "child");
  if (!target) throw new Error(`ROLE_TARGET_MISSING_${entry.id}`);
  const sourceRequiredHealth = {};
  if (entry.units.some(id => id.startsWith("E03-"))) {
    sourceRequiredHealth.diagnosed_illness_or_disability =
      target.health.diagnosed_illness_or_disability;
  }
  if (entry.units.some(id => id.startsWith("E04-"))) {
    sourceRequiredHealth.diagnosed_medical_condition_affecting_growth_development_or_behavior =
      target.health.diagnosed_medical_condition_affecting_growth_development_or_behavior;
  }
  const applicability = {
    fictional: true,
    target_role: entry.target,
    persons: entry.persons.map(person => ({
      id: person.id,
      role: person.role,
      age: person.age,
      health: person.health,
      known: person.known,
      unknown: person.unknown,
    })),
    source_applicability: sourceApplicability,
    ...(Object.keys(sourceRequiredHealth).length
      ? { source_required_target_health: sourceRequiredHealth }
      : {}),
    ...(entry.units.some(id => id.startsWith("E03-")) ? {
      source_required_caregiver_context: {
        diagnosed_illness_or_disability: entry.persons.find(
          person => person.role === "caregiver",
        )?.health.diagnosed_illness_or_disability ?? "unknown",
      },
    } : {}),
  };
  return { applicability, serviceNotices };
}

export function buildRoleSeparatedRequests({
  casesPath,
  sourceDirectory,
  caseIds = [...CASE_IDS],
  supplementalOriginalEvidence = {},
} = {}) {
  const { plan, catalog, fragments, units } =
    buildVerifiedOriginalCatalog({ casesPath, sourceDirectory });
  const requested = new Set(caseIds);
  if ([...requested].some(id => !CASE_IDS.has(id))) throw new Error("ROLE_EXPECTED_Q05_Q11");
  const requests = plan.cases.filter(entry => requested.has(entry.id)).map(entry => {
    const originals = [];
    const referenceMetadata = [];
    for (const id of entry.necessary_citations) {
      const fragment = fragments.get(id);
      if (!fragment) throw new Error(`ROLE_FRAGMENT_MISSING_${id}`);
      if (catalog[id].citable) {
        originals.push({ original_id: id, original_text: fragment.original_text });
      } else {
        referenceMetadata.push({
          metadata_id: id,
          kind: "bibliographic_metadata",
          original_text: fragment.original_text,
          title: catalog[id].title,
          version: catalog[id].version,
          locator: catalog[id].locator,
          url: catalog[id].url,
          attribution: catalog[id].attribution,
          citable: false,
        });
      }
    }
    if ((supplementalOriginalEvidence[entry.id] ?? []).length) {
      // A later, separately reviewed ingestion implementation must verify the
      // original/source IDs, title, version, locator, URL, text hash, rights
      // review provenance, and external-AI permission. Caller-supplied flags
      // are deliberately insufficient here.
      throw new Error(`ROLE_SUPPLEMENTS_DISABLED_${entry.id}`);
    }
    const separated = applicabilityFor(entry, units);
    const userPayload = {
      question: entry.question_ja,
      original_evidence: originals,
      applicability: separated.applicability,
    };
    const request = {
      model: MODEL,
      input: [
        { role: "developer", content: CLAIM_INSTRUCTIONS },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      background: false,
      store: false,
      max_output_tokens: 1500,
      reasoning: { effort: "medium" },
      prompt_cache_options: { mode: "explicit" },
      truncation: "disabled",
      tools: [],
      service_tier: "default",
      text: {
        format: {
          type: "json_schema",
          name: "claim_source_explanation",
          strict: true,
          schema: CLAIM_OUTPUT_SCHEMA,
        },
      },
    };
    return {
      case_id: entry.id,
      request,
      retrieved_original_ids: originals.map(item => item.original_id),
      administrative_ids: [...entry.units],
      reference_metadata: referenceMetadata,
      service_notices: [...SERVICE_NOTICES, ...separated.serviceNotices],
      semantic_review_required: true,
      request_serialized: JSON.stringify(request),
    };
  });
  return { catalog, requests };
}