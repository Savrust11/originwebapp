// Separate narrow graph: do not weaken the existing safety-test allowlist.
const files = new Set([
  "./budget.mjs",
  "./proposed-rates.mjs",
  "./send-plan-accounting.mjs",
  "./operational-accounting.mjs",
  "../../../tests/evidence-evaluation-budget.test.mjs",
  "../../../tests/evidence-send-plan-accounting.test.mjs",
  "../../../tests/evidence-operational-accounting.test.mjs",
].map((path) => new URL(path, import.meta.url).href));
const builtins = new Set([
  "node:test", "node:assert/strict", "node:crypto", "node:fs", "node:path",
]);

export async function resolve(specifier, context, nextResolve) {
  if (builtins.has(specifier)) return nextResolve(specifier, context);
  let url;
  try { url = new URL(specifier, context.parentURL || import.meta.url).href; }
  catch { throw new Error("OFFLINE_IMPORT_BLOCKED"); }
  if (!files.has(url)) throw new Error("OFFLINE_IMPORT_BLOCKED");
  return nextResolve(specifier, context);
}