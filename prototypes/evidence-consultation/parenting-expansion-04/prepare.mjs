import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const output = path.join(root, "evidence-work/parenting-expansion-04/validation");
export const sha = value => createHash("sha256").update(value).digest("hex");
const trees = [
  "prototypes/evidence-consultation/practical-guidance-pilot",
  "evidence-work/practical-guidance-pilot-01",
  ...["02", "03"].flatMap(n => [
    `prototypes/evidence-consultation/parenting-expansion-${n}`,
    `evidence-work/parenting-expansion-${n}`,
  ]),
];
function walk(relative) {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const name = `${relative}/${entry.name}`;
      assert(!entry.isSymbolicLink(), `protected symlink: ${name}`);
      return entry.isDirectory() ? walk(name) :
        [{ path: name, sha256: sha(fs.readFileSync(path.join(root, name))) }];
    });
}
export function preservation({ create = false } = {}) {
  const file = path.join(output, "preservation-manifest.json");
  const files = trees.flatMap(walk);
  if (fs.existsSync(file)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).files, files, "prior frozen bytes changed");
  } else {
    assert(create, "baseline must be explicitly prepared before integration");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      format: "weiku.expansion04.preservation.v1", currentUnits: 35,
      historicalUnitsKeptButExcluded: 1, files,
    }, null, 2) + "\n", { flag: "wx" });
  }
  return files.length;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Prepared/verified ${preservation({ create: true })} frozen files; no validation or storage executed.`);
}