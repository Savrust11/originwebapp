/**
 * Managed real-corpus retrieval checks for the locally extracted v0.2 files.
 *
 * There is no network acquisition in this suite. It imports only fragments
 * already prepared under evidence-work/v0.2, keeps their original_text byte
 * content unchanged, and stores every source/version/search aid as testOnly.
 * The sole publication simulation is a temporary cloned trigger in the
 * already-proven disposable PostgreSQL cluster; it never records human review.
 */
import "./safety/require-managed.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db.ts";
import {
  createEvidenceConcept,
  createEvidenceSource,
  ingestEvidenceVersion,
  linkEvidenceSectionKeyword,
  upsertEvidenceDictionaryTerm,
  upsertEvidenceKeyword,
} from "../server/evidence/catalog.ts";
import { searchEvidence } from "../server/evidence/search.ts";
import { emptySectionApplicabilityPolicy, type EvidenceRequiredContext } from "../shared/evidence.ts";
import {
  loadPreparedRealCorpus,
  type CorpusFragment,
  type PreparedUnit,
  writeRealCorpusSearchReport,
} from "./fixtures/real-corpus/corpus.mts";
import {
  assertNormalPublicationRefused,
  REAL_CORPUS_SIMULATION_MARKER,
  simulateTestOnlyPublication,
} from "./fixtures/real-corpus/publication-simulation.mts";
import {
  importCorpus as importReusableCorpus,
  linkCuratedConcepts as linkReusableCuratedConcepts,
  linkRequiredContext as linkReusableRequiredContext,
  type PersistedFragment,
  type PersistedUnit,
} from "./fixtures/real-corpus/setup.mts";

const RUN_ID = `real-corpus-v02-${randomUUID()}`;

type Result = {
  sourceId: string;
  versionId: string;
  sectionId: string;
  originalText: string;
  sourceLocation: string;
  citation: {
    sourceId: string;
    versionId: string;
    title: string;
    publisher: string;
    language: "ja" | "en";
    originalUrl: string;
    version: string;
  };
  applicability: Record<string, string>;
  source: {
    testOnly: boolean;
    review: { manualReviewed: boolean; reviewerName: string | null; reviewedAt: string | null };
    certainty: { level: string | null };
    applicabilityPolicy: {
      weiku: { japanApplicability: { mode: string } };
      research: { participantAge: { scope: string | null; meanMonths: number | null } };
    };
  };
  section: {
    notes: string | null;
    resolvedApplicabilityPolicy: {
      weiku: { age: { mode: string } };
    };
  };
  requiredContext?: EvidenceRequiredContext[];
};

const CONCEPTS = [
  {
    key: "feeding-choice",
    questionTerms: [["ja", "ミルク"]],
    sourceTerms: [["ja", "育児用ミルク"], ["ja", "人工乳"], ["en", "feeding choice"]],
    units: ["E01-S01"],
  },
  {
    key: "complementary-feeding-start",
    questionTerms: [["ja", "離乳食"]],
    sourceTerms: [["ja", "離乳食"], ["ja", "離乳"], ["en", "complementary feeding"]],
    units: ["E01-S03"],
  },
  {
    key: "weaning-and-breastfeeding",
    questionTerms: [["ja", "離乳"], ["ja", "授乳"]],
    sourceTerms: [["ja", "離乳"], ["ja", "授乳"], ["en", "weaning completion"]],
    units: ["E01-S02", "E01-S04"],
  },
  {
    key: "child-sleep-duration",
    questionTerms: [["ja", "睡眠時間"]],
    sourceTerms: [["ja", "睡眠時間"], ["ja", "睡眠"], ["en", "sleep duration"]],
    units: ["E02-S01", "E02-S02"],
  },
  {
    key: "caregiver-sleep",
    questionTerms: [["ja", "寝不足"], ["ja", "睡眠"]],
    sourceTerms: [["ja", "睡眠"], ["ja", "保護者"], ["en", "caregiver sleep"]],
    units: ["E02-S03"],
  },
  {
    key: "parental-depressive-symptoms",
    questionTerms: [["ja", "うつ"]],
    sourceTerms: [["en", "depressive symptoms"], ["en", "depression"], ["ja", "抑うつ"]],
    units: ["E03-S02"],
  },
  {
    key: "parent-child-interactions",
    questionTerms: [["ja", "育児支援"]],
    sourceTerms: [["en", "interactions"], ["en", "parenting interventions"], ["ja", "親子"]],
    units: ["E03-S01"],
  },
  {
    key: "screen-use-and-sleep",
    questionTerms: [["ja", "動画"]],
    sourceTerms: [["en", "screen use"], ["en", "screen time"], ["ja", "スクリーン"]],
    units: ["E04-S01", "E04-S02"],
  },
] as const;

