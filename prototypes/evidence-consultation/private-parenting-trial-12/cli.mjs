#!/usr/bin/env node
import { createRunner } from "./runner.mjs";
const [command, ...args] = process.argv.slice(2);
try {
  const runner = createRunner();
  const result = command === "init" ? await runner.initialize()
    : command === "status" ? await runner.status()
    : command === "send" ? await runner.send(args[0], args[1])
    : command === "close" ? await runner.close(args.slice(0).join(" "))
    : (() => { throw Error("USAGE_INIT_STATUS_SEND_CLOSE"); })();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const safe = /^[A-Z0-9_:.-]+$/.test(error?.message ?? "") ? error.message : "OPERATION_FAILED";
  console.error(safe);
  process.exitCode = 1;
}