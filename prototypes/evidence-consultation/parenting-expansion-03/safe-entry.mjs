import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { register as registerTsx } from "tsx/esm/api";
import { assertSafeCallerEnvironment } from "../parenting-expansion-02/safe-caller.mjs";
import { runFinalizedInvocation, atomicJson } from "../parenting-expansion-02/lifecycle-finalizer.mjs";
import { verifyActualSourceDisplay } from "../parenting-expansion-02/actual-display-browser.mjs";
import { preservation, output, root, sha } from "./prepare.mjs";
import { loadMunicipal } from "./municipal-input.mjs";
import { verifyMunicipalDisplay } from "./verify-display.mjs";
import { finalizeDerivedSummary } from "./finalize-summary.mjs";

try {
  assertSafeCallerEnvironment(process.env);
  preservation();
  const { input } = loadMunicipal(); // Fail before any cluster if research input is pending.
  const nonce = randomBytes(16).toString("hex");
  const inputFile = path.join(root, "evidence-work/parenting-expansion-03/municipal/validation-input.json");
  const originalInputBytes = fs.readFileSync(inputFile);
  const originalInput = JSON.parse(originalInputBytes);
  atomicJson(path.join(output, "input-adaptation.json"), {
    invocationNonce: nonce, inputSha256: sha(originalInputBytes), sourceFileModified: false,
    rationale: "Retain unknown authority codes as null; preserve prohibited/not_requested/draft; add descriptive axes limited to independent factual summaries and short identifying headings; use unique actual headings as keywords to avoid reassigning global prior keywords; add only source-explicit Japanese aliases.",
    originalConsultationQueries: originalInput.queries.length,
    adaptedConsultationQueries: input.queries,
    records: input.records.map(record => ({
      id: record.id,
      originalPermission: originalInput.records.find(r => r.id === record.id).permission,
      adaptedPermission: record.permission, queryTerms: record.queryTerms, sourceTerms: record.sourceTerms,
    })),
  }, nonce);
  const startedAtMs = Date.now();
  registerTsx();
  await import("./register.mjs");
  let denied = false;
  try { await import("../parenting-expansion-02/loader-preflight.mts"); }
  catch (error) {
    if (error.message !== "managed test authorization required") throw error;
    denied = true;
  }
  assert(denied, "authorization preflight must reject before storage");
  const { runOwnedExpansionChild } = await import("./runner-child.mjs");
  await runFinalizedInvocation({
    nonce, startedAtMs,
    resultFile: path.join(output, "result.json"),
    summaryFile: path.join(output, "brief-summary.json"),
    displayFile: path.join(output, "source-display-payload.json"),
    archiveDirectory: path.join(output, "archive"),
    validationDirectory: output,
    integrityFile: path.join(root, "prototypes/evidence-consultation/parenting-expansion-02/native-integrity.json"),
    execute: () => runOwnedExpansionChild(nonce),
    verifyDisplay: async display => {
      const result = JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"));
      assert.equal(result.invocationNonce, nonce);
      assert.equal(result.municipal.loadedRecords, input.records.length);
      const retainedDisplay = await verifyActualSourceDisplay(display);
      const municipalDisplay = await verifyMunicipalDisplay(result, input);
      preservation();
      atomicJson(path.join(output, "offline-display-verification.json"), { invocationNonce: nonce, runId: result.runId, retainedDisplay, municipalDisplay }, nonce);
      return { retainedDisplay, municipalDisplay };
    },
  });
  finalizeDerivedSummary();
  preservation();
  assert.equal(sha(fs.readFileSync(inputFile)), sha(originalInputBytes), "municipal source input changed during validation");
  console.log("expansion03 validation: passed with owned cleanup and offline display");
} catch (error) {
  // Never print database URLs or caller environment.
  console.error(`EXPANSION03_SAFE_FAILURE:${error?.diagnostic ? JSON.stringify(error.diagnostic) : String(error?.message ?? "validation failed").replace(/postgres(?:ql)?:\/\/\S+/gu, "[redacted]").slice(0, 400)}`);
  process.exitCode = 1;
}