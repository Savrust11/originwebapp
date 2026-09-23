import { register } from "node:module";
register("./offline-loader.mjs", import.meta.url);
globalThis[Symbol.for("private-parenting-trial-10.offline-lockdown")] = true;
globalThis.fetch = async () => { throw new Error("OFFLINE_NETWORK_BLOCKED"); };
globalThis.WebSocket = class { constructor() { throw new Error("OFFLINE_NETWORK_BLOCKED"); } };
