import { verifyMunicipalSearch } from "./scoped-search.mjs";
import assert from "node:assert/strict";
export function municipalItems(input) {
  return input.records.map(record => ({
    group: "municipal03", isNew: false, isHistorical: false, record,
    document: {
      id: record.id, title: record.title, publisher: record.publisher, url: record.officialUrl,
      language: "ja", originalLanguage: "ja", country: "Japan",
      ageDescription: record.targetDescription ?? "原資料の対象条件を確認",
      informationClass: "service_information", scientificCertainty: "not_applicable",
      documentType: "service_information", originalDocumentType: "municipal_official_factual_record",
      checkedOn: record.checkedOn, updatedOn: null,
      usageTerms: { storage: record.permission },
    },
    unit: {
      id: record.id, heading: record.title, originalText: record.originalText,
      originalSha256: record.originalSha256, summaryJa: record.summaryJa,
      sourceSnapshot: record.snapshot, sourceLocation: record.sourceLocation,
      targetDescription: record.targetDescription ?? "原資料の対象条件を確認",
      canSuggest: [record.summaryJa], conditions: record.conditions ?? [],
      mustNotAssert: record.mustNotAssert,
      retrievalTerms: { sourceTerms: record.sourceTerms, queryTerms: record.queryTerms },
    },
  }));
}
export async function runMunicipalChecks(options) {
  const state = await options.pool.query(`SELECT s.id AS source_id, s.status, s.test_only AS source_test_only,
    s.current_published_version_id, v.id AS version_id, v.test_only AS version_test_only,
    v.publication_status, v.manual_reviewed, v.reviewer_name, v.reviewed_at, v.adoption_reason
    FROM evidence_sources s JOIN evidence_versions v ON v.source_id=s.id
    WHERE s.source_key LIKE ($1 || '-%')`, [options.runId]);
  assert.equal(state.rows.length, 10 + options.items.length, "retain ten prior document versions");
  for (const row of state.rows) {
    assert.equal(row.status, "draft");
    assert.equal(row.source_test_only, true);
    assert.equal(row.version_test_only, true);
    assert.equal(row.publication_status, "draft");
    assert.equal(row.manual_reviewed, false);
    for (const key of ["current_published_version_id", "reviewer_name", "reviewed_at", "adoption_reason"]) assert.equal(row[key], null);
  }
  const consultations = await verifyMunicipalSearch(options);
  return {
    loadedRecords: options.items.length, consultations, factReadyUnits: 0,
    measuredDraftVersions: state.rows.length, measuredReviewedVersions: 0,
    normalSearchResults: 0, displayVerification: "See nonce-bound result.sourceDisplayBrowserVerification.municipalDisplay",
    scope: "private geography filtering only; normal application search is unchanged",
    records: options.items.map(item => ({
      id: item.record.id, sourceId: item.sourceId, versionId: item.versionId, sectionId: item.sectionId,
      originalSha256: item.record.originalSha256, geography: item.record.geography,
      officialUrl: item.record.officialUrl, checkedOn: item.record.checkedOn,
      coverage: item.record.coverage, testOnly: true, publicationStatus: "draft",
    })),
  };
}