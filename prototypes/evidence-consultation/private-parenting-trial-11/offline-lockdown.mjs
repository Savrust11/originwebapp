const deny = () => { throw new Error("OFFLINE_NETWORK_BLOCKED"); };
globalThis[Symbol.for("private-parenting-trial-11.offline-lockdown")] = true;
globalThis.fetch = async () => deny();
globalThis.WebSocket = class { constructor() { deny(); } };

const denyModule = `const deny=()=>{throw Error("OFFLINE_NETWORK_BLOCKED")};
export const request=deny, get=deny, connect=deny, createConnection=deny, lookup=deny,
resolve=deny, resolve4=deny, resolve6=deny; export default {request,get,connect,createConnection,lookup,resolve,resolve4,resolve6};`;
export async function resolve(specifier, context, nextResolve) {
  if (["node:http", "node:https", "node:net", "node:tls", "node:dns", "node:dns/promises",
    "http", "https", "net", "tls", "dns"].includes(specifier)) {
    return { url: `data:text/javascript,${encodeURIComponent(denyModule)}`, shortCircuit: true };
  }
  if (/openai|anthropic|google-generative|provider-sdk/i.test(specifier)) {
    throw new Error("PROVIDER_SDK_IMPORT_BLOCKED");
  }
  return nextResolve(specifier, context);
}