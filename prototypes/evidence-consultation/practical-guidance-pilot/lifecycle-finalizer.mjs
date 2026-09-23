import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const NONCE = /^[a-f0-9]{32}$/u;
const RUN_ID = /^practical-guidance-[a-f0-9]{24}$/u;
const EXPECTED_ADAPTATIONS = Object.freeze({
  "tests/run-ephemeral-tests.mjs": "Require an invocation nonce and safe stage callback; replace only lifecycle/suite dispatch; return a nonce-bound attestation only after unchanged owned cleanup has succeeded and removed the root.",
  "tests/run-managed-tests.mjs": "Register one non-APP_GROUPS child, require and pass its nonce, and accept only its bounded SAFE_PRACTICAL_FAILURE diagnostic; private context and ownership cleanup are retained.",
  "server/evidence/search.ts": "Preserve the hash-pinned ordinary SEARCH_SQL byte-for-byte; add a separate parameterized draft-query constant and private export scoped to testOnly rows and the exact run prefix.",
});

export function atomicJson(file, value, nonce) {
  assert.match(nonce, NONCE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${nonce}.next`;
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function archivePriorReport(file, archiveDirectory, nonce) {
  if (!fs.existsSync(file)) return null;
  const sourceStat = fs.lstatSync(file);
  assert(sourceStat.isFile() && !sourceStat.isSymbolicLink(), "prior report must be a regular file");
  const bytes = fs.readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (fs.existsSync(archiveDirectory)) {
    const archiveStat = fs.lstatSync(archiveDirectory);
    assert(archiveStat.isDirectory() && !archiveStat.isSymbolicLink(), "report archive must be a real directory");
  } else {
    fs.mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 });
  }
  const archived = path.join(archiveDirectory, `${path.basename(file, ".json")}-${digest}-${nonce}.json`);
  fs.renameSync(file, archived);
  return archived;
}

export function assertAdaptationRecords(validationDirectory, integrityFile) {
  const integrity = JSON.parse(fs.readFileSync(integrityFile, "utf8"));
  const records = [];
  for (const [modulePath, expectedOriginal] of Object.entries(integrity.modules)) {
    const file = path.join(validationDirectory, `adaptation-${path.basename(modulePath)}.json`);
    const stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), "adaptation record must be a regular file");
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(record.path, modulePath);
    assert.equal(record.originalSha256, expectedOriginal);
    assert.match(record.adaptedSha256, /^[a-f0-9]{64}$/u);
    assert.notEqual(record.adaptedSha256, record.originalSha256);
    assert.deepEqual(record.adaptations, [EXPECTED_ADAPTATIONS[modulePath]]);
    records.push({
      path: modulePath,
      originalSha256: record.originalSha256,
      adaptedSha256: record.adaptedSha256,
    });
  }
  return records;
}

function processIdentityGone(pid, startTime) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    return stat.slice(close + 2).trim().split(/\s+/)[19] !== startTime;
  } catch {
    return true;
  }
}

function freshJson(file, nonce, startedAtMs) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), "report must be a regular file");
  assert(stat.mtimeMs >= startedAtMs - 2_000, "report predates this invocation");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(parsed.invocationNonce, nonce, "report nonce does not match this invocation");
  assert.match(parsed.runId, RUN_ID, "report run ID is invalid");
  return parsed;
}

export function finalizeSuccessfulReports({
  attestation,
  nonce,
  startedAtMs,
  resultFile,
  summaryFile,
  adaptationIntegrity,
}) {
  assert.match(nonce, NONCE);
  assert.equal(attestation?.format, "weiku.owned-ephemeral-cleanup-attestation.v1");
  assert.equal(attestation.invocationNonce, nonce);
  assert.equal(attestation.cleanupComplete, true);
  assert.match(attestation.ownedRoot, /^\/tmp\/ephemeral-postgres-[A-Za-z0-9_-]+$/u);
  assert.equal(fs.existsSync(attestation.ownedRoot), false, "owned root still exists");
  assert(Number.isInteger(attestation.postgresPid) && attestation.postgresPid > 1);
  assert.equal(typeof attestation.postgresStartTime, "string");
  assert(processIdentityGone(attestation.postgresPid, attestation.postgresStartTime), "owned PostgreSQL process identity is still live");
  assert(Array.isArray(adaptationIntegrity) && adaptationIntegrity.length === 3, "adaptation integrity attestation is incomplete");
  const result = freshJson(resultFile, nonce, startedAtMs);
  const summary = freshJson(summaryFile, nonce, startedAtMs);
  assert.equal(summary.runId, result.runId, "result and summary run IDs differ");
  assert.equal(result.lifecycleCleanupStatus, "pending_parent_owned_finally");
  assert.equal(summary.status, "passed_pending_parent_cleanup");
  result.lifecycleCleanupStatus = "owned_cluster_stopped_and_deleted";
  result.cleanupAttestation = {
    format: attestation.format,
    invocationNonce: nonce,
    ownedRootRemoved: true,
    ownedPostgresIdentityGone: true,
    adaptationIntegrity,
  };
  summary.status = "passed_cleanup_complete";
  summary.lifecycleCleanupStatus = "owned_cluster_stopped_and_deleted";
  atomicJson(resultFile, result, nonce);
  atomicJson(summaryFile, summary, nonce);
  return { runId: result.runId };
}

export function safeFailureDiagnostic(error, fallbackStage = "entry") {
  const rawName = typeof error?.name === "string" ? error.name : "Error";
  const name = /^[A-Za-z][A-Za-z0-9]{0,40}$/u.test(rawName) ? rawName : "Error";
  const source = typeof error?.message === "string" ? error.message : "unspecified failure";
  const reason = source
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/giu, "[redacted-dsn]")
    .replace(/(?:password|pwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,'"}]+/giu, "$1=[redacted]")
    .replace(/\/tmp\/ephemeral-postgres-[A-Za-z0-9_-]+/gu, "[owned-root]")
    .replace(/\/home\/[^/\s]+\/[^\s,'"}]+/gu, "[workspace-path]")
    .replace(/\b[a-f0-9]{32,}\b/giu, "[redacted-opaque]")
    .replace(/\s+/gu, " ")
    .slice(0, 320);
  const stageSource = typeof error?.pilotStage === "string" ? error.pilotStage : fallbackStage;
  const stage = /^[a-z][a-z0-9_]{0,63}$/u.test(stageSource) ? stageSource : "unknown";
  const lower = reason.toLocaleLowerCase();
  const code = lower.includes("integrity") || lower.includes("hash") ? "integrity_rejected"
    : lower.includes("schema") ? "schema_stage_failed"
      : lower.includes("postgresql binary") || lower.includes("postgres binary") ? "postgres_binary_unavailable"
        : lower.includes("managed") ? "managed_stage_failed"
          : lower.includes("cleanup") || lower.includes("remove") ? "cleanup_not_attested"
            : lower.includes("prepared") || lower.includes("document") ? "prepared_validation_failed"
              : "scoped_execution_failed";
  return Object.freeze({ code, stage, errorName: name, reason });
}

export async function runFinalizedInvocation({
  nonce,
  startedAtMs,
  resultFile,
  summaryFile,
  archiveDirectory,
  validationDirectory,
  integrityFile,
  execute,
}) {
  let transactionStage = "report_archival";
  archivePriorReport(resultFile, archiveDirectory, nonce);
  archivePriorReport(summaryFile, archiveDirectory, nonce);
  atomicJson(summaryFile, {
    format: "weiku.practical-guidance-pilot.entry-status.v1",
    invocationNonce: nonce,
    status: "running_not_finalized",
  }, nonce);
  try {
    transactionStage = "owned_runner_execution";
    const attestation = await execute();
    transactionStage = "adaptation_record_validation";
    const adaptationIntegrity = assertAdaptationRecords(validationDirectory, integrityFile);
    transactionStage = "cleanup_attestation_finalization";
    return finalizeSuccessfulReports({
      attestation,
      nonce,
      startedAtMs,
      resultFile,
      summaryFile,
      adaptationIntegrity,
    });
  } catch (error) {
    const diagnostic = safeFailureDiagnostic(error, transactionStage);
    if (fs.existsSync(resultFile)) archivePriorReport(resultFile, archiveDirectory, nonce);
    atomicJson(summaryFile, {
      format: "weiku.practical-guidance-pilot.entry-status.v1",
      invocationNonce: nonce,
      status: "failed_not_finalized",
      lifecycleCleanupStatus: "not_attested",
      diagnostic,
    }, nonce);
    const failure = new Error("safe invocation failed without finalizing evidence");
    failure.name = "SafeInvocationFailure";
    failure.diagnostic = diagnostic;
    throw failure;
  }
}