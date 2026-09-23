/**
 * Reusable, managed-only setup for the prepared v0.2 corpus. It imports the
 * extracted originals unchanged and uses only the narrow test publication
 * simulator; it never imports the application database singleton.
 */
import "../../safety/require-managed.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createEvidenceConcept,
  createEvidenceSource,
  ingestEvidenceVersion,
  linkEvidenceRequiredContext,
  linkEvidenceSectionKeyword,
  upsertEvidenceDictionaryTerm,
  upsertEvidenceKeyword,
  type EvidenceCatalogPool,
} from "../../../server/evidence/catalog.ts";
import { emptySectionApplicabilityPolicy } from "../../../shared/evidence.ts";
import {
  loadPreparedRealCorpus,
  type CorpusFragment,
  type PreparedUnit,
  type RealCorpus,
} from "./corpus.mts";
import { simulateTestOnlyPublication } from "./publication-simulation.mts";
import { getManagedTestContext } from "../../safety/require-managed.mjs";

export type PrototypeCorpusPool = EvidenceCatalogPool & {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  connect(): Promise<{
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      queryText: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }>;
    release(): void;
  }>;
};
export type PersistedFragment = CorpusFragment & {
  sourceDbId: string; versionDbId: string; sectionDbId: string; logicalUnitIds: string[];
};
export type PersistedUnit = PreparedUnit & {
  sourceDbId: string; versionDbId: string; sectionDbId: string;
};
export type InitializedPrototypeCorpus = {
  corpus: RealCorpus;
  byFragment: Map<string, PersistedFragment>;
  byUnit: Map<string, PersistedUnit>;
  versionBySource: Map<string, { sourceDbId: string; versionDbId: string }>;
};

const CONCEPTS = [
  { key: "feeding-choice", questionTerms: [["ja", "ミルク"]], sourceTerms: [["ja", "育児用ミルク"], ["ja", "人工乳"], ["en", "feeding choice"]], units: ["E01-S01"] },
  { key: "complementary-feeding-start", questionTerms: [["ja", "離乳食"]], sourceTerms: [["ja", "離乳食"], ["ja", "離乳"], ["en", "complementary feeding"]], units: ["E01-S03"] },
  { key: "weaning-and-breastfeeding", questionTerms: [["ja", "離乳"], ["ja", "授乳"]], sourceTerms: [["ja", "離乳"], ["ja", "授乳"], ["en", "weaning completion"]], units: ["E01-S02", "E01-S04"] },
  { key: "child-sleep-duration", questionTerms: [["ja", "睡眠時間"]], sourceTerms: [["ja", "睡眠時間"], ["ja", "睡眠"], ["en", "sleep duration"]], units: ["E02-S01", "E02-S02"] },
  { key: "caregiver-sleep", questionTerms: [["ja", "寝不足"], ["ja", "睡眠"]], sourceTerms: [["ja", "睡眠"], ["ja", "保護者"], ["en", "caregiver sleep"]], units: ["E02-S03"] },
  { key: "parental-depressive-symptoms", questionTerms: [["ja", "うつ"]], sourceTerms: [["en", "depressive symptoms"], ["en", "depression"], ["ja", "抑うつ"]], units: ["E03-S02"] },
  { key: "parent-child-interactions", questionTerms: [["ja", "育児支援"]], sourceTerms: [["en", "interactions"], ["en", "parenting interventions"], ["ja", "親子"]], units: ["E03-S01"] },
  { key: "screen-use-and-sleep", questionTerms: [["ja", "動画"]], sourceTerms: [["en", "screen use"], ["en", "screen time"], ["ja", "スクリーン"]], units: ["E04-S01", "E04-S02"] },
] as const;

function asDateOnlyOrNull(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null;
}

