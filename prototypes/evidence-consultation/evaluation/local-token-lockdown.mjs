import { register } from "node:module";

register("./local-token-loader.mjs", import.meta.url);
globalThis.fetch = async () => { throw new Error("LOCAL_TOKEN_NETWORK_BLOCKED"); };
globalThis.WebSocket = class {
  constructor() { throw new Error("LOCAL_TOKEN_NETWORK_BLOCKED"); }
};
Object.defineProperty(globalThis, Symbol.for("evidence-local-token.offline-lockdown"), {
  value: true, writable: false, enumerable: false, configurable: false,
});
