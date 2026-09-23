import "../../../tests/safety/require-managed.mjs";
import assert from "node:assert/strict";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../../../server/db.ts";
import {
  addEvidenceDerivedText, createEvidenceConcept, createEvidenceSource, ingestEvidenceVersion,
  linkEvidenceSectionKeyword, upsertEvidenceDictionaryTerm, upsertEvidenceKeyword,
} from "../../../server/evidence/catalog.ts";
import { searchEvidence, searchEvidenceExpansionDrafts } from "../../../server/evidence/search.ts";
import { emptyDocumentApplicabilityPolicy, emptySectionApplicabilityPolicy } from "../../../shared/evidence.ts";
import { loadExpansionPrepared, ROOT, WORK } from "./prepared-loader.mjs";
import { atomicJson, safeFailureDiagnostic } from "./lifecycle-finalizer.mjs";
import { sourceDisplayPayload } from "./source-display.mjs";

const invocationNonce = process.env.PARENTING_EXPANSION_NONCE;
assert.match(invocationNonce ?? "", /^[a-f0-9]{32}$/u);
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, "127.0.0.1");
const allowedPort = Number(target.port);
assert(Number.isInteger(allowedPort) && allowedPort > 0);
const originals = {
  connect: net.connect, createConnection: net.createConnection,
  socketConnect: net.Socket.prototype.connect, lookup: dns.lookup,
};
const guardedConnect = function (...args: any[]) {
  const option = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
  if (!["127.0.0.1", "localhost"].includes(option.host ?? "localhost") || Number(option.port) !== allowedPort) {
    throw new Error("external network denied");
  }
  return originals.connect.apply(net, args as any);
};
(net as any).connect = guardedConnect;
(net as any).createConnection = guardedConnect;
(net.Socket.prototype as any).connect = function (...args: any[]) {
  const option = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
  if (!["127.0.0.1", "localhost"].includes(option.host ?? "localhost") || Number(option.port) !== allowedPort) {
    throw new Error("external network denied");
  }
  return originals.socketConnect.apply(this, args as any);
};
(dns as any).lookup = function (hostname: string, ...args: any[]) {
  if (!["127.0.0.1", "localhost"].includes(hostname)) throw new Error("external DNS denied");
  return originals.lookup.call(dns, hostname, ...args as any);
};
(globalThis as any).fetch = async () => { throw new Error("external fetch denied"); };

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const runId = `parenting-expansion-${randomBytes(12).toString("hex")}`;
const prepared = loadExpansionPrepared();
assert(prepared.overseas && prepared.overseas.documents.length > 0, "at least one rights-eligible overseas document is required");
const retrievalContract = JSON.parse(fs.readFileSync(path.join(WORK, "overseas/retrieval-contract.json"), "utf8"));
assert.equal(retrievalContract.format, "weiku.overseas-parenting-retrieval-contract.v1");
const historicalId = "cfa-regional-parenting-support-historical-detail";
type AnyUnit = any;
type Item = {
  group: string; document: any; unit: AnyUnit; isHistorical: boolean; isNew: boolean;
  sourceId?: string; versionId?: string; sectionId?: string;
};
const items: Item[] = [];
for (const source of prepared.prior.sources) {
  for (const document of source.documents) for (const unit of document.units) {
    items.push({ group: source.group, document, unit, isHistorical: unit.id === historicalId, isNew: false });
  }
}
for (const document of prepared.overseas.documents) for (const unit of document.units) {
  items.push({ group: "overseas", document, unit, isHistorical: false, isNew: true });
}
assert.equal(items.filter(item => !item.isNew && !item.isHistorical).length, 17);
assert.equal(items.filter(item => item.isHistorical).length, 1);
const heldIds = new Set(prepared.overseas.heldDocuments.map((document: any) => document.id));
for (const candidate of prepared.overseas.heldCandidates) heldIds.add(candidate.id);
const heldIdEquivalents = new Map([
  ["nz-school-transition", "nz-preparing-first-school-day"],
]);
for (const id of retrievalContract.mustExcludeDocumentIds) {
  const candidateId = heldIdEquivalents.get(id) ?? id;
  assert(heldIds.has(candidateId), `${id} must remain in held candidate audit metadata`);
}
assert(items.every(item => !heldIds.has(item.document.id)), "held NC/noncommercial resource entered DB load set");
assert(items.every(item => !/(?:book|isbn)/iu.test(`${item.document.id} ${item.document.originalDocumentType}`)),
  "held book metadata must not become a DB body");