function asDateOnlyOrNull(value: string | null) {
  // A month-only publication date must not be silently changed into the first
  // day of that month merely because the current SQL column is timestamp.
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null;
}

function originalContains(fragment: CorpusFragment, language: "ja" | "en", term: string) {
  const haystack = `${fragment.heading ?? ""} ${fragment.originalText}`.toLocaleLowerCase();
  if (language === "ja") return haystack.includes(term.toLocaleLowerCase());
  return new RegExp(`(^|[^A-Za-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}($|[^A-Za-z0-9_])`, "iu").test(haystack);
}

function requiredContextField(result: Result) {
  assert(Array.isArray(result.requiredContext), "published real-corpus result must return requiredContext");
  return result.requiredContext;
}

function physicalSectionPolicy(unit: PreparedUnit) {
  const policy = structuredClone(unit.policy);
  if (unit.fragmentId === "E02-F-S01-S02-SHARED") {
    // The single persisted original is deliberately the union of its two
    // reviewed logical units. These bounds are fixture policy, not parsed from
    // age_range_months or research_age (both remain null in the manifest).
    policy.weiku.age = { mode: "specific", scope: "range", minMonths: 12, maxMonths: 71 };
  }
  return policy;
}

function physicalSectionNotes(units: PreparedUnit[]) {
  return units.map((unit) => unit.notes).filter((note): note is string => Boolean(note)).join("\n") || null;
}

function resultForSection(response: any, sectionDbId: string): Result | undefined {
  return (response.results as Result[]).find((result) => result.sectionId === sectionDbId);
}

function resultSections(response: any) {
  return new Set((response.results as Result[]).map((result) => result.sectionId));
}

