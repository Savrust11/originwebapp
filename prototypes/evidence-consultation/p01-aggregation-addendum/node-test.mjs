import assert from "node:assert/strict";
import { evaluateSleep } from "./model.mjs";

const proof = Object.freeze({
  sourceId: "MHLW-MINUTES-20231221",
  linkedUnitId: "E02-S01",
  ageMinMonths: 12,
  ageMaxMonthsExclusive: 36,
  includesNaps: true,
  verified: true,
});
const record = (value, overrides = {}) => ({
  value,
  unit: "hours",
  kind: "actual-sleep",
  dayId: "day-1",
  complete: true,
  approximate: true,
  ...overrides,
});
const valid = () => ({
  ageMonths: 20,
  night: record(10),
  nap: record(1),
});

{
  const output = evaluateSleep(valid(), proof);
  assert.deepEqual(output.arithmetic, {
    status: "complete_total",
    operation: "night_plus_nap",
    totalHours: 11,
    rawSum: 11,
    unit: "hours",
    approximate: true,
    reasonCodes: [],
  });
  assert.equal(output.comparison.status, "within_numeric_range");
  assert.equal(output.comparison.performed, true);
  assert.equal(output.comparison.aggregation, "same_day_actual_sleep_including_naps");
  assert.deepEqual(output.reference, {
    status: "aggregation_verified",
    ageMinMonths: 12,
    ageMaxMonthsExclusive: 36,
    rangeHours: { minInclusive: 11, maxInclusive: 14 },
    includesNaps: true,
    aggregation: "includes_naps",
    sourceId: "MHLW-MINUTES-20231221",
    linkedUnitId: "E02-S01",
  });
  assert.deepEqual(output.healthJudgment, {
    status: "not_assessed",
    noReassurance: true,
    sufficientSleep: "not_assessed",
    healthy: "not_assessed",
    healthcareNeed: "not_assessed",
  });
}

// Proof is structural, not truthy: removing or revoking it removes the comparison.
{
  const attached = evaluateSleep(valid(), proof);
  const removed = evaluateSleep(valid(), null);
  const revoked = evaluateSleep(valid(), { ...proof, verified: false });
  assert.equal(attached.comparison.performed, true);
  for (const output of [removed, revoked]) {
    assert.equal(output.arithmetic.totalHours, 11);
    assert.equal(output.comparison.performed, false);
    assert.equal(output.comparison.totalHoursUsed, null);
    assert.equal(output.comparison.aggregation, "unknown");
    assert.ok(output.comparison.reasonCodes.includes("aggregation_link_unverified"));
    assert.equal(output.reference.status, "aggregation_unknown");
    assert.equal(output.reference.includesNaps, "unknown");
  }
  // Re-evaluation cannot retain a cached claim from the attached state.
  assert.notDeepEqual(removed.comparison, attached.comparison);
}

{
  const unknown = valid();
  unknown.ageMonths = null;
  const unknownOutput = evaluateSleep(unknown, proof);
  assert.deepEqual(unknownOutput.comparison.reasonCodes, ["age_unknown"]);
  assert.equal(unknownOutput.reference.status, "aggregation_verified");
  assert.equal(unknownOutput.reference.includesNaps, true);
  for (const ageMonths of [11, 36]) {
    const outside = valid();
    outside.ageMonths = ageMonths;
    const output = evaluateSleep(outside, proof);
    assert.equal(output.arithmetic.totalHours, 11);
    assert.equal(output.comparison.performed, false);
    assert.ok(output.comparison.reasonCodes.includes("age_out_of_scope"));
  }
}

{
  const input = valid();
  input.nap = null;
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.status, "partial_night_only");
  assert.equal(output.arithmetic.totalHours, null);
  assert.equal(output.comparison.performed, false);
  assert.ok(output.comparison.reasonCodes.includes("missing_nap"));
}

{
  const input = valid();
  input.nap.dayId = "day-2";
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.status, "sum_not_aggregable");
  assert.equal(output.arithmetic.rawSum, 11);
  assert.equal(output.arithmetic.totalHours, null);
  assert.ok(output.comparison.reasonCodes.includes("different_days"));
}

{
  const input = valid();
  input.night.kind = "time-in-bed";
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.totalHours, null);
  assert.ok(output.comparison.reasonCodes.includes("not_actual_sleep"));
}

{
  const input = valid();
  input.nap = record(60, { unit: "minutes" });
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.totalHours, null);
  assert.equal(output.arithmetic.rawSum, null);
  assert.ok(output.comparison.reasonCodes.includes("mixed_units"));
}

for (const badValue of [-1, Number.NaN]) {
  const input = valid();
  input.nap.value = badValue;
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.totalHours, null);
  assert.equal(output.comparison.performed, false);
  assert.ok(output.comparison.reasonCodes.includes("invalid_record"));
}

{
  const input = valid();
  input.nap.complete = false;
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.status, "incomplete_total");
  assert.equal(output.arithmetic.totalHours, 11);
  assert.equal(output.comparison.totalHoursUsed, null);
  assert.ok(output.comparison.reasonCodes.includes("incomplete_day"));
}

{
  const input = valid();
  input.night.value = 14;
  input.nap.value = 1;
  const output = evaluateSleep(input, proof);
  assert.equal(output.comparison.status, "outside_numeric_range");
  assert.equal(output.comparison.performed, true);
  assert.equal(output.comparison.totalHoursUsed, 15);
  assert.equal(output.healthJudgment.status, "not_assessed");
  assert.equal(output.healthJudgment.noReassurance, true);
}

{
  const input = valid();
  input.night.value = 24;
  input.nap.value = 1;
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.status, "implausible_total");
  assert.equal(output.comparison.performed, false);
  assert.equal(output.comparison.totalHoursUsed, null);
  assert.ok(output.comparison.reasonCodes.includes("implausible_total"));
  assert.equal(output.healthJudgment.noReassurance, true);
}

// A same-unit minutes input is deterministic and comparison-safe after conversion.
{
  const input = {
    ageMonths: 12,
    night: record(600, { unit: "minutes" }),
    nap: record(60, { unit: "minutes" }),
  };
  const output = evaluateSleep(input, proof);
  assert.equal(output.arithmetic.totalHours, 11);
  assert.equal(output.comparison.status, "within_numeric_range");
}

console.log("p01 aggregation addendum model tests passed");