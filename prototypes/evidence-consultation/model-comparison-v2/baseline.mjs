import fs from "node:fs";
import path from "node:path";
import { ROOT, PREPARATION } from "../model-comparison-execution/runner.mjs";
import { hash, assert, assertRequest, validatePricing, measureUsage } from "../model-comparison-execution/controls.mjs";
export const ID = "reading-comparison-02";
export const OUTPUT = `evidence-work/model-comparison-runs/${ID}`;
export const CODE = "prototypes/evidence-consultation/model-comparison-v2";
export const OLD = "evidence-work/model-comparison-runs/reading-comparison-01";
export const RESUME = `${OLD}-resume`;
export const DIAGNOSIS = "evidence-work/model-comparison-diagnosis/reading-comparison-01";
export const DECISION = `${OUTPUT}/preflight/evidence-accounting-decision.json`;
export const DECISION_HASH = "caac6b836c03e63fa36ff22a260326bf65ab754dccf38da293a118808e70d052";
export const DRIFT = `${OUTPUT}/preflight/report-drift.json`;
export const DRIFT_HASH = "605d7ab66543eee6999e930a91bf905cc713ecd188ee100bdc4d2831e1924ccd";
export const DRIFT_ADDENDUM = `${OUTPUT}/preflight/report-drift-addendum.json`;
export const DRIFT_ADDENDUM_HASH = "83ed8c8b5a8d7e817da2ae4125fa02c66a4242b415ca0485bf8666a48ed95ce5";
const reportPaths = [
  `${PREPARATION}/comparison-preparation.html`, `${OLD}/comparison-result.html`, `${RESUME}/comparison-resume-result.html`,
];
const historicalReportPaths = [
  "evidence-work/general-audience-evaluation/general-audience-six-01/general-audience-results.html",
  "evidence-work/model-evaluation/evaluation-excel.csv",
  "evidence-work/model-evaluation/independent-reading-results.html",
  "evidence-work/condition-display-offline/conditions-and-body.html",
];
export const LIMITS = Object.freeze({
  baselineTransmissions: 21, newMaxTransmissions: 21, plannedTransmissions: 21, cumulativeMaxTransmissions: 43,
  baselineKnownCentiMicroUSD: 6004300, baselineUnresolvedCentiMicroUSD: 551250,
  budgetCentiMicroUSD: 100000000, concurrency: 1, retries: 0, timeoutMs: 120000,
});
export function safe(root, relative) {
  assert(typeof relative === "string" && relative.length && !path.isAbsolute(relative)
    && !relative.split(/[\\/]/).includes(".."), "unsafe_path");
  const target = path.join(root, relative);
  for (let p = target; p !== path.dirname(p); p = path.dirname(p))
    if (fs.existsSync(p)) assert(!fs.lstatSync(p).isSymbolicLink(), "symlink_forbidden");
  return target;
}
export function validateDecision(d) {
  assert(d?.schemaVersion === 1 && d.decisionTiming === "before-any-reading-comparison-02-send"
    && d.operations.newProviderTransmissions === 0, "decision_not_preflight");
  const l = d.continuationLimitsFromCurrentInstruction;
  assert(l.baselineTransmissions === 21 && l.maxNewTransmissions === 21 && l.cumulativeCeiling === 43
    && l.budgetCentiMicroUSD === 100000000 && l.q10EitherModelResendForbidden
    && l.h06SolRegenerationForbidden && l.frozenPayloadChangesForbidden, "decision_limits_invalid");
  const a = d.accountingCorrection, h = a.h06, balance = a.correctedOpeningBalance;
  assert(h.knownCalculatedCostCentiMicroUSD === 3416400 && h.oldReservationCentiMicroUSD === 10398500
    && h.reservationReplacedInSuccessorBalance === true && h.reasoningChargedAgain === false
    && a.q10.unresolvedReservationCentiMicroUSD === 551250 && a.q10.reservationReplaced === false
    && balance.knownCentiMicroUSD === 6004300 && balance.unresolvedCentiMicroUSD === 551250
    && balance.totalCentiMicroUSD === 6555550 && balance.reservationAndActualDoubleCounted === false,
  "decision_accounting_invalid");
  assert(d.h06Sol.comparisonEligibility === false && d.h06Sol.completionProven === false
    && d.h06Sol.disposition === "reference-only" && d.h06Sol.rawProviderStatus === null
    && d.h06Sol.reviewReuse.originalComparisonReviewReusable === false, "decision_completion_invalid");
  return d;
}
export function loadDecision(root = ROOT) {
  const bytes = fs.readFileSync(safe(root, DECISION));
  assert(hash(bytes) === DECISION_HASH, "independent_decision_changed");
  return validateDecision(JSON.parse(bytes));
}
export function continuation(prepared) {
  const attempts = prepared.order.attempts.filter(a => a.caseId !== "C-K10"
    && !(a.caseId === "C-H06" && a.model === "gpt-5.6-sol"));
  assert(attempts.length === 21 && attempts[0].caseId === "C-H06"
    && attempts[0].model === "gpt-5.6-luna", "continuation_order_invalid");
  return { ...prepared, order: { ...prepared.order, attempts, pairs: prepared.order.pairs.filter(p => p.caseId !== "C-K10") } };
}
export function virtualReportBytes(root, relative, proof, addendum = null) {
  const bytes = fs.readFileSync(safe(root, relative));
  if (!reportPaths.includes(relative) && !historicalReportPaths.includes(relative)) return bytes;
  const entry = (reportPaths.includes(relative) ? proof.mismatches : addendum?.paths)?.find(e => e.path === relative);
  assert(entry && entry.copyCount === 16 && entry.actualBytes === entry.expectedBytes * 16
    && bytes.length === entry.actualBytes && hash(bytes) === entry.actualSha256
    && entry.historicalSource.blobSha256 === entry.expectedSha256
    && entry.historicalSource.blobBytes === entry.expectedBytes, "report_transform_proof_failed");
  const first = bytes.subarray(0, entry.expectedBytes);
  assert(hash(first) === entry.expectedSha256, "report_original_hash_failed");
  for (let i = 0; i < 16; i++) {
    const block = bytes.subarray(i * entry.expectedBytes, (i + 1) * entry.expectedBytes);
    assert(block.equals(first) && hash(block) === entry.expectedSha256, "report_copy_changed");
  }
  return first;
}
export function loadBaseline(root = ROOT) {
  const read = p => JSON.parse(fs.readFileSync(safe(root, p), "utf8"));
  const proofBytes = fs.readFileSync(safe(root, DRIFT));
  assert(hash(proofBytes) === DRIFT_HASH, "report_proof_changed");
  const proof = JSON.parse(proofBytes);
  assert(proof.mismatches.length === 3 && proof.mismatches.every(e => reportPaths.includes(e.path)), "report_proof_scope_invalid");
  const addendumBytes = fs.readFileSync(safe(root, DRIFT_ADDENDUM));
  assert(hash(addendumBytes) === DRIFT_ADDENDUM_HASH, "historical_report_proof_changed");
  const addendum = JSON.parse(addendumBytes);
  assert(addendum.paths.length === 4 && new Set(addendum.paths.map(e => e.path)).size === 4
    && addendum.paths.every(e => historicalReportPaths.includes(e.path) && e.generationRole === "none; preservation-only")
    && addendum.originalProof.sha256 === DRIFT_HASH, "historical_report_proof_scope_invalid");
  const checked = new Map();
  const verify = b => {
    const bytes = virtualReportBytes(root, b.path, proof, addendum);
    assert(hash(bytes) === b.sha256 && (b.bytes === undefined || bytes.length === b.bytes),
      "frozen_evidence_changed_requires_verified_drift_proof");
    checked.set(b.path, b.sha256);
  };
  const decision = loadDecision(root);
  verify({ path: `${DIAGNOSIS}/evidence-manifest.json`, sha256: decision.preflight.protectedManifestSha256 });
  const manifest = read(`${DIAGNOSIS}/evidence-manifest.json`);
  assert(manifest.protectedFiles.length === 80, "protected_manifest_invalid");
  manifest.protectedFiles.forEach(verify);
  // Reconstruct the original 50-file predecessor snapshot with original size/hash
  // only for the three proven report transforms. No global filesystem patch.
  const rows = [];
  const walk = p => {
    for (const n of fs.readdirSync(safe(root, p)).sort()) {
      const relative = `${p}/${n}`, stat = fs.lstatSync(safe(root, relative));
      if (stat.isDirectory()) walk(relative);
      else {
        assert(stat.isFile(), "old_nonfile");
        const bytes = virtualReportBytes(root, relative, proof, addendum);
        rows.push([relative, hash(bytes), bytes.length]);
      }
    }
  };
  ["prototypes/evidence-consultation/model-comparison", "prototypes/evidence-consultation/model-comparison-execution",
    PREPARATION, OLD].forEach(walk);
  assert(rows.length === 50 && hash(JSON.stringify(rows)) === "5d55ce9c8541a26a0f3678a277456110aa8a376f004aaeaa8aa332602707f3b0",
    "old_virtual_snapshot_changed");
  decision.citations.forEach(verify);
  for (const [name, sha256] of [
    ["official-response_reasoning_item.py.md", "a407ce25e045d11f932d481b115496cf17bfd08600ad8842456eeae380e55e44"],
    ["official-response_output_message.py.md", "db04d068cc349db4a0ea812f6f2eb1a336ab5e64bbc481b2bbc927ac8d0e26d8"],
    ["official-response_format_text_json_schema_config.py.md", "9ae3cf1a3901b67b2d7f93134a51281fab4a9649403777cbd108e67f54355508"],
  ]) verify({ path: `${DIAGNOSIS}/${name}`, sha256 });
  const freezeSha256 = "fb8af8e6c6546ce43d7f1cbd57e541bb86ebae009989dcc37646e2db8b2681b0";
  verify({ path: `${PREPARATION}/final-freeze.json`, sha256: freezeSha256 });
  read(`${PREPARATION}/final-freeze.json`).files.forEach(verify);
  read(`${PREPARATION}/preserved-results.json`).files.forEach(verify);
  read("evidence-work/general-audience-evaluation/general-audience-six-01/history-snapshot.json").preservedFiles.forEach(verify);
  Object.entries(read(`${PREPARATION}/manifest.json`).frozenReferences).forEach(([p, sha256]) => verify({ path: p, sha256 }));
  for (const old of [OLD, RESUME]) {
    const auth = read(`${old}/private/authorization.json`);
    (auth.bindings ?? auth.codeBindings).forEach(verify);
    let previous = null;
    const events = fs.readdirSync(safe(root, `${old}/private/events`)).sort().map((n, i) => {
      assert(n === `${String(i + 1).padStart(6, "0")}.json`, "old_event_sequence_changed");
      const bytes = fs.readFileSync(safe(root, `${old}/private/events/${n}`)), e = JSON.parse(bytes);
      assert(e.previousSha256 === previous, "old_chain_changed");
      e.assets.forEach(a => verify({ ...a, path: `${old}/${a.path}` }));
      previous = hash(bytes); return e;
    });
    assert(events.at(-1).type === "unmasked" && events.filter(e => e.type === "transmission-reserved").length === 1,
      "old_run_not_closed_or_count_changed");
    assert(previous === decision.preflight.eventChains.find(c => `${OLD.split("/").slice(0, -1).join("/")}/${c.run}` === old).tipSha256,
      "old_tip_changed");
  }
  validatePricing(read(`${OLD}/preflight/current-pricing.json`));
  const saved = read(`${RESUME}/private/results/C-H06/Y.json`);
  assert(measureUsage(saved.usage, "gpt-5.6-sol").centiMicroUSD === 3416400, "h06_cost_evidence_changed");
  const prepared = { freezeSha256, decision, requests: read(`${PREPARATION}/request-packets.json`),
    order: read(`${PREPARATION}/execution-order.json`), displays: read(`${PREPARATION}/app-display-templates.json`),
    rubric: read(`${PREPARATION}/rubric.json`), predecessorSnapshot: hash(JSON.stringify([...checked].sort())) };
  for (const pair of prepared.requests.requests) {
    pair.requests.forEach(assertRequest);
    const [{ model: first, ...a }, { model: second, ...b }] = pair.requests;
    assert(first !== second && JSON.stringify(a) === JSON.stringify(b), "pair_payloads_differ_beyond_model");
  }
  return continuation(prepared);
}