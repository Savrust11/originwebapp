import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { register as registerTsx } from "tsx/esm/api";
import { assertSafeCallerEnvironment } from "../parenting-expansion-02/safe-caller.mjs";
import { runFinalizedInvocation, atomicJson, safeFailureDiagnostic } from "../parenting-expansion-02/lifecycle-finalizer.mjs";
import { verifyActualSourceDisplay } from "../parenting-expansion-02/actual-display-browser.mjs";
import { preservation, output, root, sha } from "./prepare.mjs";
import { loadInputs } from "./input.mjs";
import { verifyExpansionDisplay } from "./verify-display.mjs";

try {
  assertSafeCallerEnvironment(process.env);
  assert.deepEqual(process.argv.slice(2), ["--authorize-expansion04-owned-validation"],
    "fresh explicit expansion04-only invocation authorization required");
  preservation();
  const input = loadInputs(); // No child/storage if either dataset is pending.
  const nonce = randomBytes(16).toString("hex");
  const startedAtMs = Date.now();
  atomicJson(path.join(output, "authorization.json"), {
    invocationNonce: nonce, startedAtMs, scope: "expansion04-owned-disposable-validation-only",
    userInstruction: "Continue executable wiring; once datasets ready integrate/full clean ephemeral validation through cleanup. No existing DB, app/workflow, model API or external network.",
    inputHashes: input.hashes, contractSha256: sha(fs.readFileSync(path.join(output, "input-contract.json"))),
    preservationSha256: sha(fs.readFileSync(path.join(output, "preservation-manifest.json"))),
    priorFactsAndPermissionAxesPreserved: true, externalModel: false, externalNetwork: false,
  }, nonce);
  registerTsx();
  await import("./register.mjs");
  let denied = false;
  try { await import("../parenting-expansion-02/loader-preflight.mts"); }
  catch (error) {
    if (error.message !== "managed test authorization required") throw error;
    denied = true;
  }
  assert(denied, "loader must deny unauthorized imports before storage");
  const { runOwnedExpansionChild } = await import("./runner-child.mjs");
  await runFinalizedInvocation({
    nonce, startedAtMs, resultFile: path.join(output, "result.json"),
    summaryFile: path.join(output, "brief-summary.json"), displayFile: path.join(output, "source-display-payload.json"),
    archiveDirectory: path.join(output, "archive"), validationDirectory: output,
    integrityFile: path.join(root, "prototypes/evidence-consultation/parenting-expansion-02/native-integrity.json"),
    execute: () => runOwnedExpansionChild(nonce),
    verifyDisplay: async display => {
      const result = JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"));
      assert.equal(result.invocationNonce, nonce);
      assert.deepEqual(result.inputHashes, input.hashes);
      assert.equal(result.retrievalVerifiedUnits, 35 + input.additions.length);
      const retained = await verifyActualSourceDisplay(display);
      const expansion04 = await verifyExpansionDisplay(result, input);
      assert.deepEqual(loadInputs().hashes, input.hashes);
      preservation();
      atomicJson(path.join(output, "offline-display-verification.json"), {
        invocationNonce: nonce, runId: result.runId, retained, expansion04,
      }, nonce);
      return { retained, expansion04 };
    },
  });
  preservation();
  console.log("expansion04 validation passed with nonce-bound owned cleanup and offline source display");
} catch (error) {
  console.error(`EXPANSION04_SAFE_FAILURE:${JSON.stringify(safeFailureDiagnostic(error, "expansion04_entry"))}`);
  process.exitCode = 1;
}