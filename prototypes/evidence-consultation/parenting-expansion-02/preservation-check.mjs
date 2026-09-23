import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(new URL("../../../", import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(
  root,
  "evidence-work/parenting-expansion-02/validation/preservation-manifest.json",
), "utf8"));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const anchors = {
  priorResult: "evidence-work/practical-guidance-pilot-01/validation/result.json",
  priorSummary: "evidence-work/practical-guidance-pilot-01/validation/brief-summary.json",
  priorPreparedLoader: "prototypes/evidence-consultation/practical-guidance-pilot/prepared-loader.mjs",
  priorAdapterLoader: "prototypes/evidence-consultation/practical-guidance-pilot/adapter-loader.mjs",
};
for (const [name, relative] of Object.entries(anchors)) {
  assert.equal(hash(path.join(root, relative)), manifest.anchors[name], `${relative} changed after expansion preservation`);
}
for (const tree of manifest.protectedTrees) {
  const command = `find ${JSON.stringify(tree.path)} -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum`;
  // sha256sum escapes non-ASCII file names according to locale; bind the
  // manifest calculation to the locale used when the pre-change digest was recorded.
  const digest = execFileSync("sh", ["-c", command], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH, LC_ALL: "en_US.UTF-8" },
  }).trim().split(/\s+/u)[0];
  assert.equal(digest, tree.sortedSha256ListDigest, `${tree.path} tree changed after preservation`);
}
console.log("prior pilot preservation: passed");