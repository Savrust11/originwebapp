// Deliberately one POST per explicit invocation, no loop/retry/SDK/app/DB import.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MODEL, estimate, admit, checkResponse } from "./operational-accounting.mjs";

const root = path.resolve(new URL("../../../", import.meta.url).pathname);
const base = path.join(root, "evidence-work/model-evaluation");
const ledgerPath = path.join(base, "api-call-ledger.json");
const lockPath = path.join(base, ".isolated-reading.lock");
const frozenHash = "003d04c34e8e71a0c5703f13ee33add84140955973102fe58631b03b66f9c37b";
const hash = b => createHash("sha256").update(b).digest("hex");
const load = p => JSON.parse(fs.readFileSync(p, "utf8"));
function persist(file, object) {
  const temporary = `${file}.next`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(object, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
const [action, caseId, reviewFile] = process.argv.slice(2);
if (!["preview", "send", "review"].includes(action) || !/^Q(?:0[1-9]|1[01])$/.test(caseId ?? ""))
  throw new Error("explicit_single_case_action_required");
let locked = false, ledger, entry;
try {
  const lock = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(lock, String(process.pid)); fs.fsyncSync(lock); fs.closeSync(lock); locked = true;
  ledger = load(ledgerPath);
  // A separately authorized revision must only use run-revised-reading.mjs.
  // This also prevents the legacy review action from mutating revision state.
  if (ledger.activeRevision) throw new Error("legacy_runner_disabled_during_revision");
  if (ledger.independentRun)
    throw new Error("legacy_runner_disabled_during_independent_run");
  if (action === "review") {
    entry = ledger.entries.at(-1);
    if (entry.kind !== "generation" || entry.caseId !== caseId || entry.review)
      throw new Error("review_requires_latest_unreviewed_case");
    const assessment = load(path.resolve(reviewFile ?? ""));
    if (!["acceptable", "stop"].includes(assessment.verdict) || !Array.isArray(assessment.findings)
      || !assessment.findings.length || assessment.checkedBy !== "agent-source-comparison-not-clinical-review")
      throw new Error("explicit_source_review_required");
    if (assessment.verdict === "acceptable" && (entry.state !== "completed" || ledger.halted))
      throw new Error("cannot_override_technical_stop");
    entry.review = assessment;
    if (assessment.verdict === "stop") ledger.halted = true;
    persist(ledgerPath, ledger);
    console.log(JSON.stringify({ caseId, review: assessment.verdict, halted: ledger.halted }));
  } else {
    const bytes = fs.readFileSync(path.join(base, "local-token-payloads.json"));
    if (hash(bytes) !== frozenHash) throw new Error("frozen_payload_changed");
    const corpus = load(path.join(base, "cases.json"));
    for (const id of ["E01", "E02", "E03", "E04"]) {
      const source = fs.readFileSync(path.join(root, `evidence-work/v0.2/${id}.json`));
      if (hash(source) !== corpus.source_registry[id].file_sha256) throw new Error("source_changed");
    }
    const request = JSON.parse(bytes).requests.find(x => x.case_id === caseId)?.request;
    if (!request || request.model !== MODEL || request.store !== false || request.background !== false
      || request.truncation !== "disabled" || request.max_output_tokens !== 1500
      || request.tools.length || request.service_tier !== "default"
      || JSON.stringify(request.prompt_cache_options) !== '{"mode":"explicit"}')
      throw new Error("request_controls_changed");
    const audit = load(path.join(base, "local-token-audit.json"));
    if (audit.frozen_payload_file_sha256 !== frozenHash) throw new Error("audit_binding_changed");
    const local = audit.per_case.find(x => x.case_id === caseId).full_request_json.exact_local_text_tokens;
    const projection = estimate(local, ledger.entries.filter(e => e.kind === "generation"));
    const budget = admit(ledger, caseId, projection);
    if (action === "preview") {
      console.log(JSON.stringify({ caseId, estimate: projection, ...budget, noNetwork: true }, null, 2));
    } else {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("credential_not_available");
      fs.mkdirSync(path.join(base, "operational-results"), { recursive: true, mode: 0o700 });
      entry = { sequence: ledger.entries.length + 1, kind: "generation", method: "POST",
        path: "/v1/responses", caseId, state: "reserved", questionOrSourceSent: true,
        modelInference: true, estimate: projection, measuredMicroUSD: null,
        requestSha256: hash(JSON.stringify(request)), reservedAt: new Date().toISOString() };
      ledger.entries.push(entry);
      persist(ledgerPath, ledger); // Durable consumption BEFORE the sole network invocation.
      const signal = AbortSignal.timeout(120_000);
      let body, response;
      try {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST", redirect: "error", signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        entry.httpStatus = response.status;
        const chunks = []; let length = 0;
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > 262_144) throw new Error("response_too_large");
          chunks.push(Buffer.from(chunk));
        }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        entry.state = "outcome_unknown"; entry.stopReasons = ["transport_or_response_unavailable_no_retry"];
        ledger.halted = true; persist(ledgerPath, ledger);
        console.log(JSON.stringify({ caseId, stopped: true, usageUnknown: true, transmissions: ledger.entries.length }));
        process.exitCode = 2;
      }
      if (body) {
        const context = JSON.parse(request.input.find(x => x.role === "user").content).source_context;
        const checks = checkResponse(body, context, projection);
        if (!response.ok) checks.stopReasons.push("http_failure_no_retry");
        const result = { caseId, model: body.model ?? null, status: body.status ?? null,
          serviceTier: body.service_tier ?? null, usage: body.usage ?? null,
          incompleteDetails: body.incomplete_details ?? null,
          errorType: body.error?.type ?? null, errorCode: body.error?.code ?? null,
          ...checks };
        entry.responseFile = `evidence-work/model-evaluation/operational-results/${caseId}.json`;
        persist(path.join(root, entry.responseFile), result);
        entry.state = checks.stopReasons.length ? "stopped" : "completed";
        entry.measuredMicroUSD = checks.measuredMicroUSD;
        entry.usage = body.usage ?? null;
        entry.stopReasons = checks.stopReasons;
        entry.completedAt = new Date().toISOString();
        ledger.halted = checks.stopReasons.length > 0;
        persist(ledgerPath, ledger);
        console.log(JSON.stringify({ caseId, state: entry.state, usage: entry.usage,
          measuredMicroUSD: entry.measuredMicroUSD, stopReasons: entry.stopReasons,
          sourceReviewRequired: true, transmissions: ledger.entries.length }, null, 2));
      }
    }
  }
} catch {
  // Do not log raw errors/headers/credentials; durable reserved entry blocks resumption.
  if (entry && action === "send") {
    ledger.halted = true;
    try { persist(ledgerPath, ledger); } catch {}
  }
  console.error("ISOLATED_EVALUATION_STOPPED_CHECK_LOCAL_STATE_NO_RETRY");
  process.exitCode = 2;
} finally {
  if (locked) fs.unlinkSync(lockPath);
}