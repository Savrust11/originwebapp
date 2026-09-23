// Narrow graph for generation of LOCAL DISPLAY FILES and tests, never model calls.
const files = new Set([
  "./build-display-records.mjs", "./history-integrity.mjs", "./verified-catalog.mjs",
  "./display-policy.mjs", "./render-report.mjs",
  "../../../tests/evidence-condition-catalog.test.mjs",
  "../../../tests/evidence-condition-display-policy.test.mjs",
  "../../../tests/evidence-condition-integration.test.mjs",
].map(file => new URL(file, import.meta.url).href));
const builtins = new Set([
  "node:fs", "node:path", "node:url", "node:crypto", "node:test", "node:assert/strict",
]);
export async function resolve(specifier, context, nextResolve) {
  if (builtins.has(specifier)) return nextResolve(specifier, context);
  let url;
  try { url = new URL(specifier, context.parentURL || import.meta.url).href; }
  catch { throw new Error("CONDITION_OFFLINE_IMPORT_BLOCKED"); }
  if (!files.has(url)) throw new Error("CONDITION_OFFLINE_IMPORT_BLOCKED");
  return nextResolve(specifier, context);
}