async function importCorpus() {
  const corpus = loadPreparedRealCorpus();
  const byFragment = new Map<string, PersistedFragment>();
  const byUnit = new Map<string, PersistedUnit>();
  const versionBySource = new Map<string, { sourceDbId: string; versionDbId: string }>();

  for (const [sourceId, source] of corpus.sources) {
    const sourceDb = await createEvidenceSource(pool, {
      sourceKey: `${RUN_ID}-${sourceId.toLowerCase()}`,
      testOnly: true,
    }) as { id: string };
    const units = corpus.units.filter((unit) => unit.sourceId === sourceId);
    assert(units.length > 0, `${sourceId} requires prepared units`);
    // Do not import unused real fragments or verification-only material. The
    // only sections in this isolated suite are a prepared unit's original and
    // its declared required-context closure.
    const requiredFragmentIds = new Set(units.flatMap((unit) => [
      unit.fragmentId,
      ...unit.requiredContext.map((context) => context.fragmentId),
    ]));
    const sourceFragments = [...corpus.fragments.values()].filter((fragment) =>
      fragment.sourceId === sourceId && requiredFragmentIds.has(fragment.id),
    );
    assert(sourceFragments.length > 0, `${sourceId} requires extracted fragments`);

    // A fragment remains a single database section even when more than one
    // logical applicability unit references it (the E02 1–2 / 3–5 case).
    const canonicalUnit = new Map<string, PreparedUnit>();
    for (const unit of units) {
      const prior = canonicalUnit.get(unit.fragmentId);
      if (!prior) canonicalUnit.set(unit.fragmentId, unit);
      else assert.equal(prior.fragmentId, unit.fragmentId, `${unit.id} can share only its declared original fragment`);
    }
    const ingest = await ingestEvidenceVersion(pool, {
      sourceId: sourceDb.id,
      version: source.version,
      title: source.title,
      publisher: source.publisher,
      authors: source.authors,
      originalUrl: source.originalUrl,
      externalIdentifier: source.externalIdentifier,
      documentType: source.documentType,
      language: source.language,
      publishedOn: asDateOnlyOrNull(source.publishedOn),
      revisedOn: asDateOnlyOrNull(source.revisedOn),
      age: { scope: "unknown", minMonths: null, maxMonths: null },
      regions: { scope: "unknown", values: [] },
      conditions: {
        scope: "unknown", values: [],
        exceptions: sourceId === "E03" ? ["diagnosed_illness_or_disability"]
          : sourceId === "E04" ? ["diagnosed_medical_condition_affecting_growth_development_or_behavior"] : [],
      },
      certainty: { level: null, assessmentMethod: null, assessmentSource: null },
      documentApplicabilityPolicy: source.documentPolicy,
      testOnly: true,
      sections: sourceFragments.map((fragment) => ({
        sectionType: "excerpt",
        heading: fragment.heading,
        originalText: fragment.originalText,
        sourceLocation: fragment.sourceLocation,
        notes: fragment.notes ?? physicalSectionNotes(units.filter((unit) => unit.fragmentId === fragment.id)),
        applicabilityPolicy: canonicalUnit.has(fragment.id)
          ? physicalSectionPolicy(canonicalUnit.get(fragment.id)!)
          : structuredClone(emptySectionApplicabilityPolicy),
      })),
    });
    versionBySource.set(sourceId, { sourceDbId: sourceDb.id, versionDbId: ingest.versionId });
    sourceFragments.forEach((fragment, index) => {
      byFragment.set(fragment.id, {
        ...fragment,
        sourceDbId: sourceDb.id,
        versionDbId: ingest.versionId,
        sectionDbId: ingest.sectionIds[index],
        logicalUnitIds: units.filter((unit) => unit.fragmentId === fragment.id).map((unit) => unit.id),
      });
    });
  }

  for (const unit of corpus.units) {
    const fragment = byFragment.get(unit.fragmentId);
    assert(fragment, `${unit.id} persisted fragment is missing`);
    byUnit.set(unit.id, {
      ...unit,
      sourceDbId: fragment.sourceDbId,
      versionDbId: fragment.versionDbId,
      sectionDbId: fragment.sectionDbId,
    });
  }
  return { corpus, byFragment, byUnit, versionBySource };
}

async function linkCuratedConcepts(byUnit: Map<string, PersistedUnit>, byFragment: Map<string, PersistedFragment>) {
  for (const conceptSpec of CONCEPTS) {
    const targets = conceptSpec.units.map((unitId) => {
      const unit = byUnit.get(unitId);
      assert(unit, `curated concept ${conceptSpec.key} refers to a prepared unit`);
      return unit;
    });
    const concept = await createEvidenceConcept(pool, {
      conceptKey: `${RUN_ID}-${conceptSpec.key}`,
    }) as { id: string };
    const sourceTerms = conceptSpec.sourceTerms.filter(([language, term]) =>
      targets.some((unit) => originalContains(byFragment.get(unit.fragmentId)!, language, term)),
    );
    // A bilingual concept link may help discovery, but a source term must be
    // literal in the real original/heading or the normal text-match SQL cannot
    // return a section. No translation or edited original is inserted.
    assert(sourceTerms.length > 0, `${conceptSpec.key} has no curated term in its real original text`);
    const keywordIds = new Map<string, string>();
    for (const [language, term] of sourceTerms) {
      const row = await upsertEvidenceKeyword(pool, {
        id: randomUUID(), conceptId: concept.id, term, language, active: true, testOnly: true,
      }) as { id: string };
      keywordIds.set(`${language}:${term}`, row.id);
    }
    for (const [language, term] of conceptSpec.questionTerms) {
      await upsertEvidenceDictionaryTerm(pool, {
        id: randomUUID(), conceptId: concept.id, term, language, testOnly: true,
      });
    }
    for (const target of targets) {
      const fragment = byFragment.get(target.fragmentId)!;
      for (const [language, term] of sourceTerms) {
        if (originalContains(fragment, language, term)) {
          await linkEvidenceSectionKeyword(pool, {
            sourceVersionId: target.versionDbId,
            sectionId: target.sectionDbId,
            keywordId: keywordIds.get(`${language}:${term}`)!,
          });
        }
      }
    }
  }
}

