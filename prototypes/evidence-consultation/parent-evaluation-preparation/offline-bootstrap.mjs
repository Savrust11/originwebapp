// Run directly: env -i /absolute/path/to/node .../offline-bootstrap.mjs
// Do not use node --test: node:test runs here without spawning a child.
// Own copy of the semantic-regressions pattern; no old files are imported.
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import dns from "node:dns";
import childProcess from "node:child_process";
import workers from "node:worker_threads";
import { register, syncBuiltinESMExports } from "node:module";

function deny() { throw new Error("offline_network_or_process_forbidden"); }
globalThis.fetch = deny;
globalThis.WebSocket = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
net.Server.prototype.listen = deny;
tls.connect = http.request = http.get = https.request = https.get = deny;
http2.connect = http2.createServer = http2.createSecureServer = deny;
dgram.createSocket = deny;
for (const key of Object.keys(dns)) {
  if (typeof dns[key] === "function") dns[key] = deny;
}
for (const key of Object.keys(dns.promises)) {
  if (typeof dns.promises[key] === "function") dns.promises[key] = deny;
}
for (const key of ["exec", "execFile", "spawn", "fork", "execSync", "execFileSync", "spawnSync"]) {
  childProcess[key] = deny;
}
syncBuiltinESMExports();

// Initialize Node's own loader thread before denying user-created workers.
register("./offline-loader.mjs", import.meta.url);
workers.Worker = deny;
syncBuiltinESMExports();
Object.defineProperty(globalThis, "__parentPreparationOfflineBoundary", {
  value: Object.freeze({
    fetch: () => globalThis.fetch("https://offline.invalid"),
    websocket: () => new globalThis.WebSocket("wss://offline.invalid"),
    socket: () => net.connect({ host: "offline.invalid", port: 443 }),
    listen: () => net.createServer().listen(0),
    tls: () => tls.connect({ host: "offline.invalid", port: 443 }),
    http: () => http.get("http://offline.invalid"),
    https: () => https.get("https://offline.invalid"),
    http2: () => http2.connect("https://offline.invalid"),
    udp: () => dgram.createSocket("udp4"),
    dns: () => dns.lookup("offline.invalid"),
    dnsPromise: () => dns.promises.resolve("offline.invalid"),
    child: () => childProcess.spawn("never-executed"),
    worker: () => new workers.Worker("never-executed"),
  }),
});
await import("./offline.test.mjs");