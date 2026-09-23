// Revised isolated evaluation only. One explicit init/preview/send/review action;
// never imports the app, normal consultation route, SDK, remote counter, or DB.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  MODEL, REVISION_CASES, estimate, initializeRevision, admitRevision, checkRevisedResponse,
  validateIndependentReview,
} from "./revised-accounting.mjs";
import {
  validateClaimAnswer, assembleClaimCitations,
} from "./claim-citations.mjs";
import {
  buildRoleSeparatedRequests,
} from "./role-separated-request.mjs";
import { loadO200k } from "./local-tokenizer.mjs";

const root = path.resolve(new URL("../../../", import.meta.url).pathname);
const base = path.join(root, "evidence-work/model-evaluation");
const ledgerPath = path.join(base, "api-call-ledger.json");
// Shared with the legacy runner: two runner versions must never reserve concurrently.
const lockPath = path.join(base, ".isolated-reading.lock");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const relative = file => path.relative(root, file).split(path.sep).join("/");

function persist(file, object) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.next`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(object, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function assertControls(request) {
  if (!request || request.model !== MODEL || request.store !== false
    || request.background !== false || request.truncation !== "disabled"
    || request.max_output_tokens !== 1500 || !Array.isArray(request.tools)
    || request.tools.length || request.service_tier !== "default"
    || JSON.stringify(request.prompt_cache_options) !== '{"mode":"explicit"}')
    throw new Error("request_controls_changed");
}

const jsonEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function assertCanonicalPreparation(prepared, catalog, runId) {
  const built = buildRoleSeparatedRequests({
    casesPath: path.join(base, "cases.json"),
    sourceDirectory: path.join(root, "evidence-work/v0.2"),
    caseIds: REVISION_CASES,
    supplementalOriginalEvidence: {},
  });
  const tokenizer = loadO200k(
    path.join(root, ".local/evidence-tokenizer/o200k_base.tiktoken"));
  const expectedApplicability = {
    provenance: "evaluation_metadata_not_original_source_conclusion",
    japanApplicability: "unknown",
    sourceApprovalChanged: false,
    publicationApprovalChanged: false,
  };
  const expectedRequests = built.requests.map(item => ({
    ...item,
    evaluation_applicability: expectedApplicability,
    localTokens: tokenizer.encode(JSON.stringify(item.request)).length,
  }));
  const expectedPackage = { schemaVersion: 1, runId, requests: expectedRequests };
  const expectedCatalog = { schemaVersion: 1, runId, catalog: built.catalog };
  if (!jsonEqual(prepared, expectedPackage)) throw new Error("revision_package_not_canonical");
  if (!jsonEqual(catalog, expectedCatalog)) throw new Error("revision_catalog_not_canonical");
}

function revision(ledger, runId) {
  const record = ledger.authorizationRevisions?.find(item => item.runId === runId);
  if (!record) throw new Error("revision_not_initialized");
  return record;
}

function loadBoundInputs(record) {
  const bindings = record.bindings;
  const paths = record.files;
  if (!bindings || !paths) throw new Error("revision_files_not_bound");
  const packageBytes = fs.readFileSync(path.join(root, paths.preparedPackage));
  const catalogBytes = fs.readFileSync(path.join(root, paths.catalog));
  const rubricBytes = fs.readFileSync(path.join(root, paths.rubric));
  const actual = {
    preparedPackageSha256: hash(packageBytes),
    catalogSha256: hash(catalogBytes),
    rubricSha256: hash(rubricBytes),
  };
  if (Object.keys(actual).some(key => actual[key] !== bindings[key]))
    throw new Error("revision_binding_changed");
  return {
    bindings: actual,
    prepared: JSON.parse(packageBytes),
    catalog: JSON.parse(catalogBytes),
    rubric: JSON.parse(rubricBytes),
  };
}

// CLI:
// init <runId> <prepared-package.json> <citable-catalog.json> <rubric.json>
// preview|send <runId> <Q05..Q11>
// q03-display <runId> <offline-display-gate.json>
// review <runId> <Q05..Q11> <independent-review.json>
const [action, runId, argument, reviewArgument] = process.argv.slice(2);
if (!["init", "preview", "send", "review", "q03-display"].includes(action)
  || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId ?? ""))
  throw new Error("explicit_revision_action_required");
if (!["init", "q03-display"].includes(action) && !REVISION_CASES.includes(argument))
  throw new Error("explicit_single_revision_case_required");

let locked = false;
let ledger;
let entry;
try {
  const lock = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(lock, String(process.pid)); fs.fsyncSync(lock); fs.closeSync(lock); locked = true;
  ledger = load(ledgerPath);
  if (ledger.independentRun)
    throw new Error("revision_runner_disabled_during_independent_run");
  if (action === "init") {
    const files = [argument, reviewArgument, process.argv[6]].map(file => path.resolve(file ?? ""));
    if (files.some(file => !file.startsWith(`${root}${path.sep}`))) throw new Error("revision_file_outside_workspace");
    const [preparedFile, catalogFile, rubricFile] = files;
    const prepared = load(preparedFile);
    const catalog = load(catalogFile);
    const rubric = load(rubricFile);
    if (prepared.runId !== runId || !Array.isArray(prepared.requests)
      || prepared.requests.map(item => item.case_id).join(",") !== REVISION_CASES.join(",")
      || rubric.runId !== runId || catalog.runId !== runId)
      throw new Error("revision_package_scope_invalid");
    assertCanonicalPreparation(prepared, catalog, runId);
    const q05Expectations = rubric.cases?.Q05?.expectations;
    if (rubric.scoringFrozenBeforeSend !== true
      || rubric.preservesFailedQ05AsRegression !== true
      || rubric.semanticReviewRequired !== true
      || q05Expectations?.durationHours !== "11-14"
      || q05Expectations?.attribution !== "AASM"
      || q05Expectations?.nightVs24Hours !== "abstain-not-established-by-presented-originals")
      throw new Error("q05_revision_rubric_not_strictly_prerecorded");
    prepared.requests.forEach(item => {
      assertControls(item.request);
      if (!Number.isSafeInteger(item.localTokens) || item.localTokens < 0)
        throw new Error("revision_local_tokens_invalid");
    });
    initializeRevision(ledger, {
      runId,
      initializedAt: new Date().toISOString(),
      preparedPackageSha256: hash(fs.readFileSync(preparedFile)),
      catalogSha256: hash(fs.readFileSync(catalogFile)),
      rubricSha256: hash(fs.readFileSync(rubricFile)),
      priorLedgerSha256: hash(fs.readFileSync(ledgerPath)),
      historicalEntriesSha256: hash(JSON.stringify(ledger.entries)),
    });
    const record = revision(ledger, runId);
    record.files = {
      preparedPackage: relative(preparedFile),
      catalog: relative(catalogFile),
      rubric: relative(rubricFile),
    };
    persist(ledgerPath, ledger);
    console.log(JSON.stringify({ runId, initialized: true, noNetwork: true,
      nextCaseId: ledger.activeRevision.nextCaseId }, null, 2));
  } else if (action === "q03-display") {
    const record = revision(ledger, runId);
    if (ledger.entries.length !== 7 || ledger.entries.at(-1)?.caseId !== "Q05"
      || ledger.entries.at(-1)?.review?.verdict !== "acceptable"
      || ledger.activeRevision.nextCaseId !== "Q06" || record.q03DisplayGate)
      throw new Error("q03_display_gate_wrong_stage");
    const gateFile = path.resolve(argument ?? "");
    if (!gateFile.startsWith(`${root}${path.sep}`)) throw new Error("q03_gate_outside_workspace");
    const gateBytes = fs.readFileSync(gateFile);
    const gate = JSON.parse(gateBytes);
    const legacyBytes = fs.readFileSync(path.join(base, "operational-results/Q03.json"));
    if (gate.runId !== runId || gate.caseId !== "Q03" || gate.offline !== true
      || gate.passed !== true || gate.legacyResultSha256 !== hash(legacyBytes)
      || gate.displayContract !== "verified-catalog-metadata-no-model-generated-locators"
      || !Array.isArray(gate.findings) || !gate.findings.length)
      throw new Error("q03_display_gate_invalid");
    const destination = path.join(base, "revision-results", runId, "Q03-display-gate.json");
    if (fs.existsSync(destination)) throw new Error("q03_display_gate_already_exists");
    persist(destination, gate);
    record.q03DisplayGate = {
      passed: true,
      file: relative(destination),
      sha256: hash(fs.readFileSync(destination)),
    };
    ledger.activeRevision.q03DisplayGate = { ...record.q03DisplayGate };
    persist(ledgerPath, ledger);
    console.log(JSON.stringify({ runId, q03DisplayGate: "passed", noNetwork: true }));
  } else if (action === "review") {
    entry = ledger.entries.at(-1);
    if (entry?.kind !== "generation" || entry.revisionRunId !== runId
      || entry.caseId !== argument || entry.review)
      throw new Error("review_requires_latest_revised_unreviewed_case");
    const record = revision(ledger, runId);
    const bound = loadBoundInputs(record);
    const responsePath = path.join(root, entry.responseFile ?? "");
    const responseBytes = fs.readFileSync(responsePath);
    if (!entry.responseFileSha256 || hash(responseBytes) !== entry.responseFileSha256)
      throw new Error("review_response_artifact_changed");
    const reviewSource = path.resolve(reviewArgument ?? "");
    if (!reviewSource.startsWith(`${root}${path.sep}`)) throw new Error("review_outside_workspace");
    const assessment = load(reviewSource);
    validateIndependentReview(assessment, {
      runId,
      caseId: argument,
      rubricSha256: record.bindings.rubricSha256,
      responseSha256: entry.responseFileSha256,
      rubric: bound.rubric,
      automatedPassed: entry.state === "completed" && entry.automatedChecksPassed === true
        && ledger.halted === false,
    });
    const reviewFile = path.join(base, "revision-results", runId, `${argument}-review.json`);
    if (fs.existsSync(reviewFile)) throw new Error("revision_review_already_exists");
    persist(reviewFile, assessment);
    entry.review = assessment;
    entry.reviewFile = relative(reviewFile);
    entry.reviewFileSha256 = hash(fs.readFileSync(reviewFile));
    entry.reviewedResponseSha256 = entry.responseFileSha256;
    entry.reviewedRubricSha256 = record.bindings.rubricSha256;
    if (assessment.verdict === "stop") {
      ledger.halted = true;
      ledger.activeRevision.state = "stopped";
    } else {
      const index = REVISION_CASES.indexOf(argument);
      ledger.activeRevision.nextCaseId = REVISION_CASES[index + 1] ?? null;
      ledger.activeRevision.state = index + 1 === REVISION_CASES.length ? "completed" : "ready";
    }
    persist(ledgerPath, ledger);
    console.log(JSON.stringify({ runId, caseId: argument, review: assessment.verdict,
      halted: ledger.halted, nextCaseId: ledger.activeRevision.nextCaseId }));
  } else {
    const record = revision(ledger, runId);
    const bound = loadBoundInputs(record);
    const preparedCase = bound.prepared.requests.find(item => item.case_id === argument);
    if (!preparedCase) throw new Error("revision_case_not_prepared");
    assertControls(preparedCase.request);
    if (argument === "Q06") {
      const gate = ledger.activeRevision.q03DisplayGate;
      const gateFile = path.join(root, gate?.file ?? "");
      if (!gate?.passed || !gateFile.startsWith(`${root}${path.sep}`)
        || hash(fs.readFileSync(gateFile)) !== gate.sha256)
        throw new Error("q03_offline_display_gate_changed");
    }
    const projection = estimate(preparedCase.localTokens,
      ledger.entries.filter(item => item.kind === "generation"));
    const budget = admitRevision(ledger, runId, argument, projection, bound.bindings);
    if (action === "preview") {
      console.log(JSON.stringify({ runId, caseId: argument, estimate: projection, ...budget,
        noNetwork: true }, null, 2));
    } else {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("credential_not_available");
      const resultDirectory = path.join(base, "revision-results", runId);
      const resultFile = path.join(resultDirectory, `${argument}.json`);
      if (fs.existsSync(resultFile)) throw new Error("revision_result_already_exists");
      entry = {
        sequence: ledger.entries.length + 1,
        kind: "generation",
        method: "POST",
        path: "/v1/responses",
        revisionRunId: runId,
        caseId: argument,
        state: "reserved",
        questionOrSourceSent: true,
        modelInference: true,
        estimate: projection,
        measuredMicroUSD: null,
        requestSha256: hash(JSON.stringify(preparedCase.request)),
        preparedPackageSha256: bound.bindings.preparedPackageSha256,
        catalogSha256: bound.bindings.catalogSha256,
        rubricSha256: bound.bindings.rubricSha256,
        reservedAt: new Date().toISOString(),
      };
      ledger.entries.push(entry);
      ledger.activeRevision.state = "awaiting_result";
      persist(ledgerPath, ledger); // Count transmission durably before the sole POST.
      let body;
      let response;
      try {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(preparedCase.request),
        });
        entry.httpStatus = response.status;
        const chunks = [];
        let length = 0;
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > 262_144) throw new Error("response_too_large");
          chunks.push(Buffer.from(chunk));
        }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        entry.state = "outcome_unknown";
        entry.stopReasons = ["transport_or_response_unavailable_no_retry"];
        ledger.halted = true;
        ledger.activeRevision.state = "stopped";
        persist(ledgerPath, ledger);
        console.log(JSON.stringify({ runId, caseId: argument, stopped: true,
          usageUnknown: true, transmissions: ledger.entries.length }));
        process.exitCode = 2;
      }
      if (body) {
        const checks = checkRevisedResponse(body, projection, outputText => {
          const answer = JSON.parse(outputText);
          const catalog = bound.catalog.catalog ?? bound.catalog;
          const normalized = validateClaimAnswer(answer, {
            retrievedOriginalIds: preparedCase.retrieved_original_ids,
            catalogOriginalIds: Object.keys(catalog),
            administrativeIds: preparedCase.administrative_ids,
          });
          const presentation = assembleClaimCitations(normalized, catalog, {
            retrievedOriginalIds: preparedCase.retrieved_original_ids,
            administrativeIds: preparedCase.administrative_ids,
            serviceNotices: preparedCase.service_notices,
          });
          return { passed: true, issues: [], answer: normalized, presentation };
        });
        if (!response.ok) {
          checks.stopReasons.push("http_failure_no_retry");
          checks.automatedChecks.passed = false;
          checks.automatedChecks.issues.push("http_failure_no_retry");
        }
        const result = {
          revisionRunId: runId,
          caseId: argument,
          model: body.model ?? null,
          status: body.status ?? null,
          serviceTier: body.service_tier ?? null,
          usage: body.usage ?? null,
          incompleteDetails: body.incomplete_details ?? null,
          errorType: body.error?.type ?? null,
          errorCode: body.error?.code ?? null,
          ...checks,
        };
        entry.responseFile = relative(resultFile);
        persist(resultFile, result);
        entry.responseFileSha256 = hash(fs.readFileSync(resultFile));
        entry.state = checks.stopReasons.length ? "stopped" : "completed";
        entry.measuredMicroUSD = checks.measuredMicroUSD;
        entry.usage = body.usage ?? null;
        entry.stopReasons = checks.stopReasons;
        entry.automatedChecksPassed = checks.automatedChecks.passed;
        entry.completedAt = new Date().toISOString();
        ledger.halted = checks.stopReasons.length > 0;
        ledger.activeRevision.state = checks.stopReasons.length ? "stopped" : "awaiting_review";
        persist(ledgerPath, ledger);
        console.log(JSON.stringify({ runId, caseId: argument, state: entry.state,
          usage: entry.usage, measuredMicroUSD: entry.measuredMicroUSD,
          stopReasons: entry.stopReasons, sourceReviewRequired: true,
          transmissions: ledger.entries.length }, null, 2));
      }
    }
  }
} catch {
  if (entry && action === "send") {
    ledger.halted = true;
    if (ledger.activeRevision) ledger.activeRevision.state = "stopped";
    try { persist(ledgerPath, ledger); } catch {}
  }
  console.error("REVISED_ISOLATED_EVALUATION_STOPPED_CHECK_LOCAL_STATE_NO_RETRY");
  process.exitCode = 2;
} finally {
  if (locked) fs.unlinkSync(lockPath);
}