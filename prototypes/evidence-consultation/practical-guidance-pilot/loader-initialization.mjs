import { register as registerNodeLoader } from "node:module";
import { register as registerTsx } from "tsx/esm/api";

export async function initializePilotLoaders(nonce) {
  if (typeof nonce !== "string" || !/^[a-f0-9]{32}$/u.test(nonce)) {
    throw new Error("loader initialization requires an invocation nonce");
  }
  // Register TS handling first. The checked pilot adapter is registered last
  // so it sees pinned native targets before delegating all other TS modules.
  registerTsx();
  registerNodeLoader("./adapter-loader.mjs", import.meta.url);
  try {
    await import(`./loader-preflight.mts?invocation=${nonce}`);
  } catch (error) {
    if (error?.message === "managed test authorization required") {
      return Object.freeze({ parsedMts: true, authorizationDenied: true });
    }
    const kind = error?.code ?? error?.name ?? "unknown";
    throw new Error(`loader preflight failed before managed authorization denial (${String(kind).slice(0, 80)})`);
  }
  throw new Error("loader preflight unexpectedly bypassed managed authorization");
}