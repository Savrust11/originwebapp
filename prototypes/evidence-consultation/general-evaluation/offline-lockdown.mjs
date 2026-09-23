import { register } from "node:module";
register("./offline-loader.mjs", import.meta.url);
globalThis.fetch = async () => { throw new Error("GENERAL_SIX_OFFLINE_NETWORK_BLOCKED"); };
globalThis.WebSocket = class {
  constructor() { throw new Error("GENERAL_SIX_OFFLINE_NETWORK_BLOCKED"); }
};