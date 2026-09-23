// Explicit Q06-Q11 independent evaluation controller. Each send action makes
// at most one POST. It never imports the ordinary consultation route or a DB.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  MODEL, RUN_ID, INDEPENDENT_CASES, estimate, initializeIndependentRun,
  admitIndependentCase, checkIndependentResponse, validateIndependentCaseReview,
  assertIndependentRunState, verifyPriorIndependentArtifacts,
} from "./independent-accounting.mjs";
import { validateClaimAnswer, assembleClaimCitations } from "./claim-citations.mjs";
import { buildRoleSeparatedRequests } from "./role-separated-request.mjs";
import { loadO200k } from "./local-tokenizer.mjs";

const root = path.resolve(new URL("../../../", import.meta.url).pathname);
const base = path.join(root, "evidence-work/model-evaluation");
const ledgerPath = path.join(base, "api-call-ledger.json");
const lockPath = path.join(base, ".isolated-reading.lock");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const relative = file => path.relative(root, file).split(path.sep).join("/");
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

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

function assertWorkspaceFile(file) {
  const resolved = path.resolve(file ?? "");
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("independent_file_outside_workspace");
  return resolved;
}

function assertControls(request) {
  if (!request || request.model !== MODEL || request.store !== false
    || request.background !== false || request.truncation !== "disabled"
    || request.max_output_tokens !== 1500 || !Array.isArray(request.tools)
    || request.tools.length || request.service_tier !== "default"
    || JSON.stringify(request.prompt_cache_options) !== '{"mode":"explicit"}')
    throw new Error("independent_request_controls_changed");
}

function canonicalInputs(prepared, catalog) {
  const built = buildRoleSeparatedRequests({
    casesPath: path.join(base, "cases.json"),
    sourceDirectory: path.join(root, "evidence-work/v0.2"),
    caseIds: INDEPENDENT_CASES,
    supplementalOriginalEvidence: {},
  });
  const tokenizer = loadO200k(
    path.join(root, ".local/evidence-tokenizer/o200k_base.tiktoken"));
  const expectedRequests = built.requests.map(item => ({
    ...item,
    evaluation_applicability: {
      provenance: "evaluation_metadata_not_original_source_conclusion",
      japanApplicability: "unknown",
      sourceApprovalChanged: false,
      publicationApprovalChanged: false,
    },
    localTokens: tokenizer.encode(JSON.stringify(item.request)).length,
  }));
  const expectedPrepared = {
    schemaVersion: 1,
    runId: RUN_ID,
    requests: expectedRequests,
  };
  const expectedCatalog = { schemaVersion: 1, runId: RUN_ID, catalog: built.catalog };
  if (!equal(prepared, expectedPrepared)) throw new Error("independent_package_not_canonical");
  if (!equal(catalog, expectedCatalog)) throw new Error("independent_catalog_not_canonical");
}

function assertRubric(rubric) {
  if (rubric?.schemaVersion !== 1 || rubric.runId !== RUN_ID
    || rubric.scoringFrozenBeforeSend !== true
    || rubric.semanticReviewRequired !== true
    || rubric.caseFailureMayContinueAfterReview !== true
    || rubric.globalFailureStopsRun !== true
    || Object.keys(rubric.cases ?? {}).join(",") !== INDEPENDENT_CASES.join(","))
    throw new Error("independent_rubric_policy_invalid");
  for (const id of INDEPENDENT_CASES) {
    const item = rubric.cases[id];
    if (!Array.isArray(item?.requiredMeanings) || !item.requiredMeanings.length
      || !Array.isArray(item.forbiddenContent) || !Array.isArray(item.requiredOriginalIds)
      || item.requiredOriginalIds.length < 1)
      throw new Error(`independent_case_rubric_incomplete_${id}`);
  }
}

function record(ledger) {
  return assertIndependentRunState(ledger, RUN_ID);
}

function loadBoundInputs(run) {
  let packageBytes;
  let catalogBytes;
  let rubricBytes;
  try {
    packageBytes = fs.readFileSync(path.join(root, run.files.preparedPackage));
    catalogBytes = fs.readFileSync(path.join(root, run.files.catalog));
    rubricBytes = fs.readFileSync(path.join(root, run.files.rubric));
  } catch {
    throw new Error("independent_binding_changed");
  }
  const actual = {
    preparedPackageSha256: hash(packageBytes),
    catalogSha256: hash(catalogBytes),
    rubricSha256: hash(rubricBytes),
  };
  if (Object.keys(actual).some(key => actual[key] !== run.bindings[key]))
    throw new Error("independent_binding_changed");
  return {
    bindings: actual,
    prepared: JSON.parse(packageBytes),
    catalog: JSON.parse(catalogBytes),
    rubric: JSON.parse(rubricBytes),
  };
}

