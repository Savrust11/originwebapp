// Imported by the clean bootstrap before any regression code is evaluated.
// No packages, production modules, sender/provider modules, or DB modules.
const allowedBuiltins = new Set([
  "node:fs", "node:crypto", "node:assert/strict", "node:test",
]);
const allowedFiles = new Set([
  new URL("./offline.test.mjs", import.meta.url).href,
  new URL("./claims.mjs", import.meta.url).href,
]);
export async function resolve(specifier, context, nextResolve) {
  if (allowedBuiltins.has(specifier)) return nextResolve(specifier, context);
  if (specifier.startsWith(".") || specifier.startsWith("file:")) {
    const url = new URL(specifier, context.parentURL).href;
    if (allowedFiles.has(url)) return nextResolve(specifier, context);
  }
  throw new Error(`offline_import_forbidden:${specifier}`);
}