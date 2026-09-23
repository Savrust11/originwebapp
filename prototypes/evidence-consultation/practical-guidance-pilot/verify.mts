import "../../../tests/safety/require-managed.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import dns from "node:dns";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { pool } from "../../../server/db.ts";
import {
  addEvidenceDerivedText,
  createEvidenceConcept,
  createEvidenceSource,
  ingestEvidenceVersion,
  linkEvidenceSectionKeyword,
  upsertEvidenceDictionaryTerm,
  upsertEvidenceKeyword,
} from "../../../server/evidence/catalog.ts";
import {
  searchEvidence,
  searchEvidenceDraftCandidates,
} from "../../../server/evidence/search.ts";
import {
  emptyDocumentApplicabilityPolicy,
  emptySectionApplicabilityPolicy,
} from "../../../shared/evidence.ts";
import {
  loadPreparedGuidance,
  ROOT,
  WORK,
} from "./prepared-loader.mjs";
import { atomicJson, safeFailureDiagnostic } from "./lifecycle-finalizer.mjs";

type Unit = ReturnType<typeof loadPreparedGuidance>["sources"][number]["documents"][number]["units"][number];
type Persisted = {
  unit: Unit;
  documentId: string;
  sourceId: string;
  versionId: string;
  sectionId: string;
  classification: string;
  rightsClass: unknown;
};

const target = new URL(process.env.DATABASE_URL!);
const invocationNonce = process.env.PRACTICAL_INVOCATION_NONCE;
assert.match(invocationNonce ?? "", /^[a-f0-9]{32}$/u, "managed invocation nonce is required");
assert.equal(target.hostname, "127.0.0.1", "pilot DB must be loopback");
const allowedPort = Number(target.port);
assert(Number.isInteger(allowedPort) && allowedPort > 0, "pilot DB port must be explicit");
const originalConnect = net.connect;
const originalCreateConnection = net.createConnection;
const originalSocketConnect = net.Socket.prototype.connect;
const originalLookup = dns.lookup;
const guardedConnect = function (...args: any[]) {
  const option = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
  const host = option.host ?? "localhost";
  if (!["127.0.0.1", "localhost"].includes(host) || Number(option.port) !== allowedPort) {
    throw new Error("external network denied");
  }
  return originalConnect.apply(net, args as any);
};
(net as any).connect = guardedConnect;
(net as any).createConnection = guardedConnect;
(net.Socket.prototype as any).connect = function (...args: any[]) {
  const option = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
  const host = option.host ?? "localhost";
  if (!["127.0.0.1", "localhost"].includes(host) || Number(option.port) !== allowedPort) {
    throw new Error("external network denied");
  }
  return originalSocketConnect.apply(this, args as any);
};
(dns as any).lookup = function (hostname: string, ...args: any[]) {
  if (!["127.0.0.1", "localhost"].includes(hostname)) throw new Error("external DNS denied");
  return originalLookup.call(dns, hostname, ...args as any);
};
(globalThis as any).fetch = async () => { throw new Error("external fetch denied"); };

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const runId = `practical-guidance-${randomBytes(12).toString("hex")}`;
const prepared = loadPreparedGuidance();
const persisted: Persisted[] = [];
const classifications = {
  scientific_evidence: 0,
  practical_guidance: 0,
  service_information: 0,
  professional_practice: 0,
};

function policyFor(unit: Unit, classification: string, ageDescription: string, usageTerms: unknown) {
  const policy = structuredClone(emptySectionApplicabilityPolicy);
  const terms = JSON.stringify({
    classification,
    ageDescription,
    targetDescription: unit.targetDescription,
    usageTerms,
    bindings: {
      conditions: unit.conditions,
      canSuggest: unit.canSuggest,
      mustNotAssert: unit.mustNotAssert,
      originalExamples: unit.originalExamples,
      weikuExamples: unit.weikuExamples,
    },
    derivative: { summaryJa: true, original: false },
  });
  assert(terms.length <= 4_000, `${unit.id} structured section metadata exceeds storage bounds`);
  policy.usage = {
    mode: "specific",
    terms,
    exceptions: [],
  };
  return policy;
}

