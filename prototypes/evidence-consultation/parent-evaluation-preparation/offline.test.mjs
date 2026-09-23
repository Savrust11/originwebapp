import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

// Structural integrity only. Text presence is NOT semantic or clinical validation.
assert.ok(globalThis.__parentPreparationOfflineBoundary, "use-offline-bootstrap-not-node-test");
const ROOT = new URL("../../../", import.meta.url);
const BASE = "evidence-work/parent-reading-evaluation/preparation-01/";
const PRIOR = "evidence-work/model-comparison-preparation/reading-comparison-01/";
const frozenHashes = {
  [`${PRIOR}final-freeze.json`]: "fb8af8e6c6546ce43d7f1cbd57e541bb86ebae009989dcc37646e2db8b2681b0",
  [`${PRIOR}manifest.json`]: "75d45a0388f0eba0f14c3036ca890a20d24a0de770c9a2e4c02d06f827a1c367",
  [`${PRIOR}source-content.json`]: "8b4d26d02b3031698a9c189dc55c482eea2da1ab8831ed32d9c5a6077e35fc5f",
  [`${PRIOR}request-packets.json`]: "fc9d1980ad2713c9a9e1d9f453ff87154232a9b4a7fc1765a816149f09672928",
  "evidence-work/model-evaluation/cases.json": "4d92e4a9f191650241ae8bdd655b201f16924cc21ddd977618faf3071148d76b",
  "evidence-work/v0.2/E01.json": "ff938483ebd2970f71cf51884b30999dca185d82be097c7e2f08bf29b01237c3",
  "evidence-work/v0.2/E02.json": "97ddaddb95db1d8581c4bfa7aa9f7e79bebf9a20269023832dbb136f63d1b5b5",
  "evidence-work/v0.2/E03.json": "cf6da398b615a2ac96ca65145b949475bc26f211fcfcd0563854e20541168a76",
  "evidence-work/v0.2/E04.json": "061bf103c8b1056fbc8d1744fc5ac4e47e3dc67418c2042f3614ba0f3706f352",
};
// Never follow a draft-controlled path outside this explicit local read set.
const allowedReads = new Set([
  ...Object.keys(frozenHashes),
  ...["plan.json", "plan.md", "source-bindings.json", "independent-review.json"].map(f => BASE + f),
]);
const bytes = path => {
  assert.ok(allowedReads.has(path), `offline_read_outside_allowlist:${path}`);
  const url = new URL(path, ROOT);
  assert.equal(fs.realpathSync(url), url.pathname, "symlinks-not-permitted");
  return fs.readFileSync(url);
};
const read = path => JSON.parse(bytes(path).toString("utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const text = value => assert.ok(typeof value === "string" && value.trim().length > 0);
const unique = values => assert.equal(new Set(values).size, values.length);
const nonempty = values => { assert.ok(Array.isArray(values) && values.length > 0); };
const plan = read(BASE + "plan.json");
const bindings = read(BASE + "source-bindings.json");
const review = read(BASE + "independent-review.json");
const freeze = read(PRIOR + "final-freeze.json");
const manifest = read(PRIOR + "manifest.json");
const registry = read("evidence-work/model-evaluation/cases.json").source_registry;
const content = read(PRIOR + "source-content.json");
const packets = read(PRIOR + "request-packets.json");
const originals = new Map();
for (const id of ["E01", "E02", "E03", "E04"]) {
  for (const fragment of read(`evidence-work/v0.2/${id}.json`).fragments) {
    assert.ok(!originals.has(fragment.id));
    originals.set(fragment.id, fragment);
  }
}
const byId = new Map(bindings.bindings.map(b => [b.originalId, b]));
const before = [...allowedReads].map(path => [path, hash(bytes(path))]);
after(() => assert.deepEqual(
  [...allowedReads].map(path => [path, hash(bytes(path))]), before,
  "read-only-validation-must-not-change-drafts-review-or-originals",
));

test("boundary: all network and process probes fail before transport", () => {
  for (const probe of Object.values(globalThis.__parentPreparationOfflineBoundary)) {
    assert.throws(probe, /offline_network_or_process_forbidden/);
  }
});

test("boundary: DB/provider/env/app imports and loader bypasses are denied", async () => {
  for (const specifier of [
    "pg", "@neondatabase/serverless", "openai", "@anthropic-ai/sdk", "dotenv",
    "../forbidden-production-canary.mjs", "node:net", "node:module",
    "node:child_process", "node:worker_threads", "data:text/javascript,export default 1",
  ]) {
    await assert.rejects(import(specifier), /offline_import_forbidden/);
  }
  assert.throws(() => bytes("../outside-allowlist"), /offline_read_outside_allowlist/);
});

test("governance: unexecuted, zero authorization/budget/calls, production hold", () => {
  assert.equal(plan.status, "offline-plan-for-free-review-only-not-executed");
  assert.equal(plan.governance.comparison, "closed-no-more-calls");
  assert.equal(plan.governance.production, "hold");
  assert.equal(plan.governance.adoptionApproved, false);
  for (const key of ["newApiCallsReserved", "newApiCallsAuthorized", "newApiCallsMade", "budgetReserved"]) {
    assert.equal(plan.governance[key], 0, key);
  }
  for (const key of ["sourceApproval", "settings", "futureSending"]) text(plan.governance[key]);
  assert.equal(plan.corpus.familyRecordsUsed, false);
  assert.equal(plan.corpus.fictionalOnly, true);
});

test("draft has no answer/result payloads, sendable requests, or execution parameters", () => {
  const forbidden = new Set([
    "answer", "answers", "modelAnswer", "modelAnswers", "modelResponse", "modelResponses",
    "responseText", "outputText", "scoredOutputs", "actualScores", "results",
    "requests", "requestPackets", "apiKey", "endpoint", "model", "modelId",
    "reasoning", "temperature", "max_tokens", "max_output_tokens",
  ]);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `not-a-preparation-field:${key}`);
      walk(child);
    }
  };
  walk(plan);
  walk(bindings);
});

