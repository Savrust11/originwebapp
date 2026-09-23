import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  atomicJson,
  finalizeSuccessfulReports,
  runFinalizedInvocation,
} from "./lifecycle-finalizer.mjs";

const nonce = "a".repeat(32);
const directory = path.resolve(
  "evidence-work/practical-guidance-pilot-01/validation",
  `.mock-cleanup-fault-${process.pid}`,
);
const resultFile = path.join(directory, "result.json");
const summaryFile = path.join(directory, "brief-summary.json");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
try {
  const runId = `practical-guidance-${"b".repeat(24)}`;
  atomicJson(resultFile, {
    format: "weiku.practical-guidance-pilot.validation.v1",
    invocationNonce: nonce,
    runId,
    lifecycleCleanupStatus: "pending_parent_owned_finally",
  }, nonce);
  atomicJson(summaryFile, {
    format: "weiku.practical-guidance-pilot.brief-summary.v1",
    invocationNonce: nonce,
    runId,
    status: "passed_pending_parent_cleanup",
  }, nonce);
  const before = fs.readFileSync(resultFile, "utf8");
  assert.throws(() => finalizeSuccessfulReports({
    attestation: {
      format: "weiku.owned-ephemeral-cleanup-attestation.v1",
      invocationNonce: nonce,
      cleanupComplete: false,
      ownedRoot: `/tmp/ephemeral-postgres-${"c".repeat(8)}`,
      postgresPid: 999_999,
      postgresStartTime: "1",
    },
    nonce,
    startedAtMs: Date.now() - 1_000,
    resultFile,
    summaryFile,
    adaptationIntegrity: [],
  }));
  assert.equal(fs.readFileSync(resultFile, "utf8"), before, "cleanup failure must not finalize result evidence");
  assert.equal(JSON.parse(fs.readFileSync(summaryFile, "utf8")).status, "passed_pending_parent_cleanup");
  await assert.rejects(() => runFinalizedInvocation({
    nonce,
    startedAtMs: Date.now(),
    resultFile,
    summaryFile,
    archiveDirectory: path.join(directory, "archive"),
    validationDirectory: directory,
    integrityFile: path.join(directory, "unused-integrity.json"),
    execute: async () => { throw new Error("injected owned stop/remove failure"); },
  }));
  assert.equal(fs.existsSync(resultFile), false, "failed safe invocation must not retain a current passed result");
  assert.equal(JSON.parse(fs.readFileSync(summaryFile, "utf8")).status, "failed_not_finalized");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log("cleanup fault finalization check: passed");