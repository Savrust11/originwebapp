// Read-only history verification. The only write is an exclusive new snapshot.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const outputDirectory = path.join(root, "evidence-work/condition-display-offline");
export const hashBytes = bytes => createHash("sha256").update(bytes).digest("hex");
const snapshotPath = path.join(outputDirectory, "history-snapshot.json");
const protectedRoots = [
  "evidence-work/model-evaluation", "evidence-work/v0.2",
  "prototypes/evidence-consultation/evaluation", "server/evidence",
];
const protectedFiles = [
  "prototypes/evidence-consultation/flow.ts",
  "prototypes/evidence-consultation/service.mts",
  "prototypes/evidence-consultation/answer-policy.mts",
  "shared/evidence-policy.ts",
];
function walk(relative) {
  const file = path.join(root, relative);
  if (fs.statSync(file).isDirectory()) {
    return fs.readdirSync(file).sort().flatMap(name => walk(`${relative}/${name}`));
  }
  return [{ path: relative, sha256: hashBytes(fs.readFileSync(file)) }];
}
export function assertAccounting() {
  const ledger = JSON.parse(fs.readFileSync(path.join(root,
    "evidence-work/model-evaluation/api-call-ledger.json"), "utf8"));
  const measuredMicroUSD = ledger.entries.reduce((sum, entry) =>
    sum + (Number.isSafeInteger(entry.measuredMicroUSD) ? entry.measuredMicroUSD : 0), 0);
  if (ledger.entries.length !== 13 || measuredMicroUSD !== 17093
    || ledger.limits.maxApiTransmissions !== 20
    || ledger.limits.operationalModelBudgetMicroUSD !== 1000000
    || ledger.limits.maxConcurrency !== 1 || ledger.limits.maxRetries !== 0)
    throw new Error("HISTORICAL_ACCOUNTING_CHANGED");
  return { transmissions: 13, maxTransmissions: 20, measuredMicroUSD: 17093,
    operationBudgetMicroUSD: 1000000, additionalTransmissions: 0, additionalMicroUSD: 0 };
}
export function snapshotHistory() {
  const files = [...protectedRoots, ...protectedFiles].flatMap(walk);
  const snapshot = { schemaVersion: 1, purpose: "offline-display-no-retrospective-regrading",
    accounting: assertAccounting(), files };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  return snapshot;
}
export function verifyHistory() {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  for (const file of snapshot.files) {
    if (hashBytes(fs.readFileSync(path.join(root, file.path))) !== file.sha256)
      throw new Error(`HISTORICAL_FILE_CHANGED:${file.path}`);
  }
  return { protectedFiles: snapshot.files.length, unchanged: true, ...assertAccounting() };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (!["snapshot", "verify"].includes(action)) throw new Error("Use snapshot or verify");
  const result = action === "snapshot" ? snapshotHistory() : verifyHistory();
  console.log(JSON.stringify(action === "snapshot"
    ? { protectedFiles: result.files.length, accounting: result.accounting } : result, null, 2));
}