// Test-only narrow graph: neither the paid runner nor normal application can load.
const files = new Set([
  "./independent-accounting.mjs", "./operational-accounting.mjs",
  "./attribution-data.mjs", "./attribution-display.mjs",
  "../../../tests/evidence-independent-accounting.test.mjs",
  "../../../tests/evidence-attribution-display.test.mjs",
].map(file => new URL(file, import.meta.url).href));
const builtins = new Set(["node:test", "node:assert/strict", "node:fs", "node:crypto"]);
export async function resolve(specifier, context, nextResolve) {
  if (builtins.has(specifier)) return nextResolve(specifier, context);
  let url;
  try { url = new URL(specifier, context.parentURL || import.meta.url).href; }
  catch { throw new Error("INDEPENDENT_OFFLINE_IMPORT_BLOCKED"); }
  if (!files.has(url)) throw new Error("INDEPENDENT_OFFLINE_IMPORT_BLOCKED");
  return nextResolve(specifier, context);
}