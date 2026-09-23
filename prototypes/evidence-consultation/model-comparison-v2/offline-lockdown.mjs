// Reuse the old no-network/no-child-process guard without modifying it.
import "../model-comparison-resume/offline-lockdown.mjs";
import net from "node:net";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
const deny = () => { throw new Error("offline_network_or_process_forbidden"); };
net.Server.prototype.listen = deny;
for (const key of ["lookup", "resolve", "resolve4", "resolve6", "reverse"])
  if (dns.promises[key]) dns.promises[key] = deny;
syncBuiltinESMExports();