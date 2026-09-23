// Offline planning only. No transport, secrets, database or filesystem access.
// A numerical reservation is not proof of a provider-side input bound.
export const PROVIDER_LIMITS = Object.freeze({
  maxApiTransmissions: 20,
  maxModelComputeMicroUSD: 80_000,
  maxConcurrency: 1,
  maxRetries: 0,
});

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label);
}

export function summarizeGlobalLedger(ledger) {
  if (ledger?.schemaVersion !== 1
    || ledger.purpose !== "cumulative-provider-api-transmissions-not-per-run") {
    throw new Error("global_ledger_required");
  }
  for (const [key, value] of Object.entries(PROVIDER_LIMITS)) {
    if (ledger.limits?.[key] !== value) throw new Error("limits_changed");
  }
  const first = ledger.entries?.[0];
  if (!first || first.sequence !== 1 || first.kind !== "model_metadata"
    || first.method !== "GET" || first.path !== "/v1/models/gpt-5.6-luna"
    || first.state !== "completed" || first.httpStatus !== 200
    || first.exactModelMatch !== true || first.questionOrSourceSent !== false
    || first.modelInference !== false || first.reservedModelComputeMicroUSD !== 0) {
    throw new Error("historical_request_must_be_retained");
  }
  const paths = {
    model_metadata: ["GET", "/v1/models/gpt-5.6-luna"],
    input_count: ["POST", "/v1/responses/input_tokens"],
    generation: ["POST", "/v1/responses"],
  };
  let reserved = 0;
  for (const [index, entry] of ledger.entries.entries()) {
    const endpoint = paths[entry.kind];
    if (entry.sequence !== index + 1 || !endpoint
      || entry.method !== endpoint[0] || entry.path !== endpoint[1]
      || !["reserved", "completed", "failed", "outcome_unknown"].includes(entry.state)) {
      throw new Error("invalid_attempt_history");
    }
    requireInteger(entry.reservedModelComputeMicroUSD, "invalid_reservation");
    reserved += entry.reservedModelComputeMicroUSD;
    requireInteger(reserved, "reservation_overflow");
  }
  if (ledger.entries.length > PROVIDER_LIMITS.maxApiTransmissions
    || reserved > PROVIDER_LIMITS.maxModelComputeMicroUSD) {
    throw new Error("historical_limit_exceeded");
  }
  return {
    transmissionsAlreadyUsed: ledger.entries.length,
    transmissionsRemaining: PROVIDER_LIMITS.maxApiTransmissions - ledger.entries.length,
    modelComputeReservedMicroUSD: reserved,
    modelComputeRemainingMicroUSD: PROVIDER_LIMITS.maxModelComputeMicroUSD - reserved,
  };
}

// The public short-context input ceiling is the higher CACHE-WRITE rate,
// replacing rather than adding to ordinary input. Output includes reasoning.
export function conditionalGenerationReservation(inputUpperBound, outputUpperBound = 1_500) {
  requireInteger(inputUpperBound, "input_bound_required");
  requireInteger(outputUpperBound, "output_bound_required");
  if (inputUpperBound < 1 || inputUpperBound > 8_000
    || outputUpperBound < 1 || outputUpperBound > 1_500) {
    throw new Error("per_attempt_limit");
  }
  const ceilRate = (tokens, rate) =>
    Number((BigInt(tokens) * BigInt(rate) + 999_999n) / 1_000_000n);
  return ceilRate(inputUpperBound, 250_000) + ceilRate(outputUpperBound, 1_200_000);
}

export function publishedContextCeilingReservation() {
  // A deliberately loose alternative, NOT an admission bound:
  // 1,050,000 context tokens; long-context 2x input and 1.5x output;
  // cache-write replaces ordinary input at a further 1.25x.
  // Bounding input by the entire context even while separately reserving
  // output overestimates rather than underestimates the combined usage.
  return {
    inputCeilingTokens: 1_050_000,
    outputCeilingIncludingReasoningTokens: 1_500,
    reservedModelComputeMicroUSD: 527_700,
    exceedsInputLimit: true,
    exceedsWholeEvaluationBudget: true,
    liveExecutionReady: false,
  };
}

export function describePlanCapacity(ledger) {
  const history = summarizeGlobalLedger(ledger);
  const reservation = conditionalGenerationReservation(8_000, 1_500);
  const budgetCapacity = Math.floor(history.modelComputeRemainingMicroUSD / reservation);
  return {
    ...history,
    conditionalPerGenerationReservationMicroUSD: reservation,
    // Case count reduction is permitted; source/context truncation is not.
    conditionalLocalCountCaseCapacity: Math.min(11, history.transmissionsRemaining, budgetCapacity),
    conditionalRemoteCountCaseCapacityIfVerifiedFree:
      Math.min(11, Math.floor(history.transmissionsRemaining / 2), budgetCapacity),
    liveExecutionReady: false,
    // This module calculates capacity only; it can NEVER authorize or send.
    requiresFullProviderInputBound: true,
    remoteCountingTermsVerified: false,
  };
}