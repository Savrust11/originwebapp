#!/usr/bin/env node
// One-action controller for the six newly authorized general-audience cases.
// It never imports the ordinary consultation route or a database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL, RUN_ID, CASES, sha256, estimate, createRunLedger, assertHistoricalLedger,
  assertRunState, admitCase, reserveCase, checkResponse, validateReview,
  verifyPriorArtifacts, summarizeAccounting,
} from "./accounting.mjs";
import {
  validateClaimAnswer, assembleClaimCitations,
} from "../evaluation/claim-citations.mjs";
import { verifyHistory } from "./history.mjs";
import {
  assembleGeneralDisplay, digest as displayDigest,
} from "./display.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const oldBase = path.join(root, "evidence-work/model-evaluation");
const base = path.join(root, "evidence-work/general-audience-evaluation", RUN_ID);
const preparationDirectory = path.join(base, "preparation");
const ledgerPath = path.join(base, "ledger.json");
// Deliberately shared with every historical paid evaluation controller.
const lockPath = path.join(oldBase, ".isolated-reading.lock");
const oldLedgerPath = path.join(oldBase, "api-call-ledger.json");
const historySnapshotPath = path.join(base, "history-snapshot.json");
const preparationFiles = Object.freeze({
  preparedPackageSha256: "prepared-package.json",
  catalogSha256: "catalog.json",
  rubricSha256: "rubric.json",
  appCatalogSha256: "app-catalog.json",
  manifestSha256: "manifest.json",
});
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const relative = file => path.relative(root, file).split(path.sep).join("/");
const hashFile = file => sha256(fs.readFileSync(file));
const hash64 = value => /^[a-f0-9]{64}$/.test(value ?? "");

