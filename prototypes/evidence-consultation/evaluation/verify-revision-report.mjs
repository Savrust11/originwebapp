#!/usr/bin/env node

/**
 * Offline integrity and browser verification for revised-reading-results.html.
 * It performs no provider/API/DB/secret access and does not modify artifacts.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const base = path.join(root, "evidence-work/model-evaluation");
const runId = process.argv[2] ?? "source-roles-20260918";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) throw new Error("invalid_run_id");
const prep = path.join(base, "revision-preparation", runId);
const reportPath = path.join(base, "revised-reading-results.html");
const resultPath = path.join(base, "revision-results", runId, "Q05.json");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const escaped = value => String(value).replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const [report, prepared, catalogFile, result, oldQ05, manifest] = await Promise.all([
  readFile(reportPath, "utf8"),
  json(path.join(prep, "prepared-package.json")),
  json(path.join(prep, "citable-catalog.json")),
  json(resultPath),
  json(path.join(base, "operational-results/Q05.json")),
  json(path.join(prep, "manifest.json")),
]);
const catalog = catalogFile.catalog ?? catalogFile;
const requestByCase = new Map(prepared.requests.map(item => [item.case_id, item]));
const userPayload = request => JSON.parse(
  request.request.input.find(item => item.role === "user").content);

// No external page resources; ordinary citation hyperlinks are allowed.
assert.doesNotMatch(report, /<(?:script|img|iframe|link)\b|@import/i);
assert.doesNotMatch(report, /\b(?:src|srcset)=["'][^"']+/i);

// The old and new Q05 answer texts are present verbatim.
assert.ok(report.includes(escaped(oldQ05.answer.answer_ja)), "old Q05 answer missing or changed");
assert.ok(report.includes(escaped(result.outputText)),
"new Q05 outputText missing or changed");

// Every prepared original is fully present; administrative IDs are not claim links.
for (const request of prepared.requests) {
  const payload = userPayload(request);
  for (const original of payload.original_evidence) {
    assert.ok(report.includes(escaped(original.original_text)), `${request.case_id} original missing`);
  }
}
for (const claim of [
  ...result.contract.presentation.explanations,
  ...result.contract.presentation.limitations,
  result.contract.presentation.abstention,
]) {
  for (const id of claim.original_ids) {
    assert.equal(catalog[id]?.citable, true, `claim ID is not trusted citable original: ${id}`);
    assert.ok(requestByCase.get("Q05").retrieved_original_ids.includes(id),
      `claim ID was not retrieved: ${id}`);
  }
}
for (const reference of result.contract.presentation.references) {
  const trusted = catalog[reference.original_id];
  assert.ok(trusted?.citable, `reference not in trusted catalog: ${reference.original_id}`);
  for (const field of ["title", "version", "locator", "url"]) {
    assert.equal(reference[field], trusted[field], `untrusted ${field} for ${reference.original_id}`);
  }
}

// Frozen pre-revision records still match the preparation-time manifest.
const immutablePaths = Object.entries(manifest.files)
  .filter(([name]) => name.includes("/operational-results/")
    || name.endsWith("/local-token-payloads.json"));
for (const [name, expected] of immutablePaths) {
  assert.equal(digest(await readFile(path.join(root, name))), expected.sha256,
    `frozen old record changed: ${name}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/repl/tools/bin/chromium",
  args: ["--no-sandbox", "--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage();
  const nonFileRequests = [];
  page.on("request", request => {
    if (!["file:", "data:"].includes(new URL(request.url()).protocol)) {
      nonFileRequests.push(request.url());
    }
  });
  await page.goto(pathToFileURL(reportPath).href, { waitUntil: "load" });
  assert.deepEqual(nonFileRequests, [], "report loaded an external resource");
  await page.locator("#Q05-before, #Q05, #Q03-legacy, #Q06, #Q11").first().waitFor();
  assert.equal(await page.locator("#Q05 [data-status-kind=transport]").innerText(), "応答 completed");
  assert.equal(await page.locator("#Q05 [data-status-kind=semantic]").innerText(), "意味照合 stop");
  assert.match(await page.locator("#q03-continuation-gate-status").innerText(), /継続ゲートは完了扱いにしていません/);
  assert.match(await page.locator("#revision-outcome-summary").innerText(), /AASM推奨という必須帰属を省略/);
  assert.equal(await page.locator("#Q05 .claim-link code").allInnerTexts()
    .then(values => values.every(value => value === "E02-F-S01-S02-SHARED")), true);
  assert.equal(await page.locator("#Q05 .service").count(), 1);
  assert.match(await page.locator("#Q05 .service").innerText(), /service_policy_not_source_conclusion/);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${viewport.width}px viewport has ${overflow}px horizontal overflow`);
  }
} finally {
  await browser.close();
}

process.stdout.write(JSON.stringify({
  runId,
  oldAndNewQ05Verbatim: true,
  allPreparedOriginalsPresent: true,
  trustedClaimMetadataOnly: true,
  serviceNoticesSeparated: true,
  frozenOldRecordsVerified: immutablePaths.length,
  externalResources: 0,
  responsiveWidths: [1440, 390],
}, null, 2) + "\n");