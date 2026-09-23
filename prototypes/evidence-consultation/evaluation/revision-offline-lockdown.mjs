import { register } from "node:module";
register("./revision-offline-loader.mjs", import.meta.url);
globalThis.fetch = async () => { throw new Error("REVISION_OFFLINE_NETWORK_BLOCKED"); };
globalThis.WebSocket = class {
  constructor() { throw new Error("REVISION_OFFLINE_NETWORK_BLOCKED"); }
};