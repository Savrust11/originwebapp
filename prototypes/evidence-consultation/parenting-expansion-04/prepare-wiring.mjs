import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptFrozenModule } from "./frozen-adapter.mjs";
import { output, preservation } from "./prepare.mjs";

// Prepares all frozen adapter receipts. No spawn/import of a launcher.
export function prepareWiring() {
  preservation();
  for (const name of ["adapter-loader.mjs", "runner-child.mjs", "verify.mts"]) adaptFrozenModule(name);
  fs.writeFileSync(path.join(output, "wiring-state.json"), JSON.stringify({
    status: "executable_wiring_complete_waiting_for_both_datasets",
    executed: false, databaseCreated: false,
    entry: "env -i PATH=\"$PATH\" LANG=C.UTF-8 node prototypes/evidence-consultation/parenting-expansion-04/safe-entry.mjs --authorize-expansion04-owned-validation",
    implemented: [
      "composed checked frozen loader and canonical ephemeral child transport",
      "source-neutral retained35 plus new-record staging and native/Japanese probes",
      "positive, paraphrase, scope-negative and geographical-negative independent gates",
      "retained municipal regression and all draft/testOnly/review state assertions",
      "offline Japanese source display and NHS adaptation/provenance separation",
      "fresh hash-bound authorization and nonce-bound owned cleanup finalizer",
    ],
    pending: [
      "both worker datasets ready and snapshot/permission/scope verified",
      "workers include query.scope.population and query.scope.support exact labels",
      "execute only after both ready; measure all checks and final cleanup",
    ],
    safety: "safe-entry fails before storage on pending/invalid inputs or absent explicit authorization; preparation never imports launchers",
  }, null, 2) + "\n");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) prepareWiring();