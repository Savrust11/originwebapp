import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { output, sha } from "./prepare.mjs";
import { atomicJson } from "../parenting-expansion-02/lifecycle-finalizer.mjs";

// Post-cleanup derived summary only. Never change the result or repeat a DB run.
export function finalizeDerivedSummary() {
  const resultFile = path.join(output, "result.json");
  const summaryFile = path.join(output, "brief-summary.json");
  const resultBytes = fs.readFileSync(resultFile);
  const summaryBytes = fs.readFileSync(summaryFile);
  const result = JSON.parse(resultBytes);
  const summary = JSON.parse(summaryBytes);
  assert.equal(summary.status, "passed_cleanup_complete");
  assert.equal(result.lifecycleCleanupStatus, "owned_cluster_stopped_and_deleted");
  assert.equal(summary.invocationNonce, result.invocationNonce);
  assert.equal(summary.runId, result.runId);
  assert.equal(result.cleanupAttestation.ownedRootRemoved, true);
  assert.equal(result.cleanupAttestation.ownedPostgresIdentityGone, true);
  const legacyKeys = ["priorCurrentUnits", "newEligibleDocuments", "newEligibleUnits",
    "heldDocumentsExcluded", "consultationQueries", "paraphraseQueries"];
  const legacyValues = Object.fromEntries(legacyKeys.map(key => [key, summary[key]]));
  const derived = {
    ...summary,
    legacyCompatibilityFields: {
      keys: legacyKeys,
      scope: "Retained expansion-02/base-pilot and overseas verification only; these top-level fields are NOT expansion-03 municipal additions or whole-run query totals. Preserved for report-builder compatibility.",
    },
    legacyExpansion02Summary: {
      scope: "17 base-pilot current units plus 3 retained overseas units; the 3 consultation and 3 paraphrase queries exercise retained overseas material.",
      ...legacyValues,
    },
    priorExpansionCurrentUnitsRetained: result.priorExpansionCurrentUnitsRetained,
    newMunicipalUnits: result.municipal.loadedRecords,
    totalCurrentUnits: result.priorExpansionCurrentUnitsRetained + result.municipal.loadedRecords,
    municipalQueryCount: result.municipal.consultations.length,
    totalConsultationAndParaphraseQueryCount: result.consultations.length + result.paraphrases.length + result.municipal.consultations.length,
    currentRunQueryScope: "Municipal query count includes researcher cases and added natural Japanese consultations. Combined query count also includes retained overseas consultations/paraphrases; per-unit native/Japanese probes are reported separately as retrievalVerifiedUnits.",
    derivedFromResultSha256: sha(resultBytes),
  };
  const archive = path.join(output, "archive", `brief-summary-before-scope-labels-${sha(summaryBytes)}.json`);
  if (!fs.existsSync(archive)) fs.writeFileSync(archive, summaryBytes, { flag: "wx", mode: 0o600 });
  atomicJson(summaryFile, derived, result.invocationNonce);
  assert.equal(sha(fs.readFileSync(resultFile)), sha(resultBytes), "summary derivation must not modify result");
  return { runId: result.runId, municipalQueryCount: derived.municipalQueryCount, resultUnchanged: true };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(finalizeDerivedSummary()));