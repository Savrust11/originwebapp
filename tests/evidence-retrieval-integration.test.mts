/**
 * Managed, ephemeral-PostgreSQL contract for evidence retrieval.
 *
 * This suite deliberately inserts only clearly fictional TEST/架空テスト
 * documents.  It uses the normal signed-session path and does not install a
 * request or database adapter.  Importing require-managed is the first module
 * side effect so this file cannot be used against an ordinary database.
 */
import "./safety/require-managed.mjs";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { getManagedTestContext } from "./safety/require-managed.mjs";
import { pool } from "../server/db.ts";
import {
  evidenceDictionaryTermUpsertSchema,
  evidenceKeywordUpsertSchema,
  evidenceSourceCreateSchema,
  evidenceVersionIngestSchema,
} from "@shared/evidence";
import {
  emptyDocumentApplicabilityPolicy,
  emptySectionApplicabilityPolicy,
  evidenceApplicabilityPolicySchema,
  type EvidenceApplicabilityPolicy,
} from "@shared/evidence-policy";
import {
  addEvidenceDerivedText,
  createEvidenceConcept,
  createEvidenceSource,
  ingestEvidenceVersion,
  linkEvidenceSectionKeyword,
  publishEvidenceVersion,
  reviewEvidenceVersion,
  upsertEvidenceDictionaryTerm,
  upsertEvidenceKeyword,
} from "../server/evidence/catalog.ts";
import { searchEvidence } from "../server/evidence/search.ts";

const context = getManagedTestContext();
const baseURL = context.baseURL;
if (!baseURL) throw new Error("managed evidence server is unavailable");
const origin = new URL(baseURL).origin;
const tag = `evidence-it-${randomUUID()}`;

type ResponseData = { status: number; body: any; text: string };
type FixtureVersion = {
  sourceId: string;
  versionId: string;
  sectionId: string;
  sectionIds: string[];
};

let ownerId = 0;
let supporterId = 0;
let ownerCookie = "";
let supporterCookie = "";
const insertedVersionIds: string[] = [];
const insertedConsultationIds: string[] = [];
let documentConstraintVersion: FixtureVersion | null = null;
let legacyConditionEdgeVersion: FixtureVersion | null = null;
let disjointAgeVersion: FixtureVersion | null = null;

function signedCookie(sid: string) {
  const secret = process.env.SESSION_SECRET;
  assert(secret, "the managed child supplies a session secret");
  const signature = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/u, "");
  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

async function insertSession(userId: number) {
  const sid = `${tag}-${randomUUID()}`;
  const sess = {
    cookie: {
      originalMaxAge: 30 * 24 * 60 * 60 * 1000,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    },
    userId,
  };
  await pool.query(
    `INSERT INTO "session" (sid, sess, expire)
     VALUES ($1, $2::json, now() + interval '30 days')`,
    [sid, JSON.stringify(sess)],
  );
  return signedCookie(sid);
}

async function request(
  body: unknown,
  options: {
    cookie?: string;
    requestOrigin?: string;
    fetchSite?: string;
    rawBody?: string;
    contentType?: string;
  } = {},
): Promise<ResponseData> {
  const response = await fetch(`${baseURL}/api/evidence/search`, {
    method: "POST",
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.contentType === undefined ? { "content-type": "application/json" } : { "content-type": options.contentType }),
      ...(options.requestOrigin === undefined ? {} : { origin: options.requestOrigin }),
      ...(options.fetchSite === undefined ? {} : { "sec-fetch-site": options.fetchSite }),
    },
    body: options.rawBody ?? JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: response.status, body: parsed, text };
}

async function insertSource(sourceKey: string) {
  const row = await createEvidenceSource(pool, {
    sourceKey: `${tag}-${sourceKey}`,
    testOnly: true,
  }) as { id: string };
  return row.id;
}

async function insertVersion(
  sourceId: string,
  options: {
    version: string;
    title: string;
    language: "ja" | "en";
    text: string;
    location?: string;
    age?: { scope: "unknown" | "all" | "range"; min?: number; max?: number };
    regions?: { scope: "unknown" | "all" | "list"; values?: string[] };
    conditions?: { scope: "unknown" | "all" | "list"; values?: string[]; exceptions?: string[] };
    publicationStatus?: "draft" | "published";
    testOnly: boolean;
    originalUrl?: string;
    review?: boolean;
    expectedCurrentVersionId?: string | null;
    documentApplicabilityPolicy?: EvidenceApplicabilityPolicy;
    sections?: Array<{
      text: string;
      location?: string;
      heading?: string;
      notes?: string;
      applicabilityPolicy?: EvidenceApplicabilityPolicy;
    }>;
  },
): Promise<FixtureVersion> {
  const age = options.age ?? { scope: "unknown" };
  const regions = options.regions ?? { scope: "unknown" };
  const conditions = options.conditions ?? { scope: "unknown" };
  const legacyDocumentPolicy = structuredClone(emptyDocumentApplicabilityPolicy);
  // Legacy fixture metadata remains version-level metadata.  The section
  // policy stays explicitly unknown; known document restrictions must still
  // exclude mismatches without upgrading an in-range section to matched.
  legacyDocumentPolicy.weiku.age = {
    mode: age.scope === "unknown" ? "unknown" : "specific",
    scope: age.scope === "unknown" ? null : age.scope,
    minMonths: age.min ?? null,
    maxMonths: age.max ?? null,
  };
  const legacyExceptions = conditions.exceptions ?? [];
  const legacyConditionIsKnown = conditions.scope !== "unknown" || legacyExceptions.length > 0;
  legacyDocumentPolicy.weiku.conditions = {
    mode: legacyConditionIsKnown ? "specific" : "unknown",
    scope: legacyConditionIsKnown ? (conditions.values?.length ? "list" : "all") : null,
    values: conditions.values ?? [],
    exclusions: legacyExceptions,
  };
  const documentApplicabilityPolicy = options.documentApplicabilityPolicy ?? legacyDocumentPolicy;
  const defaultSectionPolicy = structuredClone(emptySectionApplicabilityPolicy);
  // Historical one-section fixtures model the old version-level age field.
  // Keep that fixture contract explicit via inheritance; dedicated multi-
  // section fixtures pass their own unknown/inherit/specific policies.
  if (!options.sections && age.scope !== "unknown") {
    defaultSectionPolicy.weiku.age = {
      mode: "inherit",
      scope: null,
      minMonths: null,
      maxMonths: null,
    };
  }
  const sectionSpecs = options.sections ?? [{
    text: options.text,
    location: options.location,
    heading: "TEST fixture section",
    notes: "架空テスト本文。実際の育児・医学的助言ではありません。",
    applicabilityPolicy: defaultSectionPolicy,
  }];
  const ingest = await ingestEvidenceVersion(pool, {
    sourceId,
    version: options.version,
    title: options.title,
    publisher: "TEST Publisher / 架空テスト発行元",
    authors: ["TEST Author"],
    originalUrl: options.originalUrl ?? `https://example.invalid/${tag}/${options.version}`,
    externalIdentifier: `${tag}-${options.version}`,
    documentType: "fictional-test",
    language: options.language,
    publishedOn: "2024-01-01",
    revisedOn: "2024-02-01",
    age: { scope: age.scope, minMonths: age.min ?? null, maxMonths: age.max ?? null },
    regions: { scope: regions.scope, values: regions.values ?? [] },
    conditions: {
      scope: conditions.scope,
      values: conditions.values ?? [],
      exceptions: conditions.exceptions ?? [],
    },
    certainty: {
      level: null,
      assessmentMethod: null,
      assessmentSource: null,
    },
    documentApplicabilityPolicy,
    testOnly: options.testOnly,
    sections: sectionSpecs.map((section) => ({
      sectionType: "excerpt",
      heading: section.heading ?? "TEST fixture section",
      originalText: section.text,
      sourceLocation: section.location ?? "TEST §1",
      notes: section.notes ?? "架空テスト本文。実際の育児・医学的助言ではありません。",
      applicabilityPolicy: section.applicabilityPolicy ?? structuredClone(emptySectionApplicabilityPolicy),
    })),
  });
  const versionId = ingest.versionId;
  const sectionId = ingest.sectionIds[0];
  insertedVersionIds.push(versionId);
  if (options.review !== false) {
    await reviewAndPublish(
      sourceId,
      versionId,
      options.publicationStatus === "published",
      options.expectedCurrentVersionId ?? null,
    );
  }
  return { sourceId, versionId, sectionId, sectionIds: ingest.sectionIds };
}

