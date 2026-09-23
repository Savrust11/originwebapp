import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const NONCE = /^[a-f0-9]{32}$/u;
const RUN_ID = /^parenting-expansion-[a-f0-9]{24}$/u;
export function atomicJson(file, value, nonce) {
  assert.match(nonce, NONCE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${nonce}.next`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}
function archive(file, directory, nonce) {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const bytes = fs.readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  fs.renameSync(file, path.join(directory, `${path.basename(file, ".json")}-${digest}-${nonce}.json`));
}
function processIdentityGone(pid, startTime) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u)[19] !== startTime;
  } catch {
    return true;
  }
}
export function safeFailureDiagnostic(error, fallbackStage = "entry") {
  const reason = String(error?.message ?? "unspecified failure")
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/giu, "[redacted-dsn]")
    .replace(/\/tmp\/ephemeral-postgres-[A-Za-z0-9_-]+/gu, "[owned-root]")
    .replace(/\/home\/[^/\s]+\/[^\s,'"}]+/gu, "[workspace-path]")
    .replace(/\b[a-f0-9]{32,}\b/giu, "[redacted-opaque]").replace(/\s+/gu, " ").slice(0, 320);
  const stage = /^[a-z][a-z0-9_]{0,63}$/u.test(error?.expansionStage ?? fallbackStage)
    ? (error?.expansionStage ?? fallbackStage) : "unknown";
  return { code: /integrity|hash/iu.test(reason) ? "integrity_rejected" : /cleanup/iu.test(reason) ? "cleanup_not_attested" : "scoped_execution_failed",
    stage, errorName: /^[A-Za-z][A-Za-z0-9]{0,40}$/u.test(error?.name) ? error.name : "Error", reason };
}
function adaptationRecords(directory, integrityFile) {
  const integrity = JSON.parse(fs.readFileSync(integrityFile, "utf8"));
  return Object.entries(integrity.modules).map(([modulePath, originalSha256]) => {
    const file = path.join(directory, `adaptation-${path.basename(modulePath)}.json`);
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(record.path, modulePath);
    assert.equal(record.originalSha256, originalSha256);
    assert.match(record.adaptedSha256, /^[a-f0-9]{64}$/u);
    assert.notEqual(record.adaptedSha256, originalSha256);
    assert.equal(record.adaptations.length, 1);
    return record;
  });
}
function fresh(file, nonce, startedAtMs) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert(stat.mtimeMs >= startedAtMs - 2_000);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(value.invocationNonce, nonce);
  assert.match(value.runId, RUN_ID);
  return value;
}
export async function runFinalizedInvocation(options) {
  const { nonce, startedAtMs, resultFile, summaryFile, displayFile, archiveDirectory,
    validationDirectory, integrityFile, execute, verifyDisplay } = options;
  archive(resultFile, archiveDirectory, nonce);
  archive(summaryFile, archiveDirectory, nonce);
  archive(displayFile, archiveDirectory, nonce);
  atomicJson(summaryFile, { format: "weiku.parenting-expansion.entry-status.v1", invocationNonce: nonce, status: "running_not_finalized" }, nonce);
  try {
    const attestation = await execute();
    assert.equal(attestation?.format, "weiku.owned-ephemeral-cleanup-attestation.v1");
    assert.equal(attestation.invocationNonce, nonce);
    assert.equal(attestation.cleanupComplete, true);
    assert.match(attestation.ownedRoot, /^\/tmp\/ephemeral-postgres-[A-Za-z0-9_-]+$/u);
    assert.equal(fs.existsSync(attestation.ownedRoot), false);
    assert(Number.isInteger(attestation.postgresPid) && attestation.postgresPid > 1);
    assert.equal(typeof attestation.postgresStartTime, "string");
    assert(processIdentityGone(attestation.postgresPid, attestation.postgresStartTime));
    const adaptations = adaptationRecords(validationDirectory, integrityFile);
    const result = fresh(resultFile, nonce, startedAtMs);
    const summary = fresh(summaryFile, nonce, startedAtMs);
    const display = fresh(displayFile, nonce, startedAtMs);
    assert.equal(result.runId, summary.runId);
    assert.equal(result.runId, display.runId);
    const browserVerification = await verifyDisplay(display);
    result.lifecycleCleanupStatus = "owned_cluster_stopped_and_deleted";
    result.cleanupAttestation = { ownedRootRemoved: true, ownedPostgresIdentityGone: true, adaptations };
    result.sourceDisplayBrowserVerification = browserVerification;
    summary.status = "passed_cleanup_complete";
    summary.lifecycleCleanupStatus = result.lifecycleCleanupStatus;
    atomicJson(resultFile, result, nonce);
    atomicJson(summaryFile, summary, nonce);
    return { runId: result.runId };
  } catch (error) {
    if (fs.existsSync(resultFile)) archive(resultFile, archiveDirectory, nonce);
    if (fs.existsSync(displayFile)) archive(displayFile, archiveDirectory, nonce);
    const diagnostic = safeFailureDiagnostic(error, "finalization");
    atomicJson(summaryFile, {
      format: "weiku.parenting-expansion.entry-status.v1", invocationNonce: nonce,
      status: "failed_not_finalized", lifecycleCleanupStatus: "not_attested", diagnostic,
    }, nonce);
    const failure = new Error("safe expansion invocation failed");
    failure.name = "SafeExpansionFailure";
    failure.diagnostic = diagnostic;
    throw failure;
  }
}