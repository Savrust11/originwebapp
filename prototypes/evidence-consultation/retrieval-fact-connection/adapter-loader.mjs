// Load-time-only adaptations. Original files are never written.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { transform } from "esbuild";
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const out = path.join(root, "evidence-work/parent-reading-evaluation/retrieval-fact-connection-01");
const verify = path.join(directory, "verify.mts");
const register = path.join(directory, "register.mjs");
function replaceOnce(source, old, replacement) {
  assert.equal(source.split(old).length, 2, `adaptation anchor must be unique: ${old.slice(0,70)}`);
  return source.replace(old, replacement);
}
export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const relative = path.relative(root, fileURLToPath(url));
  const targets = ["tests/run-ephemeral-tests.mjs", "tests/run-managed-tests.mjs",
    "tests/fixtures/real-corpus/setup.mts", "prototypes/evidence-consultation/fact-display-pilot/render.mjs"];
  if (!targets.includes(relative)) return nextLoad(url, context);
  const original = fs.readFileSync(fileURLToPath(url), "utf8");
  let source = original;
  const adaptations = [];
  if (relative === targets[0]) {
    const start = source.indexOf('    const prototypeOnly = ');
    const endMarker = "    normalRouteCompleted = normalRouteOnly;";
    const end = source.indexOf(endMarker, start);
    assert(start > 0 && end > start);
    const block = source.slice(start, end + endMarker.length);
    source = replaceOnce(source, block,
      '    assertConnectionGroup(selectedGroups);\n    await runManagedTests(["retrieval-fact-connection"], config);\n    throwIfInterrupted(operation);');
    source += '\nfunction assertConnectionGroup(groups){if(groups.length!==1||groups[0]!=="retrieval-fact-connection")throw Error("isolated connection group required");}\n';
    adaptations.push("Replace app/HTTP lifecycle and suite dispatch with one existing managed non-app group; creation, schema, ownership, signals and finally cleanup unchanged.");
  } else if (relative === targets[1]) {
    source = replaceOnce(source, "const GROUPS = new Set([", 'const GROUPS = new Set([\n  "retrieval-fact-connection",');
    source = replaceOnce(source, "const GROUP_FILES = {", `const GROUP_FILES = {\n "retrieval-fact-connection": [${JSON.stringify(verify)}],`);
    source = replaceOnce(source, "  const args = browser", `  const args = file === ${JSON.stringify(verify)} ? ["--import", ${JSON.stringify(register)}, "--import", "tsx", file] : browser`);
    adaptations.push("Add non-APP_GROUPS suite and its loader arguments; keep private context, descendant authorization, generated environment and child ownership cleanup unchanged.");
  } else if (relative === targets[2]) {
    source = replaceOnce(source, "  const corpus = loadPreparedRealCorpus();",
      `  const corpus = loadPreparedRealCorpus();
  corpus.sources.delete("E01");
  corpus.units = corpus.units.filter(u => corpus.sources.has(u.sourceId));
  for (const [id, fragment] of corpus.fragments) if (!corpus.sources.has(fragment.sourceId)) corpus.fragments.delete(id);`);
    source = replaceOnce(source, "  for (const spec of CONCEPTS) {",
      "  for (const spec of CONCEPTS.filter(spec => spec.units.every(id => byUnit.has(id)))) {");
    source = replaceOnce(source, 'assert.equal(initialized.corpus.sources.size, 4, "only the four v0.2 sources may be seeded");',
      'assert.equal(initialized.corpus.sources.size, 3, "only E02/E03/E04 are in this isolated evaluation");');
    source = replaceOnce(source, 'assert.equal(initialized.corpus.units.length, 11, "only the eleven prepared v0.2 units may be seeded");',
      'assert.equal(initialized.corpus.units.length, 7, "only seven E02/E03/E04 units are imported");');
    const call = `  await simulateTestOnlyPublication(pool, [...initialized.versionBySource.values()].map((version) => ({
    sourceId: version.sourceDbId, versionId: version.versionDbId,
  })));`;
    source = replaceOnce(source, call,
      '  assert.equal((await pool.query("SELECT evidence_is_ephemeral_test_context() AS owned")).rows[0].owned, true);');
    adaptations.push("Existing importer and vocabulary retained for E02/E03/E04 only. Omit publication simulation; require-managed import, entry guard and PostgreSQL owned-context check retained. All versions remain draft.");
  } else {
    source = replaceOnce(source, "function factHtml(fact) {", "export function factHtml(fact) {");
    adaptations.push("Expose existing factHtml without changing its function body.");
  }
  fs.mkdirSync(out, { recursive: true });
  const record = { path: relative, originalSha256: createHash("sha256").update(original).digest("hex"),
    adaptedSha256: createHash("sha256").update(source).digest("hex"), adaptations };
  fs.writeFileSync(path.join(out, `adaptation-${path.basename(relative)}.json`), JSON.stringify(record,null,2)+"\n");
  const result = await transform(source, { loader: relative.endsWith(".mts") ? "ts" : "js",
    format: "esm", target: "node20", sourcefile: fileURLToPath(url) });
  return { format: "module", source: result.code, shortCircuit: true };
}