import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const ROOT = path.resolve(new URL("../../../", import.meta.url).pathname);
export const WORK = path.join(ROOT, "evidence-work/practical-guidance-pilot-01");
export const EXPECTED = Object.freeze({ cdc: 2, nhs: 1, cfa: 4 });
const QUESTIONS = new Set([
  "出かける前の支度が進まない",
  "子どもとどう遊べばよいか分からない",
  "食べないので毎回作り直して疲れる",
  "頼れる人がいなくて休めない",
]);
const NATIVE_TERMS = Object.freeze({
  "cdc-routines-simple": ["routines"],
  "cdc-routines-capability-matched": ["skill levels"],
  "cdc-routines-predictability": ["Predictability"],
  "cdc-routines-changes": ["change"],
  "cdc-communication-active-listening": ["Active listening"],
  "cdc-communication-acknowledge-feelings": ["emotions"],
  "cdc-communication-follow-play-interest": ["Imitating"],
  "cdc-communication-describe-interest": ["Descriptions"],
  "cdc-communication-touch-autonomy": ["consent"],
  "nhs-fussy-eaters-eat-together": ["copy you"],
  "nhs-fussy-eaters-small-portions": ["small portions"],
  "nhs-fussy-eaters-no-force-retry": ["do not force"],
  "nhs-fussy-eaters-enjoyable-mealtimes": ["enjoyable"],
  "cfa-temporary-care-what-it-is": ["一時的に預かり"],
  "cfa-temporary-care-local-check": ["市区町村"],
  "cfa-regional-parenting-support-national-scope": ["地域子育て支援拠点"],
  "cfa-regional-parenting-support-current-functions": ["地域子育て支援拠点"],
  "cfa-regional-parenting-support-historical-detail": ["地域子育て支援拠点"],
});
const GENERIC_QUERY_ALIASES = Object.freeze({
  "cdc-routines-simple": ["支度", "外出の準備"],
  "cdc-communication-follow-play-interest": ["遊べ", "遊び方", "親子の遊び"],
  "nhs-fussy-eaters-no-force-retry": ["作り直し", "作り直して", "偏食への対応"],
  "cfa-regional-parenting-support-national-scope": ["頼れる人", "一人で抱え", "育児支援"],
  "cfa-regional-parenting-support-current-functions": ["頼れる人", "一人で抱え", "育児支援"],
});

const record = (value, label) => {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
};
const pick = (value, names) => {
  for (const name of names) if (Object.hasOwn(value, name)) return value[name];
  return undefined;
};
const text = (value, label, maximum = 20_000) => {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.trim() && value.length <= maximum, `${label} must be nonblank and bounded`);
  return value;
};
const texts = (value, label, allowEmpty = false) => {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(allowEmpty || value.length > 0, `${label} must not be empty`);
  return value.map((item, index) => text(item, `${label}[${index}]`, 500));
};
const structuredArray = (value, label) => {
  assert(Array.isArray(value), `${label} must be an array`);
  return value.map((item, index) => {
    if (typeof item === "string") return text(item, `${label}[${index}]`, 2_000);
    const input = record(item, `${label}[${index}]`);
    const entries = Object.entries(input);
    assert(entries.length > 0, `${label}[${index}] must not be empty`);
    return Object.fromEntries(entries.map(([key, field]) => {
      assert.match(key, /^[A-Za-z][A-Za-z0-9_]*$/u, `${label}[${index}] has an invalid field`);
      return [key, text(field, `${label}[${index}].${key}`, 2_000)];
    }));
  });
};
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function snapshotReference(value, label) {
  if (typeof value === "string") {
    const supplied = text(value, label, 500);
    return supplied.endsWith(".json")
      ? { jsonPath: null, file: supplied }
      : { jsonPath: supplied, file: null };
  }
  const input = record(value, label);
  return {
    jsonPath: text(pick(input, ["jsonPath", "json_path", "path"]), `${label}.jsonPath`, 500),
    file: pick(input, ["file", "snapshotFile", "snapshot_file"]) == null
      ? null
      : text(pick(input, ["file", "snapshotFile", "snapshot_file"]), `${label}.file`, 500),
  };
}

