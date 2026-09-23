import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadExpansionPrepared, WORK } from "./prepared-loader.mjs";
import { verifyParentDisplayRevision } from "./parent-display-browser.mjs";

const validation = path.join(WORK, "validation");
const resultFile = path.join(validation, "result.json");
const sourceDisplayFile = path.join(validation, "source-display-payload.json");
const resultBytes = fs.readFileSync(resultFile);
const sourceDisplayBytes = fs.readFileSync(sourceDisplayFile);
const result = JSON.parse(resultBytes);
const sourceDisplay = JSON.parse(sourceDisplayBytes);
assert.equal(result.runId, sourceDisplay.runId);
assert.equal(result.lifecycleCleanupStatus, "owned_cluster_stopped_and_deleted");
const prepared = loadExpansionPrepared();
const units = new Map(prepared.overseas.documents.flatMap(document =>
  document.units.map(unit => [unit.id, { document, unit }])));
const parentExamples = [];
const internalExamples = [];
for (const example of sourceDisplay.examples) {
  const resultUnit = result.units.find(unit => unit.sectionId === example.sectionId);
  assert(resultUnit?.isNew, "display example must bind a retrieved new unit");
  const preparedItem = units.get(resultUnit.unitId);
  assert(preparedItem, "display unit must remain in prepared overseas data");
  assert.equal(example.originalSha256, preparedItem.unit.originalSha256);
  assert.equal(example.sourceUrl, preparedItem.document.url);
  const isNhsAdaptation = preparedItem.document.id === "nhs-baby-play";
  const payload = structuredClone(example.payload);
  payload.parentDisplay = {
    mode: isNhsAdaptation ? "derivative_only_no_publisher_attribution" : "original_and_derivative",
    conditions: preparedItem.unit.conditions,
  };
  if (resultUnit.unitId === "nhs-baby-play-from-four-months") {
    payload.answer = `4か月頃から、その日の余力に合わせ、話す・歌う・絵本を見る中から一つだけ試す選択肢があります。`;
  }
  if (resultUnit.unitId === "nidirect-share-newborn-care") {
    payload.answer = `新生児期に、安全に頼める別の養育者がいる場合は、おむつ、抱く、必要品の準備などから一つ、分担できるか相談する選択肢があります。`;
  }
  if (isNhsAdaptation) {
    internalExamples.push({
      displayKey: resultUnit.unitId,
      sourceId: example.sourceId,
      versionId: example.versionId,
      sectionId: example.sectionId,
      originalSha256: example.originalSha256,
      sourceUrl: example.sourceUrl,
      title: example.payload.details.original.title,
      publisher: example.payload.details.original.publisher,
      originalPassage: example.payload.details.original.passage,
      visibility: "internal_audit_only",
      reason: "NHS adaptation display keeps original provenance separate from the parent-facing adaptation card",
    });
    delete payload.details.original;
    payload.details.internalOriginalAvailable = true;
    payload.details.rights.copyrightPermission.status = "licensed_public_sector_information";
    payload.details.rights.displayNotice = "Contains public sector information licensed under the Open Government Licence v3.0. 日本語の要約・例はWe育編集による翻案です。";
    payload.details.rights.termsUrl = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
  }
  parentExamples.push({
    displayKey: isNhsAdaptation ? "infant-play-from-four-months" : resultUnit.unitId,
    payload,
  });
}
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const parent = {
  format: "weiku.parenting-expansion.parent-source-display.v2",
  runId: result.runId,
  revisionType: "display_only_post_cleanup",
  databaseValidationReusedNotRerun: true,
  examples: parentExamples,
};
const audit = {
  format: "weiku.parenting-expansion.internal-source-audit.v1",
  runId: result.runId,
  visibility: "internal_only",
  resultSha256: sha256(resultBytes),
  priorSourceDisplaySha256: sha256(sourceDisplayBytes),
  examples: internalExamples,
};
const parentFile = path.join(validation, "parent-source-display-v2.json");
const auditFile = path.join(validation, "internal-source-audit.json");
fs.writeFileSync(parentFile, `${JSON.stringify(parent, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(auditFile, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 });
const browser = await verifyParentDisplayRevision(parent, audit);
fs.writeFileSync(path.join(validation, "display-only-revision.json"), `${JSON.stringify({
  format: "weiku.parenting-expansion.display-only-revision.v1",
  runId: result.runId,
  resultSha256: audit.resultSha256,
  priorSourceDisplaySha256: audit.priorSourceDisplaySha256,
  databaseRerun: false,
  databaseResultModified: false,
  parentArtifact: path.relative(WORK, parentFile),
  internalAuditArtifact: path.relative(WORK, auditFile),
  browser,
}, null, 2)}\n`, { mode: 0o600 });
console.log("display-only revision written; database validation was not rerun or modified");