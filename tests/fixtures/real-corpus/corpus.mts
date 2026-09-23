/**
 * Strict loader for the locally prepared v0.2 corpus.  This module never
 * fetches source material: extraction must already have written the four JSON
 * files below evidence-work/v0.2.  A unit is eligible only when the extractor
 * explicitly marks it prepared.
 *
 * Required prepared-unit fields (camelCase or snake_case aliases are accepted):
 * id, sourceId, fragmentId, prepared, applicabilityPolicy, and
 * requiredContext. `requiredContext` entries contain a fragment id and a
 * narrow relationship role.  Fragments contain the licensed original text.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  emptyDocumentApplicabilityPolicy,
  evidenceApplicabilityPolicySchema,
  type EvidenceApplicabilityPolicy,
} from "../../../shared/evidence.ts";

const SOURCE_IDS = ["E01", "E02", "E03", "E04"] as const;
const ROOT = path.resolve(process.cwd(), "evidence-work", "v0.2");
const REPORT_DIRECTORY = path.join(ROOT, "test-artifacts");
const REPORT_FILE = path.join(REPORT_DIRECTORY, "real-corpus-search-report.json");

type JsonRecord = Record<string, unknown>;

export type CorpusSource = {
  id: string;
  title: string;
  version: string;
  authors: string[];
  publisher: string;
  language: "ja" | "en";
  originalUrl: string;
  publishedOn: string | null;
  revisedOn: string | null;
  documentType: string;
  externalIdentifier: string | null;
  documentPolicy: EvidenceApplicabilityPolicy;
};

export type CorpusFragment = {
  id: string;
  sourceId: string;
  originalText: string;
  heading: string | null;
  sourceLocation: string;
  notes: string | null;
  textSha256: string;
};

export type RequiredContext = {
  fragmentId: string;
  role: string;
};

export type PreparedUnit = {
  id: string;
  sourceId: string;
  fragmentId: string;
  policy: EvidenceApplicabilityPolicy;
  /** The independently reviewed logical scope, retained even when units share
   * one physical section whose persisted policy is their explicit union. */
  logicalAgeRange: { minMonths: number; maxMonths: number } | null;
  requiredContext: RequiredContext[];
  notes: string | null;
  humanApproval: null;
};

