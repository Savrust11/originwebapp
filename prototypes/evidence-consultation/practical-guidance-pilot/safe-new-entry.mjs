import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertSafeCallerEnvironment } from "./safe-caller.mjs";
import { initializePilotLoaders } from "./loader-initialization.mjs";
import { runOwnedPilotChild } from "./runner-child.mjs";
import {
  runFinalizedInvocation,
} from "./lifecycle-finalizer.mjs";

assertSafeCallerEnvironment(process.env);
if (process.argv.length !== 2) throw new Error("safe entry accepts no caller arguments");

const nonce = randomBytes(16).toString("hex");
const startedAtMs = Date.now();
const validation = path.resolve("evidence-work/practical-guidance-pilot-01/validation");
const resultFile = path.join(validation, "result.json");
const summaryFile = path.join(validation, "brief-summary.json");
const archive = path.join(validation, "archive");
try {
  await runFinalizedInvocation({
    nonce,
    startedAtMs,
    resultFile,
    summaryFile,
    archiveDirectory: archive,
    validationDirectory: validation,
    integrityFile: path.join(path.dirname(fileURLToPath(import.meta.url)), "native-integrity.json"),
    execute: async () => {
      let runnerStage = "prepared_validation";
      const { loadPreparedGuidance } = await import("./prepared-loader.mjs");
      loadPreparedGuidance();
      runnerStage = "loader_preflight";
      await initializePilotLoaders(nonce);
      runnerStage = "runner_starting";
      try {
        return await runOwnedPilotChild(nonce);
      } catch (error) {
        if (error && typeof error === "object") error.pilotStage = runnerStage;
        throw error;
      }
    },
  });
} catch (error) {
  const diagnostic = error?.diagnostic ?? {
    code: "scoped_execution_failed",
    stage: "entry",
    errorName: "Error",
    reason: "safe invocation failed without a diagnostic",
  };
  console.error(`PRACTICAL_SAFE_FAILURE:${JSON.stringify(diagnostic)}`);
  process.exitCode = 1;
}