test("corpus: ten unique everyday-question slots, all four sources and route minimums", () => {
  assert.equal(plan.cases.length, 10);
  assert.equal(plan.corpus.caseCount, 10);
  unique(plan.cases.map(c => c.id));
  unique(plan.cases.map(c => c.question));
  assert.deepEqual(plan.cases.map(c => c.id).sort(),
    Array.from({ length: 10 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual([...new Set(plan.cases.flatMap(c => c.sources))].sort(), ["E01", "E02", "E03", "E04"]);
  const counts = { "bounded-answer": 0, "clarification-needed": 0, "substantive-abstention": 0 };
  for (const c of plan.cases) { assert.ok(c.primaryRouting in counts); counts[c.primaryRouting]++; }
  assert.ok(counts["clarification-needed"] >= 3);
  assert.ok(counts["substantive-abstention"] >= 2);
  assert.deepEqual(counts, plan.corpus.routingCounts);
});

test("contract: body/adjacent ownership and three independent prospective axes are present", () => {
  assert.equal(plan.responseContract.noModelAnswerTemplate, true);
  assert.equal(plan.responseContract.noKeywordScoring, true);
  for (const key of ["bodyOwnership", "adjacentOwnership", "individualizationLimit", "citationRule"]) {
    text(plan.responseContract[key]);
  }
  assert.equal(plan.globalJudgingProtocol.state, "prospective-only; no responses collected or scored");
  for (const axis of ["directness", "comprehensibility", "fidelity"]) {
    const levels = plan.globalJudgingProtocol.separateDimensions[axis];
    for (const level of ["0", "1", "2", "3"]) text(levels[level]);
  }
  for (const key of ["independence", "blindness", "grounding", "bodyThenAdjacent", "decisionRule"]) {
    text(plan.globalJudgingProtocol[key]);
  }
  nonempty(plan.globalJudgingProtocol.hardGates);
});

test("provenance: frozen hashes independently anchored, not just self-consistent draft values", () => {
  for (const [path, expected] of Object.entries(frozenHashes)) assert.equal(hash(bytes(path)), expected, path);
  for (const key of ["freeze", "manifest", "sourceContent", "requestPackets", "transitiveRegistry"]) {
    const path = bindings.provenance[`${key}Path`];
    assert.equal(bindings.provenance[`${key}Sha256`], frozenHashes[path], key);
    assert.equal(hash(bytes(path)), bindings.provenance[`${key}Sha256`], key);
  }
  for (const file of ["manifest.json", "source-content.json", "request-packets.json"]) {
    const path = PRIOR + file;
    assert.equal(freeze.files.find(f => f.path === path)?.sha256, frozenHashes[path]);
  }
  const path = "evidence-work/model-evaluation/cases.json";
  assert.equal(manifest.frozenReferences[path], frozenHashes[path]);
});

test("registry: four original files and their complete metadata remain unchanged", () => {
  assert.deepEqual(Object.keys(bindings.sources).sort(), ["E01", "E02", "E03", "E04"]);
  for (const [id, source] of Object.entries(bindings.sources)) {
    assert.equal(source.path, registry[id].path);
    assert.equal(source.fileSha256, registry[id].file_sha256);
    assert.equal(hash(bytes(source.path)), source.fileSha256);
    assert.equal(source.title, registry[id].title);
    text(source.version);
  }
});

test("bindings: 22 unique exact quotations, every binding used and no unbound case reference", () => {
  assert.equal(bindings.bindings.length, 22);
  unique(bindings.bindings.map(b => b.originalId));
  const used = new Set(plan.cases.flatMap(c => c.evidenceRefs));
  assert.deepEqual([...used].sort(), [...byId.keys()].sort());
});

test("historical closure: direct originals match every packet occurrence; transitive additions stay separate", () => {
  const occurrences = new Map();
  for (const group of packets.requests) {
    for (const request of group.requests) {
      const payload = JSON.parse(request.input.find(m => m.role === "user").content);
      for (const item of payload.original_evidence) {
        const list = occurrences.get(item.original_id) || [];
        list.push(item.original_text);
        occurrences.set(item.original_id, list);
      }
    }
  }
  const direct = bindings.bindings.filter(b =>
    b.originalId === "E02-F-S01-S02-SHARED" || ["E03", "E04"].includes(b.sourceId));
  assert.equal(direct.length, 14);
  for (const b of direct) {
    const original = originals.get(b.originalId);
    assert.equal(content.originals[b.originalId]?.originalText, original.original_text);
    assert.equal(content.originals[b.originalId]?.sourceId, b.sourceId);
    assert.equal(content.originals[b.originalId]?.textSha256, b.originalTextSha256);
    const copies = occurrences.get(b.originalId);
    nonempty(copies);
    for (const copy of copies) assert.equal(copy, original.original_text);
  }
  const transitive = bindings.bindings.filter(b => !direct.includes(b));
  assert.equal(transitive.length, 8);
  for (const b of transitive) {
    assert.equal(content.originals[b.originalId], undefined);
    assert.equal(occurrences.has(b.originalId), false);
  }
  // This is NOT a requirement to restrict the new plan to the old 14 originals.
});

test("human-readable plan retains each question; review is provisional and hash-scoped, not approval", () => {
  const md = bytes(BASE + "plan.md").toString("utf8");
  for (const c of plan.cases) {
    assert.ok(md.includes(c.id));
    assert.ok(md.includes(c.question), `${c.id}: markdown-question-drift`);
  }
  assert.equal(review.reviewType, "independent-provisional-AI-audit");
  assert.equal(review.clinicalApproval, false);
  assert.equal(review.adoptionApproval, false);
  assert.equal(review.automaticSemanticValidation, false);
  assert.equal(review.newModelCalls, 0);
  assert.equal(review.caseReviews.length, 10);
  for (const file of ["plan.json", "plan.md", "source-bindings.json"]) {
    assert.match(review.bindingHashes[BASE + file], /^[a-f0-9]{64}$/);
  }
  // Author corrections may change drafts. They do not silently extend this audit.
  // Require a fresh semantic audit for changed hashes, not exact Japanese wording here.
  const applies = ["plan.json", "plan.md", "source-bindings.json"].every(file =>
    review.bindingHashes[BASE + file] === hash(bytes(BASE + file)));
  console.log(`Independent AI audit matches current draft hashes: ${applies}; structural pass is not semantic approval.`);
});

for (const c of plan.cases) {
  test(`${c.id}: structural case contract, separate body/adjacent and source-resolved propositions`, () => {
    assert.equal(c.fictional, true);
    for (const key of ["title", "question", "userNeed", "answerableScope", "applicability"]) text(c[key]);
    for (const key of ["unknownsNotInFourSources", "prohibitedAssertions", "requiredBodyInfo", "adjacentDisplayInfo"]) {
      nonempty(c[key]);
    }
    unique(c.sources);
    unique(c.evidenceRefs);
    for (const ref of c.evidenceRefs) {
      assert.ok(byId.has(ref), ref);
      assert.ok(c.sources.includes(byId.get(ref).sourceId), ref);
    }
    for (const source of c.sources) assert.ok(c.evidenceRefs.some(ref => byId.get(ref).sourceId === source));
    for (const track of ["answered-known", "ask-before-individualize", "withhold"]) text(c.decisionTracks[track]);
    const subjects = c.confirmations.map(item => item.subject);
    unique(subjects);
    assert.deepEqual([...subjects].sort(), ["caregiver", "child", "household"]);
    for (const item of c.confirmations) {
      assert.ok(["known", "unknown", "not-required"].includes(item.status));
      for (const key of ["known", "unknown", "askBeforeIndividualize"]) assert.ok(Array.isArray(item[key]));
      text(item.notRequiredFor);
      text(item.reason);
    }
    if (c.primaryRouting === "clarification-needed") {
      assert.ok(c.confirmations.some(item => item.status === "unknown" && item.askBeforeIndividualize.length > 0));
    }
    const propositions = c.rubric.minimumPropositions;
    nonempty(propositions);
    unique(propositions.map(p => p.id));
    for (const p of propositions) {
      assert.ok(p.id.startsWith(c.id + "-"));
      text(p.meaning);
      text(p.kind);
      nonempty(p.support);
      for (const ref of p.support) assert.ok(c.evidenceRefs.includes(ref), `${p.id}:${ref}`);
    }
    unique(c.requiredBodyInfo);
    for (const id of c.requiredBodyInfo) assert.ok(propositions.some(p => p.id === id));
    for (const p of propositions) assert.ok(c.requiredBodyInfo.includes(p.id), `${p.id}: minimum belongs in body`);
    if (c.id === "P08") {
      assert.equal(c.primaryRouting, "clarification-needed");
      assert.equal(propositions.find(p => p.id === "P08-b")?.kind, "applicability-decision");
      assert.equal(propositions.find(p => p.id === "P08-c")?.kind, "bounded-absence");
      assert.ok(c.requiredBodyInfo.includes("P08-b"));
      assert.ok(c.requiredBodyInfo.includes("P08-c"));
      for (const subject of ["child", "caregiver", "household"]) {
        nonempty(c.confirmations.find(item => item.subject === subject)?.askBeforeIndividualize);
      }
      // Structural linkage only: the independent audit reads whether these
      // questions are actually required and quantity remains unknowable.
    }
    if (c.id === "P10") {
      const conditional = c.rubric.conditionalPropositions;
      nonempty(conditional);
      unique([...propositions, ...conditional].map(p => p.id));
      const hours = conditional.find(p => p.id === "P10-e");
      assert.ok(hours);
      assert.equal(hours.kind, "conditional-scope-boundary");
      const bodyCondition = c.conditionalBodyInfo.find(p => p.propositionId === hours.id);
      assert.ok(bodyCondition);
      text(hours.when);
      text(hours.evaluationRule);
      text(bodyCondition.otherwise);
      assert.equal(bodyCondition.when, hours.when);
      assert.ok(!c.requiredBodyInfo.includes(hours.id), "no-hours-body-must-not-require-hours-warning");
      assert.ok(!propositions.some(p => p.id === hours.id), "no-hours-omission-is-not-a-missing-minimum");
      for (const id of ["P10-c", "P10-d"]) assert.ok(c.requiredBodyInfo.includes(id));
      for (const p of conditional) {
        text(p.meaning);
        nonempty(p.support);
        for (const ref of p.support) assert.ok(c.evidenceRefs.includes(ref));
      }
      // This verifies conditional-versus-unconditional membership, not whether
      // arbitrary Japanese mentions hours or deserves a semantic penalty.
    }
    text(c.rubric.directnessFocus);
    text(c.rubric.comprehensibilityFocus);
    nonempty(c.rubric.abstentionTriggers);
    nonempty(c.rubric.forbiddenRefs);
    // No keywords/expected answers scored: a human or independent source audit
    // must assess real confirmation, enduring withholding and decisive caveats.
  });
}

for (const b of bindings.bindings) {
  test(`${b.originalId}: exact quote/full-original hashes, source ownership and locator`, () => {
    const original = originals.get(b.originalId);
    assert.ok(original, b.originalId);
    assert.equal(original.source_id, b.sourceId);
    assert.equal(hash(original.original_text), b.originalTextSha256);
    assert.equal(original.text_sha256, b.originalTextSha256);
    assert.equal(hash(b.quote), b.quoteSha256);
    assert.ok(original.original_text.includes(b.quote), "quote-must-be-an-exact-contiguous-original-excerpt");
    assert.ok(original.locator, "full-original-must-retain-its-locator");
    assert.ok(bindings.sources[b.sourceId]);
  });
}