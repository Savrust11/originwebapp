// Offline only: no application imports, environment reads, or network libraries.
import fs from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const old = "evidence-work/parent-reading-evaluation/execution-01";
const out = "evidence-work/parent-reading-evaluation/revision-01";
const sha = p => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const files = new Set();
function walk(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const next = `${p}/${e.name}`;
    assert(!e.isSymbolicLink());
    if (e.isDirectory()) walk(next); else files.add(next);
  }
}
walk(old);
walk("evidence-work/parent-reading-evaluation/preparation-01");
for (const b of JSON.parse(fs.readFileSync(`${old}/preflight/preflight-manifest.json`)).bindings)
  files.add(b.path);
const events = fs.readdirSync(`${old}/run/private/events`).sort()
  .map(n => JSON.parse(fs.readFileSync(`${old}/run/private/events/${n}`)));
assert.equal(events.at(-1).type, "authorization-closed");
assert.equal(events.filter(e => e.type === "transmission-reserved").length, 5);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(`${old}/report/final-results.json`, `${out}/historical-results.json`, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(`${out}/preservation-manifest.json`, JSON.stringify({
  schemaVersion: 1, purpose: "offline-revision-only", newModelApiCalls: 0,
  authorizationRemainsClosed: true, productionAdoption: "on-hold",
  snapshot: { path: `${out}/historical-results.json`, sha256: sha(`${out}/historical-results.json`) },
  protectedFiles: [...files].sort().map(path => ({ path, sha256: sha(path) })),
}, null, 2) + "\n", { flag: "wx" });
console.log("Historical results copied unchanged; closed ledger and protected hashes recorded.");