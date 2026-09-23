// Test-only graph. The paid controller, normal application and networking cannot load.
const files = new Set([
  "./accounting.mjs", "./run.mjs", "./history.mjs", "./display.mjs",
  "../evaluation/operational-accounting.mjs", "../evaluation/claim-citations.mjs",
  "../../../tests/evidence-general-six-accounting.test.mjs",
  "../../../tests/evidence-general-six-preflight.test.mjs",
].map(file => new URL(file, import.meta.url).href));
const builtins = new Set([
  "node:test", "node:assert/strict", "node:crypto", "node:fs", "node:path", "node:url",
]);
export async function resolve(specifier, context, nextResolve) {
  if (builtins.has(specifier)) return nextResolve(specifier, context);
  let url;
  try { url = new URL(specifier, context.parentURL || import.meta.url).href; }
  catch { throw new Error("GENERAL_SIX_OFFLINE_IMPORT_BLOCKED"); }
  if (!files.has(url)) throw new Error("GENERAL_SIX_OFFLINE_IMPORT_BLOCKED");
  return nextResolve(specifier, context);
}