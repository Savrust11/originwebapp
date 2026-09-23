import fs from "node:fs";
import { createHash } from "node:crypto";
import { SELECTED_UNIT_IDS, SCENE_UNITS } from "./policy.mjs";

const BINDINGS = "evidence-work/cfa100-06/validation/source-bindings.json";
const RIGHTS = "evidence-work/private-parenting-trial-11/plan/rights-plan.json";
const WALES = "evidence-work/parenting-expansion-04/practical/prepared.json";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const forbidden = /(自治体|市区町村|都道府県|municipal|地域子育て支援|動画終了|未採用)/iu;

export function loadSelectedOriginals() {
  const bytes = fs.readFileSync(BINDINGS);
  const binding = JSON.parse(bytes);
  const rows = [...binding.units, ...binding.baselineUnits];
  const rightsBytes = fs.readFileSync(RIGHTS);
  const rights = JSON.parse(rightsBytes);
  if (rights.format !== "weiku.private-parenting-trial.rights-plan.v2") throw new Error("RIGHTS_PLAN_SCHEMA");
  const wales = JSON.parse(fs.readFileSync(WALES, "utf8"));
  const walesRecord = (wales.records ?? wales.items ?? wales.sources ?? [])
    .find(item => item.id === "wales-peer-sharing-rehearsal");
  const selected = new Map();
  for (const unitId of SELECTED_UNIT_IDS) {
    const matches = rows.filter(row => row.unitId === unitId);
    const rightsSource = rights.sources.find(source => source.unitIds.includes(unitId));
    const textRef = rightsSource?.originalTextRefs.find(ref => ref.unitId === unitId);
    if (matches.length !== 1 && !(unitId === "CFA100-S05-C01" && matches.length === 0)) {
      throw new Error(`SELECTED_UNIT_BINDING_COUNT:${unitId}:${matches.length}`);
    }
    const row = matches[0] ?? {
      unitId,
      sourceId: rightsSource?.sourceId,
      versionId: rightsSource?.versionId,
      sectionId: binding.contextOnly?.sectionId,
      originalSha256: textRef?.sha256,
      isMunicipal: false,
    };
    const originalText = row.originalText ?? textRef?.text
      ?? (unitId === "wales-peer-sharing-rehearsal" ? walesRecord?.originalText : null);
    if (!rightsSource?.localAssemblyAllowed || row.isMunicipal === true
      || typeof originalText !== "string" || !originalText.trim()) {
      throw new Error(`INVALID_SELECTED_ORIGINAL:${unitId}`);
    }
    if (forbidden.test(`${row.title ?? ""}\n${originalText}`)) {
      throw new Error(`EXCLUDED_SOURCE_CONTENT:${unitId}`);
    }
    if (typeof row.originalSha256 === "string" && sha(Buffer.from(originalText)) !== row.originalSha256) {
      throw new Error(`ORIGINAL_HASH_MISMATCH:${unitId}`);
    }
    selected.set(unitId, Object.freeze({
      ...row,
      originalText,
      sourceGroupId: rightsSource.id,
      externalSendDecision: rightsSource.externalSendDecision,
      attributionRule: rightsSource.inputArchiveDisplayConditions.display,
    }));
  }
  return Object.freeze({
    path: BINDINGS,
    sha256: sha(bytes),
    rightsPath: RIGHTS,
    rightsSha256: sha(rightsBytes),
    selected,
  });
}

export function sourceBlocksForScene(sceneId, loaded = loadSelectedOriginals()) {
  const ids = SCENE_UNITS[sceneId];
  if (!ids) throw new Error("UNKNOWN_SCENE");
  const rows = ids.map(id => loaded.selected.get(id));
  if (rows.some(row => !row)) throw new Error("SCENE_SOURCE_MISSING");
  if (sceneId === "independent-attempt" && !ids.includes("CFA100-S05-C01")) {
    throw new Error("MANDATORY_CONTEXT_MISSING");
  }
  return Object.freeze({
    packetBlocks: Object.freeze(rows.map((row, index) => Object.freeze({
      label: `資料${index + 1}`,
      originalText: row.originalText,
    }))),
    sidecar: Object.freeze(rows.map(row => Object.freeze({
      unitId: row.unitId,
      sourceId: row.sourceId,
      versionId: row.versionId,
      originalSha256: row.originalSha256,
      title: row.sourceTitle ?? row.title ?? null,
      publisher: row.publisher ?? null,
      originalUrl: row.originalUrl ?? null,
      attribution: row.attribution ?? null,
      attributionRule: row.attributionRule,
      externalSendDecision: row.externalSendDecision,
      localAssemblyOnly: true,
      externalTransferAuthorized: false,
    }))),
  });
}