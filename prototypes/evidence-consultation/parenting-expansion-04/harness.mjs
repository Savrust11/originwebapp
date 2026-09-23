import assert from "node:assert/strict";
import { municipalItems, runMunicipalChecks } from "../parenting-expansion-03/municipal-harness.mjs";
import { inJurisdiction } from "../parenting-expansion-03/scoped-search.mjs";

export function expansionItems(input) {
  const prior = municipalItems(input.prior);
  const added = input.additions.map(record => {
    const item = municipalItems({ records: [record] })[0];
    item.group = `expansion04-${record.inputKind}`;
    item.document.language = record.attribution.originalLanguage;
    item.document.originalLanguage = record.attribution.originalLanguage;
    item.document.country = record.country ?? (record.inputKind === "municipal" ? "Japan" : "not_recorded");
    item.document.informationClass = record.inputKind === "municipal" ? "service_information" : "practical_guidance";
    item.document.documentType = record.inputKind === "municipal" ? "service_information" : "guideline";
    item.document.originalDocumentType = record.inputKind === "municipal" ? "municipal_official_factual_record" : "official_practical_guidance";
    // Native English vocabulary deliberately rejects punctuation. Use a checked,
    // contiguous source phrase, not punctuation-stripping or altered evidence.
    const exactPhrases = {
      "wales-tantrum-safe-reconnect": ["Big Feelings and Big Behaviours (Tantrums)", "Big Feelings and Big Behaviours"],
      "wales-baby-quiet-time": ["Top tips for parents of babies — Quiet time", "Top tips for parents of babies"],
      "wales-care-backup-plan": ["The work–family balancing act", "family balancing act"],
    };
    const phrase = exactPhrases[record.id];
    if (phrase) {
      assert.deepEqual(record.sourceTerms, [phrase[0]]);
      assert(`${record.title} ${record.originalText}`.includes(phrase[1]));
      item.unit.retrievalTerms = { sourceTerms: [phrase[1]], queryTerms: record.queryTerms };
    }
    return item;
  });
  return [...prior, ...added];
}
function inScope(record, query) {
  if (record.inputKind === "municipal" && !inJurisdiction(record.geography, query.location ?? {})) return false;
  return record.scope.population.includes(query.scope.population) &&
    record.scope.supports.includes(query.scope.support) &&
    !record.scope.doesNotSupport.includes(query.scope.support);
}
export async function runExpansionChecks({ pool, runId, items, input, draftSearch, normalSearch }) {
  const bySection = new Map(items.map(item => [item.sectionId, item]));
  const priorItems = items.filter(item => !item.record.inputKind);
  // The frozen helper asserts the prior version count, so give it a read-only
  // count projection limited to its own source IDs, not a falsified row count.
  const priorPool = { query: async (sql, args) => {
    const response = await pool.query(sql, args);
    return { ...response, rows: response.rows.filter(row => !items.some(item =>
      item.record.inputKind && item.sourceId === row.source_id)) };
  }};
  const priorChecks = await runMunicipalChecks({
    pool: priorPool, runId, items: priorItems, input: input.prior, draftSearch, normalSearch,
  });
  const queries = [];
  for (const query of input.queries) {
    const normal = await normalSearch(pool, { question: query.question, limit: 20 });
    assert.equal(normal.results.length, 0);
    const raw = await draftSearch(pool, { question: query.question, limit: 20 }, runId);
    const candidates = raw.results.filter(r => bySection.get(r.sectionId)?.record.inputKind === query.inputKind);
    const selected = candidates.filter(r => inScope(bySection.get(r.sectionId).record, query));
    const found = selected.map(r => bySection.get(r.sectionId).record.id);
    for (const id of query.expectedIds) assert(found.includes(id), `${query.id}: missing ${id}`);
    for (const id of query.excludedIds) assert(!found.includes(id), `${query.id}: excluded ${id}`);
    if (query.kind.endsWith("_negative") || query.kind === "ward_city_boundary") {
      assert(candidates.some(r => query.excludedIds.includes(bySection.get(r.sectionId).record.id)),
        `${query.id}: negative must exercise raw candidates; diagnostic=${JSON.stringify(raw.diagnostics)}; returned=${raw.results.length}`);
    }
    if (query.kind.endsWith("_negative")) assert.equal(found.length, 0);
    for (const result of selected) {
      const item = bySection.get(result.sectionId);
      assert.equal(result.originalText, item.unit.originalText);
      assert.equal(result.originalUrl, item.document.url);
      assert.equal(result.sourceId, item.sourceId);
      assert.equal(result.versionId, item.versionId);
      assert.equal(result.source.testOnly, true);
      assert.equal(result.source.review.manualReviewed, false);
    }
    queries.push({ ...query, rawCandidateCount: candidates.length, scopedRecordIds: found, normalSearchResults: 0 });
  }
  const state = await pool.query(`SELECT s.status, s.test_only, s.current_published_version_id,
    v.publication_status, v.test_only AS version_test_only, v.manual_reviewed,
    v.reviewer_name, v.reviewed_at, v.adoption_reason FROM evidence_sources s
    JOIN evidence_versions v ON v.source_id=s.id WHERE s.source_key LIKE ($1 || '-%')`, [runId]);
  assert.equal(state.rows.length, 25 + input.additions.length);
  for (const row of state.rows) {
    assert.equal(row.status, "draft"); assert.equal(row.publication_status, "draft");
    assert.equal(row.test_only, true); assert.equal(row.version_test_only, true); assert.equal(row.manual_reviewed, false);
    for (const key of ["current_published_version_id", "reviewer_name", "reviewed_at", "adoption_reason"]) assert.equal(row[key], null);
  }
  return {
    priorCurrentUnits: 35, historicalUnitsRetainedExcluded: 1, priorMunicipal: priorChecks,
    newUnits: input.additions.length, totalCurrentUnits: 35 + input.additions.length,
    queries, normalSearchResults: 0, factReadyUnits: 0,
    records: items.map(item => ({ id: item.record.id, sourceId: item.sourceId, versionId: item.versionId,
      sectionId: item.sectionId, originalSha256: item.unit.originalSha256, inputKind: item.record.inputKind ?? "retained_municipal",
      originalSourceTerms: item.record.sourceTerms, stagedSourceTerms: item.unit.retrievalTerms.sourceTerms,
      queryTermsUnchanged: true })),
  };
}