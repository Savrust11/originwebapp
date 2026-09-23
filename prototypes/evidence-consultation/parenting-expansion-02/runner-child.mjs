import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { trackOwnedProcess, stopOwnedProcess } from "../../../tests/safety/owned-process.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
export async function runOwnedExpansionChild(nonce) {
  const env = Object.fromEntries(["PATH", "LANG", "LC_ALL", "TZ"]
    .filter(key => typeof process.env[key] === "string").map(key => [key, process.env[key]]));
  const child = spawn(process.execPath, [
    "--import", "tsx", "--import", path.join(directory, "register.mjs"),
    path.join(root, "tests/run-ephemeral-tests.mjs"), "parenting-expansion-02", nonce,
  ], { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const owned = trackOwnedProcess(child);
  let output = "";
  const collect = chunk => { if (output.length < 262_144) output += String(chunk).slice(0, 262_144 - output.length); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const stop = () => { void stopOwnedProcess(owned).catch(() => {}); };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, stop);
  try {
    const [code] = await once(child, "close");
    await stopOwnedProcess(owned);
    for (const line of output.split(/\r?\n/u)) {
      if (/^(?:ephemeral stage:|ephemeral cleanup:|managed (?:suite|group|expansion diagnostic):)/u.test(line)) console.info(line.slice(0, 600));
    }
    if (code !== 0) {
      const diagnostic = output.split(/\r?\n/u).find(line => line.startsWith("managed expansion diagnostic:"));
      throw new Error(diagnostic?.slice(0, 600) ?? "owned expansion runner failed");
    }
    const markers = output.split(/\r?\n/u).filter(line => line.startsWith("EXPANSION_CLEANUP_ATTESTATION:"));
    if (markers.length !== 1) throw new Error("owned expansion runner returned no unique cleanup attestation");
    return JSON.parse(markers[0].slice("EXPANSION_CLEANUP_ATTESTATION:".length));
  } finally {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, stop);
  }
}