function resolveJsonPath(snapshot, jsonPath, label) {
  assert.match(jsonPath, /^\$(?:\.[A-Za-z0-9_-]+)+$/u, `${label} supports explicit property JSON paths only`);
  return jsonPath.slice(2).split(".").reduce((value, key) => {
    const object = record(value, `${label} parent`);
    assert(Object.hasOwn(object, key), `${label} does not resolve`);
    return object[key];
  }, snapshot);
}

function locateSnapshot(doc, source, ref, label) {
  const fetched = path.join(WORK, "source-review/fetched");
  const candidates = ref.file
    ? [path.resolve(WORK, "source-review", source.group, ref.file)]
    : fs.readdirSync(fetched).filter((name) => name.endsWith(".json")).map((name) => path.join(fetched, name));
  const inside = candidates.filter((file) => {
    const relative = path.relative(WORK, file);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  assert.equal(inside.length, candidates.length, `${label} snapshot must remain under the owned evidence-work directory`);
  const matches = inside.filter((file) => {
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
    const urls = [snapshot.url, snapshot.requestedUrl, snapshot.sourceUrl, snapshot.requestedFromPage];
    return urls.includes(doc.url) || urls.includes(source.url);
  });
  assert.equal(matches.length, 1, `${label} must resolve exactly one fetched source snapshot`);
  const file = matches[0];
  const raw = fs.readFileSync(file, "utf8");
  const snapshot = JSON.parse(raw);
  const jsonPath = ref.jsonPath ?? (() => {
    if (typeof snapshot.markdown === "string") return "$.markdown";
    if (typeof snapshot.retrievedText === "string"
      || (Array.isArray(snapshot.retrievedText) && snapshot.retrievedText.every((item) => typeof item === "string"))) {
      return "$.retrievedText";
    }
    assert.fail(`${label} file-only sourceSnapshot requires a recognized explicit text field`);
  })();
  const resolved = resolveJsonPath(snapshot, jsonPath, `${label}.sourceSnapshot`);
  assert(
    typeof resolved === "string" || (Array.isArray(resolved) && resolved.every((item) => typeof item === "string")),
    `${label} snapshot path must resolve to text or a text array`,
  );
  const value = Array.isArray(resolved) ? resolved.join("\n\n") : resolved;
  return { file, relativeFile: path.relative(ROOT, file), value, jsonPath, snapshotSha256: sha256(raw) };
}

function usage(value, label) {
  const input = record(value, label);
  const audit = pick(input, ["audited", "audit"]);
  const audited = audit === true || (
    audit && typeof audit === "object" && !Array.isArray(audit)
    && ["audited", "complete", "verified"].includes(String(pick(audit, ["status", "state"])).toLowerCase())
  ) || ["textStorage", "translationSummary", "futureExternalAI"].every((key) => {
    const section = input[key];
    return section && typeof section === "object" && !Array.isArray(section)
      && typeof section.status === "string" && section.status.trim().length > 0;
  });
  assert(audited, `${label} must explicitly record an audited status`);
  const statuses = Object.fromEntries(
    ["textStorage", "translationSummary", "display", "displayOriginal", "displayAdaptation", "futureExternalAI"]
      .filter((key) => input[key] && typeof input[key] === "object" && !Array.isArray(input[key]))
      .map((key) => [key, input[key].status]),
  );
  const storage = {
    audited: true,
    sourceObjectSha256: sha256(JSON.stringify(input)),
    officialURLs: Array.isArray(input.officialURLs) ? input.officialURLs : [],
    termsUrl: typeof input.termsUrl === "string" ? input.termsUrl : null,
    statuses,
  };
  assert(JSON.stringify(storage).length <= 3_200, `${label} compact audited storage binding is too large`);
  return { original: input, storage };
}

function retrieval(value, label, originalText, heading, unitId) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a nonempty array`);
  const queryTerms = [];
  const sourceTerms = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === "string") {
      const term = text(item, `${label}[${index}]`, 120);
      (originalText.toLocaleLowerCase().includes(term.toLocaleLowerCase())
        || heading.toLocaleLowerCase().includes(term.toLocaleLowerCase()) ? sourceTerms : queryTerms).push(term);
    } else {
      const entry = record(item, `${label}[${index}]`);
      queryTerms.push(...texts(pick(entry, ["queryTerms", "query_terms", "synonyms"]), `${label}[${index}].queryTerms`, true));
      sourceTerms.push(...texts(pick(entry, ["sourceTerms", "source_terms", "nativeTerms", "native_terms"]), `${label}[${index}].sourceTerms`, true));
    }
  }
  sourceTerms.push(...(NATIVE_TERMS[unitId] ?? []));
  queryTerms.push(...(GENERIC_QUERY_ALIASES[unitId] ?? []));
  // Japanese worker terms are editorial discovery aliases for English
  // originals. They never become original text or checked derivatives.
  if (sourceTerms.length === 0) {
    for (const item of value) {
      if (typeof item === "string" && (
        originalText.toLocaleLowerCase().includes(item.toLocaleLowerCase())
        || heading.toLocaleLowerCase().includes(item.toLocaleLowerCase())
      )) sourceTerms.push(item);
    }
  }
  for (const item of value) if (typeof item === "string" && !sourceTerms.includes(item)) queryTerms.push(item);
  assert(sourceTerms.length > 0, `${label} needs an explicit audited native-original term mapping`);
  for (const term of sourceTerms) {
    assert(
      originalText.toLocaleLowerCase().includes(term.toLocaleLowerCase())
        || heading.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
      `${label} native source term is not passage-backed`,
    );
  }
  for (const term of queryTerms) assert(!QUESTIONS.has(term), `${label} cannot contain an exact evaluation-question card`);
  return { queryTerms: [...new Set(queryTerms)], sourceTerms: [...new Set(sourceTerms)] };
}

function unitFrom(value, doc, source, index) {
  const input = record(value, `${source.group}.${doc.id}.units[${index}]`);
  const label = `${source.group}.${doc.id}.units[${index}]`;
  const originalText = text(pick(input, ["originalText", "original_text", "quote"]), `${label}.originalText`);
  const heading = text(pick(input, ["heading"]), `${label}.heading`, 2_000);
  const ref = snapshotReference(pick(input, ["sourceSnapshot", "source_snapshot"]), `${label}.sourceSnapshot`);
  const snapshot = locateSnapshot(doc, source, ref, label);
  assert(snapshot.value.includes(originalText), `${label}.originalText must be a contiguous snapshot quote`);
  const sourceUrl = text(pick(input, ["sourceUrl", "source_url"]), `${label}.sourceUrl`, 2_048);
  assert.equal(sourceUrl, doc.url, `${label}.sourceUrl must bind to its document`);
  const target = text(pick(input, ["target"]), `${label}.target`, 500);
  const id = text(pick(input, ["unitId", "unit_id", "id"]), `${label}.unitId`, 128);
  const suppliedTerms = pick(input, ["retrievalTerms", "retrieval_terms"]);
  const terms = retrieval(suppliedTerms, `${label}.retrievalTerms`, originalText, heading, id);
  const arrays = {};
  for (const name of ["canSuggest", "conditions", "mustNotAssert", "originalExamples", "weikuExamples"]) {
    const raw = pick(input, [name, name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]);
    arrays[name] = ["originalExamples", "weikuExamples"].includes(name)
      ? structuredArray(raw, `${label}.${name}`)
      : texts(raw, `${label}.${name}`, true);
  }
  return {
    id,
    heading,
    originalText,
    sourceUrl,
    sourceLocation: text(pick(input, ["sourceLocation", "source_location"]), `${label}.sourceLocation`, 1_000),
    sourceSnapshot: { jsonPath: snapshot.jsonPath, file: snapshot.relativeFile, sha256: snapshot.snapshotSha256 },
    summaryJa: text(pick(input, ["summaryJa", "summary_ja"]), `${label}.summaryJa`),
    targetDescription: target,
    ...arrays,
    retrievalTerms: terms,
    originalSha256: sha256(originalText),
  };
}

function documentFrom(value, source, index) {
  const input = record(value, `${source.group}.docs[${index}]`);
  const label = `${source.group}.docs[${index}]`;
  const informationClass = pick(input, ["informationClass", "information_class"]);
  assert(["practical_guidance", "service_information"].includes(informationClass), `${label}.informationClass is unsupported`);
  const certainty = pick(input, ["scientificCertainty", "scientific_certainty"]);
  assert.equal(certainty, "not_assessed", `${label}.scientificCertainty must remain not_assessed`);
  const originalLanguage = pick(input, ["language"]);
  assert(["ja", "en", "en-GB"].includes(originalLanguage), `${label}.language must be ja, en, or en-GB`);
  const language = originalLanguage === "en-GB" ? "en" : originalLanguage;
  const url = text(pick(input, ["url", "originalUrl", "original_url"]), `${label}.url`, 2_048);
  assert.match(url, /^https:\/\//u, `${label}.url must be HTTPS`);
  const unitsRaw = pick(input, ["units"]);
  assert(Array.isArray(unitsRaw) && unitsRaw.length > 0, `${label}.units must be nonempty`);
  const doc = {
    id: text(pick(input, ["id", "docId", "doc_id"]), `${label}.id`, 128),
    title: text(pick(input, ["title"]), `${label}.title`, 500),
    url,
    publisher: text(pick(input, ["publisher"]), `${label}.publisher`, 300),
    language,
    originalLanguage,
    informationClass,
    documentType: informationClass,
    originalDocumentType: text(pick(input, ["documentType", "document_type"]), `${label}.documentType`, 500),
    ageDescription: text(pick(input, ["ageDescription", "age_description"]), `${label}.ageDescription`, 500),
    scientificCertainty: certainty,
    usageTerms: usage(pick(input, ["usageTerms", "usage_terms"]), `${label}.usageTerms`),
  };
  return { ...doc, units: unitsRaw.map((unit, unitIndex) => unitFrom(unit, doc, source, unitIndex)) };
}

export function loadPreparedGuidance({ allowPending = false } = {}) {
  const sources = [];
  const missing = [];
  for (const [group, expectedCount] of Object.entries(EXPECTED)) {
    const file = path.join(WORK, `source-review/${group}/prepared.json`);
    if (!fs.existsSync(file)) {
      missing.push(path.relative(ROOT, file));
      continue;
    }
    const root = record(JSON.parse(fs.readFileSync(file, "utf8")), `${group} prepared root`);
    const docs = pick(root, ["docs", "documents"]);
    assert(Array.isArray(docs), `${group}.docs must be an array`);
    assert.equal(docs.length, expectedCount, `${group} must contain exactly ${expectedCount} document(s)`);
    const source = { group, url: null };
    sources.push({ group, file: path.relative(ROOT, file), documents: docs.map((doc, index) => documentFrom(doc, source, index)) });
  }
  if (missing.length && !allowPending) throw new Error(`prepared source groups pending: ${missing.join(", ")}`);
  if (!missing.length) {
    assert.equal(sources.length, 3, "all source groups are required");
    const documents = sources.flatMap((source) => source.documents);
    assert.equal(documents.length, 7, "exactly seven prepared source documents are required");
    const ids = documents.flatMap((doc) => doc.units.map((unit) => unit.id));
    assert.equal(new Set(ids).size, ids.length, "unit IDs must be globally unique");
  }
  return { sources, missing, expected: EXPECTED };
}
