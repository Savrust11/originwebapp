// Read-only verification / one-time local preservation. No provider, DB or app imports.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyHistory } from "../general-evaluation/history.mjs";
import { summarizeAccounting } from "../general-evaluation/accounting.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const BASE = path.join(ROOT, "evidence-work/model-comparison-preparation/reading-comparison-01");
const priorRoot = "evidence-work/general-audience-evaluation/general-audience-six-01";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const walk = relative => fs.statSync(path.join(ROOT, relative)).isDirectory()
  ? fs.readdirSync(path.join(ROOT, relative)).sort().flatMap(name => walk(`${relative}/${name}`))
  : [{ path: relative, sha256: hash(fs.readFileSync(path.join(ROOT, relative))) }];
export function verifyAccounting() {
  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, priorRoot, "ledger.json")));
  const summary = summarizeAccounting(ledger);
  if (summary.cumulativeTransmissions !== 19 || !summary.usageKnown
    || summary.displayMeasuredTotalMicroUSD !== 25879 || ledger.state !== "completed"
    || ledger.nextCaseId !== null || ledger.entries.length !== 6)
    throw new Error("PRIOR_COMPLETED_ACCOUNTING_CHANGED");
  return summary;
}
export function preserve() {
  const previous = verifyHistory();
  const record = {
    schemaVersion: 1,
    purpose: "preserve-completed-result-before-offline-comparison-preparation",
    accounting: verifyAccounting(),
    authorizedNewProviderTransmissions: 0,
    unusedTwentiethTransmissionForbidden: true,
    priorHistoricalProtectedFiles: previous.protectedFiles,
    files: walk(priorRoot),
  };
  fs.mkdirSync(BASE, { recursive: true });
  fs.writeFileSync(path.join(BASE, "preserved-results.json"),
    `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return record;
}
export function verifyPreservation() {
  const previous = verifyHistory();
  const accounting = verifyAccounting();
  const record = JSON.parse(fs.readFileSync(path.join(BASE, "preserved-results.json")));
  if (JSON.stringify(accounting) !== JSON.stringify(record.accounting))
    throw new Error("PRESERVED_ACCOUNTING_CHANGED");
  for (const file of record.files)
    if (hash(fs.readFileSync(path.join(ROOT, file.path))) !== file.sha256)
      throw new Error(`PRESERVED_RESULT_CHANGED:${file.path}`);
  return { unchanged: true, priorHistoricalFiles: previous.protectedFiles,
    completedRunFiles: record.files.length, accounting,
    authorizedNewProviderTransmissions: 0, unusedTwentiethTransmissionForbidden: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (!["snapshot", "verify"].includes(action)) throw new Error("USE_SNAPSHOT_OR_VERIFY");
  console.log(JSON.stringify(action === "snapshot" ? preserve() : verifyPreservation(), null, 2));
}