function originalContains(fragment: CorpusFragment, language: "ja" | "en", term: string) {
  const text = `${fragment.heading ?? ""} ${fragment.originalText}`.toLocaleLowerCase();
  return language === "ja"
    ? text.includes(term.toLocaleLowerCase())
    : new RegExp(`(^|[^A-Za-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}($|[^A-Za-z0-9_])`, "iu").test(text);
}

function physicalSectionPolicy(unit: PreparedUnit) {
  const policy = structuredClone(unit.policy);
  if (unit.fragmentId === "E02-F-S01-S02-SHARED") {
    policy.weiku.age = { mode: "specific", scope: "range", minMonths: 12, maxMonths: 71 };
  }
  return policy;
}

function physicalSectionNotes(units: PreparedUnit[]) {
  return units.map((unit) => unit.notes).filter((note): note is string => Boolean(note)).join("\n") || null;
}

export async function importCorpus(pool: PrototypeCorpusPool, runId = `prototype-corpus-${randomUUID()}`): Promise<InitializedPrototypeCorpus> {
  const corpus = loadPreparedRealCorpus();
  const byFragment = new Map<string, PersistedFragment>();
  const byUnit = new Map<string, PersistedUnit>();
  const versionBySource = new Map<string, { sourceDbId: string; versionDbId: string }>();
  for (const [sourceId, source] of corpus.sources) {
    const sourceDb = await createEvidenceSource(pool, { sourceKey: `${runId}-${sourceId.toLowerCase()}`, testOnly: true }) as { id: string };
    const units = corpus.units.filter((unit) => unit.sourceId === sourceId);
    assert(units.length > 0, `${sourceId} requires prepared units`);
    const requiredIds = new Set(units.flatMap((unit) => [unit.fragmentId, ...unit.requiredContext.map((context) => context.fragmentId)]));
    const fragments = [...corpus.fragments.values()].filter((fragment) => fragment.sourceId === sourceId && requiredIds.has(fragment.id));
    assert(fragments.length > 0, `${sourceId} requires extracted fragments`);
    const canonical = new Map<string, PreparedUnit>();
    for (const unit of units) if (!canonical.has(unit.fragmentId)) canonical.set(unit.fragmentId, unit);
    const ingest = await ingestEvidenceVersion(pool, {
      sourceId: sourceDb.id, version: source.version, title: source.title, publisher: source.publisher,
      authors: source.authors, originalUrl: source.originalUrl, externalIdentifier: source.externalIdentifier,
      documentType: source.documentType, language: source.language, publishedOn: asDateOnlyOrNull(source.publishedOn),
      revisedOn: asDateOnlyOrNull(source.revisedOn), age: { scope: "unknown", minMonths: null, maxMonths: null },
      regions: { scope: "unknown", values: [] },
      conditions: { scope: "unknown", values: [], exceptions: sourceId === "E03" ? ["diagnosed_illness_or_disability"] : sourceId === "E04" ? ["diagnosed_medical_condition_affecting_growth_development_or_behavior"] : [] },
      certainty: { level: null, assessmentMethod: null, assessmentSource: null },
      documentApplicabilityPolicy: source.documentPolicy, testOnly: true,
      sections: fragments.map((fragment) => ({
        sectionType: "excerpt", heading: fragment.heading, originalText: fragment.originalText,
        sourceLocation: fragment.sourceLocation,
        notes: fragment.notes ?? physicalSectionNotes(units.filter((unit) => unit.fragmentId === fragment.id)),
        applicabilityPolicy: canonical.has(fragment.id)
          ? physicalSectionPolicy(canonical.get(fragment.id)!)
          : structuredClone(emptySectionApplicabilityPolicy),
      })),
    });
    versionBySource.set(sourceId, { sourceDbId: sourceDb.id, versionDbId: ingest.versionId });
    fragments.forEach((fragment, index) => byFragment.set(fragment.id, {
      ...fragment, sourceDbId: sourceDb.id, versionDbId: ingest.versionId, sectionDbId: ingest.sectionIds[index],
      logicalUnitIds: units.filter((unit) => unit.fragmentId === fragment.id).map((unit) => unit.id),
    }));
  }
  for (const unit of corpus.units) {
    const fragment = byFragment.get(unit.fragmentId);
    assert(fragment, `${unit.id} persisted fragment is missing`);
    byUnit.set(unit.id, { ...unit, sourceDbId: fragment.sourceDbId, versionDbId: fragment.versionDbId, sectionDbId: fragment.sectionDbId });
  }
  return { corpus, byFragment, byUnit, versionBySource };
}

