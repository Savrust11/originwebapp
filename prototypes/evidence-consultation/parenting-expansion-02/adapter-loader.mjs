import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const output = path.join(root, "evidence-work/parenting-expansion-02/validation");
const suite = path.join(directory, "verify-entry.mjs");
const register = path.join(directory, "register.mjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const integrity = JSON.parse(fs.readFileSync(path.join(directory, "native-integrity.json"), "utf8"));
function once(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `unique adapter anchor required: ${anchor.slice(0, 80)}`);
  return source.replace(anchor, replacement);
}
function record(relative, original, adapted, adaptation) {
  fs.mkdirSync(output, { recursive: true });
  const destination = path.join(output, `adaptation-${path.basename(relative)}.json`);
  const temporary = `${destination}.${process.pid}.next`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    path: relative, originalSha256: hash(original), adaptedSha256: hash(adapted), adaptations: [adaptation],
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, destination);
  fs.chmodSync(destination, 0o600);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const relative = path.relative(root, fileURLToPath(url));
  const targets = ["tests/run-ephemeral-tests.mjs", "tests/run-managed-tests.mjs", "server/evidence/search.ts"];
  if (!targets.includes(relative)) return nextLoad(url, context);
  const original = fs.readFileSync(fileURLToPath(url), "utf8");
  assert.equal(hash(original), integrity.modules[relative], `native module integrity mismatch: ${relative}`);
  let source = original;
  let adaptation;
  if (relative === targets[0]) {
    source = once(source,
      "export async function runEphemeralTests(requestedGroups = process.argv.slice(2)) {",
      "export async function runEphemeralTests(requestedGroups = process.argv.slice(2), invocationNonce, expansionStage = () => {}) {\n  if (typeof invocationNonce !== \"string\" || !/^[a-f0-9]{32}$/.test(invocationNonce)) throw new Error(\"invocation nonce required\");");
    source = once(source, '  console.info("ephemeral stage: pure safety checks passed");',
      '  console.info("ephemeral stage: pure safety checks passed");\n  expansionStage("pure_safety_passed");');
    source = once(source, '  const root = fs.mkdtempSync("/tmp/ephemeral-postgres-");',
      '  const root = fs.mkdtempSync("/tmp/ephemeral-postgres-");\n  expansionStage("owned_root_created");');
    source = once(source, "    await waitForOwnedPostgres(ownedConfig, operation);",
      '    await waitForOwnedPostgres(ownedConfig, operation);\n    expansionStage("owned_postgres_ready");');
    source = once(source, "    await applySchema({ ...config, username, port }, operation);",
      '    await applySchema({ ...config, username, port }, operation);\n    expansionStage("schema_applied");');
    const start = source.indexOf("    const prototypeOnly = ");
    const endAnchor = "    normalRouteCompleted = normalRouteOnly;";
    const end = source.indexOf(endAnchor, start);
    assert(start > 0 && end > start, "ephemeral dispatch anchor missing");
    source = once(source, source.slice(start, end + endAnchor.length),
      '    assertExpansionGroup(selectedGroups);\n    expansionStage("managed_suite_starting");\n    await runManagedTests(["parenting-expansion-02"], Object.freeze({ ...config, invocationNonce }));\n    expansionStage("managed_suite_passed");\n    throwIfInterrupted(operation);');
    source = once(source, "  if (normalRouteCompleted) finalizeNormalRouteReport();\n}",
      "  if (normalRouteCompleted) finalizeNormalRouteReport();\n  if (fs.existsSync(root) || !ownedPostgres) throw new Error(\"cleanup attestation unavailable\");\n  expansionStage(\"cleanup_complete\");\n  return Object.freeze({ format: \"weiku.owned-ephemeral-cleanup-attestation.v1\", invocationNonce, cleanupComplete: true, ownedRoot: root, postgresPid: ownedPostgres.pid, postgresStartTime: ownedPostgres.startTime });\n}");
    source = once(source, "    await runEphemeralTests();",
      "    const directNonce = process.argv.at(-1);\n    const directGroups = process.argv.slice(2, -1);\n    const attestation = await runEphemeralTests(directGroups, directNonce);\n    console.log(\"EXPANSION_CLEANUP_ATTESTATION:\" + JSON.stringify(attestation));");
    source += '\nfunction assertExpansionGroup(groups){if(groups.length!==1||groups[0]!=="parenting-expansion-02")throw Error("isolated parenting expansion group required");}\n';
    adaptation = "Bind one expansion suite to nonce-owned ephemeral lifecycle and unchanged cleanup, returning attestation only after owned root removal.";
  } else if (relative === targets[1]) {
    source = once(source, "const GROUPS = new Set([", 'const GROUPS = new Set([\n  "parenting-expansion-02",');
    source = once(source, "const GROUP_FILES = {", `const GROUP_FILES = {\n  "parenting-expansion-02": [${JSON.stringify(suite)}],`);
    source = once(source, "  const args = browser",
      `  const args = file === ${JSON.stringify(suite)} ? ["--import", "tsx", "--import", ${JSON.stringify(register)}, file] : browser`);
    source = once(source, "function emitSafeChildDiagnostic(kind, output) {",
      `function emitSafeChildDiagnostic(kind, output) {
  if (kind === "parenting-expansion-02") {
    const line = output.split(/\\r?\\n/u).find(item => item.startsWith("SAFE_EXPANSION_FAILURE:"));
    if (line && line.length <= 800) console.error("managed expansion diagnostic: " + line.slice("SAFE_EXPANSION_FAILURE:".length));
    return;
  }`);
    source = once(source, "  if (group === \"normal-route-verification\" || group === \"normal-route-lifecycle\") {",
      "  if (group === \"parenting-expansion-02\") env.PARENTING_EXPANSION_NONCE = config.invocationNonce;\n  if (group === \"normal-route-verification\" || group === \"normal-route-lifecycle\") {");
    source = once(source, "    || typeof config.safePath !== \"string\"\n",
      "    || typeof config.safePath !== \"string\"\n    || typeof config.invocationNonce !== \"string\"\n    || !/^[a-f0-9]{32}$/.test(config.invocationNonce)\n");
    source = once(source, '              : group === "evidence-prototype" ? "evidence-prototype" : null,',
      '              : group === "evidence-prototype" ? "evidence-prototype"\n                : group === "parenting-expansion-02" ? "parenting-expansion-02" : null,');
    adaptation = "Register one private expansion managed child, pass only its nonce, and expose only bounded safe diagnostics.";
  } else {
    const publishedJoin = `JOIN evidence_versions AS version
    ON version.id = source.current_published_version_id
    AND version.source_id = source.id
    AND version.publication_status = 'published'`;
    const draftJoin = `JOIN evidence_versions AS version
    ON version.source_id = source.id
    AND version.publication_status = 'draft'
    AND version.test_only = true
    AND source.test_only = true
    AND source.source_key LIKE ($4::text || '-%')`;
    const prefix = "const SEARCH_SQL = `";
    const start = original.indexOf(prefix) + prefix.length;
    const end = original.indexOf("`;", start);
    const ordinarySql = original.slice(start, end);
    assert.equal(hash(ordinarySql), integrity.searchSqlSha256, "ordinary SEARCH_SQL integrity mismatch");
    assert.equal(ordinarySql.split(publishedJoin).length, 2);
    assert.equal(ordinarySql.split("WHERE source.status = 'active'").length, 2);
    const draftSql = ordinarySql.replace(publishedJoin, draftJoin).replace("WHERE source.status = 'active'", "WHERE source.status = 'draft'");
    source = once(source, "export async function searchEvidence(\n", "async function searchEvidenceScoped(\n");
    source = once(source, "  rawInput: SearchInput,\n): Promise<EvidenceSearchResponse> {",
      "  rawInput: SearchInput,\n  draftRunId: string | null,\n): Promise<EvidenceSearchResponse> {");
    const insertAt = source.indexOf("\n\nasync function searchEvidenceScoped(");
    source = source.slice(0, insertAt) + `\n\nconst EXPANSION_DRAFT_SEARCH_SQL = ${JSON.stringify(draftSql)};\n` + source.slice(insertAt);
    source = once(source, "      const result = await pool.query(SEARCH_SQL, [\n        input.question,\n        pageSize,\n        page * pageSize,\n      ]);",
      "      const result = await pool.query(draftRunId === null ? SEARCH_SQL : EXPANSION_DRAFT_SEARCH_SQL, [\n        input.question,\n        pageSize,\n        page * pageSize,\n        ...(draftRunId === null ? [] : [draftRunId]),\n      ]);");
    source += '\nexport async function searchEvidence(pool, rawInput) { return searchEvidenceScoped(pool, rawInput, null); }\n'
      + 'export async function searchEvidenceExpansionDrafts(pool, rawInput, runId) {\n'
      + '  if (typeof runId !== "string" || !/^parenting-expansion-[a-f0-9]{24}$/.test(runId)) throw new Error("exact expansion run ID required");\n'
      + '  return searchEvidenceScoped(pool, rawInput, runId);\n}\n';
    const adaptedStart = source.indexOf(prefix) + prefix.length;
    const adaptedEnd = source.indexOf("`;", adaptedStart);
    assert.equal(hash(source.slice(adaptedStart, adaptedEnd)), integrity.searchSqlSha256, "ordinary SEARCH_SQL changed");
    adaptation = "Preserve ordinary search SQL byte-for-byte and add a separate exact-run testOnly draft query for expansion verification.";
  }
  record(relative, original, source, adaptation);
  const transformed = await transform(source, {
    loader: relative.endsWith(".ts") ? "ts" : "js", format: "esm", target: "node20", sourcefile: fileURLToPath(url),
  });
  return { format: "module", source: transformed.code, shortCircuit: true };
}