async function reviewAndPublish(
  sourceId: string,
  versionId: string,
  publish: boolean,
  expectedCurrentVersionId: string | null = null,
) {
  await reviewEvidenceVersion(pool, {
    sourceId,
    versionId,
    reviewerName: "evidence integration test reviewer",
    reviewedAt: "2024-03-01",
    adoptionReason: "Human review of clearly fictional TEST fixture only",
    usageTerms: "TEST-only; not medical advice",
  });
  if (publish) {
    await publishEvidenceVersion(pool, {
      sourceId,
      versionId,
      expectedCurrentVersionId,
    });
  }
}

async function insertConceptTerms(conceptKey: string, terms: Array<["ja" | "en", string]>) {
  const concept = await createEvidenceConcept(pool, { conceptKey: `${tag}-${conceptKey}` }) as { id: string };
  const conceptId = concept.id;
  for (const [language, term] of terms) {
    const keywordId = randomUUID();
    await upsertEvidenceKeyword(pool, {
      id: keywordId, conceptId, term, language, active: true, testOnly: true,
    });
    await upsertEvidenceDictionaryTerm(pool, {
      id: randomUUID(), conceptId, term, language, testOnly: true,
    });
  }
  return conceptId;
}

async function linkKeyword(versionId: string, sectionId: string, keywordId: string) {
  await linkEvidenceSectionKeyword(pool, { sourceVersionId: versionId, sectionId, keywordId });
}

