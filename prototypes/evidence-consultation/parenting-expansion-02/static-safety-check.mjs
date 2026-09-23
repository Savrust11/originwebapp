import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertSafeCallerEnvironment } from "./safe-caller.mjs";
import { ROOT } from "./prepared-loader.mjs";

assert.doesNotThrow(() => assertSafeCallerEnvironment({ PATH: "/usr/bin:/bin", PWD: process.cwd(), SHLVL: "1" }));
for (const key of ["DATABASE_URL", "TEST_DATABASE_URL", "PGHOST", "OPENAI_API_KEY", "HTTP_PROXY", "NODE_OPTIONS", "BASE_URL"]) {
  assert.throws(() => assertSafeCallerEnvironment({ PATH: "/usr/bin:/bin", [key]: "forbidden" }));
}
const source = fs.readdirSync(path.join(ROOT, "prototypes/evidence-consultation/parenting-expansion-02"))
  .filter(name => /\.(?:mjs|mts)$/u.test(name) && !["static-check.mjs", "static-safety-check.mjs"].includes(name))
  .map(name => fs.readFileSync(path.join(ROOT, "prototypes/evidence-consultation/parenting-expansion-02", name), "utf8")).join("\n");
assert(!source.includes("publishEvidenceVersion("));
assert(!source.includes("api.openai.com"));
assert(!source.includes("books/snapshots"));
assert(source.includes("source.status = 'draft'"));
assert(source.includes("version.test_only = true"));
assert(source.includes("source.test_only = true"));
console.log("expansion static safety: passed");