import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildVerifiedConditionCatalog,
} from "../prototypes/evidence-consultation/condition-display/verified-catalog.mjs";

const loadSources = () => Object.fromEntries(["E02", "E03", "E04"].map(id => [
  id, JSON.parse(readFileSync(`evidence-work/v0.2/${id}.json`, "utf8")),
]));
const digest = value => createHash("sha256").update(value).digest("hex");

test("builds all seven cases with traceable exact source quote spans", () => {
  const catalog = buildVerifiedConditionCatalog(loadSources());
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(Object.keys(catalog.cases), ["Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11"]);
  const sources = loadSources();
  for (const [caseId, entry] of Object.entries(catalog.cases)) {
    assert.equal(entry.caseId, caseId);
    assert.ok(entry.blocks.length > 0);
    assert.ok(entry.sampleBody.length > 0);
    for (const block of entry.blocks) {
      assert.ok(["mandatory", "conditional", "optional"].includes(block.tier));
      assert.ok(block.supports.length > 0);
      for (const support of block.supports) {
        const fragment = sources[support.sourceId].fragments
          .find(item => item.id === support.originalId);
        assert.ok(fragment);
        assert.equal(digest(fragment.original_text), support.originalTextSha256);
        assert.equal(
          fragment.original_text.slice(support.quoteStart, support.quoteEnd),
          support.quote,
        );
        assert.equal(typeof support.locator, "string");
        assert.ok(support.locator.length > 0);
        if (typeof fragment.locator === "string")
          assert.equal(support.locator, fragment.locator);
        else {
          assert.match(support.locator, new RegExp(
            fragment.locator.publisher_html_anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ));
          assert.match(support.locator, new RegExp(
            fragment.locator.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ));
        }
        assert.equal(support.title,
          sources[support.sourceId].sources.find(x => x.id === support.sourceId).title);
      }
    }
  }
});

test("E02 distinguishes publisher and recommendation body without adding nap or 24-hour meaning", () => {
  const catalog = buildVerifiedConditionCatalog(loadSources());
  assert.equal(catalog.provenance.e02Relationship.documentPublisher, "厚生労働省");
  assert.match(catalog.provenance.e02Relationship.recommendationBodyNamedByDocument, /AASM/);
  assert.equal(catalog.provenance.e02Relationship.aasmOriginalTextIngested, false);
  assert.equal(catalog.provenance.e02Relationship.supportsNapOr24HourMeaning, false);
  for (const id of ["Q05", "Q06"]) {
    const text = catalog.cases[id].blocks.map(x => x.text).join(" ");
    assert.doesNotMatch(text, /24時間|昼寝|合計/);
    assert.match(text, /厚生労働省/);
    assert.match(text, /米国睡眠医学会/);
  }
});

test("Q07 keeps newborn and caregiver roles separate", () => {
  const blocks = buildVerifiedConditionCatalog(loadSources()).cases.Q07.blocks;
  assert.match(blocks.find(x => x.id === "q07-newborn-pattern").text, /赤ちゃん/);
  assert.match(blocks.find(x => x.id === "q07-caregiver-impact").text, /養育者/);
  assert.match(blocks.find(x => x.id === "q07-caregiver-impact").text, /別の対象/);
});

test("E03 cases preserve shared age and diagnosed child-or-parent exclusions", () => {
  const cases = buildVerifiedConditionCatalog(loadSources()).cases;
  for (const id of ["Q08", "Q09"]) {
    const blocks = cases[id].blocks;
    assert.match(blocks.find(x => x.id === "e03-mean-age").text, /平均年齢.*36か月/);
    assert.match(blocks.find(x => x.id === "e03-mean-age").text, /各参加者.*上限ではありません/);
    assert.match(blocks.find(x => x.id === "e03-diagnosis-exclusion").text,
      /子ども、または保護者/);
    assert.equal(blocks.find(x => x.id === "e03-study-regions").tier, "optional");
  }
  assert.match(cases.Q08.blocks.find(x => x.id === "q08-small-sample-bias").text,
    /小標本バイアス/);
  assert.match(cases.Q09.blocks.find(x => x.id === "q09-result-meaning").text,
    /効果がゼロだと証明したものではありません/);
});

test("E04 cases preserve setting, exclusions, age protocol, heterogeneity, and negative sleep findings", () => {
  const cases = buildVerifiedConditionCatalog(loadSources()).cases;
  for (const id of ["Q10", "Q11"]) {
    const blocks = cases[id].blocks;
    assert.match(blocks.find(x => x.id === "e04-mean-age").text, /各参加者が6歳未満.*ではありません/);
    assert.match(blocks.find(x => x.id === "e04-medical-exclusion").text, /診断済み/);
    assert.match(blocks.find(x => x.id === "e04-home-parent-setting").text, /教育場面.*除外/);
    assert.match(blocks.find(x => x.id === "e04-age-protocol").text, /5\.8歳.*6\.1歳.*5\.95歳/);
    assert.match(blocks.find(x => x.id === "e04-method-limits").text, /保護者報告/);
  }
  assert.match(cases.Q10.blocks.find(x => x.id === "q10-result-meaning").text,
    /平均差.*上限.*保証/);
  assert.equal(cases.Q10.blocks.find(x => x.id === "q10-effect-details").tier, "conditional");
  const q11 = cases.Q11.blocks;
  assert.match(q11.find(x => x.id === "q11-no-meta-mixed").text, /メタ解析できず.*混在/);
  assert.match(q11.find(x => x.id === "q11-bedtime-negative").text,
    /睡眠時間、夜間覚醒、睡眠効率、入眠潜時/);
  assert.match(q11.find(x => x.id === "q11-both-negative").text,
    /睡眠問題にもスクリーン時間にも効果がありません/);
});

test("tampered metadata, source text, hashes, bindings, and missing sources fail closed", () => {
  for (const mutate of [
    sources => { sources.E03.sources[0].version = "changed"; },
    sources => { sources.E04.sources[0].fetched_sha256 = "0".repeat(64); },
    sources => { sources.E02.fragments[0].original_text += "変更"; },
    sources => { sources.E03.fragments.find(x => x.id === "E03-C-ELIGIBILITY").source_id = "E04"; },
    sources => { delete sources.E04; },
    sources => { sources.EXTRA = {}; },
  ]) {
    const sources = loadSources();
    mutate(sources);
    assert.throws(() => buildVerifiedConditionCatalog(sources), /VERIFIED_CONDITION_/);
  }
});

test("catalog is explicitly offline editorial material, not approval or a historical regrade", () => {
  const provenance = buildVerifiedConditionCatalog(loadSources()).provenance;
  assert.equal(provenance.status, "offline_agent_source_text_comparison");
  assert.equal(provenance.modelOutput, false);
  assert.equal(provenance.approvedUserContent, false);
  assert.equal(provenance.clinicalReview, false);
  assert.equal(provenance.adoptionApproval, false);
  assert.equal(provenance.inferenceFromFreeText, false);
  assert.equal(provenance.historicalEvaluationChanged, false);
  assert.ok(provenance.applicationNotices.some(x => /個別助言を表示しない/.test(x)));
});