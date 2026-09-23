const root = new URL("./", import.meta.url).href;
const allowed = new Set([
  "node:assert/strict", "node:crypto", "node:fs", "node:os", "node:path", "node:url",
]);
export async function resolve(specifier, context, nextResolve) {
  if (allowed.has(specifier)) return nextResolve(specifier, context);
  let url;
  try { url = new URL(specifier, context.parentURL).href; }
  catch { throw new Error("OFFLINE_IMPORT_BLOCKED"); }
  if (!url.startsWith(root)) throw new Error("OFFLINE_IMPORT_BLOCKED");
  return nextResolve(specifier, context);
}