export async function linkCuratedConcepts(
  pool: PrototypeCorpusPool,
  byUnit: Map<string, PersistedUnit>,
  byFragment: Map<string, PersistedFragment>,
  runId = `prototype-concepts-${randomUUID()}`,
) {
  for (const spec of CONCEPTS) {
    const targets = spec.units.map((id) => {
      const unit = byUnit.get(id);
      assert(unit, `curated concept ${spec.key} refers to a prepared unit`);
      return unit;
    });
    const concept = await createEvidenceConcept(pool, { conceptKey: `${runId}-${spec.key}` }) as { id: string };
    const terms = spec.sourceTerms.filter(([language, term]) => targets.some((unit) => originalContains(byFragment.get(unit.fragmentId)!, language, term)));
    assert(terms.length > 0, `${spec.key} has no curated term in its real original text`);
    const keywordIds = new Map<string, string>();
    for (const [language, term] of terms) {
      const keyword = await upsertEvidenceKeyword(pool, { id: randomUUID(), conceptId: concept.id, term, language, active: true, testOnly: true }) as { id: string };
      keywordIds.set(`${language}:${term}`, keyword.id);
    }
    for (const [language, term] of spec.questionTerms) {
      await upsertEvidenceDictionaryTerm(pool, { id: randomUUID(), conceptId: concept.id, term, language, testOnly: true });
    }
    for (const target of targets) for (const [language, term] of terms) {
      const fragment = byFragment.get(target.fragmentId)!;
      if (originalContains(fragment, language, term)) await linkEvidenceSectionKeyword(pool, {
        sourceVersionId: target.versionDbId, sectionId: target.sectionDbId, keywordId: keywordIds.get(`${language}:${term}`)!,
      });
    }
  }
}

export async function linkRequiredContext(
  pool: PrototypeCorpusPool,
  byUnit: Map<string, PersistedUnit>,
  byFragment: Map<string, PersistedFragment>,
) {
  for (const unit of byUnit.values()) for (const required of unit.requiredContext) {
    const context = byFragment.get(required.fragmentId);
    assert(context, `${unit.id} required context was not persisted`);
    await linkEvidenceRequiredContext(pool, {
      sourceVersionId: unit.versionDbId, sectionId: unit.sectionDbId,
      requiredSectionId: context.sectionDbId, role: required.role,
    });
  }
}

/** Seeds exactly E01–E04 / eleven prepared units into an already authorized pool. */
export async function initializePrototypeCorpus(pool: PrototypeCorpusPool): Promise<InitializedPrototypeCorpus> {
  // This explicit entry call makes a direct import insufficient authorization.
  getManagedTestContext();
  const runId = `prototype-corpus-${randomUUID()}`;
  const initialized = await importCorpus(pool, runId);
  assert.equal(initialized.corpus.sources.size, 4, "only the four v0.2 sources may be seeded");
  assert.equal(initialized.corpus.units.length, 11, "only the eleven prepared v0.2 units may be seeded");
  await linkCuratedConcepts(pool, initialized.byUnit, initialized.byFragment, runId);
  await linkRequiredContext(pool, initialized.byUnit, initialized.byFragment);
  await simulateTestOnlyPublication(pool, [...initialized.versionBySource.values()].map((version) => ({
    sourceId: version.sourceDbId, versionId: version.versionDbId,
  })));
  return initialized;
}