function persist(file, object, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (exclusive) {
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(object, null, 2)}\n`); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    return;
  }
  const temporary = `${file}.next`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(object, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function workspaceFile(file) {
  const resolved = path.resolve(root, file ?? "");
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("file_outside_workspace");
  return resolved;
}
function runFile(file, directory) {
  const resolved = workspaceFile(file);
  if (!resolved.startsWith(`${directory}${path.sep}`)) throw new Error("run_artifact_outside_directory");
  return resolved;
}
export function assertHistorySnapshot(snapshot, oldLedgerSha256) {
  if (snapshot?.runId !== RUN_ID || !Array.isArray(snapshot.preservedFiles)
    || !snapshot.preservedFiles.length
    || snapshot.baseline?.oldLedgerSha256 !== oldLedgerSha256
    || snapshot.baseline?.transmissions !== 13
    || snapshot.baseline?.measuredMicroUSD !== 17093
    || snapshot.baseline?.newRunTransmissionCeiling !== 19
    || snapshot.baseline?.additionalCeiling !== 6
    || snapshot.baseline?.unusedTwentiethForbidden !== true
    || snapshot.baseline?.operationBudgetMicroUSD !== 1000000)
    throw new Error("history_snapshot_invalid");
  for (const record of snapshot.preservedFiles) {
    if (typeof record.path !== "string" || !hash64(record.sha256))
      throw new Error("history_snapshot_invalid");
    const file = workspaceFile(record.path);
    if (hashFile(file) !== record.sha256) throw new Error(`historical_file_changed:${record.path}`);
  }
  const oldRecord = snapshot.preservedFiles.find(record =>
    record.path === "evidence-work/model-evaluation/api-call-ledger.json");
  if (!oldRecord || oldRecord.sha256 !== oldLedgerSha256)
    throw new Error("historical_ledger_not_in_snapshot");
}
export function preparationBindings() {
  return Object.fromEntries(Object.entries(preparationFiles).map(([key, name]) =>
    [key, hashFile(path.join(preparationDirectory, name))]));
}
function loadBound(ledger) {
  const actual = preparationBindings();
  for (const [key, value] of Object.entries(actual)) {
    if (ledger.bindings[key] !== value) throw new Error("frozen_preparation_changed");
  }
  return {
    bindings: actual,
    prepared: load(path.join(preparationDirectory, preparationFiles.preparedPackageSha256)),
    catalog: load(path.join(preparationDirectory, preparationFiles.catalogSha256)),
    rubric: load(path.join(preparationDirectory, preparationFiles.rubricSha256)),
    appCatalog: load(path.join(preparationDirectory, preparationFiles.appCatalogSha256)),
    manifest: load(path.join(preparationDirectory, preparationFiles.manifestSha256)),
  };
}
export function assertControls(request) {
  const allowed = new Set([
    "model", "input", "background", "store", "max_output_tokens", "reasoning",
    "prompt_cache_options", "truncation", "tools", "service_tier", "text",
    "previous_response_id",
  ]);
  if (!request || Object.keys(request).some(key => !allowed.has(key))
    || request.model !== MODEL || request.store !== false || request.background !== false
    || request.max_output_tokens !== 1500 || request.truncation !== "disabled"
    || request.service_tier !== "default" || !Array.isArray(request.tools)
    || request.tools.length || request.reasoning?.effort !== "medium"
    || JSON.stringify(request.prompt_cache_options) !== '{"mode":"explicit"}'
    || (request.previous_response_id !== undefined && request.previous_response_id !== null))
    throw new Error("general_request_controls_changed");
}
export function assertPreparation(prepared, catalog, rubric, appCatalog, manifest) {
  if (prepared?.schemaVersion !== 1 || prepared.runId !== RUN_ID
    || prepared.requests?.map(item => item.caseId).join(",") !== CASES.join(",")
    || catalog?.schemaVersion !== 1 || catalog.runId !== RUN_ID || !catalog.catalog
    || rubric?.schemaVersion !== 1 || rubric.runId !== RUN_ID
    || rubric.frozenBeforeSend !== true || rubric.adoptedForThisRun !== true
    || rubric.applicationAndBodyScoredSeparately !== true
    || Object.keys(rubric.cases ?? {}).join(",") !== CASES.join(",")
    || appCatalog?.schemaVersion !== 1
    || manifest?.schemaVersion !== 1 || manifest.runId !== RUN_ID)
    throw new Error("general_preparation_invalid");
  for (const [file, record] of Object.entries(manifest.files ?? {})) {
    if (!hash64(record?.sha256) || !Number.isSafeInteger(record.bytes)
      || record.bytes < 1) throw new Error(`manifest_record_invalid:${file}`);
    const bytes = fs.readFileSync(workspaceFile(file));
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256)
      throw new Error(`manifest_bound_file_changed:${file}`);
  }
  const originals = load(path.join(preparationDirectory, "original-evidence.json"));
  if (originals?.schemaVersion !== 1 || originals.runId !== RUN_ID
    || originals.provenance !== "verbatim-original-fragments-for-model-input-no-editorial-notes")
    throw new Error("original_evidence_package_invalid");
  const appCases = appCatalog.cases ?? appCatalog.catalog?.cases;
  for (const item of prepared.requests) {
    assertControls(item.request);
    if (!CASES.includes(item.caseId)
      || !Array.isArray(item.originalIds) || !item.originalIds.length
      || item.originalIds.some(id => !catalog.catalog[id])
      || !appCases?.[item.baseCaseId]
      || (item.requestSerialized !== undefined
        && item.requestSerialized !== JSON.stringify(item.request)))
      throw new Error(`general_case_preparation_invalid:${item.caseId}`);
    const serializedInput = JSON.stringify(item.request.input);
    if (/sampleBody|模範回答|criterionResults|採点表/.test(serializedInput))
      throw new Error("model_input_contains_evaluation_material");
    const userMessages = item.request.input.filter(message => message?.role === "user");
    if (userMessages.length !== 1 || typeof userMessages[0].content !== "string")
      throw new Error(`model_input_user_payload_invalid:${item.caseId}`);
    let sentOriginals;
    try {
      sentOriginals = JSON.parse(userMessages[0].content).original_evidence;
    } catch {
      throw new Error(`model_input_user_payload_invalid:${item.caseId}`);
    }
    if (!Array.isArray(sentOriginals)
      || sentOriginals.map(value => value?.original_id).join(",") !== item.originalIds.join(","))
      throw new Error(`original_closure_order_changed:${item.caseId}`);
    for (const id of item.originalIds) {
      const original = originals.originals?.[id]?.originalText;
      const originalHash = originals.originals?.[id]?.textSha256;
      const sent = sentOriginals.find(value => value?.original_id === id);
      if (!serializedInput.includes(id)
        || typeof original !== "string" || !original
        || sha256(original) !== originalHash
        || catalog.catalog[id]?.text_sha256 !== originalHash
        || sent?.original_text !== original)
        throw new Error(`original_closure_not_in_model_input:${id}`);
    }
  }
  // The manifest must bind each other frozen preparation artifact by its hash.
  const manifestText = JSON.stringify(manifest);
  for (const name of Object.values(preparationFiles).filter(name => name !== "manifest.json")) {
    if (!manifestText.includes(hashFile(path.join(preparationDirectory, name))))
      throw new Error(`manifest_does_not_bind:${name}`);
  }
}
function preparedCase(bound, caseId) {
  const item = bound.prepared.requests.find(request => request.caseId === caseId);
  if (!item) throw new Error("general_case_not_prepared");
  return item;
}
function projectionFor(item) {
  const localTokens = Number.isSafeInteger(item.localTokens) ? item.localTokens : 0;
  return estimate(localTokens);
}
function markGlobalStop(ledger, entry, reason, state = "outcome_uncertain") {
  if (entry) {
    entry.state = state;
    entry.globalFailure = true;
    entry.globalStopReasons = [...new Set([...(entry.globalStopReasons ?? []), reason])];
  }
  ledger.halted = true;
  ledger.state = "globally_stopped";
  ledger.globalStopReasons = [...new Set([...(ledger.globalStopReasons ?? []), reason])];
}
function verifiedRead(file) {
  return fs.readFileSync(workspaceFile(file));
}
function loadAndVerifyHistory(ledger) {
  const oldBytes = fs.readFileSync(oldLedgerPath);
  if (sha256(oldBytes) !== ledger.bindings.oldLedgerSha256)
    throw new Error("historical_ledger_changed");
  assertHistoricalLedger(JSON.parse(oldBytes));
  const snapshotBytes = fs.readFileSync(historySnapshotPath);
  if (sha256(snapshotBytes) !== ledger.bindings.historySnapshotSha256)
    throw new Error("history_snapshot_changed");
  assertHistorySnapshot(JSON.parse(snapshotBytes), ledger.bindings.oldLedgerSha256);
  verifyHistory();
}

export function preflightFrozenInputs() {
  const oldBytes = fs.readFileSync(oldLedgerPath);
  const oldLedger = JSON.parse(oldBytes);
  assertHistoricalLedger(oldLedger);
  const snapshotBytes = fs.readFileSync(historySnapshotPath);
  assertHistorySnapshot(JSON.parse(snapshotBytes), sha256(oldBytes));
  verifyHistory();
  const bindings = preparationBindings();
  const prepared = load(path.join(preparationDirectory, "prepared-package.json"));
  const catalog = load(path.join(preparationDirectory, "catalog.json"));
  const rubric = load(path.join(preparationDirectory, "rubric.json"));
  const appCatalog = load(path.join(preparationDirectory, "app-catalog.json"));
  const manifest = load(path.join(preparationDirectory, "manifest.json"));
  assertPreparation(prepared, catalog, rubric, appCatalog, manifest);
  return { oldLedger, oldLedgerSha256: sha256(oldBytes),
    historySnapshotSha256: sha256(snapshotBytes), bindings,
    prepared, catalog, rubric, appCatalog, manifest };
}

export function expectedAppDisplayRecord(result, preparedCase, appCatalog, responseFile,
  responseBytes) {
  return {
    ...assembleGeneralDisplay(result, preparedCase, appCatalog),
    responseFile,
    responseFileSha256: displayDigest(responseBytes),
    preparedCaseSha256: displayDigest(JSON.stringify(preparedCase)),
    generatedOffline: true,
    networkUsed: false,
  };
}
export function validateAppDisplayRecord(actual, {
  result, preparedCase, appCatalog, responseFile, responseBytes,
}) {
  if (result?.runId !== RUN_ID || result.caseId !== preparedCase?.caseId
    || result.baseCaseId !== preparedCase?.baseCaseId)
    throw new Error("app_display_response_case_binding_invalid");
  const expected = expectedAppDisplayRecord(
    result, preparedCase, appCatalog, responseFile, responseBytes);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("app_display_not_deterministic_for_current_response");
  return actual;
}

export async function main(argv = process.argv.slice(2)) {
const [action, runId, caseId, candidateFile] = argv;
if (!["init", "preview", "send", "review"].includes(action) || runId !== RUN_ID)
  throw new Error("explicit_general_action_required");
if (action !== "init" && !CASES.includes(caseId))
  throw new Error("explicit_general_case_required");

let locked = false;
let ledger = null;
let entry = null;
try {
  const lock = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(lock, String(process.pid)); fs.fsyncSync(lock); fs.closeSync(lock);
  locked = true;
  if (action === "init") {
    if (fs.existsSync(ledgerPath)) throw new Error("general_run_already_initialized");
    const oldBytes = fs.readFileSync(oldLedgerPath);
    const oldLedger = JSON.parse(oldBytes);
    const snapshotBytes = fs.readFileSync(historySnapshotPath);
    assertHistorySnapshot(JSON.parse(snapshotBytes), sha256(oldBytes));
    const bindings = preparationBindings();
    const prepared = load(path.join(preparationDirectory, "prepared-package.json"));
    const catalog = load(path.join(preparationDirectory, "catalog.json"));
    const rubric = load(path.join(preparationDirectory, "rubric.json"));
    const appCatalog = load(path.join(preparationDirectory, "app-catalog.json"));
    const manifest = load(path.join(preparationDirectory, "manifest.json"));
    assertPreparation(prepared, catalog, rubric, appCatalog, manifest);
    ledger = createRunLedger({
      oldLedger, oldLedgerSha256: sha256(oldBytes),
      historySnapshotSha256: sha256(snapshotBytes), preparationBindings: bindings,
      initializedAt: new Date().toISOString(),
    });
    ledger.files = Object.fromEntries(Object.entries(preparationFiles).map(([key, name]) =>
      [key.replace("Sha256", ""), relative(path.join(preparationDirectory, name))]));
    ledger.files.historySnapshot = relative(historySnapshotPath);
    persist(ledgerPath, ledger, { exclusive: true });
    console.log(JSON.stringify({ runId, initialized: true, noNetwork: true,
      nextCaseId: CASES[0], baselineTransmissions: 13,
      maximumCumulativeTransmissions: 19, twentiethTransmissionAuthorized: false }, null, 2));
  } else {
    ledger = load(ledgerPath);
    assertRunState(ledger);
    loadAndVerifyHistory(ledger);
    const bound = loadBound(ledger);
    assertPreparation(bound.prepared, bound.catalog, bound.rubric,
      bound.appCatalog, bound.manifest);
    verifyPriorArtifacts(ledger, verifiedRead);
    if (action === "review") {
      entry = ledger.entries.at(-1);
      if (entry?.caseId !== caseId || entry.review || entry.globalFailure)
        throw new Error("review_requires_latest_reviewable_case");
      const responseBytes = fs.readFileSync(workspaceFile(entry.responseFile));
      if (sha256(responseBytes) !== entry.responseFileSha256)
        throw new Error("response_changed_before_review");
      const candidate = load(workspaceFile(candidateFile));
      const appDisplayFile = runFile(candidate.appDisplayFile,
        path.join(base, "app-displays"));
      const appDisplay = load(appDisplayFile);
      validateAppDisplayRecord(appDisplay, {
        result: JSON.parse(responseBytes),
        preparedCase: preparedCase(bound, caseId),
        appCatalog: bound.appCatalog,
        responseFile: entry.responseFile,
        responseBytes,
      });
      const appDisplaySha256 = hashFile(appDisplayFile);
      validateReview(candidate, {
        caseId, rubricSha256: ledger.bindings.rubricSha256,
        responseSha256: entry.responseFileSha256, appDisplaySha256,
        rubric: bound.rubric, globalFailure: entry.globalFailure,
        technicalCaseFailure: entry.caseFailure === true,
      });
      const reviewFile = path.join(base, "reviews", `${caseId}.json`);
      persist(reviewFile, candidate, { exclusive: true });
      entry.review = candidate;
      entry.reviewFile = relative(reviewFile);
      entry.reviewFileSha256 = hashFile(reviewFile);
      entry.appDisplayFile = relative(appDisplayFile);
      entry.appDisplayFileSha256 = appDisplaySha256;
      entry.reviewedResponseSha256 = entry.responseFileSha256;
      entry.reviewedRubricSha256 = ledger.bindings.rubricSha256;
      const index = CASES.indexOf(caseId);
      ledger.nextCaseId = CASES[index + 1] ?? null;
      ledger.state = ledger.nextCaseId ? "ready" : "completed";
      persist(ledgerPath, ledger);
      console.log(JSON.stringify({ runId, caseId, bodyVerdict: candidate.bodyVerdict,
        appVerdict: candidate.appVerdict, screenVerdict: candidate.screenVerdict,
        nextCaseId: ledger.nextCaseId, cumulativeTransmissions:
          13 + ledger.entries.length, twentiethTransmissionUnused: true }));
    } else {
      const item = preparedCase(bound, caseId);
      const projection = projectionFor(item);
      const budget = admitCase(ledger, caseId, projection, bound.bindings);
      if (action === "preview") {
        console.log(JSON.stringify({ runId, caseId, noNetwork: true,
          projection, ...budget, remainingAuthorizedAfterThisAttempt:
            19 - budget.cumulativeTransmissionNumber }, null, 2));
      } else {
        const requestBytes = Buffer.from(JSON.stringify(item.request));
        entry = reserveCase(ledger, {
          caseId, requestSha256: sha256(requestBytes),
          requestSerializedSha256: sha256(Buffer.from(item.requestSerialized
            ?? JSON.stringify(item.request))),
          projection, reservedAt: new Date().toISOString(),
        });
        persist(ledgerPath, ledger);
        const key = process.env.OPENAI_API_KEY;
        if (!key) throw new Error("api_key_unavailable_after_reservation");
        entry.questionOrSourceSent = true;
        entry.sentAt = new Date().toISOString();
        persist(ledgerPath, ledger);
        let response;
        let body;
        try {
          response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST", redirect: "manual",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: requestBytes,
            signal: AbortSignal.timeout(120_000),
          });
          entry.httpStatus = response.status;
          if (response.status >= 300 && response.status < 400)
            throw new Error("redirect_outcome_uncertain");
          body = await response.json();
        } catch (error) {
          markGlobalStop(ledger, entry, error?.name === "TimeoutError"
            ? "transport_timeout_outcome_uncertain" : "transport_outcome_uncertain");
          persist(ledgerPath, ledger);
          throw error;
        }
        const checked = checkResponse(body, projection, outputText => {
          const answer = JSON.parse(outputText);
          const normalized = validateClaimAnswer(answer, {
            retrievedOriginalIds: item.originalIds,
            catalogOriginalIds: Object.keys(bound.catalog.catalog),
            administrativeIds: item.administrativeIds ?? [],
          });
          const presentation = assembleClaimCitations(normalized, bound.catalog.catalog, {
            retrievedOriginalIds: item.originalIds,
            administrativeIds: item.administrativeIds ?? [],
            serviceNotices: item.serviceNotices ?? [],
          });
          return { passed: true, issues: [], answer: normalized, presentation };
        });
        if (!response.ok) checked.classification.globalIssues.push("http_failure_no_retry");
        checked.classification.globalIssues =
          [...new Set(checked.classification.globalIssues)];
        checked.classification.globalFailure = checked.classification.globalIssues.length > 0;
        const result = {
          runId: RUN_ID, caseId, baseCaseId: item.baseCaseId,
          model: body?.model ?? null, status: body?.status ?? null,
          serviceTier: body?.service_tier ?? null, usage: body?.usage ?? null,
          incompleteDetails: body?.incomplete_details ?? null,
          errorType: body?.error?.type ?? null, errorCode: body?.error?.code ?? null,
          ...checked,
        };
        const resultFile = path.join(base, "results", `${caseId}.json`);
        persist(resultFile, result, { exclusive: true });
        entry.responseFile = relative(resultFile);
        entry.responseFileSha256 = hashFile(resultFile);
        entry.usage = body?.usage ?? null;
        entry.measuredMicroUSD = checked.measuredMicroUSD;
        entry.usageKnown = Number.isSafeInteger(checked.measuredMicroUSD);
        entry.globalFailure = checked.classification.globalFailure;
        entry.caseFailure = checked.classification.caseFailure;
        entry.globalStopReasons = checked.classification.globalIssues;
        entry.caseFailureReasons = checked.classification.caseIssues;
        entry.completedAt = new Date().toISOString();
        if (entry.globalFailure) {
          markGlobalStop(ledger, entry,
            entry.globalStopReasons[0] ?? "global_response_failure", "globally_stopped");
        } else {
          entry.state = entry.caseFailure ? "case_failed" : "completed";
          ledger.state = "awaiting_review";
        }
        persist(ledgerPath, ledger);
        console.log(JSON.stringify({ runId, caseId, state: entry.state,
          usage: entry.usage, measuredMicroUSD: entry.measuredMicroUSD,
          globalIssues: entry.globalStopReasons, caseIssues: entry.caseFailureReasons,
          reviewRequired: !entry.globalFailure,
          cumulativeTransmissions: 13 + ledger.entries.length,
          accounting: summarizeAccounting(ledger),
          twentiethTransmissionUnused: true }, null, 2));
      }
    }
  }
} catch (error) {
  if (ledger && entry?.state === "reserved") {
    markGlobalStop(ledger, entry, "reserved_attempt_unresolved");
    try { persist(ledgerPath, ledger); } catch {}
  } else if (ledger && ["preview", "send"].includes(action)
    && /historical|history_|frozen|preparation|request_controls|original_closure|manifest_|prior_|unresolved|general_run/.test(error?.message ?? "")) {
    markGlobalStop(ledger, null, error.message, "globally_stopped");
    try { persist(ledgerPath, ledger); } catch {}
  }
  console.error(`GENERAL_AUDIENCE_EVALUATION_STOPPED_NO_RETRY:${error?.message ?? "unknown"}`);
  process.exitCode = 2;
} finally {
  if (locked) fs.unlinkSync(lockPath);
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}