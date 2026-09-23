import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const output = path.join(root, "evidence-work/practical-guidance-pilot-01/validation");
const suite = path.join(directory, "verify-entry.mjs");
const register = path.join(directory, "register.mjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const integrity = JSON.parse(fs.readFileSync(path.join(directory, "native-integrity.json"), "utf8"));
function once(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `unique adapter anchor required: ${anchor.slice(0, 80)}`);
  return source.replace(anchor, replacement);
}
function record(relative, original, adapted, adaptations) {
  fs.mkdirSync(output, { recursive: true });
  const payload = { path: relative, originalSha256: hash(original), adaptedSha256: hash(adapted), adaptations };
  const destination = path.join(output, `adaptation-${path.basename(relative)}.json`);
  const temporary = `${destination}.${process.pid}.next`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", mode: 0o600 });
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
  const adaptations = [];
  if (relative === targets[0]) {
    source = once(source,
      "export async function runEphemeralTests(requestedGroups = process.argv.slice(2)) {",
      "export async function runEphemeralTests(requestedGroups = process.argv.slice(2), invocationNonce, pilotStage = () => {}) {\n  if (typeof invocationNonce !== \"string\" || !/^[a-f0-9]{32}$/.test(invocationNonce)) throw new Error(\"invocation nonce required\");\n  if (typeof pilotStage !== \"function\") throw new Error(\"pilot stage callback required\");");
    source = once(source,
      '  console.info("ephemeral stage: pure safety checks passed");',
      '  console.info("ephemeral stage: pure safety checks passed");\n  pilotStage("pure_safety_passed");');
    source = once(source,
      '  const root = fs.mkdtempSync("/tmp/ephemeral-postgres-");',
      '  const root = fs.mkdtempSync("/tmp/ephemeral-postgres-");\n  pilotStage("owned_root_created");');
    source = once(source,
      "    await waitForOwnedPostgres(ownedConfig, operation);",
      '    await waitForOwnedPostgres(ownedConfig, operation);\n    pilotStage("owned_postgres_ready");');
    source = once(source,
      "    await applySchema({ ...config, username, port }, operation);",
      '    await applySchema({ ...config, username, port }, operation);\n    pilotStage("schema_applied");');
    const start = source.indexOf("    const prototypeOnly = ");
    const endAnchor = "    normalRouteCompleted = normalRouteOnly;";
    const end = source.indexOf(endAnchor, start);
    assert(start > 0 && end > start, "ephemeral dispatch anchor missing");
    source = once(source, source.slice(start, end + endAnchor.length),
      '    assertPracticalGroup(selectedGroups);\n    pilotStage("managed_suite_starting");\n    await runManagedTests(["practical-guidance-pilot"], Object.freeze({ ...config, invocationNonce }));\n    pilotStage("managed_suite_passed");\n    throwIfInterrupted(operation);');
    source = once(source, "  if (normalRouteCompleted) finalizeNormalRouteReport();\n}",
      "  if (normalRouteCompleted) finalizeNormalRouteReport();\n  if (fs.existsSync(root) || !ownedPostgres) throw new Error(\"cleanup attestation unavailable\");\n  pilotStage(\"cleanup_complete\");\n  return Object.freeze({ format: \"weiku.owned-ephemeral-cleanup-attestation.v1\", invocationNonce, cleanupComplete: true, ownedRoot: root, postgresPid: ownedPostgres.pid, postgresStartTime: ownedPostgres.startTime });\n}");
    source = once(source,
      "    await runEphemeralTests();",
      "    const directNonce = process.argv.at(-1);\n    const directGroups = process.argv.slice(2, -1);\n    const attestation = await runEphemeralTests(directGroups, directNonce);\n    console.log(\"PRACTICAL_CLEANUP_ATTESTATION:\" + JSON.stringify(attestation));");
    source += '\nfunction assertPracticalGroup(groups){if(groups.length!==1||groups[0]!=="practical-guidance-pilot")throw Error("isolated practical-guidance group required");}\n';
    adaptations.push("Require an invocation nonce and safe stage callback; replace only lifecycle/suite dispatch; return a nonce-bound attestation only after unchanged owned cleanup has succeeded and removed the root.");
  } else if (relative === targets[1]) {
    source = once(source, "const GROUPS = new Set([", 'const GROUPS = new Set([\n  "practical-guidance-pilot",');
    source = once(source, "const GROUP_FILES = {", `const GROUP_FILES = {\n  "practical-guidance-pilot": [${JSON.stringify(suite)}],`);
    source = once(source, "  const args = browser", `  const args = file === ${JSON.stringify(suite)} ? ["--import", "tsx", "--import", ${JSON.stringify(register)}, file] : browser`);
    source = once(source, "function emitSafeChildDiagnostic(kind, output) {",
      `function emitSafeChildDiagnostic(kind, output) {
  if (kind === "practical-guidance-pilot") {
    let emitted = false;
    for (const line of output.split(/\\r?\\n/u)) {
      if (!line.startsWith("SAFE_PRACTICAL_FAILURE:")) continue;
      try {
        const diagnostic = JSON.parse(line.slice("SAFE_PRACTICAL_FAILURE:".length));
        if (Number.isInteger(diagnostic.line) && diagnostic.line > 0 && diagnostic.line < 2000
          && /^[a-z][a-z0-9_]{0,63}$/.test(diagnostic.code)
          && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(diagnostic.errorName)
          && typeof diagnostic.reason === "string" && diagnostic.reason.length <= 320) {
          console.error("managed practical diagnostic: " + JSON.stringify(diagnostic));
          emitted = true;
        }
      } catch {}
      break;
    }
    if (!emitted) {
      const location = output.match(/practical-guidance-pilot\\/verify\\.mts:(\\d{1,4}):\\d+/u);
      const named = output.match(/(?:^|\\n)([A-Za-z][A-Za-z0-9]{0,40}Error): ([^\\r\\n]{1,500})/u);
      const coded = output.match(/\\b(ERR_[A-Z0-9_]{2,60})\\b/u);
      if (named || coded || location) {
        const reason = (named?.[2] ?? coded?.[1] ?? "module initialization failed")
          .replace(/postgres(?:ql)?:\\/\\/[^\\s'"]+/giu, "[redacted-dsn]")
          .replace(/(?:password|pwd|secret|token|api[_-]?key)\\s*[=:]\\s*[^\\s,'"}]+/giu, "$1=[redacted]")
          .replace(/\\/tmp\\/ephemeral-postgres-[A-Za-z0-9_-]+/gu, "[owned-root]")
          .replace(/\\/home\\/[^/\\s]+\\/[^\\s,'"}]+/gu, "[workspace-path]")
          .replace(/\\b[a-f0-9]{32,}\\b/giu, "[redacted-opaque]")
          .slice(0, 320);
        console.error("managed practical diagnostic: " + JSON.stringify({
          line: Number(location?.[1] ?? 1),
          code: coded?.[1]?.toLowerCase() ?? "module_initialization_failed",
          errorName: named?.[1] ?? "Error",
          reason,
        }));
      }
    }
    return;
  }`);
    source = once(source, "  if (group === \"normal-route-verification\" || group === \"normal-route-lifecycle\") {",
      "  if (group === \"practical-guidance-pilot\") env.PRACTICAL_INVOCATION_NONCE = config.invocationNonce;\n  if (group === \"normal-route-verification\" || group === \"normal-route-lifecycle\") {");
    source = once(source, "    || typeof config.safePath !== \"string\"\n", "    || typeof config.safePath !== \"string\"\n    || typeof config.invocationNonce !== \"string\"\n    || !/^[a-f0-9]{32}$/.test(config.invocationNonce)\n");
    source = once(source,
      '              : group === "evidence-prototype" ? "evidence-prototype" : null,',
      '              : group === "evidence-prototype" ? "evidence-prototype"\n                : group === "practical-guidance-pilot" ? "practical-guidance-pilot" : null,');
    adaptations.push("Register one non-APP_GROUPS child, require and pass its nonce, and accept only its bounded SAFE_PRACTICAL_FAILURE diagnostic; private context and ownership cleanup are retained.");
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
    const searchPrefix = "const SEARCH_SQL = `";
    const sqlStart = original.indexOf(searchPrefix) + searchPrefix.length;
    const sqlEnd = original.indexOf("`;", sqlStart);
    assert(sqlStart >= searchPrefix.length && sqlEnd > sqlStart, "canonical SEARCH_SQL missing");
    const ordinarySql = original.slice(sqlStart, sqlEnd);
    assert.equal(hash(ordinarySql), integrity.searchSqlSha256, "canonical ordinary SEARCH_SQL integrity mismatch");
    assert.equal(ordinarySql.split(publishedJoin).length, 2, "published SQL anchor must be unique");
    const activeSource = "WHERE source.status = 'active'";
    assert.equal(ordinarySql.split(activeSource).length, 2, "active source SQL anchor must be unique");
    const draftSql = ordinarySql
      .replace(publishedJoin, draftJoin)
      .replace(activeSource, "WHERE source.status = 'draft'");
    assert.notEqual(hash(draftSql), hash(ordinarySql), "draft query must be distinct");
    source = once(source, "export async function searchEvidence(\n", "async function searchEvidenceScoped(\n");
    source = once(source, "  rawInput: SearchInput,\n): Promise<EvidenceSearchResponse> {", "  rawInput: SearchInput,\n  draftRunId: string | null,\n): Promise<EvidenceSearchResponse> {");
    const insertAt = source.indexOf("\n\nasync function searchEvidenceScoped(");
    assert(insertAt > 0, "search function anchor missing");
    source = source.slice(0, insertAt)
      + `\n\nconst DRAFT_CANDIDATE_SEARCH_SQL = ${JSON.stringify(draftSql)};\n`
      + source.slice(insertAt);
    source = once(source, "      const result = await pool.query(SEARCH_SQL, [\n        input.question,\n        pageSize,\n        page * pageSize,\n      ]);",
      "      const result = await pool.query(draftRunId === null ? SEARCH_SQL : DRAFT_CANDIDATE_SEARCH_SQL, [\n        input.question,\n        pageSize,\n        page * pageSize,\n        ...(draftRunId === null ? [] : [draftRunId]),\n      ]);");
    source += `\nexport async function searchEvidence(pool, rawInput) { return searchEvidenceScoped(pool, rawInput, null); }\n`
      + `export async function searchEvidenceDraftCandidates(pool, rawInput, runId) {\n`
      + `  if (typeof runId !== "string" || !/^practical-guidance-[a-f0-9]{24}$/.test(runId)) throw new Error("exact practical run ID required");\n`
      + `  return searchEvidenceScoped(pool, rawInput, runId);\n}\n`;
    const adaptedSqlStart = source.indexOf(searchPrefix) + searchPrefix.length;
    const adaptedSqlEnd = source.indexOf("`;", adaptedSqlStart);
    assert.equal(hash(source.slice(adaptedSqlStart, adaptedSqlEnd)), integrity.searchSqlSha256, "ordinary SEARCH_SQL changed during adaptation");
    adaptations.push("Preserve the hash-pinned ordinary SEARCH_SQL byte-for-byte; add a separate parameterized draft-query constant and private export scoped to testOnly rows and the exact run prefix.");
  }
  record(relative, original, source, adaptations);
  const transformed = await transform(source, {
    loader: relative.endsWith(".ts") ? "ts" : "js",
    format: "esm",
    target: "node20",
    sourcefile: fileURLToPath(url),
  });
  return { format: "module", source: transformed.code, shortCircuit: true };
}
