// Offline unit-test safety boundary: never touch real credentials or networking.
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import dns from "node:dns";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const deny = () => { throw new Error("offline_network_or_process_forbidden"); };
globalThis.fetch = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
tls.connect = http.request = http.get = https.request = https.get = deny;
dgram.createSocket = dns.lookup = dns.resolve = deny;
for (const name of ["exec", "execFile", "spawn", "fork", "execSync", "execFileSync", "spawnSync"])
  childProcess[name] = deny;
syncBuiltinESMExports();