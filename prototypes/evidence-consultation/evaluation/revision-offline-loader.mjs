// Separate narrow import graph; never opens the paid runner or ordinary app.
const files = new Set([
  "./claim-citations.mjs", "./role-separated-request.mjs",
  "./revised-accounting.mjs", "./independent-accounting.mjs",
  "./operational-accounting.mjs",
  "../../../tests/evidence-claim-citations.test.mjs",
  "../../../tests/evidence-revised-accounting.test.mjs",
  "../../../tests/evidence-independent-accounting.test.mjs",
].map(file => new URL(file, import.meta.url).href));
const builtins = new Set(["node:test", "node:assert/strict", "node:fs", "node:crypto"]);
export async function resolve(specifier, context, nextResolve) {
  if (builtins.has(specifier)) return nextResolve(specifier, context);
  let url;
  try { url = new URL(specifier, context.parentURL || import.meta.url).href; }
  catch { throw new Error("REVISION_OFFLINE_IMPORT_BLOCKED"); }
  if (!files.has(url)) throw new Error("REVISION_OFFLINE_IMPORT_BLOCKED");
  return nextResolve(specifier, context);
}