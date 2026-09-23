import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { root } from "./prepare.mjs";
import { prepareAdapter } from "./checked-adapter.mjs";

const directory = path.join(root, "prototypes/evidence-consultation/parenting-expansion-04");
const priorDirectory = path.join(root, "prototypes/evidence-consultation/parenting-expansion-02");
export function adaptFrozenModule(name) {
  assert(["adapter-loader.mjs", "runner-child.mjs", "verify.mts"].includes(name));
  const file = `prototypes/evidence-consultation/parenting-expansion-02/${name}`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const edits = [];
  const add = (anchor, replacement, reason) => edits.push({ anchor, replacement, reason });
  if (name === "adapter-loader.mjs" || name === "runner-child.mjs") {
    let adapted = source;
    const anchor = "const directory = path.dirname(fileURLToPath(import.meta.url));";
    assert.equal(adapted.split(anchor).length, 2);
    adapted = adapted.replace(anchor, `const directory = ${JSON.stringify(directory)};`);
    if (name === "adapter-loader.mjs") {
      const integrity = 'path.join(directory, "native-integrity.json")';
      assert.equal(adapted.split(integrity).length, 2);
      adapted = adapted.replace(integrity, `path.join(${JSON.stringify(priorDirectory)}, "native-integrity.json")`);
    }
    const occurrences = [...adapted.matchAll(/parenting-expansion-02/gu)].length;
    // Preserve the only literal priorDirectory in native-integrity path.
    adapted = adapted.replaceAll("parenting-expansion-02", "parenting-expansion-04");
    if (name === "adapter-loader.mjs") adapted = adapted.replace(
      `path.join(${JSON.stringify(directory)}, "native-integrity.json")`,
      `path.join(${JSON.stringify(priorDirectory)}, "native-integrity.json")`);
    assert(occurrences > 0);
    add(source, adapted, `04 group/output/loader wiring (${occurrences} pinned group occurrences); original native integrity, ownership, ancestry and cleanup retained`);
  } else {
    add('import { loadExpansionPrepared, ROOT, WORK } from "./prepared-loader.mjs";',
      'import { loadExpansionPrepared, ROOT, WORK as PRIOR_WORK } from "../parenting-expansion-02/prepared-loader.mjs";\nimport { loadInputs, work as WORK } from "./input.mjs";\nimport { expansionItems, runExpansionChecks } from "./harness.mjs";',
      "retain 02 corpus plus frozen 03 municipal and new source-neutral 04 inputs");
    add('from "./lifecycle-finalizer.mjs"', 'from "../parenting-expansion-02/lifecycle-finalizer.mjs"', "reuse nonce finalizer");
    add('from "./source-display.mjs"', 'from "../parenting-expansion-02/source-display.mjs"', "reuse frozen prior display");
    add('path.join(WORK, "overseas/retrieval-contract.json")', 'path.join(PRIOR_WORK, "overseas/retrieval-contract.json")', "retain old consultation contract");
    add("function usageMetadata(item: Item) {",
      "function usageMetadata(item: Item) {\n  if (item.record) return { rights: item.record.permission, ...item.record.permission, displayMode: 'private_editorial_summary_separate_audit_provenance' };",
      "preserve each added source permission without resetting prior facts");
    add("async function main() {\n  await stage();",
      "async function main() {\n  const expansion = loadInputs();\n  const additions = expansionItems(expansion);\n  items.push(...additions);\n  await stage();",
      "load all 35 retained current units plus historical unit before new additions");
    add("  const sectionIds = new Set(items.map(item => item.sectionId!));",
      "  const expansionChecks = await runExpansionChecks({ pool, runId, items: additions, input: expansion, draftSearch: searchEvidenceExpansionDrafts, normalSearch: searchEvidence });\n  const sectionIds = new Set(items.map(item => item.sectionId!));",
      "measure new and retained municipal queries, scope controls and draft state");
    add("      const keyword = await upsertEvidenceKeyword(pool, {",
      "      if (item.record?.inputKind) {\n        const existing = await pool.query('SELECT concept_id FROM evidence_keywords WHERE language=$1 AND term=$2', [/[\\u3040-\\u30ff\\u3400-\\u9fff]/u.test(term) ? 'ja' : 'en', term]);\n        assert.equal(existing.rows.length, 0, `${item.unit.id}: cannot reassign an existing keyword owner`);\n      }\n      const keyword = await upsertEvidenceKeyword(pool, {",
      "measure and reject prior global keyword-owner collisions before new upsert");
    add('    format: "weiku.parenting-expansion.validation.v1", invocationNonce, runId,',
      '    format: "weiku.parenting-expansion.validation.v1", invocationNonce, runId,\n    expansion04: expansionChecks, inputHashes: expansion.hashes, permissionsDelta: expansion.additions.map(r => ({ id: r.id, permission: r.permission })),',
      "nonce-bound expansion counts and source-specific permission delta");
    add("      unitId: item.unit.id, documentId: item.document.id, isNew: item.isNew,",
      "      unitId: item.unit.id, documentId: item.document.id, isNew: item.isNew || Boolean(item.record?.inputKind),",
      "new-unit reporting without altering retained overseas query selection");
    add("    normalSearchCandidates: 0, factReadyUnits: 0,",
      "    normalSearchCandidates: 0, factReadyUnits: 0,\n    priorExpansionCurrentUnitsRetained: 35, newExpansion04Units: expansion.additions.length, totalCurrentUnits: 35 + expansion.additions.length, expansion04Queries: expansionChecks.queries.length,\n    legacyCompatibilityScope: 'priorCurrentUnits/newEligibleUnits/consultationQueries/paraphraseQueries are retained expansion02 fields only',",
      "unambiguous whole-run vs frozen legacy summary counts");
    add('  atomicJson(path.join(WORK, "validation/result.json"), result, invocationNonce!);',
      '  atomicJson(path.join(WORK, "validation/permissions-delta.json"), { invocationNonce, runId, priorPermissionsUnchanged: true, additions: result.permissionsDelta }, invocationNonce!);\n  atomicJson(path.join(WORK, "validation/result.json"), result, invocationNonce!);',
      "append 04 permissions only");
  }
  return prepareAdapter(file, edits, name);
}