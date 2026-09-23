import { register } from "node:module";

register("./offline-loader.mjs", import.meta.url);
globalThis.fetch = async () => { throw new Error("OFFLINE_NETWORK_BLOCKED"); };
globalThis.WebSocket = class {
  constructor() { throw new Error("OFFLINE_NETWORK_BLOCKED"); }
};
// Accidental-use guard, not an authentication token or hostile-code sandbox.
// Only this preload sets the marker in the shipped implementation.
Object.defineProperty(globalThis, Symbol.for("evidence-evaluation.offline-lockdown"), {
  value: true, writable: false, enumerable: false, configurable: true,
});