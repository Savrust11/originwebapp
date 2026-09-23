// Freezes an offline source-reading review, not adoption or clinical approval.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { loadValidatedCatalog } from "./projection.mjs";
const out = "evidence-work/parent-reading-evaluation/fact-display-pilot-01";
const catalog = loadValidatedCatalog(process.cwd());
const sha = p => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
fs.writeFileSync(`${out}/catalog-seal.json`, JSON.stringify({
  schemaVersion: 1,
  catalogSha256: sha(`${out}/fact-catalog.json`),
  reviewKind: "agent-source-reading-plus-deterministic-provenance-check-not-human-or-clinical-approval",
  reviewScope: "Numeric values, units, unknown aggregation, age bases, exact source exclusions, attribution and required contexts",
  factIds: catalog.facts.map(f => f.id),
  humanReviewPerformed: false,
  adoptionApproved: false,
  publicationApproved: false,
  scientificCertaintyAssessed: false,
  initialProjectionCorrections: [
    "Removed inferred 24-hour/nap aggregation; original excerpts do not establish it.",
    "Separated research population exclusions from editorial usage restrictions.",
    "Kept known not-approved/not-published statuses separate from unassessed scientific certainty."
  ],
  limits: "A matching hash proves reviewed bytes were retained, not that their semantics are infallible. Another AI review alone is not a guarantee."
}, null, 2) + "\n", { flag: "wx" });
console.log("Offline catalog frozen; no approval or communication authority changed.");