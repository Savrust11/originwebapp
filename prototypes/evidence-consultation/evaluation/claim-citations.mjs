// Pure, offline claim-citation validation and presentation. This module never
// reads a database, calls a provider, or decides whether a source is approved.

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const unique = values => [...new Set(values)];

export class ClaimCitationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "ClaimCitationError";
    this.code = code;
    this.details = details;
  }
}

export function validateClaimAnswer(answer, {
  retrievedOriginalIds,
  catalogOriginalIds = retrievedOriginalIds,
  administrativeIds = [],
} = {}) {
  if (!object(answer)
    || !Array.isArray(answer.explanations)
    || !Array.isArray(answer.limitations)
    || !object(answer.abstention)
    || Object.keys(answer).sort().join(",") !== "abstention,explanations,limitations") {
    throw new ClaimCitationError("claim_answer_schema_invalid");
  }
  const retrieved = new Set(retrievedOriginalIds ?? []);
  const catalog = new Set(catalogOriginalIds ?? []);
  const administrative = new Set(administrativeIds);
  const validateIds = (ids, field, { required }) => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id)) {
      throw new ClaimCitationError("original_ids_invalid", { field });
    }
    if (required && ids.length === 0) {
      throw new ClaimCitationError("factual_claim_requires_original_id", { field });
    }
    for (const id of ids) {
      if (administrative.has(id)) throw new ClaimCitationError("administrative_id_not_citable", { id, field });
      if (!catalog.has(id)) throw new ClaimCitationError("unknown_original_id", { id, field });
      if (!retrieved.has(id)) throw new ClaimCitationError("unretrieved_original_id", { id, field });
    }
    return unique(ids);
  };
  const validateItems = (items, field, required) => items.map((item, index) => {
    if (!object(item) || typeof item.text !== "string" || !item.text.trim()
      || Object.keys(item).sort().join(",") !== "original_ids,text") {
      throw new ClaimCitationError("claim_item_schema_invalid", { field, index });
    }
    return {
      text: item.text,
      original_ids: validateIds(item.original_ids, `${field}[${index}]`, { required }),
    };
  });
  const explanations = validateItems(answer.explanations, "explanations", true);
  const limitations = validateItems(answer.limitations, "limitations", false);
  const abstention = answer.abstention;
  if (typeof abstention.applies !== "boolean" || typeof abstention.text !== "string"
    || Object.keys(abstention).sort().join(",") !== "applies,original_ids,text"
    || (abstention.applies && !abstention.text.trim())
    || (!abstention.applies && (abstention.text !== "" || abstention.original_ids?.length))) {
    throw new ClaimCitationError("abstention_schema_invalid");
  }
  return {
    explanations,
    limitations,
    abstention: {
      applies: abstention.applies,
      text: abstention.text,
      original_ids: validateIds(abstention.original_ids, "abstention", { required: false }),
    },
  };
}

export function assembleClaimCitations(answer, catalog, options = {}) {
  const entries = catalog instanceof Map ? [...catalog.entries()] : Object.entries(catalog ?? {});
  const metadata = new Map(entries);
  const normalized = validateClaimAnswer(answer, {
    retrievedOriginalIds: options.retrievedOriginalIds,
    catalogOriginalIds: metadata.keys(),
    administrativeIds: options.administrativeIds,
  });
  const orderedIds = unique([
    ...normalized.explanations,
    ...normalized.limitations,
    normalized.abstention,
  ].flatMap(item => item.original_ids));
  const number = new Map(orderedIds.map((id, index) => [id, index + 1]));
  const references = orderedIds.map(id => {
    const item = metadata.get(id);
    if (!object(item) || item.citable !== true || typeof item.title !== "string"
      || typeof item.version !== "string" || typeof item.locator !== "string"
      || typeof item.url !== "string") {
      throw new ClaimCitationError("verified_catalog_metadata_missing", { id });
    }
    return {
      number: number.get(id),
      original_id: id,
      title: item.title,
      version: item.version,
      locator: item.locator,
      url: item.url,
      attribution: item.attribution ?? null,
    };
  });
  const attach = item => ({
    text: item.text,
    original_ids: item.original_ids,
    citation_numbers: item.original_ids.map(id => number.get(id)),
  });
  return {
    explanations: normalized.explanations.map(attach),
    limitations: normalized.limitations.map(attach),
    abstention: {
      ...attach(normalized.abstention),
      applies: normalized.abstention.applies,
    },
    references,
    service_notices: [...(options.serviceNotices ?? [])].map(text => ({
      text,
      provenance: "service_policy_not_source_conclusion",
    })),
    semantic_review_required: true,
  };
}

export function transformLegacyCitationDisplay(legacyAnswer, catalog) {
  if (!object(legacyAnswer) || typeof legacyAnswer.answer_ja !== "string"
    || !Array.isArray(legacyAnswer.citations)) {
    throw new ClaimCitationError("legacy_answer_invalid");
  }
  const references = legacyAnswer.citations.map((citation, index) => {
    const id = citation?.section_id;
    const verified = catalog instanceof Map ? catalog.get(id) : catalog?.[id];
    if (!verified) throw new ClaimCitationError("legacy_citation_not_in_catalog", { id });
    return {
      number: index + 1,
      original_id: id,
      title: verified.title,
      version: verified.version,
      locator: verified.locator,
      url: verified.url,
    };
  });
  return {
    text: legacyAnswer.answer_ja,
    references,
    claim_links: null,
    provenance: "legacy_answer_level_citations_only",
    warning: "旧回答には説明単位の構造化対応がないため、引用を個々の説明へ後付けしていません。",
    semantic_review_required: true,
  };
}