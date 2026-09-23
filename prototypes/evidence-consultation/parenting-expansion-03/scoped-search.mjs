import assert from "node:assert/strict";
// Explicit private result gate. This is not an enhancement to normal application search.
export function inJurisdiction(geography, location) {
  if (geography.prefecture !== location.prefecture) return false;
  if (geography.level === "prefecture") return true;
  if (geography.municipality !== location.municipality) return false;
  if (geography.level === "administrative_ward") return geography.parentCity === location.municipality && geography.ward === location.ward;
  if (geography.level === "facility" && geography.ward) return geography.ward === location.ward;
  return true;
}
export async function verifyMunicipalSearch({ pool, runId, items, input, draftSearch, normalSearch }) {
  const bySection = new Map(items.map(item => [item.sectionId, item]));
  const consultations = [];
  for (const query of input.queries) {
    const ordinary = await normalSearch(pool, { question: query.question, limit: 20 });
    assert.equal(ordinary.results.length, 0, "ordinary search must exclude all drafts");
    const raw = await draftSearch(pool, { question: query.question, limit: 20 }, runId);
    const scoped = raw.results.filter(result => {
      const item = bySection.get(result.sectionId);
      return item && inJurisdiction(item.record.geography, query.location);
    });
    const found = scoped.map(result => bySection.get(result.sectionId).record.id);
    for (const id of query.expectedIds) assert(found.includes(id), `${query.id}: missing ${id}`);
    for (const id of query.excludedIds) assert(!found.includes(id), `${query.id}: wrong geography ${id}`);
    if (query.kind === "geographical_negative") {
      assert.equal(query.expectedIds.length, 0);
      assert.equal(found.length, 0, `${query.id}: geographical negative returned scoped municipal data`);
    }
    if (["geographical_negative", "ward_city_boundary"].includes(query.kind)) {
      assert(query.excludedIds.length > 0, `${query.id}: geographic control must name excluded records`);
      assert(raw.results.some(r => query.excludedIds.includes(bySection.get(r.sectionId)?.record.id)),
        `${query.id}: geographic control must exercise an actual raw search hit, not an empty lexical search`);
    }
    const links = scoped.map(result => {
      const item = bySection.get(result.sectionId);
      assert.equal(result.originalText, item.record.originalText);
      assert.equal(result.sourceId, item.sourceId);
      assert.equal(result.versionId, item.versionId);
      assert.equal(result.originalUrl, item.record.officialUrl);
      assert.equal(result.source.testOnly, true);
      assert.equal(result.source.review.manualReviewed, false);
      assert(item.sourceId && item.versionId && item.sectionId);
      return { recordId: item.record.id, sourceId: item.sourceId, versionId: item.versionId, sectionId: item.sectionId, officialUrl: item.record.officialUrl, checkedOn: item.record.checkedOn };
    });
    consultations.push({ ...query, rawCandidateCount: raw.results.length, scopedRecordIds: found, links, normalSearchCount: 0, scopeApplied: "private_explicit_geography_gate" });
  }
  return consultations;
}