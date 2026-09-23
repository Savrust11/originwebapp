import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve("evidence-work/parenting-expansion-02/overseas");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const candidates = read("candidates.json");
const prepared = read("prepared.json");
const snapshot = read("snapshots/official-pages.json");
const retrievalContract = read("retrieval-contract.json");
const hash = text => createHash("sha256").update(text, "utf8").digest("hex");
const normalize = text => text
  .replaceAll("\\|", "|")
  .replaceAll("**", "")
  .replaceAll("_", "")
  .replace(/\r\n/gu, "\n");

assert.equal(candidates.candidates.length, 8);
assert.equal(new Set(candidates.candidates.map(item => item.id)).size, 8);
assert.equal(prepared.documents.length, 3);
const units = prepared.documents.flatMap(document =>
  document.units.map(unit => ({ document, unit })));
assert.equal(units.length, 3);

for (const candidate of candidates.candidates) {
  assert.equal(candidate.bodyStatus.startsWith("verified_"), true);
  assert.equal(typeof candidate.country, "string");
  assert.equal(typeof candidate.language, "string");
  assert.equal(typeof candidate.ageDescription, "string");
  assert.equal(typeof candidate.japanDifferences[0], "string");
  if (candidate.decision.startsWith("prepared")) {
    assert(prepared.documents.some(document => document.id === candidate.preparedDocumentId));
  } else {
    assert.equal(typeof candidate.holdReason, "string");
  }
}

for (const { document, unit } of units) {
  assert(["practical_guidance", "service_information", "scientific_evidence", "professional_practice"]
    .includes(document.informationClass));
  assert.equal(document.scientificCertainty, "not_assessed");
  for (const state of ["copyrightPermission", "contentVerification", "adoptionApproval", "publicationStatus", "externalAI"]) {
    assert(Object.hasOwn(document.rights, state), `${document.id} missing ${state}`);
  }
  assert.equal(hash(unit.originalText), unit.originalSha256);
  const source = snapshot.sources[unit.sourceSnapshotKey];
  assert(source, `${unit.unitId} missing snapshot`);
  assert(normalize(source.markdown).includes(normalize(unit.originalText)),
    `${unit.unitId} original text is not snapshot-backed`);
  assert.match(unit.summaryJa, /^We育編集：/u);
  assert(unit.retrievalTerms.sourceTerms.some(term => normalize(unit.originalText).includes(term)));
  assert(unit.retrievalTerms.queryTerms.some(term => /[\u3040-\u30ff\u3400-\u9fff]/u.test(term)));
  assert(Array.isArray(unit.canSuggest) && unit.canSuggest.length > 0);
  assert(Array.isArray(unit.mustNotAssert) && unit.mustNotAssert.length > 0);
}

const held = candidates.candidates.filter(item => item.decision === "hold_candidate_only");
assert.equal(held.length, 5);
assert(held.every(item => !prepared.documents.some(document => document.id === item.preparedDocumentId)));
assert.deepEqual(
  new Set(prepared.documents.map(document => document.id)),
  new Set(["nhs-baby-play", "nidirect-primary-school-routine", "nidirect-sharing-newborn-care"])
);
for (const rightsHeld of ["canada-stay-calm-connected", "canada-make-life-easier", "nz-school-transition"]) {
  assert(!prepared.documents.some(document => document.id === rightsHeld),
    `${rightsHeld} must not be eligible without purpose-specific NC clearance`);
}
assert(snapshot.sources.niCrown.markdown.includes(
  "free of charge in any format or medium, under the terms of the Open Government Licence"));
assert.equal(retrievalContract.queries.length, 3);
for (const query of retrievalContract.queries) {
  const item = units.find(({ unit }) => unit.unitId === query.expectedUnitId);
  assert(item, `${query.id} expected unit is not eligible`);
  assert(item.unit.retrievalTerms.queryTerms.includes(query.boundAlias));
  assert.equal(item.document.url, query.expectedSourceUrl);
  assert.equal(query.displayMode, "short_suggestion_then_source_detail");
}
for (const documentId of retrievalContract.mustExcludeDocumentIds) {
  assert(!prepared.documents.some(document => document.id === documentId));
}
console.log(JSON.stringify({
  candidates: candidates.candidates.length,
  preparedDocuments: prepared.documents.length,
  preparedUnits: units.length,
  heldCandidates: held.length,
  snapshotCitationsVerified: units.length,
  retrievalContractQueries: retrievalContract.queries.length
}));