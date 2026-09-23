import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadPreparedGuidance, ROOT, WORK } from "./prepared-loader.mjs";

const own = path.relative(ROOT, path.dirname(fileURLToPath(import.meta.url)));
assert.equal(own, "prototypes/evidence-consultation/practical-guidance-pilot");
const forbidden = /\b(?:reviewEvidenceVersion|publishEvidenceVersion|simulateTestOnlyPublication|server\/evidence\/routes|server\/evidence-http)\b/u;
for (const file of fs.readdirSync(path.join(ROOT, own)).filter((name) => /\.(?:mjs|mts)$/u.test(name))) {
  if (file === path.basename(fileURLToPath(import.meta.url))) continue;
  assert(!forbidden.test(fs.readFileSync(path.join(ROOT, own, file), "utf8")), `${file} crosses the draft-only boundary`);
}
const prepared = loadPreparedGuidance({ allowPending: true });
const integrity = JSON.parse(fs.readFileSync(path.join(ROOT, own, "native-integrity.json"), "utf8"));
for (const [file, expected] of Object.entries(integrity.modules)) {
  assert.equal(
    createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex"),
    expected,
    `${file} no longer matches the pinned native source`,
  );
}
const searchSource = fs.readFileSync(path.join(ROOT, "server/evidence/search.ts"), "utf8");
const searchAnchor = "const SEARCH_SQL = `";
const searchStart = searchSource.indexOf(searchAnchor) + searchAnchor.length;
const searchEnd = searchSource.indexOf("`;", searchStart);
assert(searchStart >= searchAnchor.length && searchEnd > searchStart, "native SEARCH_SQL anchor is missing");
assert.equal(
  createHash("sha256").update(searchSource.slice(searchStart, searchEnd)).digest("hex"),
  integrity.searchSqlSha256,
  "ordinary native SEARCH_SQL no longer matches its pinned hash",
);
const sourceFiles = fs.readdirSync(path.join(WORK, "source-review/fetched"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.join(WORK, "source-review/fetched", name));
const cfaSnapshots = path.join(WORK, "source-review/cfa/snapshots");
if (fs.existsSync(cfaSnapshots)) {
  sourceFiles.push(...fs.readdirSync(cfaSnapshots).filter((name) => name.endsWith(".json")).map((name) => path.join(cfaSnapshots, name)));
}
const sourceHashes = Object.fromEntries(sourceFiles.sort().map((file) => {
  const bytes = fs.readFileSync(file);
  return [path.relative(path.join(WORK, "source-review"), file), createHash("sha256").update(bytes).digest("hex")];
}));
const output = {
  format: "weiku.practical-guidance-pilot.preflight.v1",
  status: prepared.missing.length ? "prepared_pending" : "prepared_valid",
  expectedDocumentCounts: prepared.expected,
  receivedDocumentCounts: Object.fromEntries(prepared.sources.map((source) => [source.group, source.documents.length])),
  missingPreparedFiles: prepared.missing,
  frozenSourceSnapshotSha256: sourceHashes,
  classifications: {
    scientific_evidence: 0,
    practical_guidance: prepared.sources.flatMap((source) => source.documents).filter((doc) => doc.informationClass === "practical_guidance").length,
    service_information: prepared.sources.flatMap((source) => source.documents).filter((doc) => doc.informationClass === "service_information").length,
    professional_practice: 0,
  },
  holds: ["draft_only", "manual_review_absent", "fact_projection_not_authorized", "publication_not_authorized"],
};
fs.mkdirSync(path.join(WORK, "validation"), { recursive: true });
fs.writeFileSync(path.join(WORK, "validation/preflight.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`practical-guidance static check: ${output.status}`);
