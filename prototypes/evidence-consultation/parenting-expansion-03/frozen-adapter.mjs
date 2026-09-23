import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, output, sha, preservation } from "./prepare.mjs";
const oldDirectory = path.join(root, "prototypes/evidence-consultation/parenting-expansion-02");
const directory = path.join(root, "prototypes/evidence-consultation/parenting-expansion-03");
function once(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `unique frozen anchor missing: ${anchor.slice(0, 90)}`);
  return source.replace(anchor, replacement);
}
// Pure preparation: returns adapted source without importing or executing a DB launcher.
// The owner must register this source adapter before the canonical ephemeral child.
export function adaptFrozenModule(name) {
  preservation();
  assert(["adapter-loader.mjs", "runner-child.mjs", "verify.mts", "verify-entry.mjs"].includes(name));
  const source = fs.readFileSync(path.join(oldDirectory, name), "utf8");
  let adapted = source;
  if (name === "adapter-loader.mjs") {
    adapted = once(adapted, "const directory = path.dirname(fileURLToPath(import.meta.url));", `const directory = ${JSON.stringify(directory)};`);
    adapted = once(adapted, 'path.join(directory, "native-integrity.json")', "__FROZEN_NATIVE_INTEGRITY__");
    adapted = adapted.replaceAll("parenting-expansion-02", "parenting-expansion-03");
    // Native integrity remains the frozen original, not a newly blessed checksum.
    adapted = once(adapted, "__FROZEN_NATIVE_INTEGRITY__", `path.join(${JSON.stringify(oldDirectory)}, "native-integrity.json")`);
  } else if (name === "runner-child.mjs") {
    adapted = once(adapted, "const directory = path.dirname(fileURLToPath(import.meta.url));", `const directory = ${JSON.stringify(directory)};`);
    adapted = adapted.replaceAll('"parenting-expansion-02"', '"parenting-expansion-03"');
  } else if (name === "verify-entry.mjs") {
    adapted = adapted.replaceAll('from "./lifecycle-finalizer.mjs"', 'from "../parenting-expansion-02/lifecycle-finalizer.mjs"');
  } else if (name === "verify.mts") {
    adapted = once(adapted, 'import { loadExpansionPrepared, ROOT, WORK } from "./prepared-loader.mjs";',
      'import { loadExpansionPrepared, ROOT, WORK as PRIOR_WORK } from "../parenting-expansion-02/prepared-loader.mjs";\nimport { loadMunicipal, work as WORK } from "./municipal-input.mjs";\nimport { municipalItems, runMunicipalChecks } from "./municipal-harness.mjs";');
    adapted = once(adapted, 'from "./lifecycle-finalizer.mjs"', 'from "../parenting-expansion-02/lifecycle-finalizer.mjs"');
    adapted = once(adapted, 'from "./source-display.mjs"', 'from "../parenting-expansion-02/source-display.mjs"');
    adapted = once(adapted, 'path.join(WORK, "overseas/retrieval-contract.json")', 'path.join(PRIOR_WORK, "overseas/retrieval-contract.json")');
    adapted = once(adapted, "async function main() {\n  await stage();",
      "async function main() {\n  const municipal = loadMunicipal();\n  const additions = municipalItems(municipal.input);\n  items.push(...additions);\n  await stage();");
    adapted = once(adapted, "  const sectionIds = new Set(items.map(item => item.sectionId!));",
      "  const municipalChecks = await runMunicipalChecks({pool, runId, items: additions, input: municipal.input, draftSearch: searchEvidenceExpansionDrafts, normalSearch: searchEvidence});\n  const sectionIds = new Set(items.map(item => item.sectionId!));");
    adapted = once(adapted, "    usage: usageMetadata(item),", "    usage: usageMetadata(item),\n    municipalGeography: item.record?.geography ?? null,\n    municipalCoverage: item.record?.coverage ?? null,");
    adapted = once(adapted, "function usageMetadata(item: Item) {", "function usageMetadata(item: Item) {\n  if (item.record) return { rights: item.record.permission, copyrightPermission: item.record.permission.copyrightPermission, contentVerification: item.record.permission.contentVerification, adoptionApproval: item.record.permission.adoptionApproval, publicationStatus: item.record.permission.publicationStatus, externalAI: item.record.permission.externalAI, displayMode: 'private_factual_summary_not_official_advice' };");
    adapted = once(adapted, '    format: "weiku.parenting-expansion.validation.v1", invocationNonce, runId,',
      '    format: "weiku.parenting-expansion.validation.v1", invocationNonce, runId,\n    municipal: municipalChecks, priorExpansionCurrentUnitsRetained: 20, permissionsDelta: municipal.input.records.map(r => ({id:r.id, permission:r.permission})),');
    adapted = once(adapted, "    normalSearchCandidates: 0, factReadyUnits: 0,", "    normalSearchCandidates: 0, factReadyUnits: 0,\n    priorExpansionCurrentUnitsRetained: 20, newMunicipalUnits: additions.length, totalCurrentUnits: 20 + additions.length,");
    adapted = once(adapted, "      unitId: item.unit.id, documentId: item.document.id, isNew: item.isNew,",
      "      unitId: item.unit.id, documentId: item.document.id, isNew: item.isNew || Boolean(item.record), isMunicipal: Boolean(item.record),");
    adapted = once(adapted, '  atomicJson(path.join(WORK, "validation/result.json"), result, invocationNonce!);',
      '  atomicJson(path.join(WORK, "validation/permissions-delta.json"), {invocationNonce, runId, priorPermissionsUnchanged: true, additions: result.permissionsDelta}, invocationNonce!);\n  atomicJson(path.join(WORK, "validation/result.json"), result, invocationNonce!);');
  }
  assert.notEqual(adapted, source, `${name}: no adaptation (preflight should be reused directly)`);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `prepared-adaptation-${name}.json`), JSON.stringify({
    originalPath: path.relative(root, path.join(oldDirectory, name)),
    originalSha256: sha(source), adaptedSha256: sha(adapted), executed: false,
  }, null, 2) + "\n");
  return adapted;
}