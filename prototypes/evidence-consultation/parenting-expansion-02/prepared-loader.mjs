import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPreparedGuidance } from "../practical-guidance-pilot/prepared-loader.mjs";

export const ROOT = path.resolve(new URL("../../../", import.meta.url).pathname);
export const WORK = path.join(ROOT, "evidence-work/parenting-expansion-02");
export const OVERSEAS_FILE = path.join(WORK, "overseas/prepared.json");
const OVERSEAS_CANDIDATES = path.join(WORK, "overseas/candidates.json");
const OVERSEAS_SNAPSHOTS = path.join(WORK, "overseas/snapshots/official-pages.json");
const GENERIC_JA_ALIASES = Object.freeze({
  "nhs-baby-play-from-four-months": ["4か月", "赤ちゃん", "遊び"],
  "nidirect-school-daily-routine": ["入学前", "入学", "学校生活", "一日の流れ"],
  "nidirect-share-newborn-care": ["新生児", "赤ちゃん", "世話", "分担", "休む"],
});
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
// The official snapshot stores presentational Markdown markers. Prepared
// originals are plain text, so remove only syntax which has no textual content.
const passageText = value => value.replace(/\*\*/gu, "").replace(/\\\|/gu, "|");
const record = (value, label) => {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
};
const text = (value, label, max = 20_000) => {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.trim() && value.length <= max, `${label} must be nonblank and bounded`);
  return value;
};
const nullableDate = (value, label) => {
  if (value === null) return null;
  assert.match(text(value, label, 10), /^\d{4}-\d{2}-\d{2}$/u, `${label} must be an ISO date or null`);
  return value;
};
const strings = (value, label, allowEmpty = false) => {
  assert(Array.isArray(value) && (allowEmpty || value.length), `${label} must be ${allowEmpty ? "an" : "a nonempty"} array`);
  return value.map((item, index) => text(item, `${label}[${index}]`, 2_000));
};
const httpsUrl = (value, label) => {
  const result = text(value, label, 2_048);
  assert.match(result, /^https:\/\//u, `${label} must use HTTPS`);
  return result;
};
function insideWork(relative, label) {
  const absolute = path.resolve(WORK, relative);
  const back = path.relative(WORK, absolute);
  assert(back && !back.startsWith("..") && !path.isAbsolute(back), `${label} must remain in expansion evidence-work`);
  return absolute;
}
function usage(value, label) {
  const input = record(value, label);
  const copyright = record(input.copyrightPermission, `${label}.copyrightPermission`);
  const axes = {
    copyrightPermission: {
      status: text(copyright.status, `${label}.copyrightPermission.status`, 100),
      basis: strings(copyright.conditions, `${label}.copyrightPermission.conditions`).join("\n"),
    },
    contentVerification: {
      status: text(input.contentVerification, `${label}.contentVerification`, 120),
      basis: "official snapshots bound to each stored passage",
    },
    adoptionApproval: {
      status: text(input.adoptionApproval, `${label}.adoptionApproval`, 120),
      basis: "no adoption requested or granted",
    },
    publicationStatus: {
      status: text(input.publicationStatus, `${label}.publicationStatus`, 120),
      basis: "private preparation/evaluation only",
    },
    externalAI: {
      status: text(input.externalAI, `${label}.externalAI`, 120),
      basis: "provider processing terms not reviewed; no API call authorized",
    },
  };
  assert.match(axes.contentVerification.status, /verified/u, `${label}.contentVerification must be verified for prepared text`);
  assert.match(axes.copyrightPermission.status, /permitted|CC_BY/u, `${label}.copyrightPermission must permit the prepared private use`);
  assert.match(axes.adoptionApproval.status, /not_requested|not_granted/u, `${label} cannot claim adoption approval`);
  assert(!/^(?:published|approved)$/u.test(axes.publicationStatus.status), `${label} cannot claim publication`);
  assert.match(axes.externalAI.status, /hold/u, `${label}.externalAI must remain held`);
  const unresolvedNoncommercial = /noncommercial|(?:^|_)NC(?:_|$)/iu.test(axes.copyrightPermission.status)
    || /noncommercial/iu.test(axes.publicationStatus.status);
  return {
    axes,
    termsUrl: httpsUrl(copyright.termsUrl, `${label}.copyrightPermission.termsUrl`),
    officialUrls: [],
    sourceObjectSha256: sha256(JSON.stringify(input)),
    databasePreparationEligible: !unresolvedNoncommercial,
    holdReason: unresolvedNoncommercial
      ? "noncommercial_or_nc_scope_does_not_establish_private_product_development_permission"
      : null,
  };
}
function loadSnapshot(value, label) {
  const key = text(value, label, 100);
  const file = insideWork("overseas/snapshots/official-pages.json", label);
  const raw = fs.readFileSync(file, "utf8");
  const snapshot = record(JSON.parse(raw), `${label} snapshot`);
  const source = record(record(snapshot.sources, `${label} snapshot.sources`)[key], `${label} snapshot.sources.${key}`);
  const body = text(source.markdown, `${label} snapshot.sources.${key}.markdown`, 500_000);
  return { body, file: path.relative(ROOT, file), jsonPath: `$.sources.${key}.markdown`, sha256: sha256(raw) };
}
function unitFrom(value, document, index) {
  const input = record(value, `${document.id}.units[${index}]`);
  const id = text(input.unitId, `${document.id}.units[${index}].unitId`, 128);
  const heading = text(input.heading, `${id}.heading`, 500);
  const originalText = text(input.originalText, `${id}.originalText`);
  const snapshot = loadSnapshot(input.sourceSnapshotKey, `${id}.sourceSnapshotKey`);
  assert(passageText(snapshot.body).includes(originalText), `${id}.originalText must be a contiguous plain-text quote in its snapshot`);
  assert.equal(input.originalSha256, sha256(originalText), `${id}.originalSha256 does not match original text`);
  const terms = record(input.retrievalTerms, `${id}.retrievalTerms`);
  const suppliedSourceTerms = strings(terms.sourceTerms, `${id}.retrievalTerms.sourceTerms`);
  const queryTerms = strings(terms.queryTerms, `${id}.retrievalTerms.queryTerms`);
  queryTerms.push(...(GENERIC_JA_ALIASES[id] ?? []));
  const passageBacked = suppliedSourceTerms.filter(term =>
    originalText.toLocaleLowerCase().includes(term.toLocaleLowerCase())
    || heading.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  const sourceTerms = passageBacked.filter(term =>
    /[\u3040-\u30ff\u3400-\u9fff]/u.test(term) || /^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/u.test(term));
  // A worker may include a page-level discovery phrase beside passage terms.
  // It remains an alias and is never represented as native passage text.
  queryTerms.push(...suppliedSourceTerms.filter(term =>
    !passageBacked.includes(term)
    && (/[\u3040-\u30ff\u3400-\u9fff]/u.test(term) || /^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/u.test(term))));
  assert(sourceTerms.length > 0, `${id} needs at least one passage-backed source term`);
  assert(queryTerms.some(term => /[\u3040-\u30ff\u3400-\u9fff]/u.test(term)), `${id} needs a Japanese discovery alias`);
  return {
    id,
    heading,
    originalText,
    sourceUrl: document.url,
    sourceLocation: text(input.sourceLocation, `${id}.sourceLocation`, 1_000),
    sourceSnapshot: { file: snapshot.file, jsonPath: snapshot.jsonPath, sha256: snapshot.sha256 },
    originalSha256: sha256(originalText),
    summaryJa: text(input.summaryJa, `${id}.summaryJa`),
    targetDescription: text(input.target, `${id}.target`, 1_000),
    canSuggest: strings(input.canSuggest, `${id}.canSuggest`),
    conditions: strings(input.conditions, `${id}.conditions`),
    mustNotAssert: strings(input.mustNotAssert, `${id}.mustNotAssert`),
    originalExamples: strings(input.originalExamples, `${id}.originalExamples`, true),
    weikuExamples: strings(input.weikuExamples, `${id}.weikuExamples`, true),
    retrievalTerms: { sourceTerms: [...new Set(sourceTerms)], queryTerms: [...new Set(queryTerms)] },
  };
}
function documentFrom(value, index) {
  const input = record(value, `overseas.documents[${index}]`);
  const informationClass = text(input.informationClass, `overseas.documents[${index}].informationClass`, 100);
  assert(["scientific_evidence", "practical_guidance", "professional_practice"].includes(informationClass),
    `${input.id ?? index} has unsupported informationClass`);
  const scientificCertainty = text(input.scientificCertainty, `${input.id}.scientificCertainty`, 100);
  assert(["not_assessed", "source_reported"].includes(scientificCertainty),
    `${input.id}.scientificCertainty may not be inferred from publisher reputation`);
  const language = text(input.language, `${input.id}.language`, 30);
  const sourceDate = record(input.date, `${input.id}.date`);
  const document = {
    id: text(input.id, `overseas.documents[${index}].id`, 128),
    title: text(input.title, `${input.id}.title`, 500),
    publisher: text(input.publisher, `${input.id}.publisher`, 300),
    url: httpsUrl(input.url, `${input.id}.url`),
    country: text(input.country, `${input.id}.country`, 100),
    language,
    originalLanguage: language,
    ageDescription: text(input.ageDescription, `${input.id}.ageDescription`, 500),
    updatedOn: nullableDate(sourceDate.value, `${input.id}.date.value`),
    checkedOn: null,
    japanDifferences: strings(input.japanApplicability, `${input.id}.japanApplicability`),
    informationClass,
    scientificCertainty,
    usageTerms: usage(input.rights, `${input.id}.rights`),
    originalDocumentType: "official_parent_guidance_webpage",
    documentType: informationClass,
  };
  assert(Array.isArray(input.units) && input.units.length, `${document.id}.units must be nonempty`);
  return { ...document, units: input.units.map((unit, unitIndex) => unitFrom(unit, document, unitIndex)) };
}

export function loadExpansionPrepared({ allowPending = false } = {}) {
  const prior = loadPreparedGuidance();
  const priorUnits = prior.sources.flatMap(source => source.documents.flatMap(document => document.units));
  assert.equal(priorUnits.length, 18, "prior pilot must retain all 18 units");
  assert.equal(priorUnits.filter(unit => unit.id === "cfa-regional-parenting-support-historical-detail").length, 1,
    "prior historical unit identity changed");
  if (!fs.existsSync(OVERSEAS_FILE)) {
    if (!allowPending) throw new Error("overseas prepared input is pending");
    return { prior, overseas: null, missing: [path.relative(ROOT, OVERSEAS_FILE)] };
  }
  const root = record(JSON.parse(fs.readFileSync(OVERSEAS_FILE, "utf8")), "overseas prepared root");
  assert.equal(root.format, "weiku.overseas-parenting-prepared.v2");
  assert.match(text(root.checkedAt, "overseas.checkedAt", 40), /^\d{4}-\d{2}-\d{2}T/u);
  assert(Array.isArray(root.documents) && root.documents.length > 0, "overseas documents must be nonempty");
  const checkedOn = root.checkedAt.slice(0, 10);
  const checkedDocuments = root.documents.map(documentFrom).map(document => ({ ...document, checkedOn }));
  const documents = checkedDocuments.filter(document => document.usageTerms.databasePreparationEligible);
  const heldDocuments = checkedDocuments.filter(document => !document.usageTerms.databasePreparationEligible).map(document => ({
    id: document.id,
    title: document.title,
    holdReason: document.usageTerms.holdReason,
    usageTerms: document.usageTerms,
  }));
  const candidateLedger = record(JSON.parse(fs.readFileSync(OVERSEAS_CANDIDATES, "utf8")), "overseas candidates");
  assert.equal(candidateLedger.format, "weiku.overseas-parenting-candidates.v1");
  assert(Number.isInteger(candidateLedger.selectionCount)
    && candidateLedger.selectionCount >= 6 && candidateLedger.selectionCount <= 8,
  "overseas candidate ledger must shortlist 6 to 8 sources");
  assert(Array.isArray(candidateLedger.candidates) && candidateLedger.candidates.length === candidateLedger.selectionCount);
  const heldCandidates = candidateLedger.candidates
    .filter(candidate => String(candidate.decision).includes("hold"))
    .map(candidate => ({
      id: text(candidate.id, "held candidate id", 128),
      decision: text(candidate.decision, `${candidate.id}.decision`, 200),
      rightsStatus: text(candidate.rightsStatus, `${candidate.id}.rightsStatus`, 500),
      holdReason: text(candidate.holdReason, `${candidate.id}.holdReason`, 2_000),
    }));
  const ids = [...priorUnits.map(unit => unit.id), ...documents.flatMap(document => document.units.map(unit => unit.id))];
  assert.equal(new Set(ids).size, ids.length, "all prior and new unit IDs must remain unique");
  return {
    prior,
    overseas: {
      group: "overseas",
      file: path.relative(ROOT, OVERSEAS_FILE),
      candidateCount: candidateLedger.selectionCount,
      documents,
      heldDocuments,
      heldCandidates,
    },
    missing: [],
  };
}