function usageMetadata(item: Item) {
  if (!item.isNew) return {
    rights: item.document.usageTerms.storage,
    copyrightPermission: "prior_source_specific_state_preserved",
    contentVerification: "prior_snapshot_binding_preserved",
    adoptionApproval: "not_approved",
    publicationStatus: "not_published",
    externalAI: "held",
    displayMode: item.document.id.startsWith("nhs-")
      ? "adaptation_separate_weiku_not_nhs_attributed" : "prior_source_specific_display_hold",
  };
  const terms = item.document.usageTerms;
  assert.equal(terms.databasePreparationEligible, true);
  return {
    rights: terms,
    copyrightPermission: terms.axes.copyrightPermission.status,
    contentVerification: terms.axes.contentVerification.status,
    adoptionApproval: "not_approved",
    publicationStatus: "not_published",
    externalAI: "held",
    displayMode: item.document.id.startsWith("nhs-")
      ? "adaptation_separate_weiku_ogl_notice_not_nhs_attributed"
      : "private_rights_conditioned_example",
  };
}
function sectionPolicy(item: Item) {
  const policy = structuredClone(emptySectionApplicabilityPolicy);
  const metadata = JSON.stringify({
    informationClass: item.document.informationClass,
    ageDescription: item.document.ageDescription,
    targetDescription: item.unit.targetDescription,
    country: item.document.country ?? (item.group === "cfa" ? "Japan" : "not_recorded_in_prior_pilot"),
    language: item.document.originalLanguage,
    japanDifferences: item.document.japanDifferences ?? [],
    usage: usageMetadata(item),
    canSuggest: item.unit.canSuggest,
    conditions: item.unit.conditions,
    mustNotAssert: item.unit.mustNotAssert,
  });
  assert(metadata.length <= 4_000, `${item.unit.id} section metadata exceeds storage bounds`);
  policy.usage = { mode: "specific", terms: metadata, exceptions: [] };
  return policy;
}
async function stage() {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = `${item.group}:${item.document.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const [key, documentItems] of groups) {
    const first = documentItems[0];
    const source = await createEvidenceSource(pool, { sourceKey: `${runId}-${key.replace(/[^a-z0-9-]/giu, "-")}`, testOnly: true }) as { id: string };
    const documentPolicy = structuredClone(emptyDocumentApplicabilityPolicy);
    documentPolicy.usage = {
      mode: "specific",
      terms: JSON.stringify({
        informationClass: first.document.informationClass,
        scientificCertainty: first.document.scientificCertainty,
        ageDescription: first.document.ageDescription,
        country: first.document.country ?? null,
        language: first.document.originalLanguage,
        updatedOn: first.document.updatedOn ?? null,
        checkedOn: first.document.checkedOn ?? null,
        usage: usageMetadata(first),
      }),
      exceptions: [],
    };
    const ingest = await ingestEvidenceVersion(pool, {
      sourceId: source.id, version: `prepared-${runId}`, title: first.document.title,
      publisher: first.document.publisher, authors: [], originalUrl: first.document.url,
      externalIdentifier: first.document.id, documentType: first.document.documentType,
      language: first.document.language, publishedOn: null, revisedOn: first.document.updatedOn ?? null,
      age: { scope: "unknown", minMonths: null, maxMonths: null },
      regions: { scope: "unknown", values: [] },
      conditions: { scope: "unknown", values: [], exceptions: [] },
      certainty: { level: null, assessmentMethod: null, assessmentSource: null },
      documentApplicabilityPolicy: documentPolicy, testOnly: true,
      sections: documentItems.map(item => ({
        sectionType: "excerpt", heading: item.unit.heading, originalText: item.unit.originalText,
        sourceLocation: item.unit.sourceLocation,
        notes: JSON.stringify({ unitId: item.unit.id, sourceSnapshot: item.unit.sourceSnapshot, originalSha256: item.unit.originalSha256 }),
        applicabilityPolicy: sectionPolicy(item),
      })),
    });
    for (const [index, item] of documentItems.entries()) {
      item.sourceId = source.id; item.versionId = ingest.versionId; item.sectionId = ingest.sectionIds[index];
      await addEvidenceDerivedText(pool, {
        sourceVersionId: ingest.versionId, originalSectionId: item.sectionId, kind: "summary",
        language: "ja", content: item.unit.summaryJa, creationMethod: "prepared-source-worker",
        reviewStatus: "unchecked", reviewerName: null, reviewedAt: null,
      });
    }
  }
}
async function vocabulary() {
  for (const item of items.filter(item => !item.isHistorical)) {
    const concept = await createEvidenceConcept(pool, { conceptKey: `${runId}-${item.unit.id}` }) as { id: string };
    const keywordIds: string[] = [];
    for (const term of item.unit.retrievalTerms.sourceTerms) {
      assert(`${item.unit.heading} ${item.unit.originalText}`.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
      const keyword = await upsertEvidenceKeyword(pool, {
        id: randomUUID(), conceptId: concept.id, term,
        language: /[\u3040-\u30ff\u3400-\u9fff]/u.test(term) ? "ja" : "en", active: true, testOnly: true,
      }) as { id: string };
      keywordIds.push(keyword.id);
    }
    for (const term of item.unit.retrievalTerms.queryTerms) {
      await upsertEvidenceDictionaryTerm(pool, {
        id: randomUUID(), conceptId: concept.id, term,
        language: /[\u3040-\u30ff\u3400-\u9fff]/u.test(term) ? "ja" : "en", testOnly: true,
      });
    }
    for (const keywordId of keywordIds) await linkEvidenceSectionKeyword(pool, {
      sourceVersionId: item.versionId!, sectionId: item.sectionId!, keywordId,
    });
  }
}
async function main() {
  await stage();
  await vocabulary();
  const sectionIds = new Set(items.map(item => item.sectionId!));
  const historicalSection = items.find(item => item.isHistorical)!.sectionId!;
  const probes = [];
  for (const item of items.filter(item => !item.isHistorical)) {
    const nativeTerm = item.unit.retrievalTerms.sourceTerms[0];
    const alias = item.unit.retrievalTerms.queryTerms.find((term: string) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(term));
    assert(alias, `${item.unit.id} needs Japanese alias`);
    const [native, japanese] = await Promise.all([
      searchEvidenceExpansionDrafts(pool, { question: nativeTerm, limit: 20 }, runId),
      searchEvidenceExpansionDrafts(pool, { question: alias, limit: 20 }, runId),
    ]);
    assert(native.results.some(result => result.sectionId === item.sectionId), `${item.unit.id} native probe failed`);
    assert(japanese.results.some(result => result.sectionId === item.sectionId), `${item.unit.id} Japanese probe failed`);
    assert([...native.results, ...japanese.results].every(result => result.sectionId !== historicalSection));
    const [normalNative, normalAlias] = await Promise.all([
      searchEvidence(pool, { question: nativeTerm, limit: 20 }),
      searchEvidence(pool, { question: alias, limit: 20 }),
    ]);
    assert.equal([...normalNative.results, ...normalAlias.results].filter(result => sectionIds.has(result.sectionId)).length, 0);
    probes.push({ unitId: item.unit.id, nativeTerm, japaneseAlias: alias, ownSectionRetrieved: true });
  }
  const newItems = items.filter(item => item.isNew);
  assert.equal(retrievalContract.queries.length, 3);
  const consultations = [];
  const displayExamples = [];
  for (const contract of retrievalContract.queries) {
    const item = newItems.find(candidate => candidate.unit.id === contract.expectedUnitId);
    assert(item, `${contract.expectedUnitId} is not in the eligible corpus`);
    assert.equal(item.document.url, contract.expectedSourceUrl);
    const question = contract.question;
    assert(!question.includes(contract.boundAlias), `${contract.id} raw question unexpectedly contains its bound alias`);
    const matchedAliases = item.unit.retrievalTerms.queryTerms.filter((term: string) =>
      question.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
    assert(matchedAliases.length > 0, `${contract.id} has no explicit generic-alias normalization`);
    const response = await searchEvidenceExpansionDrafts(pool, { question, limit: 20 }, runId);
    const own = response.results.find(result => result.sectionId === item.sectionId);
    assert(own, `${item.unit.id} consultation query did not retrieve own passage`);
    assert.equal(own.originalText, item.unit.originalText);
    assert.equal(sha256(own.originalText), item.unit.originalSha256);
    assert.equal(own.source.review.manualReviewed, false);
    assert.equal(own.source.review.reviewerName, null);
    assert.equal(own.source.certainty.level, null);
    const usage = usageMetadata(item);
    const payload = sourceDisplayPayload({
      answer: item.unit.canSuggest[0],
      suggestionClass: item.document.informationClass,
      original: {
        title: item.document.title, publisher: item.document.publisher, url: item.document.url,
        passage: own.originalText, country: item.document.country, language: item.document.originalLanguage,
        ageDescription: item.document.ageDescription, updatedOn: item.document.updatedOn, checkedOn: item.document.checkedOn,
      },
      derivative: { isOriginal: false, text: item.unit.summaryJa },
      rights: {
        copyrightPermission: { status: usage.copyrightPermission },
        contentVerified: { status: usage.contentVerification },
        adoptionApproval: { status: "not_approved" },
        publicationStatus: { status: "not_published" },
        externalAI: { status: "held" },
        displayNotice: item.document.id.startsWith("nhs-")
          ? "Contains public sector information licensed under the Open Government Licence v3.0. Japanese summary and examples are Weiku editorial adaptations and are not attributed to the NHS."
          : `Contains public sector information licensed under the Open Government Licence v3.0. Source: ${item.document.title}, ${item.document.publisher}. Adapted by Weiku; no official endorsement, adoption, or publication approval is claimed.`,
        termsUrl: item.document.usageTerms.termsUrl,
      },
    });
    consultations.push({
      id: contract.id, rawQuestion: question, boundAlias: contract.boundAlias,
      questionWasReplacedByBoundAlias: false, matchedNormalizationAliases: matchedAliases,
      unitId: item.unit.id, resultCount: response.results.length, ownSectionRetrieved: true,
    });
    displayExamples.push({
      sourceId: item.sourceId, versionId: item.versionId, sectionId: item.sectionId,
      originalSha256: item.unit.originalSha256, sourceUrl: item.document.url,
      displayMode: usage.displayMode, payload,
    });
  }
  const paraphraseSpecs = [
    { expectedUnitId: "nhs-baby-play-from-four-months", question: "生後4か月ごろの子との遊び方を知りたい" },
    { expectedUnitId: "nidirect-school-daily-routine", question: "年長の子に入学後の一日をどう説明するか知りたい" },
    { expectedUnitId: "nidirect-share-newborn-care", question: "新生児のお世話を家族と分けて休む方法を考えたい" },
  ];
  const paraphrases = [];
  for (const spec of paraphraseSpecs) {
    const item = newItems.find(candidate => candidate.unit.id === spec.expectedUnitId)!;
    const matchedAliases = item.unit.retrievalTerms.queryTerms.filter((term: string) =>
      spec.question.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
    assert(matchedAliases.length > 0, `${spec.expectedUnitId} paraphrase has no generic-alias normalization`);
    const response = await searchEvidenceExpansionDrafts(pool, { question: spec.question, limit: 20 }, runId);
    assert(response.results.some(result => result.sectionId === item.sectionId), `${spec.expectedUnitId} paraphrase failed`);
    paraphrases.push({
      rawQuestion: spec.question, questionWasReplacedByAlias: false,
      matchedNormalizationAliases: matchedAliases, expectedUnitId: spec.expectedUnitId,
      ownSectionRetrieved: true,
    });
  }
  for (const question of ["スマートフォンの写真を整理したい", "高熱の診断と薬の量を教えて"]) {
    const response = await searchEvidenceExpansionDrafts(pool, { question, limit: 20 }, runId);
    assert.equal(response.results.length, 0);
  }
  const measured = await pool.query(`SELECT
    (SELECT count(*)::integer FROM evidence_sources WHERE source_key LIKE ($1 || '-%')) AS sources,
    (SELECT count(*)::integer FROM evidence_versions v JOIN evidence_sources s ON s.id=v.source_id WHERE s.source_key LIKE ($1 || '-%')) AS versions,
    (SELECT count(*)::integer FROM evidence_sections e JOIN evidence_versions v ON v.id=e.source_version_id JOIN evidence_sources s ON s.id=v.source_id WHERE s.source_key LIKE ($1 || '-%')) AS sections,
    (SELECT count(*)::integer FROM evidence_derived_texts d JOIN evidence_versions v ON v.id=d.source_version_id JOIN evidence_sources s ON s.id=v.source_id WHERE s.source_key LIKE ($1 || '-%')) AS derivatives`, [runId]);
  const counts = measured.rows[0];
  const result = {
    format: "weiku.parenting-expansion.validation.v1", invocationNonce, runId,
    lifecycleCleanupStatus: "pending_parent_owned_finally",
    prior: { documents: 7, units: 18, currentUnits: 17, historicalUnitsExcludedFromRetrieval: 1 },
    overseas: {
      candidateCount: prepared.overseas!.candidateCount,
      eligibleDocuments: prepared.overseas!.documents.length,
      heldPreparedDocuments: prepared.overseas!.heldDocuments,
      heldCandidateMetadata: prepared.overseas!.heldCandidates,
      eligibleUnits: newItems.length,
    },
    measuredLoadedDb: {
      sources: Number(counts.sources), versions: Number(counts.versions),
      sections: Number(counts.sections), uncheckedJapaneseSummaryDerivatives: Number(counts.derivatives),
    },
    ordinarySearchExpansionCandidateCount: 0,
    retrievalVerifiedUnits: probes.length,
    consultations,
    paraphrases,
    negativeControls: 2,
    units: items.map(item => ({
      unitId: item.unit.id, documentId: item.document.id, isNew: item.isNew,
      historical: item.isHistorical, vocabularyLinked: !item.isHistorical,
      retrievalVerified: !item.isHistorical, informationClass: item.document.informationClass,
      scientificCertainty: item.document.scientificCertainty,
      sourceId: item.sourceId, versionId: item.versionId, sectionId: item.sectionId,
      originalSha256: item.unit.originalSha256, sourceSnapshot: item.unit.sourceSnapshot,
      sourceDisplay: usageMetadata(item), factReady: false,
    })),
  };
  atomicJson(path.join(WORK, "validation/result.json"), result, invocationNonce!);
  atomicJson(path.join(WORK, "validation/source-display-payload.json"), {
    format: "weiku.parenting-expansion.source-display.v1", invocationNonce, runId, examples: displayExamples,
  }, invocationNonce!);
  atomicJson(path.join(WORK, "validation/brief-summary.json"), {
    format: "weiku.parenting-expansion.summary.v1", invocationNonce, runId,
    status: "passed_pending_parent_cleanup", priorCurrentUnits: 17,
    newEligibleDocuments: prepared.overseas!.documents.length, newEligibleUnits: newItems.length,
    heldDocumentsExcluded: prepared.overseas!.heldDocuments.length + prepared.overseas!.heldCandidates.length,
    retrievalVerifiedUnits: probes.length, consultationQueries: consultations.length,
    paraphraseQueries: paraphrases.length,
    normalSearchCandidates: 0, factReadyUnits: 0,
  }, invocationNonce!);
}

let failure: unknown;
try { await main(); } catch (error) { failure = error; } finally {
  (net as any).connect = originals.connect;
  (net as any).createConnection = originals.createConnection;
  (net.Socket.prototype as any).connect = originals.socketConnect;
  (dns as any).lookup = originals.lookup;
  await pool.end();
}
if (failure) {
  const diagnostic = safeFailureDiagnostic(failure, "managed_verification");
  console.error(`SAFE_EXPANSION_FAILURE:${JSON.stringify({ line: 1, ...diagnostic })}`);
  process.exitCode = 1;
}