function contains(text: string, term: string) {
  return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

async function stage() {
  for (const source of prepared.sources) {
    for (const document of source.documents) {
      classifications[document.informationClass] += 1;
      const sourceRow = await createEvidenceSource(pool, {
        sourceKey: `${runId}-${source.group}-${document.id}`,
        testOnly: true,
      }) as { id: string };
      const documentPolicy = structuredClone(emptyDocumentApplicabilityPolicy);
      documentPolicy.usage = {
        mode: "specific",
        terms: JSON.stringify({
          classification: document.informationClass,
          usageTerms: document.usageTerms.storage,
          scientificCertainty: "not_assessed",
          ageDescription: document.ageDescription,
          originalDocumentType: document.originalDocumentType,
          originalLanguage: document.originalLanguage,
        }),
        exceptions: [],
      };
      const ingest = await ingestEvidenceVersion(pool, {
        sourceId: sourceRow.id,
        version: `prepared-${runId}`,
        title: document.title,
        publisher: document.publisher,
        authors: [],
        originalUrl: document.url,
        externalIdentifier: document.id,
        documentType: document.documentType,
        language: document.language,
        publishedOn: null,
        revisedOn: null,
        age: { scope: "unknown", minMonths: null, maxMonths: null },
        regions: { scope: "unknown", values: [] },
        conditions: { scope: "unknown", values: [], exceptions: [] },
        certainty: { level: null, assessmentMethod: null, assessmentSource: null },
        documentApplicabilityPolicy: documentPolicy,
        testOnly: true,
        sections: document.units.map((unit) => ({
          sectionType: "excerpt",
          heading: unit.heading,
          originalText: unit.originalText,
          sourceLocation: unit.sourceLocation,
          notes: JSON.stringify({
            unitId: unit.id,
            sourceSnapshot: unit.sourceSnapshot,
            originalSha256: unit.originalSha256,
          }),
          applicabilityPolicy: policyFor(unit, document.informationClass, document.ageDescription, document.usageTerms.storage),
        })),
      });
      for (const [index, unit] of document.units.entries()) {
        const sectionId = ingest.sectionIds[index];
        await addEvidenceDerivedText(pool, {
          sourceVersionId: ingest.versionId,
          originalSectionId: sectionId,
          kind: "summary",
          language: "ja",
          content: unit.summaryJa,
          creationMethod: "prepared-source-worker",
          reviewStatus: "unchecked",
          reviewerName: null,
          reviewedAt: null,
        });
        persisted.push({
          unit,
          documentId: document.id,
          sourceId: sourceRow.id,
          versionId: ingest.versionId,
          sectionId,
          classification: document.informationClass,
          rightsClass: document.usageTerms.storage,
        });
      }
    }
  }
}

async function linkVocabulary() {
  for (const item of persisted) {
    if (item.documentId === "cfa-sukusuku-historical") continue;
    const concept = await createEvidenceConcept(pool, { conceptKey: `${runId}-${item.unit.id}` }) as { id: string };
    const keywordIds = new Map<string, string>();
    for (const term of item.unit.retrievalTerms.sourceTerms) {
      assert(contains(`${item.unit.heading} ${item.unit.originalText}`, term), `${item.unit.id} source term must remain native and passage-backed`);
      const keyword = await upsertEvidenceKeyword(pool, {
        id: randomUUID(), conceptId: concept.id, term,
        language: /[\u3040-\u30ff\u3400-\u9fff]/u.test(term) ? "ja" : "en",
        active: true, testOnly: true,
      }) as { id: string };
      keywordIds.set(term, keyword.id);
    }
    for (const term of item.unit.retrievalTerms.queryTerms) {
      await upsertEvidenceDictionaryTerm(pool, {
        id: randomUUID(), conceptId: concept.id, term,
        language: /[\u3040-\u30ff\u3400-\u9fff]/u.test(term) ? "ja" : "en",
        testOnly: true,
      });
    }
    for (const keywordId of keywordIds.values()) {
      await linkEvidenceSectionKeyword(pool, {
        sourceVersionId: item.versionId,
        sectionId: item.sectionId,
        keywordId,
      });
    }
  }
}

const questions = [
  "出かける前の支度が進まない",
  "子どもとどう遊べばよいか分からない",
  "食べないので毎回作り直して疲れる",
  "頼れる人がいなくて休めない",
];
const paraphrases = [
  "外出の準備をスムーズにしたい",
  "親子の遊び方を知りたい",
  "偏食への対応で消耗している",
  "育児を一人で抱えて休息できない",
];

async function main() {
  await stage();
  await linkVocabulary();
  const sectionIds = new Set(persisted.map((item) => item.sectionId));
  const historicalIds = new Set(persisted.filter((item) => item.documentId === "cfa-sukusuku-historical").map((item) => item.sectionId));
  const currentItems = persisted.filter((item) => item.documentId !== "cfa-sukusuku-historical");
  const retrievalVerified = new Set<string>();
  const unitRetrievalProbes = [];
  let normalProbeCandidateCount = 0;
  for (const item of currentItems) {
    const nativeTerm = item.unit.retrievalTerms.sourceTerms[0];
    const japaneseAlias = item.unit.retrievalTerms.queryTerms.find((term) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(term));
    assert(nativeTerm, `${item.unit.id} needs a native passage term probe`);
    assert(japaneseAlias, `${item.unit.id} needs a general Japanese alias probe`);
    const nativeResponse = await searchEvidenceDraftCandidates(pool, { question: nativeTerm, limit: 20 }, runId);
    const aliasResponse = await searchEvidenceDraftCandidates(pool, { question: japaneseAlias, limit: 20 }, runId);
    assert(nativeResponse.results.some((result) => result.sectionId === item.sectionId),
      `${item.unit.id} native term must retrieve its own section`);
    assert(aliasResponse.results.some((result) => result.sectionId === item.sectionId),
      `${item.unit.id} Japanese alias must retrieve its own passage-backed section`);
    assert([...nativeResponse.results, ...aliasResponse.results].every((result) => !historicalIds.has(result.sectionId)),
      "historical held unit must remain excluded from unit probes");
    const normalNative = await searchEvidence(pool, { question: nativeTerm, limit: 20 });
    const normalAlias = await searchEvidence(pool, { question: japaneseAlias, limit: 20 });
    const normalPilotResults = [...normalNative.results, ...normalAlias.results]
      .filter((result) => sectionIds.has(result.sectionId));
    assert.equal(normalPilotResults.length, 0, "ordinary published search must exclude every pilot unit probe");
    normalProbeCandidateCount += normalPilotResults.length;
    retrievalVerified.add(item.unit.id);
    unitRetrievalProbes.push({
      unitId: item.unit.id,
      vocabularyLinked: true,
      nativeQuery: { term: nativeTerm, ownSectionRetrieved: true },
      generalJapaneseAliasProbe: { term: japaneseAlias, ownSectionRetrieved: true },
      retrievalVerified: true,
    });
  }
  const historicalItem = persisted.find((item) => item.documentId === "cfa-sukusuku-historical")!;
  unitRetrievalProbes.push({
    unitId: historicalItem.unit.id,
    vocabularyLinked: false,
    nativeQuery: null,
    generalJapaneseAliasProbe: null,
    retrievalVerified: false,
    excludedAsHistorical: true,
  });
  assert.equal(retrievalVerified.size, 17, "all current units must pass both retrieval probes");
  const normal = await Promise.all(questions.map((question) => searchEvidence(pool, { question, limit: 20 })));
  assert.equal(normal.flatMap((response) => response.results).filter((result) => sectionIds.has(result.sectionId)).length, 0,
    "ordinary published search must return zero pilot drafts");

  const evaluated = [];
  const fourQueryHits = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const response = await searchEvidenceDraftCandidates(pool, { question, limit: 20 }, runId);
    assert(response.results.length > 0, `evaluation query ${index + 1} needs a passage-backed candidate`);
    assert(response.results.every((result) => !historicalIds.has(result.sectionId)), "historical held units must be excluded from retrieval");
    for (const result of response.results) {
      assert(sectionIds.has(result.sectionId), "draft adapter returned another run");
      const item = persisted.find((candidate) => candidate.sectionId === result.sectionId)!;
      assert.equal(result.originalText, item.unit.originalText);
      assert.equal(sha256(result.originalText), item.unit.originalSha256);
      assert.equal(result.source.review.manualReviewed, false);
      assert.equal(result.source.review.reviewerName, null);
      assert.equal(result.source.certainty.level, null);
      assert.equal(result.applicability.age, "unverified", "unknown age must remain usable only as an unverified related candidate");
      fourQueryHits.add(item.unit.id);
    }
    evaluated.push({
      kind: "primary",
      question,
      status: response.status,
      results: response.results.map((result) => {
        const item = persisted.find((candidate) => candidate.sectionId === result.sectionId)!;
        return {
          unitId: item.unit.id,
          sourceId: result.sourceId,
          versionId: result.versionId,
          sectionId: result.sectionId,
          originalText: result.originalText,
          summaryJaDerivativeUnchecked: item.unit.summaryJa,
          sourceUrl: item.unit.sourceUrl,
          sourceLocation: item.unit.sourceLocation,
          rightsClass: item.rightsClass,
          ageApplicability: result.applicability.age,
          scientificCertainty: "not_assessed",
        };
      }),
    });
  }
  for (const question of paraphrases) {
    const response = await searchEvidenceDraftCandidates(pool, { question, limit: 20 }, runId);
    evaluated.push({
      kind: "paraphrase",
      question,
      status: response.status,
      results: response.results.map((result) => {
        const item = persisted.find((candidate) => candidate.sectionId === result.sectionId)!;
        return { unitId: item.unit.id, sourceId: result.sourceId, sectionId: result.sectionId };
      }),
    });
  }
  for (const question of ["スマートフォンの写真を整理したい", "高熱の診断と薬の量を教えて"]) {
    const response = await searchEvidenceDraftCandidates(pool, { question, limit: 20 }, runId);
    assert.equal(response.results.length, 0, "irrelevant or diagnostic requests must not retrieve general guidance");
    evaluated.push({ kind: "negative", question, status: response.status, results: [] });
  }
  const measured = await pool.query<{
    sources: number; versions: number; sections: number; derivatives: number;
  }>(`SELECT
      (SELECT count(*)::integer FROM evidence_sources WHERE source_key LIKE ($1 || '-%')) AS sources,
      (SELECT count(*)::integer FROM evidence_versions v JOIN evidence_sources s ON s.id=v.source_id WHERE s.source_key LIKE ($1 || '-%')) AS versions,
      (SELECT count(*)::integer FROM evidence_sections e JOIN evidence_versions v ON v.id=e.source_version_id JOIN evidence_sources s ON s.id=v.source_id WHERE s.source_key LIKE ($1 || '-%')) AS sections,
      (SELECT count(*)::integer FROM evidence_derived_texts d JOIN evidence_versions v ON v.id=d.source_version_id JOIN evidence_sources s ON s.id=v.source_id WHERE s.source_key LIKE ($1 || '-%')) AS derivatives`,
  [runId]);
  const row = measured.rows[0];
  assert.equal(Number(row.sources), 7);
  assert.equal(Number(row.versions), 7);
  assert.equal(Number(row.sections), persisted.length);
  assert.equal(Number(row.derivatives), persisted.length);
  assert.deepEqual(classifications, {
    scientific_evidence: 0,
    practical_guidance: classifications.practical_guidance,
    service_information: classifications.service_information,
    professional_practice: 0,
  });

  const report = {
    format: "weiku.practical-guidance-pilot.validation.v1",
    invocationNonce,
    runId,
    lifecycleCleanupStatus: "pending_parent_owned_finally",
    sourceDocumentCounts: Object.fromEntries(prepared.sources.map((source) => [source.group, source.documents.length])),
    requestedSourceGroupCount: 4,
    requestedSourceGroups: ["cdc-routines", "cdc-communication", "nhs-fussy-eaters", "cfa-umbrella"],
    classifications,
    measuredLoadedDb: {
      sources: Number(row.sources),
      versions: Number(row.versions),
      sections: Number(row.sections),
      uncheckedJapaneseSummaryDerivatives: Number(row.derivatives),
    },
    normalSearchPilotCandidateCount: 0,
    normalUnitProbePilotCandidateCount: normalProbeCandidateCount,
    queries: evaluated,
    unitRetrievalProbes,
    units: persisted.map((item) => ({
      unitId: item.unit.id,
      documentId: item.documentId,
      classification: item.classification,
      rightsClass: item.rightsClass,
      prepared: true,
      loaded: true,
      vocabularyLinked: item.documentId !== "cfa-sukusuku-historical",
      retrievalVerified: retrievalVerified.has(item.unit.id),
      fourQueryHit: fourQueryHits.has(item.unit.id),
      factReady: false,
      hold: item.documentId === "cfa-sukusuku-historical"
        ? "historical_noncurrent_excluded_from_retrieval"
        : "draft_unreviewed_no_fact_projection_or_publication",
      sourceId: item.sourceId,
      versionId: item.versionId,
      sectionId: item.sectionId,
      sourceSnapshot: item.unit.sourceSnapshot,
      originalSha256: item.unit.originalSha256,
      returnedOriginalBindingRequired: true,
      displayProvenance: {
        original: { publisherAttribution: true, sourceUrl: item.unit.sourceUrl },
        japaneseSummaryDerivative: {
          original: false,
          reviewStatus: "unchecked",
          publisherBrandAttributionAuthorized: item.documentId.startsWith("nhs-") ? false : null,
          editorialAttribution: "We育編集",
        },
      },
      originalExamples: item.unit.originalExamples,
      weikuExamples: item.unit.weikuExamples,
      conditions: item.unit.conditions,
      canSuggest: item.unit.canSuggest,
      mustNotAssert: item.unit.mustNotAssert,
    })),
  };
  atomicJson(path.join(WORK, "validation/result.json"), report, invocationNonce!);
  atomicJson(path.join(WORK, "validation/brief-summary.json"), {
    format: "weiku.practical-guidance-pilot.brief-summary.v1",
    invocationNonce,
    status: "passed_pending_parent_cleanup",
    runId,
    requestedSourceGroups: 4,
    documents: 7,
    units: persisted.length,
    loadedDb: report.measuredLoadedDb,
    normalSearchPilotCandidateCount: 0,
    normalUnitProbePilotCandidateCount: normalProbeCandidateCount,
    vocabularyLinkedUnits: currentItems.length,
    retrievalVerifiedUnits: retrievalVerified.size,
    fourPrimaryQueryHitUnits: fourQueryHits.size,
    factReadyUnits: 0,
    holds: ["all_units_draft_unreviewed", "no_fact_projection", "no_publication"],
  }, invocationNonce!);
}

let failure: unknown;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  (net as any).connect = originalConnect;
  (net as any).createConnection = originalCreateConnection;
  (net.Socket.prototype as any).connect = originalSocketConnect;
  (dns as any).lookup = originalLookup;
  await pool.end();
}
if (failure) {
  const stack = typeof (failure as { stack?: unknown })?.stack === "string"
    ? (failure as { stack: string }).stack
    : "";
  const line = Number(stack.match(/practical-guidance-pilot\/verify\.mts:(\d{1,4}):\d+/u)?.[1] ?? 1);
  const diagnostic = safeFailureDiagnostic(failure, "managed_verification");
  console.error(`SAFE_PRACTICAL_FAILURE:${JSON.stringify({
    line,
    code: diagnostic.code,
    errorName: diagnostic.errorName,
    reason: diagnostic.reason,
  })}`);
  process.exitCode = 1;
}