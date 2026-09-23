import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  summarizeGlobalLedger, conditionalGenerationReservation, describePlanCapacity,
  publishedContextCeilingReservation,
} from "../prototypes/evidence-consultation/evaluation/send-plan-accounting.mjs";

const initial = JSON.parse(readFileSync(
  new URL("../evidence-work/model-evaluation/api-call-ledger-original-fixture.json", import.meta.url), "utf8",
));
const copy = () => structuredClone(initial);

test("previous authenticated request consumes one of the original twenty", () => {
  const result = summarizeGlobalLedger(copy());
  assert.equal(result.transmissionsAlreadyUsed, 1);
  assert.equal(result.transmissionsRemaining, 19);
  assert.equal(result.modelComputeRemainingMicroUSD, 80_000);
});

test("blank, reset, duplicated or changed historical entry is rejected", () => {
  for (const mutate of [
    x => { x.entries = []; },
    x => { x.entries[0].sequence = 0; },
    x => { x.entries.push(structuredClone(x.entries[0])); },
    x => { x.entries[0].path = "/v1/models/another-model"; },
  ]) {
    const ledger = copy(); mutate(ledger);
    assert.throws(() => summarizeGlobalLedger(ledger));
  }
});

test("limits cannot be increased or retried or made concurrent", () => {
  for (const [key, value] of [
    ["maxApiTransmissions", 21], ["maxModelComputeMicroUSD", 80_001],
    ["maxConcurrency", 2], ["maxRetries", 1],
  ]) {
    const ledger = copy(); ledger.limits[key] = value;
    assert.throws(() => summarizeGlobalLedger(ledger), /limits_changed/);
  }
});

test("failed, reserved and unknown-outcome calls still consume capacity and money", () => {
  const ledger = copy();
  for (const state of ["failed", "reserved", "outcome_unknown"]) {
    ledger.entries.push({
      sequence: ledger.entries.length + 1, kind: "generation", method: "POST",
      path: "/v1/responses", state, reservedModelComputeMicroUSD: 3_800,
    });
  }
  const result = summarizeGlobalLedger(ledger);
  assert.equal(result.transmissionsAlreadyUsed, 4);
  assert.equal(result.modelComputeReservedMicroUSD, 11_400);
});

test("metadata and counting consume the same global communications budget", () => {
  const ledger = copy();
  for (const [kind, method, path] of [
    ["model_metadata", "GET", "/v1/models/gpt-5.6-luna"],
    ["input_count", "POST", "/v1/responses/input_tokens"],
  ]) {
    ledger.entries.push({sequence: ledger.entries.length + 1, kind, method, path,
      state: "failed", reservedModelComputeMicroUSD: 0});
  }
  assert.equal(summarizeGlobalLedger(ledger).transmissionsRemaining, 17);
});

test("known numerical bounds reserve output including reasoning once", () => {
  assert.equal(conditionalGenerationReservation(8_000, 1_500), 3_800);
  assert.equal(conditionalGenerationReservation(8_000, 1_500) * 11, 41_800);
  assert.equal(conditionalGenerationReservation(1, 1), 3);
});

test("missing, guessed strings, fractional and over-cap bounds are refused", () => {
  for (const value of [null, undefined, "8000", 0, -1, 1.5, 8_001, NaN, Infinity]) {
    assert.throws(() => conditionalGenerationReservation(value));
  }
  assert.throws(() => conditionalGenerationReservation(8_000, 1_501));
});

test("global cap cannot be reset by using a smaller set of questions", () => {
  const ledger = copy();
  while (ledger.entries.length < 20) {
    ledger.entries.push({
      sequence: ledger.entries.length + 1, kind: "model_metadata", method: "GET",
      path: "/v1/models/gpt-5.6-luna", state: "failed", reservedModelComputeMicroUSD: 0,
    });
  }
  assert.equal(describePlanCapacity(ledger).conditionalLocalCountCaseCapacity, 0);
  ledger.entries.push({...ledger.entries[19], sequence: 21});
  assert.throws(() => summarizeGlobalLedger(ledger), /historical_limit_exceeded/);
});

test("local eleven fits call count; remote counting can only fit nine pairs", () => {
  const result = describePlanCapacity(copy());
  assert.equal(result.conditionalLocalCountCaseCapacity, 11);
  assert.equal(result.conditionalRemoteCountCaseCapacityIfVerifiedFree, 9);
  assert.equal(result.liveExecutionReady, false);
  assert.equal(result.remoteCountingTermsVerified, false);
});

test("unknown endpoint or overspent ledger cannot silently fall back", () => {
  for (const entry of [
    {kind: "generation", method: "POST", path: "/v1/chat/completions", reservedModelComputeMicroUSD: 3_800},
    {kind: "generation", method: "POST", path: "/v1/responses", reservedModelComputeMicroUSD: 80_001},
  ]) {
    const ledger = copy();
    ledger.entries.push({sequence: 2, state: "failed", ...entry});
    assert.throws(() => summarizeGlobalLedger(ledger));
  }
});

test("published context ceiling is too expensive even for one question", () => {
  const result = publishedContextCeilingReservation();
  assert.equal(
    result.reservedModelComputeMicroUSD,
    1_050_000 * 0.5 + 1_500 * 1.8,
  );
  assert.equal(result.exceedsInputLimit, true);
  assert.equal(result.exceedsWholeEvaluationBudget, true);
  assert.equal(result.liveExecutionReady, false);
});