// Final boundary encompassing both the question-authoring stage and model/cost stage.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ROOT, BASE, verifyPreservation } from "./preserve.mjs";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const file = path.join(BASE, "final-freeze.json");
const relative = value => path.relative(ROOT, value).split(path.sep).join("/");
const walk = directory => fs.readdirSync(directory).sort().flatMap(name => {
  const value = path.join(directory, name);
  if (value === file || name.endsWith(".zip")) return [];
  if (fs.statSync(value).isDirectory()) return walk(value);
  const bytes = fs.readFileSync(value);
  return [{ path: relative(value), bytes: bytes.length, sha256: digest(bytes) }];
});
const core = [
  "comparison-policy.json", "models-and-budget.json", "request-packets.json",
  "app-display-templates.json", "execution-order.json", "manifest.json",
  "cases.json", "source-content.json", "rubric.json", "generation-rules.txt",
  "response-schema.json", "preparation-verification.json",
];
const action = process.argv[2];
if (!["create", "verify"].includes(action)) throw new Error("USE_CREATE_OR_VERIFY");
const preservation = verifyPreservation();
if (action === "create") {
  const checks = JSON.parse(fs.readFileSync(path.join(BASE, "preparation-verification.json")));
  assert.equal(checks.passed, true);
  const record = {
    schemaVersion: 1, comparisonId: "reading-comparison-01",
    status: "preparation-frozen-not-authorized-not-executed",
    selectedCandidate: "gpt-5.6-sol",
    subordinateManifestScope: "manifest.json binds the question-authoring stage only; its modelCandidateSelectedHere=false refers to that stage, not this final combined plan.",
    candidateAndBudgetFile: "models-and-budget.json",
    frozenBeforeAnyNewProviderTransmission: true,
    authorizedAdditionalProviderTransmissions: 0,
    historicalCumulativeTransmissions: 19, historicalCalculatedCostMicroUSD: 25879,
    oldUnusedTwentiethSlotForbidden: true,
    controlsAndPricesAreProposalsNotNewAuthorization: true,
    files: [...walk(BASE), ...walk(path.join(ROOT, "prototypes/evidence-consultation/model-comparison"))],
  };
  for (const name of core) assert.ok(record.files.some(f => f.path === relative(path.join(BASE, name))), name);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
}
const record = JSON.parse(fs.readFileSync(file));
assert.equal(record.status, "preparation-frozen-not-authorized-not-executed");
assert.equal(record.authorizedAdditionalProviderTransmissions, 0);
for (const name of core) assert.ok(record.files.some(f => f.path === relative(path.join(BASE, name))), name);
for (const item of record.files) {
  const bytes = fs.readFileSync(path.join(ROOT, item.path));
  assert.equal(bytes.length, item.bytes, item.path);
  assert.equal(digest(bytes), item.sha256, item.path);
}
console.log(JSON.stringify({ frozenFilesVerified: record.files.length, preservedResults: preservation,
  currentAdditionalProviderPermission: 0, senderImplemented: false }));