const allowed = new Set([
  "./local-token-lockdown.mjs",
  "./local-tokenizer.mjs",
  "./local-token-request.mjs",
  "./local-token-audit.mjs",
  "../../../tests/evidence-local-token.test.mjs",
].map((path) => new URL(path, import.meta.url).href));
const builtins = new Set(["node:assert/strict", "node:crypto", "node:fs", "node:test"]);

export async function resolve(specifier, context, nextResolve) {
  if (builtins.has(specifier)) return nextResolve(specifier, context);
  let url;
  try { url = new URL(specifier, context.parentURL || import.meta.url).href; }
  catch { throw new Error("LOCAL_TOKEN_IMPORT_BLOCKED"); }
  if (!allowed.has(url)) throw new Error("LOCAL_TOKEN_IMPORT_BLOCKED");
  return nextResolve(specifier, context);
}
