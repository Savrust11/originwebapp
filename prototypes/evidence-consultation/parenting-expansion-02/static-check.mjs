import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadExpansionPrepared, ROOT } from "./prepared-loader.mjs";

await import("./preservation-check.mjs");
const pending = loadExpansionPrepared({ allowPending: true });
assert.equal(pending.prior.sources.flatMap(source => source.documents).length, 7);
assert.equal(pending.prior.sources.flatMap(source => source.documents.flatMap(document => document.units)).length, 18);
assert.equal(pending.prior.sources.flatMap(source => source.documents.flatMap(document => document.units))
  .filter(unit => unit.id !== "cfa-regional-parenting-support-historical-detail").length, 17);
if (pending.overseas === null) {
  assert.equal(pending.missing.length, 1);
  console.log(`overseas prepared input: pending (${pending.missing[0]})`);
} else {
  assert(pending.overseas.candidateCount >= 6 && pending.overseas.candidateCount <= 8,
    "candidate ledger must contain 6 to 8 shortlisted overseas sources");
  assert(pending.overseas.documents.length <= pending.overseas.candidateCount);
  for (const document of pending.overseas.documents) {
    assert.equal(document.usageTerms.databasePreparationEligible, true);
    assert(!/noncommercial|(?:^|_)NC(?:_|$)/iu.test(document.usageTerms.axes.copyrightPermission.status));
  }
  for (const held of pending.overseas.heldDocuments) {
    assert.equal(held.usageTerms.databasePreparationEligible, false);
    assert.match(held.holdReason, /noncommercial_or_nc/u);
  }
  assert.equal(pending.overseas.heldCandidates.length, 5, "five shortlisted candidates must remain held outside DB preparation");
  console.log(`overseas prepared input: ${pending.overseas.documents.length} eligible, ${pending.overseas.heldCandidates.length} held candidate(s)`);
}
const ownFiles = fs.readdirSync(path.join(ROOT, "prototypes/evidence-consultation/parenting-expansion-02"))
  .filter(name => name.endsWith(".mjs") && !["static-check.mjs", "static-safety-check.mjs"].includes(name))
  .map(name => fs.readFileSync(path.join(ROOT, "prototypes/evidence-consultation/parenting-expansion-02", name), "utf8"))
  .join("\n");
for (const forbidden of ["OPENAI_API_KEY", "api.openai.com", "publishEvidenceVersion(", "current_published_version_id ="]) {
  assert(!ownFiles.includes(forbidden), `expansion harness must not contain ${forbidden}`);
}
console.log("expansion static preparation: passed (no database or network used)");