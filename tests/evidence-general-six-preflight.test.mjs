import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  preflightFrozenInputs, assertHistorySnapshot, assertPreparation,
  expectedAppDisplayRecord, validateAppDisplayRecord,
} from "../prototypes/evidence-consultation/general-evaluation/run.mjs";
import {
  CASES, requiredReviewCriteria,
} from "../prototypes/evidence-consultation/general-evaluation/accounting.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root,
  "evidence-work/general-audience-evaluation/general-audience-six-01");
const ledger = path.join(base, "ledger.json");

test("actual frozen preparation and exact main history snapshot pass without initialization", () => {
  const existed = fs.existsSync(ledger);
  const value = preflightFrozenInputs();
  assert.equal(value.oldLedger.entries.length, 13);
  assert.deepEqual(value.prepared.requests.map(item => item.caseId), CASES);
  assert.equal(fs.existsSync(ledger), existed);
  assert.ok(value.prepared.requests.every(item => item.request.model === "gpt-5.6-luna"));
  assert.ok(value.prepared.requests.every(item =>
    requiredReviewCriteria(value.rubric, item.caseId).length > 10));
});

test("snapshot schema is runId/baseline/preservedFiles and tampering fails", () => {
  const value = preflightFrozenInputs();
  const snapshot = JSON.parse(fs.readFileSync(path.join(base, "history-snapshot.json")));
  assert.doesNotThrow(() => assertHistorySnapshot(snapshot, value.oldLedgerSha256));
  const changed = structuredClone(snapshot);
  changed.baseline.transmissions = 14;
  assert.throws(() => assertHistorySnapshot(changed, value.oldLedgerSha256),
    /history_snapshot_invalid/);
});

test("actual claim catalog metadata does not need duplicated original text", () => {
  const value = preflightFrozenInputs();
  const first = value.catalog.catalog["E02-F-S01-S02-SHARED"];
  assert.equal(first.originalText, undefined);
  assert.equal(first.original_text, undefined);
  assert.doesNotThrow(() => assertPreparation(value.prepared, value.catalog,
    value.rubric, value.appCatalog, value.manifest));
});

test("all originals are explicitly selected and present in frozen model input", () => {
  const value = preflightFrozenInputs();
  for (const item of value.prepared.requests) {
    const input = JSON.stringify(item.request.input);
    const sent = JSON.parse(item.request.input.find(message => message.role === "user").content)
      .original_evidence;
    for (const id of item.originalIds) {
      assert.ok(value.catalog.catalog[id]);
      assert.match(input, new RegExp(id.replaceAll("-", "\\-")));
      assert.equal(sent.find(original => original.original_id === id).original_text,
        JSON.parse(fs.readFileSync(path.join(base, "preparation/original-evidence.json")))
          .originals[id].originalText);
    }
    assert.doesNotMatch(input, /sampleBody|模範回答|criterionResults|採点表/);
  }
});

test("app display review path remains separate and must use app-displays directory", () => {
  assert.equal(path.basename(path.join(base, "app-displays")), "app-displays");
});

test("review accepts only the deterministic display for the current case and response", () => {
  const value = preflightFrozenInputs();
  const preparedCase = value.prepared.requests[0];
  const result = {
    runId: "general-audience-six-01", caseId: preparedCase.caseId,
    baseCaseId: preparedCase.baseCaseId, status: "completed",
    classification: { globalFailure: false, caseFailure: false },
    outputText: "{\"answer\":\"test\"}",
    answer: { explanations: [{ text: "検証用の本文", original_ids: preparedCase.originalIds }],
      limitations: [], abstention: { applies: false, text: "", original_ids: [] } },
  };
  const responseBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  const responseFile = "evidence-work/general-audience-evaluation/general-audience-six-01/results/G-Q05.json";
  const display = expectedAppDisplayRecord(result, preparedCase,
    value.appCatalog, responseFile, responseBytes);
  assert.doesNotThrow(() => validateAppDisplayRecord(display, {
    result, preparedCase, appCatalog: value.appCatalog, responseFile, responseBytes,
  }));
  for (const mutate of [
    value => { value.caseId = "G-Q06"; },
    value => { value.responseFileSha256 = "a".repeat(64); },
    value => { value.appDisplay.claims[0].blocks = []; },
    value => { value.appDisplay.sourceSupports[0].originalId = "E99-FORGED"; },
  ]) {
    const forged = structuredClone(display);
    mutate(forged);
    assert.throws(() => validateAppDisplayRecord(forged, {
      result, preparedCase, appCatalog: value.appCatalog, responseFile, responseBytes,
    }), /app_display_not_deterministic/);
  }
  assert.throws(() => validateAppDisplayRecord(display, {
    result: { ...result, caseId: "G-Q06" }, preparedCase,
    appCatalog: value.appCatalog, responseFile, responseBytes,
  }), /response_case_binding_invalid/);
  assert.throws(() => validateAppDisplayRecord(display, {
    result, preparedCase, appCatalog: value.appCatalog, responseFile,
    responseBytes: Buffer.from("different-current-response"),
  }), /app_display_not_deterministic/);
});