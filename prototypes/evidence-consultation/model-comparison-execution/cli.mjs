// No work on import. Each explicit command is a single offline action or one POST.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunner, withSharedLock } from "./runner.mjs";

export async function main(args = process.argv.slice(2)) {
  const [command, a, b, c] = args;
  const valid = (command === "init" && args.length === 2 && a === "--authorize-24-43-usd1")
    || (["next", "status", "recover"].includes(command) && args.length === 1)
    || (command === "review" && args.length === 4 && /^C-[KH]\d{2}$/.test(a) && /^[XY]$/.test(b))
    || (command === "unmask" && args.length === 2 && a.trim().length >= 8);
  if (!valid) throw new Error("Use init --authorize-24-43-usd1 | status | next | review CASE X_or_Y FILE | recover | unmask REASON");
  const runner = createRunner();
  return withSharedLock(async () => {
    try {
      if (command === "init") return runner.initialize();
      if (command === "next") return await runner.next();
      if (command === "review") return runner.acceptReview(a, b, path.resolve(c));
      if (command === "recover") return runner.recover();
      if (command === "unmask") return runner.unmask(a);
      return runner.status();
    } catch (error) {
      // Expected operator mistakes refuse without turning into a global failure.
      const correctable = /^(already_initialized|run_not_initialized|globally_stopped_no_resume|previous_attempt_requires_frozen_blind_review|transmission_limit|credential_not_available|latest_attempt_not_reviewable|review_|invalid_answer_cannot_pass|unmask_requires_|no_unresolved_reservation)/;
      if (!correctable.test(error.message)) runner.emergencyStop();
      throw error;
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    // Never emit provider exception text, request objects, headers or environment.
    const code = /^[a-z0-9_-]+$/.test(error.message) ? error.message : "local_action_refused_check_integrity";
    console.error(JSON.stringify({ error: code, noAutomaticRetry: true }));
    process.exitCode = 2;
  });
}