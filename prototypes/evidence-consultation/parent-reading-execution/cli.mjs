#!/usr/bin/env node
// One explicit command performs at most one action. Importing runner.mjs never executes.
import { createRunner } from "./runner.mjs";

const [command, ...arguments_] = process.argv.slice(2);
if (!["init", "status", "next", "close"].includes(command)) {
  console.error("usage: node cli.mjs <init|status|next|close> [closure reason]");
  process.exitCode = 2;
} else {
  try {
    const runner = createRunner();
    const result = command === "init" ? await runner.initialize()
      : command === "status" ? await runner.status()
      : command === "next" ? await runner.next()
      : await runner.close(arguments_.join(" "));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    // Codes are local fixed diagnostics; provider bodies, raw errors and credentials are never printed.
    const safe = /^[a-z0-9:_-]+$/i.test(error?.message ?? "") ? error.message : "operation_failed";
    console.error(safe);
    process.exitCode = 1;
  }
}
