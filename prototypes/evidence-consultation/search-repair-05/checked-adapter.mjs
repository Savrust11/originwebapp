import { pinned, once, directory, output, root, sha } from "./prepare.mjs";
import fs from "node:fs";
import path from "node:path";
export function adapt(name) {
  const relative = `prototypes/evidence-consultation/parenting-expansion-02/${name}`;
  const original = pinned(relative);
  let source = original;
  if (name === "adapter-loader.mjs" || name === "runner-child.mjs") {
    source = once(source, "const directory = path.dirname(fileURLToPath(import.meta.url));", `const directory = ${JSON.stringify(directory)};`);
    source = source.replaceAll("parenting-expansion-02", "search-repair-05");
    if (name === "adapter-loader.mjs") {
      source = once(source, 'path.join(directory, "native-integrity.json")', `path.join(${JSON.stringify(path.join(root,"prototypes/evidence-consultation/parenting-expansion-02"))}, "native-integrity.json")`);
      source = once(source, '  record(relative, original, source, adaptation);', `  if (relative === "server/evidence/search.ts") {
    const { repairSearch } = await import(${JSON.stringify(path.join(directory,"search-adapter.mjs"))});
    source = repairSearch(source);
    adaptation += " Isolated repair export only; ordinary/native draft exports and guard preserved.";
  }
  record(relative, original, source, adaptation);`);
    }
  } else if (name === "verify.mts") {
    source = once(source, 'import { loadExpansionPrepared, ROOT, WORK } from "./prepared-loader.mjs";',
      'import { loadExpansionPrepared, ROOT, WORK } from "../parenting-expansion-02/prepared-loader.mjs";\nimport { output } from "./prepare.mjs";\nimport { getInputs, runCases } from "./harness.mjs";');
    source = source.replaceAll('from "./lifecycle-finalizer.mjs"', 'from "../parenting-expansion-02/lifecycle-finalizer.mjs"')
      .replaceAll('from "./source-display.mjs"', 'from "../parenting-expansion-02/source-display.mjs"');
    source = once(source, 'import { searchEvidence, searchEvidenceExpansionDrafts }', 'import { searchEvidence, searchEvidenceExpansionDrafts, searchEvidenceRepairedDrafts, expansionTrace }');
    source = once(source, "function usageMetadata(item: Item) {", "function usageMetadata(item: Item) {\n  if (item.record) return { ...item.record.permission, rights: item.record.permission, displayMode: 'private_editorial_summary_separate_audit_provenance' };");
    const start = source.indexOf("async function main() {");
    const end = source.indexOf("\nlet failure: unknown;", start);
    if (start < 0 || end < 0) throw Error("main anchors absent");
    source = source.slice(0,start) + `async function main() {
  const expansion = getInputs();
  items.push(...expansion.items);
  await stage();
  await vocabulary();
  await runCases({pool, runId, invocationNonce, items, input: expansion.input,
    nativeSearch: searchEvidenceExpansionDrafts, repairedSearch: searchEvidenceRepairedDrafts,
    normalSearch: searchEvidence, expansionTrace});
}
` + source.slice(end);
  } else throw Error("unsupported adapter");
  fs.writeFileSync(path.join(output,`checked-${name}.json`),JSON.stringify({relative,originalSha256:sha(original),adaptedSha256:sha(source),nativeProductionFilesEdited:false},null,2));
  return source;
}