async function seed() {
  assert.equal(
    evidenceApplicabilityPolicySchema.safeParse({}).success,
    false,
    "section policy requires explicit structured dimensions",
  );
  assert.equal(
    evidenceApplicabilityPolicySchema.safeParse(emptySectionApplicabilityPolicy).success,
    true,
    "empty policy is explicit unknown, not an implicit all-scope policy",
  );
  assert.throws(
    () => evidenceSourceCreateSchema.parse({ sourceKey: `${tag}-missing-test-flag` }),
    "source testOnly is required",
  );
  assert.throws(
    () => evidenceKeywordUpsertSchema.parse({
      conceptId: null,
      term: "TEST missing flag",
      language: "en",
      active: true,
    }),
    "keyword testOnly is required",
  );
  assert.throws(
    () => evidenceDictionaryTermUpsertSchema.parse({
      conceptId: randomUUID(),
      term: "TEST missing flag",
      language: "en",
    }),
    "dictionary testOnly is required",
  );
  const users = await pool.query<{ id: number }>(
    `INSERT INTO users (line_user_id, display_name, family_id, role)
     VALUES ($1, 'Evidence TEST owner', $2, 'mama'),
            ($3, 'Evidence TEST supporter', $4, 'papa')
     RETURNING id`,
    [`${tag}-owner`, `${tag}-family`, `${tag}-supporter`, `${tag}-supporter-family`],
  );
  [ownerId, supporterId] = users.rows.map((row) => row.id);
  await pool.query(
    `INSERT INTO supporter_accounts (user_id, invite_address, public_code, display_name, kind)
     VALUES ($1, $2, $3, 'Evidence TEST supporter', 'facility')`,
    [supporterId, `${tag}@supporter.invalid`, `${tag}-supporter-code`],
  );
  [ownerCookie, supporterCookie] = await Promise.all([
    insertSession(ownerId),
    insertSession(supporterId),
  ]);

  const sleepConcept = await insertConceptTerms("sleep", [["ja", "睡眠"], ["en", "sleep"]]);
  const jaSource = await insertSource("ja-boundary");
  const jaVersion = await insertVersion(jaSource, {
    version: "ja-v1",
    title: "架空テスト資料 JA sleep",
    language: "ja",
    text: "架空テスト本文 JA 睡眠 sleep boundary marker。医療助言ではありません。",
    age: { scope: "range", min: 0, max: 6 },
    regions: { scope: "list", values: ["日本"] },
    conditions: { scope: "list", values: ["night"] },
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  const sleepKeywordRows = await pool.query<{ id: string; language: "ja" | "en" }>(
    `SELECT id, language FROM evidence_keywords WHERE concept_id = $1 ORDER BY language`,
    [sleepConcept],
  );
  const jaSleepKeyword = sleepKeywordRows.rows.find((row) => row.language === "ja");
  const enSleepKeyword = sleepKeywordRows.rows.find((row) => row.language === "en");
  if (jaSleepKeyword) await linkKeyword(jaVersion.versionId, jaVersion.sectionId, jaSleepKeyword.id);

  const enSource = await insertSource("en-all");
  const enVersion = await insertVersion(enSource, {
    version: "en-v1",
    title: "FICTIONAL TEST English sleep document",
    language: "en",
    text: "FICTIONAL TEST original English sleep passage; not medical advice.",
    age: { scope: "all" },
    regions: { scope: "all" },
    conditions: { scope: "all" },
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  if (enSleepKeyword) await linkKeyword(enVersion.versionId, enVersion.sectionId, enSleepKeyword.id);

  const unknownSource = await insertSource("unknown");
  const unknownVersion = await insertVersion(unknownSource, {
    version: "unknown-v1",
    title: "架空テスト unknown applicability",
    language: "ja",
    text: "架空テスト unknown 睡眠 sleep applicability marker。",
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  if (jaSleepKeyword) await linkKeyword(unknownVersion.versionId, unknownVersion.sectionId, jaSleepKeyword.id);

  const currentSource = await insertSource("retention");
  const oldVersion = await insertVersion(currentSource, {
    version: "old-v1",
    title: "架空テスト old retained version",
    language: "en",
    text: "架空テスト OLD_VERSION_ONLY marker.",
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  const currentVersion = await insertVersion(currentSource, {
    version: "current-v2",
    title: "架空テスト current version",
    language: "en",
    text: "架空テスト CURRENT_VERSION_ONLY marker.",
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: oldVersion.versionId,
  });
  const currentConcept = await insertConceptTerms("version", [["en", "CURRENT_VERSION_ONLY"]]);
  const oldConcept = await insertConceptTerms("old", [["en", "OLD_VERSION_ONLY"]]);
  const currentKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [currentConcept],
  )).rows[0];
  const oldKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [oldConcept],
  )).rows[0];
  await linkKeyword(currentVersion.versionId, currentVersion.sectionId, currentKeyword.id);
  await linkKeyword(oldVersion.versionId, oldVersion.sectionId, oldKeyword.id);
  const staleVersion = await insertVersion(currentSource, {
    version: "stale-v3-draft",
    title: "架空テスト stale CAS draft",
    language: "en",
    text: "架空テスト stale compare-and-swap draft.",
    testOnly: true,
    publicationStatus: "draft",
  });
  const stalePublish = await publishEvidenceVersion(pool, {
    sourceId: currentSource,
    versionId: staleVersion.versionId,
    expectedCurrentVersionId: oldVersion.versionId,
  });
  assert.equal(stalePublish, null, "stale expected current version cannot publish");

  const duplicateSource = await insertSource("derived");
  const duplicateVersion = await insertVersion(duplicateSource, {
    version: "derived-v1",
    title: "架空テスト checked translation canonical",
    language: "en",
    text: "架空テスト canonical original body.",
    testOnly: true,
    publicationStatus: "published",
    review: false,
  });
  const derivedKeyword = await insertConceptTerms("derived", [["ja", "翻訳だけのマーカー"], ["en", "translation only marker"]]);
  const derivedKeywords = await pool.query<{ id: string; language: string }>(
    `SELECT id, language FROM evidence_keywords WHERE concept_id = $1`, [derivedKeyword],
  );
  const jaDerived = derivedKeywords.rows.find((row) => row.language === "ja");
  const enDerived = derivedKeywords.rows.find((row) => row.language === "en");
  if (enDerived) await linkKeyword(duplicateVersion.versionId, duplicateVersion.sectionId, enDerived.id);
  if (jaDerived) {
    await addEvidenceDerivedText(pool, {
      id: randomUUID(),
      sourceVersionId: duplicateVersion.versionId,
      originalSectionId: duplicateVersion.sectionId,
      kind: "translation",
      language: "ja",
      content: "翻訳だけのマーカー。架空テスト翻訳。",
      creationMethod: "human-test-fixture",
      reviewStatus: "checked",
      reviewerName: "TEST reviewer",
      reviewedAt: "2024-03-01",
    });
    await addEvidenceDerivedText(pool, {
      id: randomUUID(),
      sourceVersionId: duplicateVersion.versionId,
      originalSectionId: duplicateVersion.sectionId,
      kind: "translation",
      language: "ja",
      content: "未確認翻訳マーカー。公開前の架空テスト未確認派生文。",
      creationMethod: "unreviewed-test-fixture",
      reviewStatus: "unchecked",
    });
  }
  await reviewAndPublish(duplicateSource, duplicateVersion.versionId, true, null);

  const uncheckedSource = await insertSource("unchecked-derived");
  const uncheckedVersion = await insertVersion(uncheckedSource, {
    version: "unchecked-v1",
    title: "架空テスト unchecked derivative",
    language: "en",
    text: "架空テスト unchecked original.",
    testOnly: true,
    publicationStatus: "published",
    review: false,
  });
  const uncheckedConcept = await insertConceptTerms("unchecked", [["ja", "未確認翻訳マーカー"]]);
  const uncheckedKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [uncheckedConcept],
  )).rows[0];
  await addEvidenceDerivedText(pool, {
    id: randomUUID(),
    sourceVersionId: uncheckedVersion.versionId,
    originalSectionId: uncheckedVersion.sectionId,
    kind: "translation",
    language: "ja",
    content: "未確認翻訳マーカー。",
    creationMethod: "unreviewed-test-fixture",
    reviewStatus: "unchecked",
  });
  await linkKeyword(uncheckedVersion.versionId, uncheckedVersion.sectionId, uncheckedKeyword.id);
  await reviewAndPublish(uncheckedSource, uncheckedVersion.versionId, true, null);

  const draftReparentSource = await insertSource("draft-reparent");
  const draftReparentVersion = await insertVersion(draftReparentSource, {
    version: "draft-reparent-v1",
    title: "架空テスト draft FK reparent",
    language: "en",
    text: "架空テスト draft section and derived text must not move into a published version.",
    testOnly: true,
    publicationStatus: "draft",
    review: false,
  });
  const draftDerivedId = randomUUID();
  await addEvidenceDerivedText(pool, {
    id: draftDerivedId,
    sourceVersionId: draftReparentVersion.versionId,
    originalSectionId: draftReparentVersion.sectionId,
    kind: "summary",
    language: "en",
    content: "架空テスト draft derived text.",
    creationMethod: "draft-test-fixture",
    reviewStatus: "unchecked",
  });
  await assert.rejects(pool.query(
    `UPDATE evidence_sections
     SET source_version_id = $1
     WHERE id = $2`,
    [jaVersion.versionId, draftReparentVersion.sectionId],
  ), "a draft section cannot be reparented into an ever-published version");
  await assert.rejects(pool.query(
    `UPDATE evidence_derived_texts
     SET source_version_id = $1
     WHERE id = $2`,
    [jaVersion.versionId, draftDerivedId],
  ), "a draft derived text cannot be reparented into an ever-published version");

  const immutableSource = await insertSource("immutable-test-only-source");
  const immutableSourceRow = await pool.query<{ test_only: boolean }>(
    "SELECT test_only FROM evidence_sources WHERE id = $1",
    [immutableSource],
  );
  assert.equal(immutableSourceRow.rows[0].test_only, true);
  await assert.rejects(pool.query(
    "UPDATE evidence_sources SET test_only = false WHERE id = $1",
    [immutableSource],
  ), "test-only source flag is immutable");
  await assert.rejects(ingestEvidenceVersion(pool, {
    sourceId: immutableSource,
    version: "ordinary-next-version",
    title: "架空テスト ordinary next version",
    publisher: "TEST Publisher / 架空テスト発行元",
    authors: ["TEST Author"],
    originalUrl: `https://example.invalid/${tag}/ordinary-next-version`,
    externalIdentifier: `${tag}-ordinary-next-version`,
    documentType: "fictional-test",
    language: "en",
    publishedOn: "2024-01-01",
    revisedOn: "2024-02-01",
    age: { scope: "unknown", minMonths: null, maxMonths: null },
    regions: { scope: "unknown", values: [] },
    conditions: { scope: "unknown", values: [], exceptions: [] },
    certainty: { level: null, assessmentMethod: null, assessmentSource: null },
    testOnly: false,
    sections: [{
      sectionType: "excerpt",
      heading: "TEST ordinary next version",
      originalText: "架空テスト ordinary next version.",
      sourceLocation: "TEST §1",
      notes: "架空テスト",
    }],
  }), "a non-test next version cannot launder a test-only source");

  const invalidUrlSource = await insertSource("invalid-original-url");
  const invalidUrlInput = {
    sourceId: invalidUrlSource,
    version: "invalid-url",
    title: "架空テスト invalid original URL",
    publisher: "TEST Publisher / 架空テスト発行元",
    authors: ["TEST Author"],
    originalUrl: "https://example.invalid/placeholder",
    externalIdentifier: `${tag}-invalid-url`,
    documentType: "fictional-test",
    language: "en" as const,
    publishedOn: "2024-01-01",
    revisedOn: "2024-02-01",
    age: { scope: "unknown" as const, minMonths: null, maxMonths: null },
    regions: { scope: "unknown" as const, values: [] as string[] },
    conditions: { scope: "unknown" as const, values: [] as string[], exceptions: [] as string[] },
    certainty: { level: null, assessmentMethod: null, assessmentSource: null },
    testOnly: true,
    sections: [{
      sectionType: "excerpt",
      heading: "TEST invalid URL",
      originalText: "架空テスト invalid URL.",
      sourceLocation: "TEST §1",
      notes: "架空テスト",
    }],
  };
  const missingVersionTestFlag = { ...invalidUrlInput };
  delete (missingVersionTestFlag as { testOnly?: boolean }).testOnly;
  assert.throws(
    () => evidenceVersionIngestSchema.parse(missingVersionTestFlag),
    "version testOnly is required",
  );
  for (const [index, originalUrl] of ["javascript:alert(1)", "data:text/plain,TEST", "file:///tmp/test"].entries()) {
    const candidate = { ...invalidUrlInput, version: `invalid-url-${index}`, originalUrl };
    assert.throws(() => evidenceVersionIngestSchema.parse(candidate), "Zod rejects unsafe original URL schemes");
    await assert.rejects(pool.query(
      `INSERT INTO evidence_versions
       (id, source_id, version_label, title, publisher, original_url,
        document_type, original_language, test_only)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        invalidUrlSource,
        `sql-invalid-url-${index}`,
        "架空テスト SQL URL guard",
        "TEST Publisher / 架空テスト発行元",
        originalUrl,
        "fictional-test",
        "en",
        true,
      ],
    ), "SQL rejects unsafe original URL schemes");
  }

  const scriptSource = await insertSource("literal-script");
  const scriptVersion = await insertVersion(scriptSource, {
    version: "script-v1",
    title: "架空テスト literal script",
    language: "en",
    text: `<script>throw new Error("TEST_TEXT_MUST_STAY_LITERAL")</script> SQL_INJECTION_FIXTURE`,
    testOnly: true,
    publicationStatus: "published",
  });
  const scriptConcept = await insertConceptTerms("script", [["en", "SQL_INJECTION_FIXTURE"]]);
  const scriptKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [scriptConcept],
  )).rows[0];
  await linkKeyword(scriptVersion.versionId, scriptVersion.sectionId, scriptKeyword.id);

  const policySource = await insertSource("section-policy");
  const policyVersion = await insertVersion(policySource, {
    version: "section-policy-v1",
    title: "FICTIONAL TEST section applicability policy",
    language: "en",
    text: "unused single-section shorthand",
    age: { scope: "unknown" },
    regions: { scope: "unknown" },
    conditions: { scope: "unknown" },
    documentApplicabilityPolicy: fixturePolicy({
      age: { min: 0, max: 120 },
      conditions: { exclusions: ["premature"] },
      researchRegions: ["Canada"],
      usage: "TEST document restriction: no redistribution",
      usageExceptions: ["third-party figure"],
    }),
    sections: [
      {
        heading: "TEST infant section",
        text: "SECTION_POLICY_MARKER infant section HIGH_RANK_MARKER",
        location: "TEST §infant",
        applicabilityPolicy: fixturePolicy({
          target: "child",
          age: { min: 0, max: 12 },
          researchAge: { mean: 24 },
          researchRegions: ["Canada"],
          conditionsMode: "inherit",
          usageMode: "inherit",
        }),
      },
      {
        heading: "TEST caregiver section",
        text: "SECTION_POLICY_MARKER caregiver section HIGH_RANK_MARKER",
        location: "TEST §caregiver",
        applicabilityPolicy: fixturePolicy({
          target: "caregiver",
          ageMode: "inherit",
          conditionsMode: "inherit",
          researchRegionsMode: "inherit",
          usageMode: "inherit",
        }),
      },
      {
        heading: "TEST under-five section",
        text: "SECTION_POLICY_MARKER under five section",
        location: "TEST §under-five",
        applicabilityPolicy: fixturePolicy({
          target: "child",
          age: { min: 0, max: 59 },
          japan: "applicable",
          conditionsMode: "inherit",
          usage: "TEST section wording cannot remove document restriction",
        }),
      },
      {
        heading: "TEST Japan-inapplicable section",
        text: "SECTION_POLICY_MARKER Japan inapplicable section",
        location: "TEST §japan-inapplicable",
        applicabilityPolicy: fixturePolicy({
          target: "child",
          age: { min: 0, max: 59 },
          japan: "inapplicable",
          conditionsMode: "inherit",
          usageMode: "inherit",
        }),
      },
      {
        heading: "TEST unknown section",
        text: "SECTION_POLICY_MARKER unknown section",
        location: "TEST §unknown",
        applicabilityPolicy: structuredClone(emptySectionApplicabilityPolicy),
      },
      {
        heading: "TEST inherited section",
        text: "SECTION_POLICY_MARKER inherited section",
        location: "TEST §inherited",
        applicabilityPolicy: fixturePolicy({
          ageMode: "inherit",
          conditionsMode: "inherit",
          japanMode: "inherit",
          researchAgeMode: "inherit",
          researchRegionsMode: "inherit",
          usageMode: "inherit",
        }),
      },
      {
        heading: "TEST attempted broadening section",
        text: "SECTION_POLICY_MARKER attempted broadening section",
        location: "TEST §attempted-broadening",
        applicabilityPolicy: fixturePolicy({
          target: "child",
          age: "all",
          conditions: {},
          japanMode: "inherit",
          usage: "TEST section claims unrestricted use",
        }),
      },
    ],
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  const policyConcept = await insertConceptTerms("section-policy", [["en", "SECTION_POLICY_MARKER"]]);
  const policyKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [policyConcept],
  )).rows[0];
  for (const sectionId of policyVersion.sectionIds) {
    await linkKeyword(policyVersion.versionId, sectionId, policyKeyword.id);
  }
  const highRankConcept = await insertConceptTerms("section-policy-high-rank", [["en", "HIGH_RANK_MARKER"]]);
  const highRankKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [highRankConcept],
  )).rows[0];
  for (const sectionId of policyVersion.sectionIds.slice(0, 2)) {
    await linkKeyword(policyVersion.versionId, sectionId, highRankKeyword.id);
  }
  const malformedPolicySource = await insertSource("malformed-policy");
  const malformedPolicyVersion = await insertVersion(malformedPolicySource, {
    version: "malformed-policy-v1",
    title: "架空テスト malformed section policy",
    language: "en",
    text: "MALFORMED_SECTION_POLICY_MARKER",
    testOnly: true,
    publicationStatus: "draft",
    review: false,
  });
  await assert.rejects(
    pool.query(
      `UPDATE evidence_sections SET applicability_policy = '{}'::jsonb WHERE id = $1`,
      [malformedPolicyVersion.sectionId],
    ),
    "database rejects malformed section policy rather than treating it as unrestricted",
  );
  for (const invalidAge of [
    { mode: null, scope: "range", minMonths: 0, maxMonths: 6 },
    { mode: "specific", scope: "range", minMonths: 0.5, maxMonths: 6 },
    { mode: "specific", scope: "range", minMonths: 0, maxMonths: "6" },
  ]) {
    await assert.rejects(
      pool.query(
        `UPDATE evidence_sections
         SET applicability_policy = jsonb_set(applicability_policy, '{weiku,age}', $2::jsonb)
         WHERE id = $1`,
        [malformedPolicyVersion.sectionId, JSON.stringify(invalidAge)],
      ),
      "database rejects invalid JSON policy bounds without relying on raw error text",
    );
  }
  const documentConstraintSource = await insertSource("document-constraints");
  const constraintVersion = await insertVersion(documentConstraintSource, {
    version: "document-constraints-v1",
    title: "FICTIONAL TEST document constraints with unknown section",
    language: "en",
    text: "DOCUMENT_CONSTRAINTS_MARKER",
    documentApplicabilityPolicy: fixturePolicy({
      target: "caregiver",
      age: { min: 0, max: 6 },
      conditions: { exclusions: ["premature"] },
    }),
    sections: [{
      text: "DOCUMENT_CONSTRAINTS_MARKER",
      applicabilityPolicy: structuredClone(emptySectionApplicabilityPolicy),
    }],
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  documentConstraintVersion = constraintVersion;
  const documentConstraintConcept = await insertConceptTerms(
    "document-constraints",
    [["en", "DOCUMENT_CONSTRAINTS_MARKER"]],
  );
  const documentConstraintKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [documentConstraintConcept],
  )).rows[0];
  await linkKeyword(
    constraintVersion.versionId,
    constraintVersion.sectionId,
    documentConstraintKeyword.id,
  );

  const legacyConditionEdgeSource = await insertSource("legacy-condition-edge");
  const legacyConditionEdge = await insertVersion(legacyConditionEdgeSource, {
    version: "legacy-condition-edge-v1",
    title: "FICTIONAL TEST legacy unknown scope with exclusion",
    language: "en",
    text: "LEGACY_CONDITION_EDGE_MARKER",
    conditions: { scope: "unknown", exceptions: ["premature"] },
    sections: [
      {
        text: "LEGACY_CONDITION_EDGE_MARKER unknown section",
        heading: "TEST legacy condition unknown",
        applicabilityPolicy: structuredClone(emptySectionApplicabilityPolicy),
      },
      {
        text: "LEGACY_CONDITION_EDGE_MARKER inherited section",
        heading: "TEST legacy condition inherit",
        applicabilityPolicy: fixturePolicy({ conditionsMode: "inherit" }),
      },
      {
        text: "LEGACY_CONDITION_EDGE_MARKER specific section",
        heading: "TEST legacy condition specific",
        applicabilityPolicy: fixturePolicy({ conditions: {} }),
      },
    ],
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  legacyConditionEdgeVersion = legacyConditionEdge;
  const legacyConditionEdgeConcept = await insertConceptTerms(
    "legacy-condition-edge",
    [["en", "LEGACY_CONDITION_EDGE_MARKER"]],
  );
  const legacyConditionEdgeKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [legacyConditionEdgeConcept],
  )).rows[0];
  for (const sectionId of legacyConditionEdge.sectionIds) {
    await linkKeyword(legacyConditionEdge.versionId, sectionId, legacyConditionEdgeKeyword.id);
  }

  const disjointAgeSource = await insertSource("legacy-disjoint-age");
  const disjointAge = await insertVersion(disjointAgeSource, {
    version: "legacy-disjoint-age-v1",
    title: "FICTIONAL TEST disjoint legacy and document ages",
    language: "en",
    text: "DISJOINT_AGE_MARKER",
    age: { scope: "range", min: 0, max: 6 },
    documentApplicabilityPolicy: fixturePolicy({ age: { min: 12, max: 24 } }),
    sections: [{
      text: "DISJOINT_AGE_MARKER disjoint ranges",
      heading: "TEST disjoint age section",
      applicabilityPolicy: fixturePolicy({ age: { min: 0, max: 6 } }),
    }],
    testOnly: true,
    publicationStatus: "published",
    expectedCurrentVersionId: null,
  });
  disjointAgeVersion = disjointAge;
  const disjointAgeConcept = await insertConceptTerms(
    "legacy-disjoint-age",
    [["en", "DISJOINT_AGE_MARKER"]],
  );
  const disjointAgeKeyword = (await pool.query<{ id: string }>(
    `SELECT id FROM evidence_keywords WHERE concept_id = $1`, [disjointAgeConcept],
  )).rows[0];
  await linkKeyword(disjointAge.versionId, disjointAge.sectionId, disjointAgeKeyword.id);

  await insertConceptTerms(
    "expansion-limit",
    Array.from(
      { length: 65 },
      (_, index) => ["ja", `展開語${index.toString().padStart(2, "0")}`] as ["ja", string],
    ),
  );

  const consultationId = randomUUID();
  insertedConsultationIds.push(consultationId);
  await pool.query(
    `INSERT INTO consultations (id, owner_user_id, title, request_id)
     VALUES ($1, $2, 'TEST private consultation', $3)`,
    [consultationId, ownerId, randomUUID()],
  );
  await pool.query(
    `INSERT INTO consultation_messages (id, consultation_id, content, author_type, request_id)
     VALUES ($1, $2, $3, 'user', $4)`,
    [randomUUID(), consultationId, "PRIVATE_CONSULTATION_ONLY_MARKER sleep", randomUUID()],
  );
}

async function cleanup() {
  await pool.query(`DELETE FROM consultation_messages WHERE consultation_id = ANY($1::uuid[])`, [insertedConsultationIds]);
  await pool.query(`DELETE FROM consultations WHERE id = ANY($1::uuid[])`, [insertedConsultationIds]);
  // Published evidence is immutable, including test-only evidence. Do not
  // delete or downgrade these rows as test cleanup: the owned ephemeral
  // PostgreSQL cluster is the evidence fixture's cleanup boundary.
  await pool.query(`DELETE FROM "session" WHERE sid LIKE $1`, [`${tag}-%`]);
  await pool.query("DELETE FROM supporter_accounts WHERE user_id = $1", [supporterId]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [[ownerId, supporterId]]);
}

function resultFor(body: any, sourceId: string) {
  return body.results.find((result: any) => result.sourceId === sourceId);
}

function fixturePolicy(options: {
  target?: "child" | "caregiver";
  age?: { min: number; max: number } | "all";
  ageMode?: "unknown" | "inherit";
  conditions?: { values?: string[]; exclusions?: string[] };
  conditionsMode?: "unknown" | "inherit";
  japan?: "applicable" | "inapplicable";
  japanMode?: "unknown" | "inherit";
  researchAge?: { min: number; max: number } | { mean: number };
  researchAgeMode?: "unknown" | "inherit";
  researchRegions?: string[];
  researchRegionsMode?: "unknown" | "inherit";
  usage?: string;
  usageExceptions?: string[];
  usageMode?: "unknown" | "inherit";
}): EvidenceApplicabilityPolicy {
  const policy = structuredClone(emptySectionApplicabilityPolicy);
  if (options.target) policy.weiku.target = { mode: "specific", values: [options.target] };
  if (options.age) {
    policy.weiku.age = options.age === "all"
      ? { mode: "specific", scope: "all", minMonths: null, maxMonths: null }
      : { mode: "specific", scope: "range", minMonths: options.age.min, maxMonths: options.age.max };
  } else if (options.ageMode) {
    policy.weiku.age = { mode: options.ageMode, scope: null, minMonths: null, maxMonths: null };
  }
  if (options.conditions) {
    policy.weiku.conditions = {
      mode: "specific",
      scope: options.conditions.values?.length ? "list" : "all",
      values: options.conditions.values ?? [],
      exclusions: options.conditions.exclusions ?? [],
    };
  } else if (options.conditionsMode) {
    policy.weiku.conditions = {
      mode: options.conditionsMode,
      scope: null,
      values: [],
      exclusions: [],
    };
  }
  if (options.japan) {
    policy.weiku.japanApplicability = { mode: "specific", value: options.japan };
  } else if (options.japanMode) {
    policy.weiku.japanApplicability = { mode: options.japanMode, value: null };
  }
  if (options.researchAge) {
    policy.research.participantAge = "mean" in options.researchAge
      ? { mode: "specific", scope: "mean", minMonths: null, maxMonths: null, meanMonths: options.researchAge.mean }
      : { mode: "specific", scope: "range", minMonths: options.researchAge.min, maxMonths: options.researchAge.max, meanMonths: null };
  } else if (options.researchAgeMode) {
    policy.research.participantAge = {
      mode: options.researchAgeMode,
      scope: null,
      minMonths: null,
      maxMonths: null,
      meanMonths: null,
    };
  }
  if (options.researchRegions) {
    policy.research.regions = { mode: "specific", scope: "list", values: options.researchRegions };
  } else if (options.researchRegionsMode) {
    policy.research.regions = { mode: options.researchRegionsMode, scope: null, values: [] };
  }
  if (options.usage || options.usageExceptions) {
    policy.usage = {
      mode: "specific",
      terms: options.usage ?? null,
      exceptions: options.usageExceptions ?? [],
    };
  } else if (options.usageMode) {
    policy.usage = { mode: options.usageMode, terms: null, exceptions: [] };
  }
  return policy;
}

async function main() {
  await seed();

  const privateCanary = "EVIDENCE_PRIVATE_LOG_CANARY";
  const canarySearch = await request({ question: `sleep ${privateCanary}` }, {
    cookie: ownerCookie, requestOrigin: origin, fetchSite: "same-origin",
  });
  assert.equal(canarySearch.status, 200);
  const canaryParseError = await request(undefined, {
    cookie: ownerCookie, requestOrigin: origin, fetchSite: "same-origin",
    rawBody: `{"question":"${privateCanary}"`,
  });
  assert.equal(canaryParseError.status, 400);
  assert(!canaryParseError.text.includes(privateCanary));
  const canaryUnknownPath = await fetch(`${baseURL}/api/evidence/${privateCanary}`);
  assert.equal(canaryUnknownPath.status, 404);
  // The parent launcher independently checks its owned app's stdout/stderr
  // for this fixed marker, without revealing or persisting raw log contents.

  const unauthenticated = await request({ question: "睡眠" }, {
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(unauthenticated.status, 401, "anonymous search is rejected");

  const supporter = await request({ question: "睡眠" }, {
    cookie: supporterCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(supporter.status, 401, "supporter sessions are not eligible parent sessions");

  const authenticated = await request({ question: "睡眠", limit: 20 }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.status, "results");
  assert.ok(authenticated.body.results.some((result: any) => result.language === "ja"));
  assert.ok(authenticated.body.results.some((result: any) => result.language === "en"));
  assert.ok(authenticated.body.results.every((result: any) => result.originalText.includes("架空テスト") || result.originalText.includes("FICTIONAL TEST")));
  assert.ok(authenticated.body.results.every((result: any) => !result.originalText.includes("PRIVATE_CONSULTATION_ONLY_MARKER")));
  const tieOrder = authenticated.body.results.map((result: any) => `${result.sourceId}:${result.versionId}:${result.sectionId}`);
  const tieRepeat = await request({ question: "睡眠", limit: 20 }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.deepEqual(
    tieRepeat.body.results.map((result: any) => `${result.sourceId}:${result.versionId}:${result.sectionId}`),
    tieOrder,
    "equal match counts use stable source/version/section ordering, not language preference",
  );

  const english = await request({ question: "sleep", limit: 20 }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(english.status, 200);
  assert.ok(english.body.results.some((result: any) => result.language === "en"), "English keywords retrieve English fixture");

  const unknownDictionary = await request({ question: "未登録の根拠なし語" }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.deepEqual(
    unknownDictionary.body,
    { status: "no_results", results: [], diagnostics: { reason: "no_vocabulary" } },
    "a question with no known vocabulary is distinct from a vocabulary search with no matching section",
  );
  const expansionLimit = await request({
    question: Array.from({ length: 65 }, (_, index) => `展開語${index.toString().padStart(2, "0")}`).join(" "),
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(expansionLimit.status, 200);
  assert.deepEqual(
    expansionLimit.body,
    { status: "no_results", results: [], diagnostics: { reason: "expansion_limit" } },
    "expanded-term overflow is explicit rather than silently truncated",
  );

  const boundaryIncluded = await request({ question: "睡眠", ageMonths: 6, region: "日本", limit: 20 }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  // Multiple Japanese fixtures intentionally have different age scopes.
  // Select the boundary fixture by its version, not arbitrary UUID tie order.
  const jaResult = boundaryIncluded.body.results.find((result: any) => result.version === "ja-v1");
  assert.equal(jaResult?.applicability.age, "matched", "lower/upper age boundary is included");
  assert.equal(jaResult?.applicability.region, "matched");
  assert.equal(jaResult?.applicability.conditions, "unverified", "conditions remain explicit without an input condition");
  assert.equal(jaResult?.originalUrl.startsWith("https://example.invalid/"), true);
  assert.equal(jaResult?.sourceLocation, "TEST §1");
  assert.equal(jaResult?.version, "ja-v1");
  assert.equal(jaResult?.section.originalSectionId, jaResult?.sectionId);
  assert.equal(jaResult?.section.type, "excerpt");
  assert.equal(jaResult?.section.heading, "TEST fixture section");
  assert.equal(jaResult?.section.notes, "架空テスト本文。実際の育児・医学的助言ではありません。");
  assert.equal(jaResult?.source.testOnly, true);
  assert.equal(jaResult?.source.review.manualReviewed, true);
  assert.equal(jaResult?.source.conditions.values[0], "night");
  assert.equal(jaResult?.source.conditions.exceptions.length, 0);
  const legacyConditionMatch = await request({
    question: "睡眠",
    ageMonths: 6,
    region: "日本",
    context: { conditions: ["night"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const legacyConditionResult = legacyConditionMatch.body.results.find(
    (result: any) => result.version === "ja-v1",
  );
  assert.equal(
    legacyConditionResult?.applicability.conditions,
    "unverified",
    "legacy document condition matches do not upgrade an unknown section to matched",
  );
  const legacyConditionMismatch = await request({
    question: "睡眠",
    ageMonths: 6,
    region: "日本",
    context: { conditions: ["day"], absentConditions: ["night"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    legacyConditionMismatch.body.results.some((result: any) => result.version === "ja-v1"),
    false,
    "legacy version conditions remain restrictive through unknown section policy",
  );

  const infantPolicy = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 6,
    context: { target: "child", japanApplicability: true },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(infantPolicy.status, 200);
  const infantResult = infantPolicy.body.results.find(
    (result: any) => result.section?.heading === "TEST infant section",
  );
  assert.equal(infantResult?.applicability.target, "matched");
  assert.equal(infantResult?.applicability.age, "matched");
  assert.equal(infantResult?.applicability.japan, "unverified", "research country does not approve Japan");
  assert.equal(infantResult?.section.applicabilityPolicy.weiku.age.mode, "specific");
  assert.equal(infantResult?.section.resolvedApplicabilityPolicy.research.participantAge.scope, "mean");
  assert.equal(infantResult?.section.resolvedApplicabilityPolicy.research.participantAge.meanMonths, 24);
  assert.equal(infantResult?.source.applicabilityPolicy.research.regions.values[0], "Canada");
  assert.equal(infantResult?.sourceLocation, "TEST §infant");
  assert.match(infantResult?.originalText ?? "", /infant section/);
  assert.equal(infantResult?.section.notes, "架空テスト本文。実際の育児・医学的助言ではありません。");
  assert.equal(
    infantResult?.section.resolvedApplicabilityPolicy.weiku.conditions.exclusions.includes("premature"),
    true,
    "section inheritance retains document exclusions",
  );
  assert.equal(
    infantResult?.section.resolvedApplicabilityPolicy.usage.terms.includes("document restriction"),
    true,
    "section usage cannot clear document restriction",
  );
  assert.equal(
    infantResult?.section.resolvedApplicabilityPolicy.usage.exceptions.includes("third-party figure"),
    true,
    "section usage retains document usage exceptions",
  );

  const caregiverPolicy = await request({
    question: "SECTION_POLICY_MARKER",
    context: { target: "caregiver", japanApplicability: true },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const caregiverResult = caregiverPolicy.body.results.find(
    (result: any) => result.section?.heading === "TEST caregiver section",
  );
  assert.equal(caregiverResult?.applicability.target, "matched", "caregiver text is distinct from infant text");
  assert.equal(caregiverResult?.section.resolvedApplicabilityPolicy.weiku.target.values[0], "caregiver");
  assert.equal(
    infantPolicy.body.results.some((result: any) => result.section?.heading === "TEST caregiver section"),
    false,
    "caregiver section is not returned for an explicit child target",
  );
  const noTargetContext = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 6,
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const noTargetInfant = noTargetContext.body.results.find(
    (result: any) => result.section?.heading === "TEST infant section",
  );
  assert.equal(noTargetInfant?.applicability.target, "unverified", "missing request target is not inferred");

  const underFiveAtSix = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 72,
    context: { target: "child", japanApplicability: true },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    underFiveAtSix.body.results.some((result: any) => result.section?.heading === "TEST under-five section"),
    false,
    "under-five section does not match six-year-old child",
  );
  assert.equal(
    underFiveAtSix.body.results.some((result: any) => result.section?.heading === "TEST attempted broadening section"),
    true,
    "a narrower section may match inside the document age range",
  );
  const broadeningAtSix = underFiveAtSix.body.results.find(
    (result: any) => result.section?.heading === "TEST attempted broadening section",
  );
  assert.equal(
    broadeningAtSix?.section.resolvedApplicabilityPolicy.weiku.conditions.exclusions.includes("premature"),
    true,
    "a section cannot clear document condition exclusions",
  );
  assert.equal(
    broadeningAtSix?.section.resolvedApplicabilityPolicy.usage.terms.includes("document restriction"),
    true,
    "a section cannot clear document usage restrictions",
  );
  assert.equal(
    broadeningAtSix?.section.resolvedApplicabilityPolicy.usage.exceptions.includes("third-party figure"),
    true,
    "a section cannot clear document usage exceptions",
  );
  const excludedCondition = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 6,
    context: { target: "child", conditions: ["premature"], japanApplicability: true },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    excludedCondition.body.results.some((result: any) => result.section?.heading === "TEST infant section"),
    false,
    "a known document exclusion remains effective for inherited sections",
  );
  assert.equal(
    excludedCondition.body.results.some((result: any) => result.section?.heading === "TEST attempted broadening section"),
    false,
    "a specific section policy cannot waive a document exclusion",
  );
  assert(documentConstraintVersion, "document constraint fixture was created");
  const constraintChild = await request({
    question: "DOCUMENT_CONSTRAINTS_MARKER",
    ageMonths: 6,
    context: { target: "child", conditions: ["well"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    constraintChild.body.results.some((result: any) => result.versionId === documentConstraintVersion?.versionId),
    false,
    "document caregiver target excludes a child request even with an unknown section",
  );
  const constraintAge = await request({
    question: "DOCUMENT_CONSTRAINTS_MARKER",
    ageMonths: 7,
    context: { target: "caregiver", conditions: ["well"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    constraintAge.body.results.some((result: any) => result.versionId === documentConstraintVersion?.versionId),
    false,
    "document age range excludes a seven-month request even with an unknown section",
  );
  const constraintExcludedCondition = await request({
    question: "DOCUMENT_CONSTRAINTS_MARKER",
    ageMonths: 6,
    context: { target: "caregiver", conditions: ["premature"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    constraintExcludedCondition.body.results.some(
      (result: any) => result.versionId === documentConstraintVersion?.versionId,
    ),
    false,
    "document condition exclusions apply when the section condition is unknown",
  );
  const constraintMatching = await request({
    question: "DOCUMENT_CONSTRAINTS_MARKER",
    ageMonths: 6,
    context: { target: "caregiver", conditions: ["well"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const constraintResult = constraintMatching.body.results.find(
    (result: any) => result.versionId === documentConstraintVersion?.versionId,
  );
  assert.equal(constraintResult?.applicability.target, "unverified");
  assert.equal(constraintResult?.applicability.age, "unverified");
  assert.equal(constraintResult?.applicability.conditions, "unverified");
  assert(legacyConditionEdgeVersion, "legacy condition edge fixture was created");
  const legacyConditionRejected = await request({
    question: "LEGACY_CONDITION_EDGE_MARKER",
    context: { conditions: ["premature"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    legacyConditionRejected.body.results.some(
      (result: any) => result.versionId === legacyConditionEdgeVersion?.versionId,
    ),
    false,
    "legacy unknown-scope exclusion rejects all unknown, inherited, and specific sections",
  );
  const legacyConditionPositive = await request({
    question: "LEGACY_CONDITION_EDGE_MARKER",
    context: { conditions: ["well"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const legacyInheritedPositive = legacyConditionPositive.body.results.find(
    (result: any) => result.section?.heading === "TEST legacy condition inherit",
  );
  assert.equal(
    legacyInheritedPositive?.applicability.conditions,
    "unverified",
    "inherited unknown positive scope with a known exclusion stays unverified",
  );
  const legacySpecificPositive = legacyConditionPositive.body.results.find(
    (result: any) => result.section?.heading === "TEST legacy condition specific",
  );
  assert.equal(
    legacySpecificPositive?.applicability.conditions,
    "unverified",
    "an unrelated present condition does not prove a parent exclusion is absent",
  );
  const legacyConditionConfirmed = await request({
    question: "LEGACY_CONDITION_EDGE_MARKER",
    context: { conditions: ["well"], absentConditions: ["premature"] },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const legacySpecificConfirmed = legacyConditionConfirmed.body.results.find(
    (result: any) => result.section?.heading === "TEST legacy condition specific",
  );
  assert.equal(
    legacySpecificConfirmed?.applicability.conditions,
    "matched",
    "explicit absence permits matching only for a known specific section policy",
  );
  assert(disjointAgeVersion, "disjoint age fixture was created");
  const disjointAgeWithoutRequest = await request({
    question: "DISJOINT_AGE_MARKER",
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    disjointAgeWithoutRequest.body.results.some(
      (result: any) => result.versionId === disjointAgeVersion?.versionId,
    ),
    false,
    "disjoint legacy and document age ranges are excluded even without a requested age",
  );
  const attemptedBroadeningAt121 = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 121,
    context: { target: "child", japanApplicability: true },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    attemptedBroadeningAt121.body.results.some(
      (result: any) => result.section?.heading === "TEST attempted broadening section",
    ),
    false,
    "a section cannot widen a known document age restriction",
  );

  const unknownPolicy = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 6,
    context: { target: "child", japanApplicability: true },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const unknownPolicyResult = unknownPolicy.body.results.find(
    (result: any) => result.section?.heading === "TEST unknown section",
  );
  assert.equal(unknownPolicyResult?.applicability.age, "unverified", "missing section age is unverified");
  assert.equal(unknownPolicyResult?.applicability.conditions, "unverified", "missing section conditions are unverified");
  assert.equal(unknownPolicyResult?.applicability.target, "unverified", "missing section target is unverified");
  const inheritedResult = unknownPolicy.body.results.find(
    (result: any) => result.section?.heading === "TEST inherited section",
  );
  assert.equal(inheritedResult?.applicability.age, "matched", "inheritance is distinct from unknown");
  assert.equal(inheritedResult?.section.applicabilityPolicy.weiku.age.mode, "inherit");
  assert.equal(inheritedResult?.section.resolvedApplicabilityPolicy.weiku.age.minMonths, 0);
  assert.equal(inheritedResult?.applicability.japan, "unverified", "inherited unknown Japan status remains unverified");

  const japanRejected = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 6,
    context: { target: "child", japanApplicability: true },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(
    japanRejected.body.results.some((result: any) => result.section?.heading === "TEST Japan-inapplicable section"),
    false,
    "explicitly inapplicable Japan section is excluded",
  );
  const japanFalse = await request({
    question: "SECTION_POLICY_MARKER",
    ageMonths: 6,
    context: { target: "child", japanApplicability: false },
    limit: 20,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const japanFalseInfant = japanFalse.body.results.find(
    (result: any) => result.section?.heading === "TEST infant section",
  );
  assert.equal(
    japanFalseInfant?.applicability.japan,
    "unverified",
    "Japan false is not inverse approval when the policy is unknown",
  );
  const japanFalseUnderFive = japanFalse.body.results.find(
    (result: any) => result.section?.heading === "TEST under-five section",
  );
  assert.equal(
    japanFalseUnderFive?.applicability.japan,
    "unverified",
    "Japan=false does not derive an inverse approval or mismatch from applicability alone",
  );

  const highRankIneligible = await request({
    question: "SECTION_POLICY_MARKER HIGH_RANK_MARKER",
    // At 24 months both higher-ranked rows are ineligible: the infant age
    // range ends at 12 months, and the caregiver row has the wrong target.
    ageMonths: 24,
    context: { target: "child", japanApplicability: true },
    limit: 1,
  }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(highRankIneligible.body.results.length, 1);
  assert.equal(
    ["TEST infant section", "TEST caregiver section", "TEST Japan-inapplicable section"]
      .includes(highRankIneligible.body.results[0].section?.heading),
    false,
    "limit is applied after ineligible high-ranked sections are filtered",
  );

  await assert.rejects(
    pool.query(
      `UPDATE evidence_sections
       SET applicability_policy = jsonb_set(
         applicability_policy, '{weiku,age}',
         '{"mode":"specific","scope":"all","minMonths":null,"maxMonths":null}'::jsonb)
       WHERE id = $1`,
      [infantResult.sectionId],
    ),
    (error: any) => error?.code === "P0001"
      && error?.message === "sections of an ever-published version are immutable",
    "published section policy is immutable",
  );

  const boundaryExcluded = await request({ question: "睡眠", ageMonths: 7, region: "日本", limit: 20 }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(resultFor(boundaryExcluded.body, jaResult?.sourceId ?? ""), undefined, "age mismatch is excluded");

  const unspecifiedAge = await request({ question: "睡眠", region: "日本", limit: 20 }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  const unknown = unspecifiedAge.body.results.find((result: any) => result.title.includes("unknown applicability"));
  assert.equal(unknown?.applicability.age, "unverified", "unknown age is not treated as all ages");
  const allAges = unspecifiedAge.body.results.find((result: any) => result.title.includes("English sleep"));
  assert.equal(allAges?.source.age.scope, "all", "all ages and unknown age remain distinct");
  assert.equal(allAges?.applicability.conditions, "unverified", "nonempty section notes keep conditions unverified");

  const wrongRegion = await request({ question: "睡眠", ageMonths: 6, region: "米国", limit: 20 }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(resultFor(wrongRegion.body, jaResult?.sourceId ?? ""), undefined, "regional mismatch is excluded");

  const current = await request({ question: "CURRENT_VERSION_ONLY" }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(current.status, 200);
  assert.ok(current.body.results.every((result: any) => result.version === "current-v2"));
  const old = await request({ question: "OLD_VERSION_ONLY" }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.deepEqual(old.body, { status: "no_results", results: [] }, "retained ever-published old version is not current");

  const checkedTranslation = await request({ question: "翻訳だけのマーカー" }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(checkedTranslation.body.results.length, 1, "checked translation does not become a second root");
  assert.equal(checkedTranslation.body.results[0].language, "en");
  const uncheckedTranslation = await request({ question: "未確認翻訳マーカー" }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.deepEqual(uncheckedTranslation.body, { status: "no_results", results: [] }, "unchecked translation is not searchable");

  const literal = await request({ question: "SQL_INJECTION_FIXTURE'; DROP TABLE evidence_sources; --" }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(literal.status, 200, "search parameters are bound");
  const scriptResult = await request({ question: "SQL_INJECTION_FIXTURE" }, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
  });
  assert.equal(scriptResult.body.results[0].originalText, `<script>throw new Error("TEST_TEXT_MUST_STAY_LITERAL")</script> SQL_INJECTION_FIXTURE`);

  for (const body of [
    { question: "睡眠", userId: ownerId },
    { question: "睡眠", unknown: "reject" },
    { question: "" },
    { question: "x".repeat(1_001) },
    { question: "睡眠", ageMonths: 1.5 },
    { question: "睡眠", ageMonths: 1_201 },
    { question: "睡眠", limit: 21 },
    { question: "睡眠", context: { conditions: ["night"], absentConditions: ["night"] } },
  ]) {
    const invalid = await request(body, {
      cookie: ownerCookie,
      requestOrigin: origin,
      fetchSite: "same-origin",
    });
    assert.equal(invalid.status, 400, "strict invalid input is rejected");
  }
  const hugeJson = await request(undefined, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
    rawBody: JSON.stringify({ question: "睡眠", padding: "x".repeat(10_000) }),
  });
  assert.equal(hugeJson.status, 413, "oversized JSON is rejected before search");
  assert.ok(!hugeJson.text.includes(tag), "oversized-input errors do not echo the question");
  const malformed = await request(undefined, {
    cookie: ownerCookie,
    requestOrigin: origin,
    fetchSite: "same-origin",
    rawBody: `{"question":"log-guard-${tag}"`,
  });
  assert.equal(malformed.status, 400);
  assert.ok(!malformed.text.includes(tag), "parser errors do not echo the question");

  const crossSite = await request({ question: "睡眠" }, {
    cookie: ownerCookie,
    requestOrigin: "https://attacker.invalid",
    fetchSite: "cross-site",
  });
  assert.equal(crossSite.status, 403, "same-origin protection rejects cross-site POST");

  assert.equal((await request({ question: "睡眠" }, { cookie: ownerCookie })).status, 403);
  const queryInput = await fetch(`${baseURL}/api/evidence/search?question=${encodeURIComponent("log-query-" + tag)}`, {
    method: "POST",
    headers: {
      cookie: ownerCookie,
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ question: "睡眠" }),
  });
  assert.equal(queryInput.status, 400, "questions in query strings are rejected");
  assert.equal((await request({ question: "睡眠" }, {
    cookie: "connect.sid=s%3Aforged.invalid",
    requestOrigin: origin,
    fetchSite: "same-origin",
  })).status, 401);

  const scanPolicy = structuredClone(emptySectionApplicabilityPolicy);
  scanPolicy.weiku.age = { mode: "specific", scope: "range", minMonths: 0, maxMonths: 1 };
  const scanDocumentPolicy = structuredClone(emptyDocumentApplicabilityPolicy);
  const scanRows = (offset: number) => Array.from({ length: offset < 2_000 ? 100 : 1 }, (_, index) => ({
    source_id: `${tag}-scan-source`,
    source_test_only: false,
    version_id: `${tag}-scan-version`,
    section_id: `${tag}-scan-section-${offset + index}`,
    original_text: "controlled scan marker",
    title: "controlled scan fixture",
    publisher: "TEST",
    original_language: "en",
    original_url: "https://example.invalid/scan",
    source_location: "TEST scan",
    section_type: "excerpt",
    heading: "TEST scan fixture",
    notes: null,
    version_label: "scan-v1",
    document_type: "fictional-test",
    authors: ["TEST"],
    external_identifier: null,
    published_on: null,
    revised_on: null,
    age_scope: "unknown",
    age_min_months: null,
    age_max_months: null,
    region_scope: "unknown",
    regions: [],
    condition_scope: "unknown",
    conditions: [],
    exceptions: [],
    certainty_level: null,
    certainty_assessment_method: null,
    certainty_assessment_source: null,
    manual_reviewed: true,
    reviewer_name: "TEST",
    reviewed_at: "2024-01-01",
    adoption_reason: "TEST",
    usage_terms: "TEST",
    section_policy_defaults: scanDocumentPolicy,
    applicability_policy: offset < 2_000 ? scanPolicy : emptySectionApplicabilityPolicy,
  }));
  const scanPool = {
    async query(queryText: string, values?: unknown[]) {
      if (queryText.includes("SELECT count(*)::integer AS expansion_count")) return { rows: [{ expansion_count: 1 }] };
      return { rows: scanRows(Number(values?.[2] ?? 0)) };
    },
  };
  const scanResponse = await searchEvidence(scanPool, {
    question: "controlled scan marker",
    ageMonths: 72,
    limit: 1,
  });
  const scanResponseAny = scanResponse as any;
  assert.equal(
    scanResponseAny.status === "results"
      || scanResponseAny.diagnostics?.reason === "candidate_scan_limit",
    true,
    "candidate scan exhaustion must not silently become no_results",
  );
  if (scanResponseAny.status === "results") assert.equal(scanResponseAny.results.length, 1);

  const contextRows = await pool.query<{ data_directory: string; session_user: string }>(
    "SELECT current_setting('data_directory') AS data_directory, session_user",
  );
  assert.match(contextRows.rows[0].data_directory, /^\/tmp\/ephemeral-postgres-[^/]+\/data$/);
  assert.match(contextRows.rows[0].session_user, /^test_owner_[0-9a-f]{16}$/);
  const fixtureGuard = await pool.query<{ allowed: boolean }>(
    "SELECT evidence_is_ephemeral_test_context() AS allowed",
  );
  assert.equal(fixtureGuard.rows[0].allowed, true, "PostgreSQL itself authorizes test-only fixtures");
  const fixtureFlags = await pool.query<{ test_only: boolean }>(
    "SELECT test_only FROM evidence_versions WHERE id = ANY($1::uuid[])",
    [insertedVersionIds],
  );
  assert.ok(fixtureFlags.rows.every((row) => row.test_only), "the fixture marker cannot be omitted");

  // Exercise the publication guard under an ordinary (non-test-owner)
  // session_user while remaining inside the same owned disposable cluster.
  // The role is intentionally left for whole-cluster teardown; no test may
  // weaken or remove the guard by dropping it mid-run.
  const guardedSource = await insertSource("ordinary-session-publication-guard");
  const guardedVersion = await insertVersion(guardedSource, {
    version: "guard-draft-v1",
    title: "架空テスト ordinary-session guard draft",
    language: "en",
    text: "架空テスト draft must not publish under an ordinary session identity.",
    testOnly: true,
    publicationStatus: "draft",
  });
  const guardRole = `evidence_guard_${randomUUID().replaceAll("-", "")}`;
  assert.match(guardRole, /^evidence_guard_[0-9a-f]{32}$/);
  const quoteRole = `"${guardRole}"`;
  await pool.query(`CREATE ROLE ${quoteRole} NOLOGIN`);
  let guardedClient: Awaited<ReturnType<typeof pool.connect>> | null = null;
  try {
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteRole}`);
    await pool.query(`GRANT SELECT, UPDATE ON TABLE public.evidence_versions TO ${quoteRole}`);
    await pool.query(`GRANT SELECT ON TABLE public.evidence_sources TO ${quoteRole}`);
    guardedClient = await pool.connect();
    await guardedClient.query(`SET SESSION AUTHORIZATION ${quoteRole}`);
    const ordinaryContext = await guardedClient.query<{ allowed: boolean; session_user: string }>(
      "SELECT evidence_is_ephemeral_test_context() AS allowed, session_user",
    );
    assert.equal(ordinaryContext.rows[0].allowed, false, "session identity, not data directory alone, authorizes test fixtures");
    assert.equal(ordinaryContext.rows[0].session_user, guardRole);
    let rejected = false;
    try {
      await guardedClient.query(
        `UPDATE public.evidence_versions
         SET publication_status = 'published', published_at = now()
         WHERE id = $1`,
        [guardedVersion.versionId],
      );
    } catch (error) {
      assert.match(
        (error as Error).message,
        /test-only evidence cannot be published outside the owned ephemeral database/,
      );
      rejected = true;
    }
    assert.equal(rejected, true, "ordinary session cannot publish a test-only draft");
    const remainsDraft = await guardedClient.query<{ publication_status: string }>(
      "SELECT publication_status FROM public.evidence_versions WHERE id = $1",
      [guardedVersion.versionId],
    );
    assert.equal(remainsDraft.rows[0].publication_status, "draft");
  } finally {
    if (guardedClient) {
      try {
        await guardedClient.query("RESET SESSION AUTHORIZATION");
      } finally {
        guardedClient.release();
      }
    }
  }
  const ownerAfterReset = await pool.query<{ session_user: string }>("SELECT session_user");
  assert.match(ownerAfterReset.rows[0].session_user, /^test_owner_[0-9a-f]{16}$/);
  const sourceRetention = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM evidence_versions WHERE id = ANY($1::uuid[])`,
    [insertedVersionIds],
  );
  assert.equal(Number(sourceRetention.rows[0].count), insertedVersionIds.length, "evidence fixtures remain retained until cluster teardown");
}

let failure: unknown = null;
try {
  await main();
} catch (error) {
  failure = error;
}
try {
  await cleanup();
} catch (error) {
  failure ||= error;
} finally {
  await pool.end();
}
if (failure) {
  const stack = typeof (failure as { stack?: unknown })?.stack === "string"
    ? (failure as { stack: string }).stack
    : "";
  const match = stack.match(/evidence-retrieval-integration\.test\.mts:(\d{1,4}):\d+/);
  console.error(`SAFE_TEST_FAILURE_LINE:${match ? Number(match[1]) : 1}`);
  process.exitCode = 1;
}