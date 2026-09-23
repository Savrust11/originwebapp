import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const output = path.join(root, "evidence-work/cfa100-06/browser");
const validation = path.join(root, "evidence-work/cfa100-06/validation");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// No fallback to old measured runs or question-indexed replay is permitted.
export async function buildBrowser({ searchModule, searchExport = "createFixtureSearch" }) {
  assert(searchModule, "Pass the shared measured-fixture search module explicitly");
  const files = Object.fromEntries(["cases", "cfa-cases", "source-bindings", "dictionary-fixture"].map(name => {
    const bytes = fs.readFileSync(path.join(validation, `${name}.json`));
    return [name, { data: JSON.parse(bytes), sha256: hash(bytes) }];
  }));
  const measured = files.cases.data;
  assert(measured.invocationNonce && measured.runId, "Final measured run identity is required");
  for (const name of ["cfa-cases", "source-bindings", "dictionary-fixture"]) {
    assert.equal(files[name].data.invocationNonce, measured.invocationNonce, `${name} must belong to this measured run`);
  }
  const provenance = {
    mode: "actual-final-db-fixture-offline-evidence-retrieval-no-model",
    runId: measured.runId, invocationNonce: measured.invocationNonce,
    measuredCounts: measured.counts,
    cfaCounts: files["cfa-cases"].data.counts,
    artifacts: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, file.sha256])),
    formalAdoption: "not_approved", publication: "not_published", modelAPICalls: 0,
  };
  const entry = `
    import { boot } from ${JSON.stringify(path.join(directory, "app.mjs"))};
    import { ${searchExport} } from ${JSON.stringify(path.resolve(root, searchModule))};
    const fixture = ${JSON.stringify(files["dictionary-fixture"].data)};
    const bindings = ${JSON.stringify(files["source-bindings"].data)};
    const search = ${searchExport}({ fixture, bindings });
    window.__CFA_BROWSER__ = boot({ search, provenance: ${JSON.stringify(provenance)} });
  `;
  const compiled = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: "offline-entry.mjs" },
    bundle: true, write: false, platform: "browser", format: "iife", target: "es2022",
  });
  const font = fs.readFileSync(path.join(root, "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2"));
  const html = fs.readFileSync(path.join(directory, "index.html"), "utf8")
    .replace("/* FONT */", `@font-face{font-family:"Noto Sans JP";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")}`)
    .replace("<!-- BUNDLE -->", `<script>${compiled.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "offline.html"), html);
  fs.writeFileSync(path.join(output, "build-provenance.json"), JSON.stringify({ ...provenance, offlineHtmlSha256: hash(html) }, null, 2));
  return { output, provenance };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildBrowser({ searchModule: process.argv[2], searchExport: process.argv[3] });
}