async function linkRequiredContext(byUnit: Map<string, PersistedUnit>, byFragment: Map<string, PersistedFragment>) {
  const catalog = await import("../server/evidence/catalog.ts") as Record<string, unknown>;
  const link = catalog.linkEvidenceRequiredContext;
  assert.equal(typeof link, "function", "core must expose linkEvidenceRequiredContext for required original context");
  for (const unit of byUnit.values()) {
    for (const required of unit.requiredContext) {
      const context = byFragment.get(required.fragmentId);
      assert(context, `${unit.id} required context was not persisted`);
      await (link as (pool: typeof pool, input: {
        sourceVersionId: string; sectionId: string; requiredSectionId: string; role: string;
      }) => Promise<unknown>)(pool, {
        sourceVersionId: unit.versionDbId,
        sectionId: unit.sectionDbId,
        requiredSectionId: context.sectionDbId,
        role: required.role,
      });
    }
  }
}

async function assertPersistedUnapproved(byUnit: Map<string, PersistedUnit>) {
  const ids = [...new Set([...byUnit.values()].map((unit) => unit.versionDbId))];
  const rows = await pool.query<{
    id: string; publication_status: string; manual_reviewed: boolean; reviewer_name: string | null; reviewed_at: string | null;
  }>(
    `SELECT id, publication_status, manual_reviewed, reviewer_name, reviewed_at
     FROM evidence_versions WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  assert.equal(rows.rows.length, ids.length, "every corpus version must persist");
  for (const row of rows.rows) {
    assert.equal(row.manual_reviewed, false, "real-corpus test data must never acquire human review");
    assert.equal(row.reviewer_name, null);
    assert.equal(row.reviewed_at, null);
  }
}

function assertExactResult(result: Result, fragment: PersistedFragment) {
  assert.equal(result.sourceId, fragment.sourceDbId);
  assert.equal(result.versionId, fragment.versionDbId);
  assert.equal(result.sectionId, fragment.sectionDbId);
  assert.equal(result.originalText, fragment.originalText, "result must return the unmodified extracted original");
  assert.equal(result.sourceLocation, fragment.sourceLocation, "result must preserve citation location");
  assert.equal(result.citation.sourceId, fragment.sourceDbId);
  assert.equal(result.citation.versionId, fragment.versionDbId);
  assert.equal(result.source.testOnly, true);
  assert.equal(result.source.review.manualReviewed, false);
}

function assertRequiredContext(result: Result, unit: PersistedUnit, byFragment: Map<string, PersistedFragment>) {
  const returned = requiredContextField(result);
  for (const required of unit.requiredContext) {
    const fragment = byFragment.get(required.fragmentId)!;
    const matching = returned.find((context) => context.sectionId === fragment.sectionDbId && context.role === required.role);
    assert(matching, `${unit.id} lost required ${required.role} context`);
    assert.equal(matching.citation.sourceId, fragment.sourceDbId);
    assert.equal(matching.citation.versionId, fragment.versionDbId);
    assert.equal(matching.originalText, fragment.originalText, `${unit.id} context must retain the full original`);
    assert.equal(matching.sourceLocation, fragment.sourceLocation, `${unit.id} context must retain citation`);
  }
}

function reportResult(
  queryId: string,
  input: Parameters<typeof searchEvidence>[1],
  response: any,
  byFragment: Map<string, PersistedFragment>,
  byUnit: Map<string, PersistedUnit>,
) {
  return {
    queryId,
    question: input.question,
    // These explicit values are fixed test inputs, never NLP-derived facts.
    testInput: {
      ageMonths: input.ageMonths ?? null,
      context: input.context ?? null,
    },
    status: response.status,
    diagnostics: response.diagnostics ?? null,
    results: (response.results as Result[]).map((result) => {
      const fragment = [...byFragment.values()].find((candidate) => candidate.sectionDbId === result.sectionId);
      return {
        sourceId: result.sourceId,
        versionId: result.versionId,
        sectionId: result.sectionId,
        fragmentId: fragment?.id ?? null,
        allLogicalUnitIds: fragment?.logicalUnitIds ?? [],
        selectedLogicalUnitIds: (fragment?.logicalUnitIds ?? []).filter((unitId) => {
          const unit = byUnit.get(unitId)!;
          const range = unit.logicalAgeRange;
          return !range
            || input.ageMonths === undefined
            || (input.ageMonths >= range.minMonths && input.ageMonths <= range.maxMonths);
        }),
        returnedOriginal: result.originalText,
        citation: {
          ...result.citation,
          sourceLocation: result.sourceLocation,
        },
        notes: result.section.notes,
        requiredContext: requiredContextField(result).map((context) => ({
          citation: context.citation,
          sectionId: context.sectionId,
          originalText: context.originalText,
          sourceLocation: context.sourceLocation,
          notes: context.notes,
          role: context.role,
          policy: context.policy,
          section: context.section,
        })),
        applicability: result.applicability,
      };
    }),
  };
}

async function main() {
  const { corpus, byFragment, byUnit, versionBySource } = await importReusableCorpus(pool, RUN_ID);
  await linkReusableCuratedConcepts(pool, byUnit, byFragment, RUN_ID);
  await linkReusableRequiredContext(pool, byUnit, byFragment);
  await assertPersistedUnapproved(byUnit);

  // Search sees only published versions. This isolated evidence-real group
  // proves the ordinary draft is not retrievable before the narrow simulator.
  const draftSearch = await searchEvidence(pool, { question: "ミルクを使うことに罪悪感がある" });
  assert(!resultSections(draftSearch).has(byUnit.get("E01-S01")!.sectionDbId), "an unapproved real-corpus draft must not be searchable");

  // This check intentionally precedes the simulator: neither a test marker nor
  // the owned DB context alone may publish an unapproved ordinary draft.
  await assertNormalPublicationRefused(pool, versionBySource.get("E01")!.versionDbId);
  await simulateTestOnlyPublication(pool, [...versionBySource.values()].map((version) => ({
    sourceId: version.sourceDbId,
    versionId: version.versionDbId,
  })));
  await assertPersistedUnapproved(byUnit);

  const reports: unknown[] = [];
  const run = async (queryId: string, input: Parameters<typeof searchEvidence>[1]) => {
    const response = await searchEvidence(pool, input);
    reports.push(reportResult(queryId, input, response, byFragment, byUnit));
    return response;
  };

  // The eight fixed v0.2 evaluation questions. Only the unrelated no-source
  // query below asserts universal emptiness; an out-of-range result need only
  // exclude the selected incompatible E02 section because other research may
  // legitimately remain unverified and eligible.
  const milk = await run("v02-01-feeding-choice", {
    question: "ミルクを使うことに罪悪感がある", context: { target: "caregiver" },
  });
  const milkUnit = byUnit.get("E01-S01")!;
  const milkResult = resultForSection(milk, milkUnit.sectionDbId)!;
  assertExactResult(milkResult, byFragment.get(milkUnit.fragmentId)!);
  assertRequiredContext(milkResult, milkUnit, byFragment);

  const start = await run("v02-02-complementary-feeding-start", {
    question: "離乳食をいつ始める？", context: { target: "child" },
  });
  const startUnit = byUnit.get("E01-S03")!;
  const startResult = resultForSection(start, startUnit.sectionDbId)!;
  assertExactResult(startResult, byFragment.get(startUnit.fragmentId)!);
  assertRequiredContext(startResult, startUnit, byFragment);

  const completion = await run("v02-03-weaning-and-breastfeeding", {
    question: "離乳が終わったら授乳もやめる？", context: { target: "child" },
  });
  for (const unitId of ["E01-S02", "E01-S04"]) {
    const unit = byUnit.get(unitId)!;
    const result = resultForSection(completion, unit.sectionDbId)!;
    assertExactResult(result, byFragment.get(unit.fragmentId)!);
    assertRequiredContext(result, unit, byFragment);
  }
  const completionContext = requiredContextField(resultForSection(completion, byUnit.get("E01-S02")!.sectionDbId)!);
  assert(
    completionContext.some((context) => context.sectionId === byFragment.get("E01-C-BASIC-INDIVIDUALIZATION")?.sectionDbId),
    "the p29 S02 → S04 → basic relationship must return transitive required context",
  );

  const ageTwo = await run("v02-04-two-year-sleep", {
    question: "2歳の睡眠時間は？", ageMonths: 24, context: { target: "child" },
  });
  const sleepOne = byUnit.get("E02-S01")!;
  const sleepTwo = byUnit.get("E02-S02")!;
  assert.equal(sleepOne.sectionDbId, sleepTwo.sectionDbId, "the shared E02 original must return one result identity");
  const sleepResult = resultForSection(ageTwo, sleepOne.sectionDbId)!;
  assertExactResult(sleepResult, byFragment.get(sleepOne.fragmentId)!);
  assert.deepEqual(
    byFragment.get(sleepOne.fragmentId)!.logicalUnitIds.sort(),
    ["E02-S01", "E02-S02"],
    "logical 1–2 and 3–5 scopes are tracked separately without duplicate original sections",
  );
  assert.equal(sleepResult.applicability.age, "matched");
  assert.match(sleepResult.section.notes ?? "", /24時間/u, "the sourced 24-hour annotation must be returned as section metadata");
  assert.match(sleepResult.section.notes ?? "", /昼寝/u, "the sourced nap annotation must be returned as section metadata");
  assert((sleepResult.section.notes ?? "").includes("https://aasm.org/resources/pdf/pediatricsleepdurationconsensus.pdf"),
    "the separate verification annotation must carry its actual source URL");
  assertRequiredContext(sleepResult, sleepOne, byFragment);
  assertRequiredContext(sleepResult, sleepTwo, byFragment);

  const ageSix = await run("v02-05-six-year-sleep", {
    question: "6歳の睡眠時間は？", ageMonths: 72, context: { target: "child" },
  });
  assert(!resultSections(ageSix).has(sleepOne.sectionDbId), "the selected E02 12–71 month section must not match age six");

  const depression = await run("v02-06-parental-depression-limit", {
    question: "育児支援で親のうつも治る？", context: { target: "caregiver" },
  });
  const depressionUnit = byUnit.get("E03-S02")!;
  const depressionResult = resultForSection(depression, depressionUnit.sectionDbId)!;
  assertExactResult(depressionResult, byFragment.get(depressionUnit.fragmentId)!);
  assertRequiredContext(depressionResult, depressionUnit, byFragment);

  const screenSleep = await run("v02-07-screen-and-sleep-limit", {
    question: "動画を減らせば必ず眠れる？", context: { target: "child" },
  });
  const screenUnit = byUnit.get("E04-S02")!;
  const screenResult = resultForSection(screenSleep, screenUnit.sectionDbId)!;
  assertExactResult(screenResult, byFragment.get(screenUnit.fragmentId)!);
  assertRequiredContext(screenResult, screenUnit, byFragment);

  const disability = await run("v02-08-diagnosed-disability", {
    question: "発達障害のある子にも使える？",
    context: { target: "child", conditions: ["diagnosed_illness_or_disability"] },
  });
  // This plain-language question has no fabricated translation keyword. Its
  // explicit diagnosis input is still recorded. The linked corpus query below
  // verifies the actual policy exclusion through a literal source term.
  assert(!resultSections(disability).has(byUnit.get("E03-S01")!.sectionDbId), "the diagnosis question must not surface E03-S01");
  const disabilityPolicy = await run("diagnosed-disability-policy-limit", {
    question: "育児支援で親のうつも治る？",
    context: { target: "child", conditions: ["diagnosed_illness_or_disability"] },
  });
  assert(!resultSections(disabilityPolicy).has(byUnit.get("E03-S01")!.sectionDbId), "E03-S01 must not be treated as applicable to its excluded diagnosis tag");
  assert(!resultSections(disabilityPolicy).has(byUnit.get("E03-S02")!.sectionDbId), "E03-S02 shares the same research eligibility exclusion");

  const medicalCondition = await run("medical-condition-limit", {
    question: "動画を減らせば必ず眠れる？",
    context: { target: "child", conditions: ["diagnosed_medical_condition_affecting_growth_development_or_behavior"] },
  });
  assert(!resultSections(medicalCondition).has(byUnit.get("E04-S02")!.sectionDbId), "E04-S02 must not be treated as applicable to its excluded diagnosis tag");
  assert(!resultSections(medicalCondition).has(byUnit.get("E04-S01")!.sectionDbId), "E04-S01 shares the same research eligibility exclusion");

  const caregiver = await run("caregiver-target", {
    question: "寝不足でつらい保護者の睡眠を確保したい",
    context: { target: "caregiver" },
  });
  const caregiverUnit = byUnit.get("E02-S03")!;
  const caregiverResult = resultForSection(caregiver, caregiverUnit.sectionDbId)!;
  assert.equal(caregiverResult.applicability.target, "matched");
  assertExactResult(caregiverResult, byFragment.get(caregiverUnit.fragmentId)!);
  assertRequiredContext(caregiverResult, caregiverUnit, byFragment);
  assert.equal(caregiverResult.section.resolvedApplicabilityPolicy.weiku.age.mode, "unknown", "newborn prose must not become a caregiver age range");

  const unknown = await run("unknown-japan-grade-and-research-mean", { question: "育児支援" });
  const researchUnit = byUnit.get("E03-S01")!;
  const researchResult = resultForSection(unknown, researchUnit.sectionDbId)!;
  assert.equal(researchResult.applicability.japan, "unverified", "unknown Japan applicability must remain unknown");
  assert.equal(researchResult.source.certainty.level, null, "no GRADE must be invented");
  assert.equal(
    researchResult.section.resolvedApplicabilityPolicy.weiku.age.mode,
    "unknown",
    "research average-age metadata must not become child applicability bounds",
  );

  const noSource = await run("unrelated-no-source", { question: "このコーパスにない無関係な質問" });
  assert.deepEqual(
    noSource,
    { status: "no_results", results: [], diagnostics: { reason: "no_vocabulary" } },
    "an unrelated question without any catalog vocabulary must be explicit",
  );

  // Candidate pagination is a real fail-closed behavior, but this focused
  // probe has no corpus text: it cannot accidentally report a corpus answer.
  const scanPolicy = structuredClone(emptySectionApplicabilityPolicy);
  scanPolicy.weiku.age = { mode: "specific", scope: "range", minMonths: 0, maxMonths: 1 };
  const scanRows = (offset: number) => Array.from({ length: offset < 2_000 ? 100 : 1 }, (_, index) => ({
    source_id: "scan-source", source_test_only: false, version_id: "scan-version", section_id: `scan-${offset + index}`,
    original_text: "scan marker", title: "scan", publisher: "scan", original_language: "en", original_url: "https://example.invalid/scan",
    source_location: "scan", section_type: "excerpt", heading: "scan marker", notes: null, version_label: "scan",
    document_type: "scan", authors: [], external_identifier: null, published_on: null, revised_on: null,
    age_scope: "unknown", age_min_months: null, age_max_months: null, region_scope: "unknown", regions: [],
    condition_scope: "unknown", conditions: [], exceptions: [], certainty_level: null, certainty_assessment_method: null,
    certainty_assessment_source: null, manual_reviewed: false, reviewer_name: null, reviewed_at: null,
    adoption_reason: null, usage_terms: null, section_policy_defaults: emptySectionApplicabilityPolicy,
    applicability_policy: offset < 2_000 ? scanPolicy : emptySectionApplicabilityPolicy, required_context: [],
    context_limit: false, context_incomplete: false,
  }));
  const scan = await searchEvidence({
    async query(sql: string, values?: unknown[]) {
      return sql.includes("SELECT count(*)::integer AS expansion_count")
        ? { rows: [{ expansion_count: 1 }] }
        : { rows: scanRows(Number(values?.[2] ?? 0)) };
    },
  }, { question: "scan marker", ageMonths: 72, limit: 1 });
  assert.equal(scan.diagnostics?.reason, "candidate_scan_limit", "scan exhaustion must be explicit");

  const contextFailureRow = {
    ...scanRows(2_000)[0],
    applicability_policy: emptySectionApplicabilityPolicy,
    context_limit: false,
    context_incomplete: false,
  };
  const mockContextSearch = async (row: Record<string, unknown>) => searchEvidence({
    async query(sql: string) {
      return sql.includes("SELECT count(*)::integer AS expansion_count")
        ? { rows: [{ expansion_count: 1 }] }
        : { rows: [row] };
    },
  }, { question: "scan marker", limit: 1 });
  const missingContext = await mockContextSearch({
    ...contextFailureRow,
    required_context: null,
  });
  assert.equal(missingContext.diagnostics?.reason, "context_incomplete", "missing required-context payload must fail closed");
  const excessiveContext = await mockContextSearch({
    ...contextFailureRow,
    required_context: Array.from({ length: 17 }, () => ({})),
  });
  assert.equal(excessiveContext.diagnostics?.reason, "context_limit", "more than sixteen required contexts must fail closed");
  const cyclicContext = await mockContextSearch({
    ...contextFailureRow,
    required_context: [{
      sectionId: "scan-2000",
      role: "required_context",
      originalText: "scan marker",
      sourceLocation: "scan",
      notes: null,
      policy: emptySectionApplicabilityPolicy,
      sectionType: "excerpt",
      heading: "scan marker",
    }],
  });
  assert.equal(cyclicContext.diagnostics?.reason, "context_incomplete", "a returned required-context cycle must fail closed");

  writeRealCorpusSearchReport({
    format: "weiku.evidence-real-corpus-search-report.v0.2",
    publicationSimulation: {
      approvalState: "test_only_simulated_publication",
      marker: REAL_CORPUS_SIMULATION_MARKER,
      manualReviewed: false,
    },
    corpus: {
      sourceIds: [...corpus.sources.keys()],
      preparedUnitIds: [...byUnit.keys()],
      fragmentIds: [...byFragment.keys()],
    },
    queries: reports,
  });
}

let failure: unknown = null;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  await pool.end();
}
if (failure) {
  const stack = typeof (failure as { stack?: unknown })?.stack === "string"
    ? (failure as { stack: string }).stack
    : "";
  const location = stack.match(/(?:evidence-real-corpus\.test|publication-simulation|corpus)\.mts:(\d{1,4}):\d+/u);
  const kind = location?.[0].startsWith("publication-simulation") ? "publication"
    : location?.[0].startsWith("corpus.") ? "corpus" : "suite";
  // The managed launcher accepts only this bounded location marker and never
  // forwards assertion details, request questions, database errors, or text.
  console.error(`SAFE_REAL_CORPUS_FAILURE_LINE:${kind}:${location ? Number(location[1]) : 1}`);
  process.exitCode = 1;
}