export type RealCorpus = {
  sources: Map<string, CorpusSource>;
  fragments: Map<string, CorpusFragment>;
  units: PreparedUnit[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonRecord {
  assert(isRecord(value), `${label} must be an object`);
  return value;
}

function field(value: JsonRecord, ...names: string[]) {
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  return undefined;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.trim().length > 0, `${label} must not be blank`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return text(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  assert(Array.isArray(value), `${label} must be an array`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function explicitPolicy(value: unknown, label: string): EvidenceApplicabilityPolicy {
  const parsed = evidenceApplicabilityPolicySchema.safeParse(value);
  assert(parsed.success, `${label} must contain every explicit applicability dimension`);
  return parsed.data;
}

function sourceFrom(value: unknown, fileId: string): CorpusSource {
  const input = record(value, `${fileId}.sources[]`);
  const language = field(input, "language");
  assert(language === "ja" || language === "en", `${fileId} source language must be ja or en`);
  const originalUrl = text(field(input, "url", "originalUrl", "original_url"), `${fileId} source URL`);
  assert(/^https:\/\//u.test(originalUrl), `${fileId} source URL must be HTTPS`);
  return {
    id: text(field(input, "id", "sourceId", "source_id"), `${fileId} source id`),
    title: text(field(input, "title"), `${fileId} source title`),
    version: text(field(input, "version"), `${fileId} source version`),
    authors: stringArray(field(input, "authors"), `${fileId} source authors`),
    publisher: text(
      field(input, "publisher", "issuer", "issuing_context", "issuingContext", "institution", "journal"),
      `${fileId} source publisher`,
    ),
    language,
    originalUrl,
    publishedOn: nullableText(field(input, "publication_date", "publishedOn", "published_on"), `${fileId} publication date`),
    revisedOn: nullableText(
      field(input, "revision_date", "revisionDate", "revisedOn", "revised_on"),
      `${fileId} revision date`,
    ),
    documentType: text(field(input, "document_type", "documentType", "kind", "source_type", "sourceType"), `${fileId} document type`),
    externalIdentifier: nullableText(field(input, "external_identifier", "externalIdentifier", "doi", "landing"), `${fileId} identifier`),
    // The manifests do not claim a document-wide applicability policy. Keep
    // every dimension explicitly unknown rather than manufacturing policy from
    // descriptive prose; the selected unit policy below carries only reviewed
    // target/age/condition facts.
    documentPolicy: (() => {
      const supplied = field(input, "applicability_policy", "applicabilityPolicy", "document_applicability_policy", "documentApplicabilityPolicy");
      const policy = supplied === undefined
        ? structuredClone(emptyDocumentApplicabilityPolicy)
        : explicitPolicy(supplied, `${fileId} source policy`);
      // Rights are checked metadata, not adoption approval or clinical scope.
      const license = record(field(input, "license"), `${fileId} license`);
      policy.usage = {
        mode: "specific",
        terms: [
          text(license.name, `${fileId} license name`),
          text(field(license, "license_url", "url"), `${fileId} license URL`),
          text(license.attribution, `${fileId} attribution`),
          text(license.change_record, `${fileId} change record`),
        ].join("\n"),
        exceptions: ["図表・写真・ロゴ・別途権利表示のある第三者素材は今回の対象外。"],
      };
      return policy;
    })(),
  };
}

function fragmentFrom(value: unknown, fileId: string): CorpusFragment {
  const input = record(value, `${fileId}.fragments[]`);
  const originalText = text(
    field(input, "original_text", "originalText"),
    `${fileId} fragment original text`,
  );
  // The fixture is specifically a real licensed corpus. Marking or decorating
  // an original with a test prefix would alter the provenance-bearing text.
  assert(!/^\s*(?:TEST|架空テスト)\b/iu.test(originalText), `${fileId} original text must not carry a test prefix`);
  const textSha256 = text(field(input, "text_sha256", "textSha256"), `${fileId} fragment text SHA-256`);
  assert.match(textSha256, /^[a-f0-9]{64}$/u, `${fileId} fragment SHA-256 must be lowercase hexadecimal`);
  assert.equal(
    createHash("sha256").update(originalText, "utf8").digest("hex"),
    textSha256,
    `${fileId} fragment original text must match its supplied SHA-256`,
  );
  return {
    id: text(field(input, "id", "fragmentId", "fragment_id"), `${fileId} fragment id`),
    sourceId: text(field(input, "source_id", "sourceId"), `${fileId} fragment source id`),
    originalText,
    heading: nullableText(
      field(input, "heading") ?? (isRecord(field(input, "locator")) ? field(field(input, "locator") as JsonRecord, "heading") : undefined),
      `${fileId} fragment heading`,
    ),
    sourceLocation: (() => {
      const locator = field(input, "source_location", "sourceLocation", "locator", "citation");
      return isRecord(locator) ? JSON.stringify(locator) : text(locator, `${fileId} fragment citation`);
    })(),
    notes: nullableText(field(input, "notes"), `${fileId} fragment notes`),
    textSha256,
  };
}

function requiredContextFrom(value: unknown, label: string): RequiredContext {
  if (typeof value === "string") return { fragmentId: text(value, `${label} fragment id`), role: "required_context" };
  const input = record(value, label);
  return {
    fragmentId: text(field(input, "fragment_id", "fragmentId", "required_fragment_id", "requiredFragmentId"), `${label} fragment id`),
    role: text(field(input, "role"), `${label} role`),
  };
}

function reviewedUnitPolicy(unitId: string): EvidenceApplicabilityPolicy {
  const policy = structuredClone(emptyDocumentApplicabilityPolicy);
  const setTarget = (...values: Array<"child" | "caregiver">) => {
    policy.weiku.target = { mode: "specific", values };
  };
  if (unitId === "E02-S01" || unitId === "E02-S02") {
    setTarget("child");
    const logicalRange = unitId === "E02-S01"
      ? { minMonths: 12, maxMonths: 35 }
      : { minMonths: 36, maxMonths: 71 };
    policy.weiku.age = { mode: "specific", scope: "range", ...logicalRange };
  } else if (unitId === "E02-S03") {
    setTarget("caregiver");
  } else if (/^E0[34]-S0[12]$/u.test(unitId)) {
    // Shared research eligibility exclusions live on the version, not only
    // one outcome. All unconfirmed positive conditions remain unknown.
  } else if (/^E01-S0[1-4]$/u.test(unitId)) {
    setTarget("child", "caregiver");
  } else {
    assert.fail(`no reviewed structured policy is defined for ${unitId}`);
  }
  return policy;
}

function logicalAgeRange(unitId: string) {
  if (unitId === "E02-S01") return { minMonths: 12, maxMonths: 35 };
  if (unitId === "E02-S02") return { minMonths: 36, maxMonths: 71 };
  return null;
}

function noteText(value: unknown, label: string) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return text(value, label);
  if (Array.isArray(value)) {
    const notes = value.map((item, index) => text(item, `${label}[${index}]`));
    return notes.length ? notes.join("\n") : null;
  }
  assert.fail(`${label} must be a string or string array`);
}

function manifestNotes(input: JsonRecord, fileId: string) {
  const editorial = noteText(
    field(input, "notes", "editorial_notes", "editorialNotes", "source_annotations", "sourceAnnotations"),
    `${fileId} unit notes`,
  );
  const preservedFields: Array<[string, unknown]> = [
    ["Manifest population", field(input, "population")],
    ["Manifest conditions", field(input, "conditions")],
    ["Manifest exclusions", field(input, "exclusions")],
    ["Manifest allowed role", field(input, "allowed_role", "allowedRole")],
  ].flatMap(([label, value]) => {
    if (value === undefined || value === null) return [];
    if (typeof value === "string") return [`${label}: ${value}`];
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return [`${label}: ${(value as string[]).join("; ")}`];
    }
    assert.fail(`${fileId} ${label} must be a string or string array`);
  });
  return [editorial, ...preservedFields].filter((note): note is string => Boolean(note)).join("\n") || null;
}

function unitFrom(value: unknown, fileId: string, referenceNotes = ""): PreparedUnit | null {
  const input = record(value, `${fileId}.units[]`);
  const prepared = field(input, "prepared", "is_prepared", "isPrepared", "ingest_ready", "ingestReady", "status");
  if (prepared !== true && prepared !== "prepared") return null;
  const approval = field(input, "human_approval", "humanApproval");
  assert.equal(approval, null, `${fileId} prepared unit must retain human_approval: null`);
  const contexts = field(input, "required_context", "requiredContext", "required_context_ids");
  assert(Array.isArray(contexts), `${fileId} prepared unit must explicitly declare required context`);
  const id = text(field(input, "id", "unitId", "unit_id"), `${fileId} unit id`);
  return {
    id,
    sourceId: text(field(input, "source_id", "sourceId"), `${fileId} unit source id`),
    fragmentId: text(field(input, "fragment_id", "fragmentId"), `${fileId} unit fragment id`),
    policy: (() => {
      const supplied = field(input, "applicability_policy", "applicabilityPolicy");
      return supplied === undefined ? reviewedUnitPolicy(id) : explicitPolicy(supplied, `${fileId} unit policy`);
    })(),
    logicalAgeRange: logicalAgeRange(id),
    requiredContext: contexts.map((context, index) => requiredContextFrom(context, `${fileId} required context ${index}`)),
    notes: [manifestNotes(input, fileId), referenceNotes].filter(Boolean).join("\n") || null,
    humanApproval: null,
  };
}

function readFileCorpus(fileId: typeof SOURCE_IDS[number]) {
  const file = path.join(ROOT, `${fileId}.json`);
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${fileId} corpus file must be a regular file`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const root = record(parsed, `${fileId} corpus`);
  const sources = field(root, "sources");
  const fragments = field(root, "fragments");
  const units = field(root, "units");
  assert(Array.isArray(sources) && Array.isArray(fragments) && Array.isArray(units), `${fileId} must contain sources, fragments, and units arrays`);
  return {
    // AASM is verification-only, not an additional licensed ingest source.
    sources: sources
      .filter((source) => field(record(source, `${fileId} source`), "id", "sourceId", "source_id") === fileId)
      .map((source) => sourceFrom(source, fileId)),
    fragments: fragments.map((fragment) => fragmentFrom(fragment, fileId)),
    units: units.map((unit) => {
      const value = record(unit, `${fileId} unit`);
      const ids = field(value, "verification_reference_ids") ?? [];
      assert(Array.isArray(ids), "verification references must be explicit IDs");
      const notes = ids.map((id) => {
        const reference = sources.find((source) => field(record(source, "reference"), "id") === id);
        assert(reference, "a verification-only source must resolve");
        const url = text(field(record(reference, "reference"), "url"), "verification URL");
        assert(url.startsWith("https://"), "verification URL must be HTTPS");
        return `照合専用出典: ${url}（本文は取り込まず、原文と区別した確認注記として保持）`;
      }).join("\n");
      return unitFrom(unit, fileId, notes);
    }).filter((unit): unit is PreparedUnit => unit !== null),
  };
}

export function loadPreparedRealCorpus(): RealCorpus {
  const sources = new Map<string, CorpusSource>();
  const fragments = new Map<string, CorpusFragment>();
  const units: PreparedUnit[] = [];
  for (const sourceFileId of SOURCE_IDS) {
    const file = readFileCorpus(sourceFileId);
    const ingestibleSources = file.sources.filter((source) => source.id === sourceFileId);
    assert.equal(ingestibleSources.length, 1, `${sourceFileId} must have exactly one ingestible source identity`);
    for (const source of ingestibleSources) {
      assert.equal(source.id, sourceFileId, `${sourceFileId} source id must preserve the v0.2 identity`);
      assert(!sources.has(source.id), `${source.id} source identity was duplicated`);
      sources.set(source.id, source);
    }
    for (const fragment of file.fragments) {
      assert.equal(fragment.sourceId, sourceFileId, `${fragment.id} must belong to its file source`);
      assert(!fragments.has(fragment.id), `${fragment.id} fragment identity was duplicated`);
      fragments.set(fragment.id, fragment);
    }
    units.push(...file.units);
  }
  assert.equal(units.length, 11, "v0.2 must ingest exactly eleven explicitly prepared logical units");
  const expectedIds = new Set([
    "E01-S01", "E01-S02", "E01-S03", "E01-S04",
    "E02-S01", "E02-S02", "E02-S03",
    "E03-S01", "E03-S02", "E04-S01", "E04-S02",
  ]);
  assert.deepEqual(new Set(units.map((unit) => unit.id)), expectedIds, "prepared logical unit identities must be complete");
  for (const unit of units) {
    assert(sources.has(unit.sourceId), `${unit.id} refers to an unknown source`);
    const fragment = fragments.get(unit.fragmentId);
    assert(fragment, `${unit.id} refers to an unknown fragment`);
    assert.equal(fragment.sourceId, unit.sourceId, `${unit.id} cannot cross source boundaries`);
    for (const required of unit.requiredContext) {
      assert(fragments.has(required.fragmentId), `${unit.id} required context must be an extracted fragment`);
      assert.notEqual(required.fragmentId, unit.fragmentId, `${unit.id} cannot self-link required context`);
    }
  }
  const sleepOne = units.find((unit) => unit.id === "E02-S01");
  const sleepTwo = units.find((unit) => unit.id === "E02-S02");
  assert(sleepOne && sleepTwo, "both E02 logical age scopes are required");
  assert.equal(sleepOne.fragmentId, sleepTwo.fragmentId, "E02 age units share exactly one original fragment");
  for (const unit of [sleepOne, sleepTwo]) {
    assert(unit.logicalAgeRange, `${unit.id} must retain a reviewed logical age range`);
  }
  return { sources, fragments, units };
}

function assertSafeReportDirectory() {
  const parent = path.dirname(REPORT_DIRECTORY);
  const parentStat = fs.lstatSync(parent);
  assert(parentStat.isDirectory() && !parentStat.isSymbolicLink(), "real-corpus report parent must be a real directory");
  if (fs.existsSync(REPORT_DIRECTORY)) {
    const stat = fs.lstatSync(REPORT_DIRECTORY);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "real-corpus report directory must not be a symlink");
  } else {
    fs.mkdirSync(REPORT_DIRECTORY, { mode: 0o700 });
  }
  fs.chmodSync(REPORT_DIRECTORY, 0o700);
}

/**
 * Persist only a deliberately shaped report of fixed public questions and
 * licensed corpus records. It is never written to stdout/stderr; the managed
 * launcher emits only pass/fail and a bounded source line. The main agent may
 * collect this 0600 artifact after an authorized managed execution.
 */
export function writeRealCorpusSearchReport(report: unknown) {
  assertSafeReportDirectory();
  const temporary = path.join(REPORT_DIRECTORY, `.real-corpus-search-report-${process.pid}.next`);
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, REPORT_FILE);
  fs.chmodSync(REPORT_FILE, 0o600);
  return REPORT_FILE;
}