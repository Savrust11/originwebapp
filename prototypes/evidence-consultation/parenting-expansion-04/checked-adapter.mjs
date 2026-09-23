import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, output, sha, preservation } from "./prepare.mjs";

// Preparation only: never imports frozen modules (03 adapter writes into 03).
// Every requested change is exact-once and recorded before later loader wiring.
export function prepareAdapter(relativePath, edits, name) {
  preservation();
  const baseline = JSON.parse(fs.readFileSync(path.join(output, "preservation-manifest.json"), "utf8"));
  const pinned = baseline.files.find(file => file.path === relativePath);
  assert(pinned, "adapter source must be in the preserved prior baseline");
  assert(/^[a-z0-9.-]+$/u.test(name), "unsafe adapter receipt name");
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.equal(sha(source), pinned.sha256);
  assert(edits.length > 0);
  let adapted = source;
  for (const { anchor, replacement, reason } of edits) {
    assert(anchor && replacement && reason);
    assert.equal(adapted.split(anchor).length, 2, `nonunique adapter anchor: ${name}`);
    adapted = adapted.replace(anchor, replacement);
  }
  fs.writeFileSync(path.join(output, `prepared-adaptation-${name}.json`), JSON.stringify({
    originalPath: relativePath, originalSha256: sha(source), adaptedSha256: sha(adapted),
    edits, executed: false,
  }, null, 2) + "\n");
  return adapted;
}