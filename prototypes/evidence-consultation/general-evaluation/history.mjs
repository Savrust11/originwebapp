// New-run preservation boundary; never rewrites an older result, source, or ledger.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const RUN_ID = "general-audience-six-01";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const BASE = path.join(ROOT, "evidence-work/general-audience-evaluation", RUN_ID);
export const hash = value => createHash("sha256").update(value).digest("hex");
const snapshotFile = path.join(BASE, "history-snapshot.json");
const roots = [
  "evidence-work/model-evaluation", "evidence-work/condition-display-offline",
  "evidence-work/v0.2", "prototypes/evidence-consultation/evaluation",
  "prototypes/evidence-consultation/condition-display", "server/evidence",
];
const files = [
  "prototypes/evidence-consultation/flow.ts", "prototypes/evidence-consultation/service.mts",
  "prototypes/evidence-consultation/answer-policy.mts", "shared/evidence-policy.ts",
];
const walk = relative => fs.statSync(path.join(ROOT, relative)).isDirectory()
  ? fs.readdirSync(path.join(ROOT, relative)).sort().flatMap(name => walk(`${relative}/${name}`))
  : [{ path: relative, sha256: hash(fs.readFileSync(path.join(ROOT, relative))) }];
export function verifyBaseline() {
  const old = fs.readFileSync(path.join(ROOT, "evidence-work/model-evaluation/api-call-ledger.json"));
  const ledger = JSON.parse(old);
  const total = ledger.entries.reduce((sum, entry) =>
    sum + (Number.isSafeInteger(entry.measuredMicroUSD) ? entry.measuredMicroUSD : 0), 0);
  if (ledger.entries.length !== 13 || total !== 17093
    || ledger.limits.operationalModelBudgetMicroUSD !== 1000000
    || ledger.limits.maxApiTransmissions !== 20
    || ledger.limits.maxConcurrency !== 1 || ledger.limits.maxRetries !== 0)
    throw new Error("BASELINE_ACCOUNTING_CHANGED");
  return { oldLedgerSha256: hash(old), transmissions: 13, measuredMicroUSD: 17093,
    newRunTransmissionCeiling: 19, additionalCeiling: 6, unusedTwentiethForbidden: true,
    operationBudgetMicroUSD: 1000000 };
}
export function snapshotHistory() {
  const result = { runId: RUN_ID, baseline: verifyBaseline(),
    preservedFiles: [...roots, ...files].flatMap(walk) };
  fs.mkdirSync(BASE, { recursive: true });
  fs.writeFileSync(snapshotFile, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return result;
}
export function verifyHistory() {
  const result = JSON.parse(fs.readFileSync(snapshotFile));
  const baseline = verifyBaseline();
  if (result.runId !== RUN_ID || result.baseline.oldLedgerSha256 !== baseline.oldLedgerSha256)
    throw new Error("BASELINE_SNAPSHOT_CHANGED");
  for (const file of result.preservedFiles) {
    if (hash(fs.readFileSync(path.join(ROOT, file.path))) !== file.sha256)
      throw new Error(`PROTECTED_HISTORY_CHANGED:${file.path}`);
  }
  return { runId: RUN_ID, protectedFiles: result.preservedFiles.length, unchanged: true, baseline };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action === "snapshot") {
    const result = snapshotHistory();
    console.log(JSON.stringify({ protectedFiles: result.preservedFiles.length, baseline: result.baseline }));
  } else if (action === "verify") console.log(JSON.stringify(verifyHistory()));
  else throw new Error("Use snapshot or verify");
}