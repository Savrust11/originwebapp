// Operates ONLY on manually mapped, typed claims. No text parser or model scorer.
const countFacts = Object.freeze({
  "meta.studies": { value: 6 },
  "outside.studies": { value: 4 },
  "sleep.objective": { value: 1, denominator: 5 },
});
const unsupportedCounts = new Set([
  "outside.duration", "outside.quality", "outside.timing",
  "outside.uniqueFromCitations", "outside.overlap",
  "sleep.parentReportExclusiveTotal",
]);
const citationFacts = Object.freeze({
  "outside.duration": [31, 34],
  "outside.quality": [29, 43],
  "outside.timing": [30],
});
const knowledgeFacts = Object.freeze({
  "outside.categoryCounts": "unknown",
  "outside.overlap": "unknown",
  "sleep.modalityContext": "parent-report-and-objective",
  "sleep.remainingModality": "parent-report-at-category-level",
  "sleep.instruments": "unknown",
  "sleep.detailedAllocation": "unknown",
  "sleep.coMeasurement": "unknown",
  "sleep.objectiveResult": "unknown",
});
const own = (object, key) => Object.hasOwn(object, key);
function requireKeys(claim, required, optional = []) {
  if (!required.every(key => own(claim, key))
    || !Object.keys(claim).every(key => required.includes(key) || optional.includes(key))) {
    throw new TypeError("unsupported-claim-shape");
  }
}

// null means this single encoded claim respects this fixture's bounded evidence.
// It NEVER means the natural-language answer is correct, complete, or improved.
export function violation(claim) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new TypeError("manual-typed-claim-required");
  }
  if (claim.kind === "count") {
    requireKeys(claim, ["kind", "scope", "value", "basis"], ["denominator"]);
    if (!own(countFacts, claim.scope) && !unsupportedCounts.has(claim.scope)) {
      throw new TypeError("unsupported-count-scope");
    }
    if (!Number.isSafeInteger(claim.value) || claim.value < 0
      || (own(claim, "denominator") && (!Number.isSafeInteger(claim.denominator)
        || claim.denominator < 1 || claim.value > claim.denominator))) {
      return "invalid-count";
    }
    if (!["explicit-source", "citation-cardinality", "subtraction"].includes(claim.basis)) {
      throw new TypeError("unsupported-count-basis");
    }
    if (claim.basis === "citation-cardinality") return "citation-count-is-not-study-count";
    if (unsupportedCounts.has(claim.scope)) return "unsupported-study-cardinality";
    const expected = countFacts[claim.scope];
    if (claim.basis !== "explicit-source") return "unsupported-count-derivation";
    if (claim.value !== expected.value || claim.denominator !== expected.denominator) {
      return "explicit-count-mismatch";
    }
    return null;
  }
  if (claim.kind === "citations") {
    requireKeys(claim, ["kind", "scope", "references"]);
    if (!own(citationFacts, claim.scope)) throw new TypeError("unsupported-citation-scope");
    if (!Array.isArray(claim.references) || !claim.references.every(Number.isSafeInteger)) {
      throw new TypeError("invalid-citation-identifiers");
    }
    const expected = citationFacts[claim.scope];
    return claim.references.length === expected.length
      && claim.references.every((value, index) => value === expected[index])
      ? null : "citation-identifiers-mismatch";
  }
  if (claim.kind === "knowledge") {
    requireKeys(claim, ["kind", "scope", "value"]);
    if (!own(knowledgeFacts, claim.scope)) throw new TypeError("unsupported-knowledge-scope");
    if (!["unknown", "known", "absent", "parent-report-and-objective",
      "parent-report-at-category-level"].includes(claim.value)) {
      throw new TypeError("unsupported-knowledge-value");
    }
    if (claim.value === knowledgeFacts[claim.scope]) return null;
    if (claim.value === "unknown" && claim.scope.startsWith("sleep.")
      && knowledgeFacts[claim.scope] !== "unknown") return "known-modality-erased";
    return "unsupported-detail";
  }
  throw new TypeError("unsupported-claim-kind");
}