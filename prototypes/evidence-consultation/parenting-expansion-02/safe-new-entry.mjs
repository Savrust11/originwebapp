import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertSafeCallerEnvironment } from "./safe-caller.mjs";
import { initializeExpansionLoaders } from "./loader-initialization.mjs";
import { runOwnedExpansionChild } from "./runner-child.mjs";
import { runFinalizedInvocation } from "./lifecycle-finalizer.mjs";
import { verifyActualSourceDisplay } from "./actual-display-browser.mjs";

assertSafeCallerEnvironment(process.env);
if (process.argv.length !== 2) throw new Error("safe entry accepts no caller arguments");
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const validation = path.join(root, "evidence-work/parenting-expansion-02/validation");
const permissionRecord = path.join(root, "evidence-work/parenting-expansion-02/permission-reuse.json");
if (!fs.existsSync(permissionRecord)) throw new Error("permission reuse record is required");
const permission = JSON.parse(fs.readFileSync(permissionRecord, "utf8"));
if (permission.currentAuthorization?.modelApiCallsAuthorized !== false
  || permission.currentAuthorization?.existingDatabaseWritesAuthorized !== false
  || permission.currentAuthorization?.publicationApproval !== false) {
  throw new Error("permission reuse record does not retain required execution boundaries");
}
const nonce = randomBytes(16).toString("hex");
try {
  await runFinalizedInvocation({
    nonce, startedAtMs: Date.now(),
    resultFile: path.join(validation, "result.json"),
    summaryFile: path.join(validation, "brief-summary.json"),
    displayFile: path.join(validation, "source-display-payload.json"),
    archiveDirectory: path.join(validation, "archive"),
    validationDirectory: validation,
    integrityFile: path.join(directory, "native-integrity.json"),
    verifyDisplay: verifyActualSourceDisplay,
    execute: async () => {
      let expansionStage = "prepared_validation";
      try {
        const { loadExpansionPrepared } = await import("./prepared-loader.mjs");
        const prepared = loadExpansionPrepared();
        if (!prepared.overseas?.documents.length) throw new Error("no rights-eligible overseas prepared document");
        expansionStage = "loader_preflight";
        await initializeExpansionLoaders(nonce);
        expansionStage = "runner_starting";
        return await runOwnedExpansionChild(nonce);
      } catch (error) {
        if (error && typeof error === "object") error.expansionStage = expansionStage;
        throw error;
      }
    },
  });
} catch (error) {
  console.error(`PARENTING_EXPANSION_SAFE_FAILURE:${JSON.stringify(error?.diagnostic ?? {
    code: "scoped_execution_failed", stage: "entry", errorName: "Error", reason: "safe invocation failed",
  })}`);
  process.exitCode = 1;
}