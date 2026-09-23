import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { violation } from "./claims.mjs";

// Fail closed if invoked without the no-network bootstrap.
assert.ok(globalThis.__semanticOfflineBoundary, "use-offline-bootstrap-not-node-test");
const ROOT = new URL("../../../", import.meta.url);
const RUN = "evidence-work/model-comparison-runs/reading-comparison-02/";
const FIX = "evidence-work/semantic-regressions/reading-comparison-02/";
const bytes = path => fs.readFileSync(new URL(path, ROOT));
const read = path => JSON.parse(bytes(path).toString("utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const fixture = read(`${FIX}fixtures.json`);
const mapping = read(`${FIX}manual-mapping.json`);
const verifyFile = binding => {
  assert.equal(hash(bytes(binding.path)), binding.sha256, binding.path);
  return read(binding.path);
};
const source = read(fixture.bindings.source.path);
const requests = read(fixture.bindings.requests.path);
const final = read(fixture.bindings.unmasked.path);
const events = fs.readdirSync(new URL(`${RUN}private/events/`, ROOT)).sort()
  .map(name => ({ name, raw: bytes(`${RUN}private/events/${name}`),
    event: read(`${RUN}private/events/${name}`) }));
const protectedPaths = [...new Set([
  ...Object.values(fixture.bindings).map(binding => binding.path),
  ...events.map(({ name }) => `${RUN}private/events/${name}`),
  ...events.flatMap(({ event }) => event.assets.map(asset => `${RUN}${asset.path}`)),
])];
const before = protectedPaths.map(path => [path, hash(bytes(path))]);
after(() => {
  assert.deepEqual(protectedPaths.map(path => [path, hash(bytes(path))]), before,
    "read-only-test-must-not-change-bound-frozen-assets");
});

test("bootstrap: network/process entry points throw before transport", () => {
  for (const probe of Object.values(globalThis.__semanticOfflineBoundary)) {
    assert.throws(probe, /offline_network_or_process_forbidden/);
  }
});

test("bootstrap: dependency allowlist denies packages and production imports", async () => {
  // Deliberately nonexistent canary: rejection must be the loader, not file lookup.
  await assert.rejects(import("never-load-a-provider-or-database"), /offline_import_forbidden/);
  await assert.rejects(import("../forbidden-production-canary.mjs"), /offline_import_forbidden/);
});

test("status never equates structural test success with model resolution", () => {
  assert.equal(fixture.status.modelProblemResolution, "UNRESOLVED");
  assert.equal(fixture.status.modelRetest, "not-retested");
  assert.equal(mapping.notIndependentApproval, true);
  assert.equal(mapping.authorRole, "fixture-author");
  assert.equal(mapping.status, "pending-independent-review");
});

test("closed unmasked mapping and historical event chain remain bound", () => {
  for (const binding of Object.values(fixture.bindings)) verifyFile(binding);
  const close = read(fixture.bindings.closure.path);
  assert.equal(close.type, "unmasked");
  assert.equal(close.assets[0].sha256, fixture.bindings.unmasked.sha256);
  assert.equal(final.h06ReferenceOnly, true);
  assert.equal(final.closureReasonSha256, close.data.closureReasonSha256);
  assert.equal(events.length, 77);
  events.forEach(({ event }, index) => {
    assert.equal(event.sequence, index + 1);
    if (index) assert.equal(event.previousSha256, hash(events[index - 1].raw));
    for (const asset of event.assets) {
      assert.equal(hash(bytes(`${RUN}${asset.path}`)), asset.sha256, asset.path);
    }
  });
});

for (const c of fixture.cases) {
  test(`${c.caseId}: exact source/request/outputText/answer/review/closure binding`, () => {
    const result = verifyFile(c.result);
    const packet = verifyFile(c.packet);
    const review = verifyFile(c.sealedReview);
    const original = source.originals[c.source.originalId];
    assert.equal(original.sourceId, c.source.sourceId);
    assert.equal(original.originalText, c.source.exactText);
    assert.equal(hash(c.source.exactText), c.source.textSha256);
    assert.equal(original.textSha256, c.source.textSha256);
    assert.equal(final.mapping[c.caseId][c.model], c.label);
    const attempt = final.attempted.find(a => a.caseId === c.caseId && a.model === c.model);
    assert.ok(attempt);
    assert.equal(attempt.requestSha256, c.requestJSONSha256);
    const request = requests.requests.find(r => r.caseId === c.caseId).requests
      .find(r => r.model === c.model);
    assert.equal(hash(JSON.stringify(request)), c.requestJSONSha256);
    const user = JSON.parse(request.input.find(message => message.role === "user").content);
    assert.equal(user.question, c.question);
    assert.equal(packet.question, c.question);
    assert.deepEqual(user.original_evidence, packet.originalEvidence);
    for (const original of user.original_evidence) {
      const frozen = source.originals[original.original_id];
      assert.equal(original.original_text, frozen.originalText);
      assert.equal(hash(original.original_text), frozen.textSha256);
    }
    assert.equal(hash(result.outputText), c.result.outputTextSha256);
    assert.deepEqual(JSON.parse(result.outputText), result.answer);
    assert.deepEqual(packet.answer.content, result.answer);
    assert.equal(result.answer.explanations[c.result.explanationIndex].text,
      c.result.exactWrongExplanation);
    assert.ok(result.answer.explanations[c.result.explanationIndex].original_ids
      .includes(c.source.originalId));
    assert.equal(review.layers.bodyMeaning.verdict, c.sealedReview.bodyMeaning);
    assert.equal(review.reviewerType, c.sealedReview.reviewerType);
    assert.equal(review.blindPacketSha256, c.packet.sha256);
    const accepted = read(`${RUN}private/events/${c.sealedReview.acceptanceEvent}`);
    assert.equal(accepted.type, "review-accepted");
    assert.equal(accepted.data.caseId, c.caseId);
    assert.equal(accepted.data.label, c.label);
    assert.equal(accepted.assets.find(a => `${RUN}${a.path}` === c.sealedReview.path).sha256,
      c.sealedReview.sha256);
    const response = read(`${RUN}private/events/${c.sealedReview.responseEvent}`);
    assert.equal(response.type, "response-recorded");
    assert.equal(response.assets.find(a => `${RUN}${a.path}` === c.result.path).sha256,
      c.result.sha256);
    assert.equal(attempt.result.responsePath, c.result.path.slice(RUN.length));
    assert.equal(attempt.result.blindPacketSha256, c.packet.sha256);
  });
}

test("evidence anchors explicitly distinguish study totals and citation lists", () => {
  const text = fixture.cases[0].source.exactText;
  assert.ok(text.includes("across six studies (n = 1,106)"));
  assert.ok(text.includes("Among four additional studies not included in the meta-analysis"));
  assert.ok(text.includes("duration [31, 34], content (quality) [29, 43], and timing (before bedtime) [30]"));
  for (const [scope, value] of [["meta.studies", 6], ["outside.studies", 4]]) {
    assert.equal(violation({ kind: "count", scope, value, basis: "explicit-source" }), null);
  }
  // 2+2+1 is a citation count, not an arithmetic proof of study counts or overlap.
  assert.equal(2 + 2 + 1, 5);
  assert.equal(violation({ kind: "count", scope: "outside.overlap", value: 1,
    basis: "subtraction" }), "unsupported-study-cardinality");
});

test("evidence anchors retain measurement context and exact sleep fraction", () => {
  const text = fixture.cases[1].source.exactText;
  assert.ok(text.includes("For other outcomes, a mix of parent-report and objective measures were used."));
  assert.ok(text.includes("in one (out of five) studies sleep was objectively assessed [30]."));
  assert.ok(text.includes("in two (out of three) studies physical activity was objectively assessed [34, 45]"));
  assert.equal(violation({ kind: "count", scope: "sleep.objective", value: 1,
    denominator: 5, basis: "explicit-source" }), null);
});

for (const observed of mapping.observedCases) {
  test(`${observed.caseId}: manually mapped real negative span, not a text detector`, () => {
    const c = fixture.cases.find(c => c.caseId === observed.caseId);
    assert.equal(observed.outputTextSha256, c.result.outputTextSha256);
    assert.equal(observed.explanationIndex, c.result.explanationIndex);
    assert.ok(c.result.exactWrongExplanation.includes(observed.exactMappedSpan));
    assert.deepEqual(observed.claims.map(violation), observed.expectedViolations);
    assert.ok(observed.expectedViolations.some(Boolean));
  });
}

test("H06 alternate narrow reading is not condemned by preserved broad-reading verdict", () => {
  const observed = mapping.observedCases.find(c => c.caseId === "C-H06");
  assert.deepEqual(observed.alternateNarrowReading.map(violation), [null, null]);
  assert.equal(fixture.cases[1].sealedReview.bodyMeaning, "fail");
});

for (const example of mapping.examples) {
  test(`mapped example: ${example.id} (${example.type})`, () => {
    // example.text is explanatory documentation, deliberately NOT passed to the checker.
    assert.deepEqual(example.claims.map(violation), example.expectedViolations);
    assert.equal(example.expectedViolations.some(Boolean), example.type !== "accepted-paraphrase");
  });
}

test("numeric boundaries: exact numerator, denominator, populations; no citation derivation", () => {
  for (const value of [0, 2, 3, 4, 5]) {
    assert.equal(violation({ kind: "count", scope: "sleep.objective", value,
      denominator: 5, basis: "explicit-source" }), "explicit-count-mismatch");
  }
  for (const denominator of [1, 2, 3, 4, 6, 10]) {
    assert.equal(violation({ kind: "count", scope: "sleep.objective", value: 1,
      denominator, basis: "explicit-source" }), "explicit-count-mismatch");
  }
  for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(violation({ kind: "count", scope: "meta.studies", value,
      basis: "explicit-source" }), "invalid-count");
  }
  for (const value of [0, 1, 2, 3, 4, 5, 6]) {
    for (const scope of ["outside.duration", "outside.quality", "outside.timing", "outside.overlap"]) {
      assert.equal(violation({ kind: "count", scope, value, basis: "explicit-source" }),
        "unsupported-study-cardinality");
    }
  }
  assert.equal(violation({ kind: "count", scope: "meta.studies", value: 6,
    basis: "citation-cardinality" }), "citation-count-is-not-study-count");
  assert.equal(violation({ kind: "count", scope: "meta.studies", value: 6,
    basis: "subtraction" }), "unsupported-count-derivation");
});

test("logic boundaries: missing fraction, overcorrection, scope and unit confusion", () => {
  assert.equal(violation({ kind: "count", scope: "sleep.objective", value: 1,
    basis: "explicit-source" }), "explicit-count-mismatch");
  assert.equal(violation({ kind: "count", scope: "sleep.objective", value: 6,
    denominator: 5, basis: "explicit-source" }), "invalid-count");
  assert.equal(violation({ kind: "count", scope: "sleep.objective", value: 1,
    denominator: 0, basis: "explicit-source" }), "invalid-count");
  for (const scope of ["sleep.instruments", "sleep.detailedAllocation",
    "sleep.coMeasurement", "sleep.objectiveResult"]) {
    assert.equal(violation({ kind: "knowledge", scope, value: "unknown" }), null);
    assert.equal(violation({ kind: "knowledge", scope, value: "known" }), "unsupported-detail");
  }
  assert.equal(violation({ kind: "knowledge", scope: "sleep.modalityContext",
    value: "unknown" }), "known-modality-erased");
  assert.throws(() => violation({ kind: "count", scope: "sleep.participants",
    value: 5, basis: "explicit-source" }), /unsupported-count-scope/);
});

test("no general NL recognition: raw language and unmodeled claims fail closed", () => {
  for (const text of mapping.examples.map(example => example.text)) {
    assert.throws(() => violation(text), /manual-typed-claim-required/);
  }
  assert.throws(() => violation({ kind: "guaranteed-treatment-benefit" }), /unsupported-claim-kind/);
  assert.throws(() => violation({ kind: "knowledge", scope: "sleep.instruments", value: "unknown",
    hiddenInstrumentName: "invented" }), /unsupported-claim-shape/);
  assert.throws(() => violation({ kind: "knowledge", scope: "sleep.instruments", value: "maybe" }),
    /unsupported-knowledge-value/);
  assert.throws(() => violation({ kind: "knowledge", scope: "__proto__", value: "unknown" }),
    /unsupported-knowledge-scope/);
});

test("integrity assertions reject source, span, and full-answer single-byte drift", () => {
  for (const c of fixture.cases) {
    assert.notEqual(hash(`${c.source.exactText} `), c.source.textSha256);
    const result = read(c.result.path);
    assert.notEqual(hash(`${result.outputText} `), c.result.outputTextSha256);
    const changed = structuredClone(result.answer);
    changed.explanations[c.result.explanationIndex].text += " ";
    assert.notEqual(hash(JSON.stringify(changed)), c.result.outputTextSha256);
    // The hash binds unaffected explanation elements too, not only the selected negative span.
    const elsewhere = structuredClone(result.answer);
    elsewhere.explanations[0].text += " ";
    assert.notEqual(hash(JSON.stringify(elsewhere)), c.result.outputTextSha256);
  }
});