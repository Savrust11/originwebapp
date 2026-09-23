import { register as registerNodeLoader } from "node:module";
import { register as registerTsx } from "tsx/esm/api";

export async function initializeExpansionLoaders(nonce) {
  if (typeof nonce !== "string" || !/^[a-f0-9]{32}$/u.test(nonce)) throw new Error("loader initialization requires invocation nonce");
  registerTsx();
  registerNodeLoader("./adapter-loader.mjs", import.meta.url);
  try {
    await import(`./loader-preflight.mts?invocation=${nonce}`);
  } catch (error) {
    if (error?.message === "managed test authorization required") return { parsedMts: true, authorizationDenied: true };
    throw new Error(`loader preflight failed (${String(error?.code ?? error?.name ?? "unknown").slice(0, 80)})`);
  }
  throw new Error("loader preflight bypassed managed authorization");
}