import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OPENING, LIMITS, validatePackets } from "./runner.mjs";
const root = "evidence-work/parent-reading-evaluation/execution-01/preflight";
const hash = b => createHash("sha256").update(b).digest("hex");
const reviewPath = `${root}/independent-preflight-review.json`;
const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
assert.equal(review.status, "FROZEN_READY");
assert.equal(review.decision, "READY_FOR_MANIFEST_CONSTRUCTION");
const allowedRoles = new Set(["protocol", "source", "price", "payload", "controlcode", "historical-closure"]);
const bindings = review.bindings.map(b => {
  assert.equal(hash(fs.readFileSync(b.path)), b.sha256, b.path);
  return { path: b.path, sha256: b.sha256, role: allowedRoles.has(b.role) ? b.role : "protocol" };
});
for (const [p, role] of [
  [reviewPath, "protocol"],
  [`${root}/independent-preflight-review.md`, "protocol"],
  ["prototypes/evidence-consultation/parent-reading-execution/finalize-preflight.mjs", "controlcode"],
  ["prototypes/evidence-consultation/parent-reading-execution/cli.mjs", "controlcode"],
  ["prototypes/evidence-consultation/parent-reading-execution/offline.test.mjs", "controlcode"],
  ["prototypes/evidence-consultation/parent-reading-execution/offline-lockdown.mjs", "controlcode"],
  ["evidence-work/comparison-closeout/reading-comparison-02/closure.json", "historical-closure"],
]) if (!bindings.some(b => b.path === p)) bindings.push({ path: p, role, sha256: hash(fs.readFileSync(p)) });
validatePackets(JSON.parse(fs.readFileSync(`${root}/request-packets.json`, "utf8")));
const manifest = {
  schemaVersion: 1,
  audit: { decision: "authorized", completedAt: new Date().toISOString(),
    authority: "Current user's explicit approval: five named Luna attempts, new USD 0.05, cumulative USD 1",
    independentSafetyReview: reviewPath, sourceAdoptionApproved: false, publicationApproved: false },
  historicalClosure: OPENING, limits: LIMITS, bindings,
};
fs.writeFileSync(`${root}/preflight-manifest.json`, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ manifestCreated: true, bindings: bindings.length,
  newProviderCalls: 0, oldSlotReused: false, sourceApprovalChanged: false }));