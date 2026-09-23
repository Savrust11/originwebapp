import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const output = path.join(root, "evidence-work/parenting-expansion-03/validation");
const protectedTrees = [
  "prototypes/evidence-consultation/parenting-expansion-02",
  "evidence-work/parenting-expansion-02",
  "prototypes/evidence-consultation/practical-guidance-pilot",
  "evidence-work/practical-guidance-pilot-01",
];
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function walk(relative) {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = `${relative}/${entry.name}`;
    assert(!entry.isSymbolicLink(), `protected symlink rejected: ${name}`);
    return entry.isDirectory() ? walk(name) : [{ path: name, sha256: sha(fs.readFileSync(path.join(root, name))) }];
  });
}
export function preservation() {
  const file = path.join(output, "preservation-manifest.json");
  const files = protectedTrees.flatMap(walk);
  if (fs.existsSync(file)) assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).files, files, "frozen prior bytes changed");
  else {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ format: "weiku.expansion03.preservation.v1", files }, null, 2) + "\n", { flag: "wx" });
  }
  return files.length;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Frozen files verified: ${preservation()}; municipal input not executed.`);