const PRE_SEND_GLOBAL_INTEGRITY_ERRORS = new Set([
  "independent_binding_changed",
  "independent_authorization_limits_changed",
  "q05_failures_not_preserved",
  "baseline_entries_changed",
  "ledger_sequence_invalid",
  "unexpected_independent_transmission",
  "independent_review_binding_changed",
  "independent_artifact_unavailable",
  "independent_artifact_hash_changed",
  "independent_artifact_invalid_json",
  "independent_artifact_internal_binding_changed",
  "previous_case_not_independently_reviewed",
  "invalid_usage_integer",
  "transmission_limit",
  "generation_limit",
  "insufficient_operational_headroom",
]);

// CLI:
// init independent-cases-20260918 <prepared.json> <catalog.json> <rubric.json>
// preview|send independent-cases-20260918 <Q06..Q11>
// review independent-cases-20260918 <Q06..Q11> <bound-review.json>
const [action, runId, argument, reviewArgument] = process.argv.slice(2);
if (!["init", "preview", "send", "review"].includes(action) || runId !== RUN_ID)
  throw new Error("explicit_independent_action_required");
if (action !== "init" && !INDEPENDENT_CASES.includes(argument))
  throw new Error("explicit_independent_case_required");

let locked = false;
let ledger;
let entry;
try {
  const lock = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(lock, String(process.pid)); fs.fsyncSync(lock); fs.closeSync(lock); locked = true;
  ledger = load(ledgerPath);
  if (action === "init") {
    const preparedFile = assertWorkspaceFile(argument);
    const catalogFile = assertWorkspaceFile(reviewArgument);
    const rubricFile = assertWorkspaceFile(process.argv[6]);
    const prepared = load(preparedFile);
    const catalog = load(catalogFile);
    const rubric = load(rubricFile);
    canonicalInputs(prepared, catalog);
    assertRubric(rubric);
    prepared.requests.forEach(item => assertControls(item.request));
    initializeIndependentRun(ledger, {
      runId,
      initializedAt: new Date().toISOString(),
      preparedPackageSha256: hash(fs.readFileSync(preparedFile)),
      catalogSha256: hash(fs.readFileSync(catalogFile)),
      rubricSha256: hash(fs.readFileSync(rubricFile)),
      priorLedgerSha256: hash(fs.readFileSync(ledgerPath)),
      baselineEntriesSha256: hash(JSON.stringify(ledger.entries)),
    });
    const run = record(ledger);
    run.files = {
      preparedPackage: relative(preparedFile),
      catalog: relative(catalogFile),
      rubric: relative(rubricFile),
    };
    persist(ledgerPath, ledger);
    console.log(JSON.stringify({
      runId, initialized: true, noNetwork: true, nextCaseId: "Q06",
      q05GenerationAuthorized: false,
    }, null, 2));
  } else if (action === "review") {
    entry = ledger.entries.at(-1);
    if (entry?.independentRunId !== RUN_ID || entry.caseId !== argument || entry.review)
      throw new Error("review_requires_latest_independent_case");
    if (entry.globalFailure === true || ledger.halted)
      throw new Error("global_failure_cannot_continue_by_review");
    const run = record(ledger);
    const bound = loadBoundInputs(run);
    const resultPath = path.join(root, entry.responseFile ?? "");
    const resultBytes = fs.readFileSync(resultPath);
    if (!entry.responseFileSha256 || hash(resultBytes) !== entry.responseFileSha256)
      throw new Error("independent_result_changed");
    const reviewSource = assertWorkspaceFile(reviewArgument);
    const assessment = load(reviewSource);
    validateIndependentCaseReview(assessment, {
      runId, caseId: argument, rubricSha256: run.bindings.rubricSha256,
      responseSha256: entry.responseFileSha256, rubric: bound.rubric,
      globalFailure: entry.globalFailure,
      qualityPassed: entry.caseFailure !== true,
    });
    const reviewFile = path.join(base, "independent-results", RUN_ID, `${argument}-review.json`);
    if (fs.existsSync(reviewFile)) throw new Error("independent_review_already_exists");
    persist(reviewFile, assessment);
    entry.review = assessment;
    entry.reviewFile = relative(reviewFile);
    entry.reviewFileSha256 = hash(fs.readFileSync(reviewFile));
    entry.reviewedResponseSha256 = entry.responseFileSha256;
    entry.reviewedRubricSha256 = run.bindings.rubricSha256;
    const index = INDEPENDENT_CASES.indexOf(argument);
    ledger.independentRun.nextCaseId = INDEPENDENT_CASES[index + 1] ?? null;
    ledger.independentRun.state =
      index + 1 === INDEPENDENT_CASES.length ? "completed" : "ready";
    persist(ledgerPath, ledger);
    console.log(JSON.stringify({
      runId, caseId: argument, verdict: assessment.verdict,
      continuedAfterCaseFailure: assessment.verdict === "fail",
      nextCaseId: ledger.independentRun.nextCaseId, globallyHalted: false,
    }));
  } else {
    const run = record(ledger);
    const bound = loadBoundInputs(run);
    verifyPriorIndependentArtifacts(ledger, runId, file => {
      const location = path.resolve(root, file ?? "");
      if (!location.startsWith(`${root}${path.sep}`))
        throw new Error("artifact_path_outside_workspace");
      return fs.readFileSync(location);
    });
    const preparedCase = bound.prepared.requests.find(item => item.case_id === argument);
    if (!preparedCase) throw new Error("independent_case_not_prepared");
    assertControls(preparedCase.request);
    const projection = estimate(preparedCase.localTokens,
      ledger.entries.filter(item => item.kind === "generation"));
    const budget = admitIndependentCase(ledger, runId, argument, projection, bound.bindings);
    if (action === "preview") {
      console.log(JSON.stringify({
        runId, caseId: argument, estimate: projection, ...budget, noNetwork: true,
      }, null, 2));
    } else {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("credential_not_available");
      const resultFile = path.join(base, "independent-results", RUN_ID, `${argument}.json`);
      if (fs.existsSync(resultFile)) throw new Error("independent_result_already_exists");
      entry = {
        sequence: ledger.entries.length + 1,
        kind: "generation",
        method: "POST",
        path: "/v1/responses",
        independentRunId: RUN_ID,
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
      ledger.independentRun.state = "awaiting_result";
      persist(ledgerPath, ledger);
      let response;
      let body;
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
        entry.globalFailure = true;
        entry.globalStopReasons = ["transport_or_response_unavailable_no_retry"];
        ledger.halted = true;
        ledger.independentRun.state = "globally_stopped";
        persist(ledgerPath, ledger);
        console.log(JSON.stringify({
          runId, caseId: argument, globallyStopped: true,
          usageUnknown: true, transmissions: ledger.entries.length,
        }));
        process.exitCode = 2;
      }
      if (body) {
        const checked = checkIndependentResponse(body, projection, outputText => {
          const answer = JSON.parse(outputText);
          const sourceCatalog = bound.catalog.catalog;
          const normalized = validateClaimAnswer(answer, {
            retrievedOriginalIds: preparedCase.retrieved_original_ids,
            catalogOriginalIds: Object.keys(sourceCatalog),
            administrativeIds: preparedCase.administrative_ids,
          });
          const presentation = assembleClaimCitations(normalized, sourceCatalog, {
            retrievedOriginalIds: preparedCase.retrieved_original_ids,
            administrativeIds: preparedCase.administrative_ids,
            serviceNotices: preparedCase.service_notices,
          });
          return { passed: true, issues: [], answer: normalized, presentation };
        });
        if (!response.ok) checked.classification.globalIssues.push("http_failure_no_retry");
        checked.classification.globalIssues =
          [...new Set(checked.classification.globalIssues)];
        checked.classification.globalFailure =
          checked.classification.globalIssues.length > 0;
        const result = {
          independentRunId: RUN_ID,
          caseId: argument,
          model: body.model ?? null,
          status: body.status ?? null,
          serviceTier: body.service_tier ?? null,
          usage: body.usage ?? null,
          incompleteDetails: body.incomplete_details ?? null,
          errorType: body.error?.type ?? null,
          errorCode: body.error?.code ?? null,
          ...checked,
        };
        persist(resultFile, result);
        entry.responseFile = relative(resultFile);
        entry.responseFileSha256 = hash(fs.readFileSync(resultFile));
        entry.measuredMicroUSD = checked.measuredMicroUSD;
        entry.usage = body.usage ?? null;
        entry.globalFailure = checked.classification.globalFailure;
        entry.caseFailure = checked.classification.caseFailure;
        entry.globalStopReasons = checked.classification.globalIssues;
        entry.caseFailureReasons = checked.classification.caseIssues;
        entry.state = entry.globalFailure ? "globally_stopped"
          : entry.caseFailure ? "case_failed" : "completed";
        entry.completedAt = new Date().toISOString();
        ledger.halted = entry.globalFailure;
        ledger.independentRun.state =
          entry.globalFailure ? "globally_stopped" : "awaiting_review";
        persist(ledgerPath, ledger);
        console.log(JSON.stringify({
          runId, caseId: argument, state: entry.state,
          usage: entry.usage, measuredMicroUSD: entry.measuredMicroUSD,
          globalIssues: entry.globalStopReasons, caseIssues: entry.caseFailureReasons,
          reviewRequired: !entry.globalFailure, transmissions: ledger.entries.length,
        }, null, 2));
      }
    }
  }
} catch (error) {
  if (!entry && ["preview", "send"].includes(action)
    && ledger?.independentRun?.runId === RUN_ID
    && PRE_SEND_GLOBAL_INTEGRITY_ERRORS.has(error?.message)) {
    ledger.halted = true;
    ledger.independentRun.state = "globally_stopped";
    ledger.independentRun.globalStopReasons =
      [...new Set([...(ledger.independentRun.globalStopReasons ?? []), error.message])];
    try { persist(ledgerPath, ledger); } catch {}
  }
  if (entry && action === "send") {
    ledger.halted = true;
    if (ledger.independentRun) ledger.independentRun.state = "globally_stopped";
    try { persist(ledgerPath, ledger); } catch {}
  }
  console.error("INDEPENDENT_EVALUATION_STOPPED_CHECK_LOCAL_STATE_NO_RETRY");
  process.exitCode = 2;
} finally {
  if (locked) fs.unlinkSync(lockPath);
}