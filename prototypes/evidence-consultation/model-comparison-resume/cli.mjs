// Importing this CLI performs no action. No metacalls or network preflight.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunner } from "./runner.mjs";
export async function main(args = process.argv.slice(2)) {
  const [command, a, b, c] = args;
  const valid = (["init", "status", "next", "recover"].includes(command) && args.length === 1)
    || (command === "review" && args.length === 4 && /^C-[KH]\d{2}$/.test(a) && /^[XY]$/.test(b))
    || (command === "unmask" && args.length === 2 && a.trim().length >= 8);
  if (!valid) throw new Error("invalid_command");
  const runner = createRunner();
  if (command === "init") return runner.initialize(); // Existing explicit permission; no new authorization prompt.
  if (command === "review") return runner.review(a, b, path.resolve(c));
  if (command === "unmask") return runner.unmask(a);
  return runner[command]();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    // Only an internal error category; never arbitrary exception/provider content.
    const allowed = /^(already_initialized|run_not_initialized|continuation_stopped|previous_attempt_requires_review_or_recover|transmission_limit|credential_not_available|latest_attempt_not_reviewable|review_[a-z_]+|invalid_answer_cannot_pass|unmask_requires_[a-z_]+|no_unresolved_reservation|invalid_command)$/;
    console.error(JSON.stringify({ error: allowed.test(error.message) ? error.message : "local_action_refused_check_integrity",
      noAutomaticRetry: true }));
    process.exitCode = 2;
  });
}