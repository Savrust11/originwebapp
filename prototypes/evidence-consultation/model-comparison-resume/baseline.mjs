// Read-only verification of the closed predecessor. Never repairs its ledger/code.
import fs from "node:fs";
import path from "node:path";
import { hash, assert } from "../model-comparison-execution/controls.mjs";
import { ROOT, loadPreparation } from "../model-comparison-execution/runner.mjs";

export const ID = "reading-comparison-01-resume";
export const OUTPUT = `evidence-work/model-comparison-runs/${ID}`;
export const OLD = "evidence-work/model-comparison-runs/reading-comparison-01";
export const CODE = "prototypes/evidence-consultation/model-comparison-resume";
export const SDK = ".local/evidence-tokenizer/official-response-params.py";
export const SNAPSHOT = "5d55ce9c8541a26a0f3678a277456110aa8a376f004aaeaa8aa332602707f3b0";
export const SDK_HASH = "148f2fb0c1a51df3f03c3a83ba061beed5c9213f64109a6412010d7658cb8267";
export const LIMITS = Object.freeze({
  baselineTransmissions: 20, newMaxTransmissions: 23, plannedTransmissions: 22,
  cumulativeMaxTransmissions: 43, baselineKnownCentiMicroUSD: 2587900,
  baselineUnresolvedCentiMicroUSD: 551250, budgetCentiMicroUSD: 100000000,
  concurrency: 1, retries: 0, timeoutMs: 120000,
});
const roots = [
  "prototypes/evidence-consultation/model-comparison",
  "prototypes/evidence-consultation/model-comparison-execution",
  "evidence-work/model-comparison-preparation/reading-comparison-01", OLD,
];
export function snapshot(root = ROOT) {
  const rows = [];
  const walk = relative => {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const p = `${relative}/${name}`, stat = fs.lstatSync(path.join(root, p));
      assert(!stat.isSymbolicLink(), "baseline_symlink_forbidden");
      if (stat.isDirectory()) walk(p);
      else { assert(stat.isFile(), "baseline_nonfile"); rows.push([p, hash(fs.readFileSync(path.join(root, p))), stat.size]); }
    }
  };
  roots.forEach(walk);
  return { sha256: hash(JSON.stringify(rows)), files: rows };
}
export function loadBaseline(root = ROOT) {
  const frozen = snapshot(root);
  assert(frozen.sha256 === SNAPSHOT && frozen.files.length === 50, "closed_predecessor_changed");
  assert(hash(fs.readFileSync(path.join(root, SDK))) === SDK_HASH, "archived_sdk_changed");
  const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  const events = fs.readdirSync(path.join(root, OLD, "private/events")).sort().map((n, i) => {
    const bytes = fs.readFileSync(path.join(root, OLD, "private/events", n));
    const event = JSON.parse(bytes);
    assert(n === `${String(i + 1).padStart(6, "0")}.json`, "old_sequence_changed");
    for (const asset of event.assets)
      assert(hash(fs.readFileSync(path.join(root, OLD, asset.path))) === asset.sha256, "old_asset_changed");
    return { ...event, hash: hash(bytes) };
  });
  events.forEach((e, i) => assert(e.previousSha256 === (events[i - 1]?.hash ?? null), "old_chain_changed"));
  assert(events.at(-1).type === "unmasked" && events.some(e => e.type === "global-stop"), "old_run_not_closed");
  const sent = events.filter(e => e.type === "transmission-reserved");
  assert(sent.length === 1 && sent[0].data.caseId === "C-K10"
    && sent[0].data.cumulativeTransmission === 20
    && sent[0].data.projection.centiMicroUSD === LIMITS.baselineUnresolvedCentiMicroUSD, "old_baseline_changed");
  const auth = read(`${OLD}/private/authorization.json`);
  assert(auth.limits.historicalCostCentiMicroUSD === LIMITS.baselineKnownCentiMicroUSD, "old_known_cost_changed");
  for (const binding of auth.codeBindings)
    assert(hash(fs.readFileSync(path.join(root, binding.path))) === binding.sha256, "old_sender_binding_changed");
  const response = read(`${OLD}/private/responses/C-K10/X.json`);
  assert(response.measured === null && !Object.hasOwn(response, "prompt_cache_options")
    && !Object.hasOwn(response, "controls"), "old_eligibility_requires_new_offline_assessment");
  const prepared = loadPreparation(root);
  const order = {
    ...prepared.order,
    pairs: prepared.order.pairs.filter(p => p.caseId !== "C-K10"),
    attempts: prepared.order.attempts.filter(a => a.caseId !== "C-K10"),
  };
  assert(order.pairs.length === 11 && order.attempts.length === 22, "continuation_plan_invalid");
  return { ...prepared, order, predecessorSnapshot: frozen.sha256 };
}