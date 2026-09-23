// Fail closed before resolving packages, providers, database or app code.
const allowedBuiltins = new Set([
  "node:fs", "node:crypto", "node:assert/strict", "node:test",
]);
const allowedFile = new URL("./offline.test.mjs", import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (allowedBuiltins.has(specifier)) return nextResolve(specifier, context);
  if (specifier.startsWith(".") || specifier.startsWith("file:")) {
    if (new URL(specifier, context.parentURL).href === allowedFile) {
      return nextResolve(specifier, context);
    }
  }
  throw new Error(`offline_import_forbidden:${specifier}`);
}