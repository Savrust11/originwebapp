import { createHash } from "node:crypto";

/**
 * Main-agent verification against official OpenAI pricing, model and
 * prompt-caching pages on 2026-09-18. NOT approval or an account/connection
 * check. Alias only; immutable snapshot unconfirmed.
 * No real execution is enabled by importing this data.
 */
const proposal = {
  modelId: "gpt-5.6-luna",
  // Reservation ceiling includes possible cache WRITE charges.
  inputMicroUSDPerMillion: 250_000,
  outputMicroUSDPerMillion: 1_200_000,
  inputBillingRates: Object.freeze({
    uncached: 200_000, cacheWrite: 250_000, cachedRead: 20_000,
  }),
};
export const PROPOSED_LUNA_RATE = Object.freeze({
  ...proposal,
  rateId: createHash("sha256").update(JSON.stringify(proposal)).digest("hex"),
});
export const PROPOSED_BUDGET_MICRO_USD = 80_000; // $0.08, not an alert threshold.
export const PROPOSED_MODEL_STATUS = Object.freeze({
  aliasOnly: true, immutableSnapshotConfirmed: false, accountAvailabilityTested: false,
  approvedForRealExecution: false,
});