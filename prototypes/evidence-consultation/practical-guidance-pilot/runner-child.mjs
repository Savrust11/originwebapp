import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { trackOwnedProcess, stopOwnedProcess } from "../../../tests/safety/owned-process.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const runner = path.join(root, "tests/run-ephemeral-tests.mjs");
const register = path.join(directory, "register.mjs");
const MAX_OUTPUT = 256 * 1024;

export async function runOwnedPilotChild(nonce) {
  const env = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  const child = spawn(process.execPath, [
    "--import", "tsx",
    "--import", register,
    runner,
    "practical-guidance-pilot",
    nonce,
  ], {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = trackOwnedProcess(child);
  let output = "";
  const collect = (chunk) => {
    if (output.length < MAX_OUTPUT) output += String(chunk).slice(0, MAX_OUTPUT - output.length);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const stop = () => { void stopOwnedProcess(record).catch(() => {}); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    const [code] = await once(child, "close");
    await stopOwnedProcess(record);
    for (const line of output.split(/\r?\n/u)) {
      if (/^(?:ephemeral stage:|ephemeral cleanup:|managed (?:suite|group|practical diagnostic):)/u.test(line)) {
        console.info(line.slice(0, 500));
      }
    }
    if (code !== 0) {
      const managed = output.split(/\r?\n/u).find((line) => line.startsWith("managed practical diagnostic:"));
      throw new Error(managed?.slice(0, 500) ?? "owned runner child failed without a bounded suite diagnostic");
    }
    const markers = output.split(/\r?\n/u).filter((line) => line.startsWith("PRACTICAL_CLEANUP_ATTESTATION:"));
    if (markers.length !== 1) throw new Error("owned runner child returned no unique cleanup attestation");
    return JSON.parse(markers[0].slice("PRACTICAL_CLEANUP_ATTESTATION:".length));
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGHUP", stop);
  }
}