import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SYSTEM_POLICY } from "./policy.mjs";
import { validatePlanBundle, validateProviderFacts } from "./plan-adapter.mjs";

const root = path.resolve(".");
const planDir = path.join(root, "evidence-work/private-parenting-trial-10/plan");
const out = path.join(root, "evidence-work/private-parenting-trial-10/offline");
const hashFile = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const planFiles = ["scenes.json", "source-plan.json", "model-budget.json", "provider-facts.json", "offline-connection-check.json", "report.md"];
const planHashes = Object.fromEntries(planFiles.map(name => [name, hashFile(path.join(planDir, name))]));
const scenes = readJson(path.join(planDir, "scenes.json"));
const sources = readJson(path.join(planDir, "source-plan.json"));
const budget = readJson(path.join(planDir, "model-budget.json"));
const providerFacts = readJson(path.join(planDir, "provider-facts.json"));
const adapted = validatePlanBundle({ scenes, sources, budget });
const provider = validateProviderFacts(providerFacts);
for (const scene of scenes.scenes) {
  for (const turn of scene.plannedUserTurns) {
    assert(!SYSTEM_POLICY.includes(turn.purpose), "evaluation purpose copied into generation system policy");
  }
}
assert(!SYSTEM_POLICY.includes("期待回答"));
assert.equal(adapted.actualRequestCandidates.length, 0);
assert(adapted.eligibility.every(item => !item.eligible));
const browser = readJson(path.join(out, "browser-check.json"));
assert.equal(browser.status, "passed_offline_file_only");
assert.equal(browser.externalRequests, 0);
const synthetic = readJson(path.join(out, "synthetic-connection/index.json"));
assert.equal(synthetic.status, "immutable_technical_synthetic_not_real_model_answer");
assert.equal(synthetic.actualProviderCalls, 0);
assert.equal(synthetic.parentingAnswer, false);
const syntheticRaw = path.join(out, "synthetic-connection", synthetic.rawFile);
const syntheticMetadata = path.join(out, "synthetic-connection", synthetic.metadataFile);
assert.equal(hashFile(syntheticRaw), synthetic.rawSha256);
assert.equal(hashFile(syntheticMetadata), synthetic.metadataSha256);
const actualRawFiles = fs.readdirSync(out, { recursive: true })
  .filter(name => String(name).endsWith(".raw.json") && !String(name).startsWith(`synthetic-connection${path.sep}`));
assert.equal(actualRawFiles.length, 0);

const artifactFiles = [
  "index.html", "reviewer.html", "review-template.json", "connection-status.json",
  "offline-verification.json", "adapter-receipt.json", "browser-check.json", "browser-check.png",
];
const receipt = {
  status: "final_offline_receipt_live_trial_blocked",
  finalPlanSha256: planHashes,
  planValidation: {
    scenes: adapted.sceneCount,
    eligibleScenesNow: adapted.eligibility.filter(item => item.eligible).length,
    actualRequestCandidates: adapted.actualRequestCandidates.length,
    providerFactsStatus: provider.status,
    datedProviderFactsPreserved: provider.datedFacts,
    currentAuthorizedTransmissions: provider.currentAuthorizedTransmissions,
  },
  executionEvidence: {
    actualProviderRequests: 0,
    actualRawProviderResponses: actualRawFiles.length,
    liveHandshakeTests: 0,
    browser: {
      fileOnly: true,
      httpServerStarted: browser.httpServerStarted,
      externalRequests: browser.externalRequests,
      screenshot: browser.screenshot,
      scenes: browser.scenes,
      futureEmptyReviewRecords: browser.futureEmptyReviewRecords,
      unratedDimensions: browser.unratedDimensions,
    },
    syntheticArchive: {
      label: synthetic.status,
      distinctFromActualResponses: true,
      rawSha256: synthetic.rawSha256,
      metadataSha256: synthetic.metadataSha256,
    },
  },
  generationBoundary: {
    authoredAssistantExamplesIncluded: false,
    expectedAnswersIncluded: false,
    evaluationPurposesIncludedInSystemPolicy: false,
    municipalSourcesIncluded: false,
    unknownRightsSourcesIncluded: false,
  },
  remainingDependencies: [
    "Five source-specific external-processing delta decisions remain unresolved.",
    "New transmission and cost authorization remains zero.",
    "The real transport is intentionally unimplemented and unconditionally throws.",
    "No live handshake, current credential check, current model entitlement check, or current price check was performed.",
  ],
  outputSha256: Object.fromEntries(artifactFiles.map(name => [name, hashFile(path.join(out, name))])),
  closedArchive: {
    sha256: hashFile(path.join(root, "evidence-work/comparison-closeout/reading-comparison-02/evidence-manifest.json")),
    unchangedExpectedSha256: "3d2d55621d3ebab1f87a8c2951b3364e1084684c22804331b1cf21327418393d",
  },
};
assert.equal(receipt.closedArchive.sha256, receipt.closedArchive.unchangedExpectedSha256);
fs.writeFileSync(path.join(out, "final-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log("Wrote final offline receipt matching final plan hashes.");
