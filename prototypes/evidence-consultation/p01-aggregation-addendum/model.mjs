/*
 * Pure, deterministic P01 computation.
 *
 * Input shape:
 * {
 *   ageMonths: number | null,
 *   night: { value:number, unit:"hours"|"minutes", kind:"actual-sleep",
 *            dayId:string, complete:boolean, approximate:boolean },
 *   nap:   { value:number, unit:"hours"|"minutes", kind:"actual-sleep",
 *            dayId:string, complete:boolean, approximate:boolean } | null
 * }
 *
 * Linkage is accepted only when every field exactly matches the reviewed
 * addendum contract. No prose is parsed and no value is inferred.
 */

export function evaluateSleep(input, linkage) {
  const expectedLink = linkage !== null
    && typeof linkage === "object"
    && linkage.sourceId === "MHLW-MINUTES-20231221"
    && linkage.linkedUnitId === "E02-S01"
    && linkage.ageMinMonths === 12
    && linkage.ageMaxMonthsExclusive === 36
    && linkage.includesNaps === true
    && linkage.verified === true;

  const age = input?.ageMonths;
  const ageKnown = typeof age === "number" && Number.isFinite(age);
  const ageEligible = ageKnown && age >= 12 && age < 36;
  const night = input?.night;
  const nap = input?.nap;
  const records = [night, nap].filter((record) => record !== null && record !== undefined);
  const recordShapeValid = (record) =>
    record !== null
    && typeof record === "object"
    && typeof record.value === "number"
    && Number.isFinite(record.value)
    && record.value >= 0
    && (record.unit === "hours" || record.unit === "minutes")
    && typeof record.dayId === "string"
    && record.dayId.length > 0
    && typeof record.complete === "boolean"
    && typeof record.approximate === "boolean";
  const allShapesValid = records.length > 0 && records.every(recordShapeValid);
  const hasNight = night !== null && night !== undefined;
  const hasNap = nap !== null && nap !== undefined;
  const bothRecords = hasNight && hasNap;
  const actualSleep = allShapesValid
    && records.every((record) => record.kind === "actual-sleep");
  const sameUnit = bothRecords && allShapesValid && night.unit === nap.unit;
  const sameDay = bothRecords && allShapesValid && night.dayId === nap.dayId;
  const completeDay = bothRecords && allShapesValid
    && night.complete === true && nap.complete === true;

  let arithmeticStatus = "unavailable";
  let totalHours = null;
  let rawSum = null;
  const arithmeticReasons = [];
  if (!hasNight) arithmeticReasons.push("missing_night");
  if (!hasNap) arithmeticReasons.push("missing_nap");
  if (records.some((record) => !recordShapeValid(record))) arithmeticReasons.push("invalid_record");
  if (allShapesValid && !actualSleep) arithmeticReasons.push("not_actual_sleep");
  if (bothRecords && allShapesValid && !sameUnit) arithmeticReasons.push("mixed_units");
  if (bothRecords && allShapesValid && sameUnit) {
    const candidateSum = night.value + nap.value;
    if (!Number.isFinite(candidateSum)) {
      arithmeticStatus = "implausible_total";
      arithmeticReasons.push("implausible_total");
    } else {
      rawSum = candidateSum;
      if (actualSleep && sameDay) {
        totalHours = night.unit === "minutes" ? rawSum / 60 : rawSum;
        if (totalHours > 24) {
          arithmeticStatus = "implausible_total";
          arithmeticReasons.push("implausible_total");
        } else {
          arithmeticStatus = completeDay ? "complete_total" : "incomplete_total";
          if (!completeDay) arithmeticReasons.push("incomplete_day");
        }
      } else if (!sameDay) {
        arithmeticStatus = "sum_not_aggregable";
        arithmeticReasons.push("different_days");
      }
    }
  } else if (hasNight && allShapesValid && actualSleep) {
    arithmeticStatus = "partial_night_only";
  }

  const comparisonReasons = [];
  if (!expectedLink) comparisonReasons.push("aggregation_link_unverified");
  if (!ageKnown) comparisonReasons.push("age_unknown");
  else if (!ageEligible) comparisonReasons.push("age_out_of_scope");
  if (arithmeticStatus !== "complete_total") {
    comparisonReasons.push(...arithmeticReasons);
    if (arithmeticStatus === "partial_night_only" && !comparisonReasons.includes("missing_nap")) {
      comparisonReasons.push("missing_nap");
    }
  }
  const uniqueComparisonReasons = [...new Set(comparisonReasons)];
  const canCompare = arithmeticStatus === "complete_total"
    && Number.isFinite(totalHours)
    && totalHours >= 0
    && totalHours <= 24
    && uniqueComparisonReasons.length === 0;
  const comparisonStatus = !canCompare
    ? "withheld"
    : totalHours >= 11 && totalHours <= 14
      ? "within_numeric_range"
      : "outside_numeric_range";

  return {
    reference: {
      status: expectedLink ? "aggregation_verified" : "aggregation_unknown",
      ageMinMonths: 12,
      ageMaxMonthsExclusive: 36,
      rangeHours: { minInclusive: 11, maxInclusive: 14 },
      includesNaps: expectedLink ? true : "unknown",
      aggregation: expectedLink ? "includes_naps" : "unknown",
      sourceId: expectedLink ? linkage.sourceId : null,
      linkedUnitId: expectedLink ? linkage.linkedUnitId : null,
    },
    arithmetic: {
      status: arithmeticStatus,
      operation: "night_plus_nap",
      totalHours,
      rawSum,
      unit: sameUnit ? night.unit : null,
      approximate: records.some((record) => recordShapeValid(record) && record.approximate),
      reasonCodes: [...new Set(arithmeticReasons)],
    },
    comparison: {
      status: comparisonStatus,
      performed: canCompare,
      totalHoursUsed: canCompare ? totalHours : null,
      referenceRangeHours: { minInclusive: 11, maxInclusive: 14 },
      aggregation: canCompare ? "same_day_actual_sleep_including_naps" : "unknown",
      reasonCodes: uniqueComparisonReasons,
    },
    healthJudgment: {
      status: "not_assessed",
      noReassurance: true,
      sufficientSleep: "not_assessed",
      healthy: "not_assessed",
      healthcareNeed: "not_assessed",
    },
    checks: {
      linkageVerified: expectedLink,
      ageKnown,
      ageEligible,
      actualSleep,
      sameUnit,
      sameDay,
      completeDay,
    },
  };
}