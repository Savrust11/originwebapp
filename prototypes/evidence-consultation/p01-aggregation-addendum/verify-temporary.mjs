// Offline browser and provenance checks. No app, database, provider or HTTP server.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { renderP01 } from "./render.mjs";
import "./node-test.mjs";

const root = process.cwd();
const out = "evidence-work/parent-reading-evaluation/p01-aggregation-addendum-01";
const json = p => JSON.parse(fs.readFileSync(p, "utf8"));
const hash = p => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const checkResults = [];
function check(name, condition) {
  assert(condition, name);
  checkResults.push({ name, result: "PASS" });
}
const protectedFiles = new Map();
for (const folder of ["fact-display-pilot-01", "display-refinement-01"]) {
  const p = `evidence-work/parent-reading-evaluation/${folder}/delivery-manifest.json`;
  for (const e of json(p).entries) protectedFiles.set(e.path, e.sha256);
  protectedFiles.set(p, hash(p));
}
for (const e of json("evidence-work/parent-reading-evaluation/revision-01/preservation-manifest.json").protectedFiles)
  protectedFiles.set(e.path, e.sha256);
for (const [p, h] of protectedFiles) check(`Before: protected ${p}`, hash(p) === h);

const source = json(`${out}/minutes-source.json`);
const seal = json(`${out}/minutes-seal.json`);
check("Minutes frozen original and metadata", hash(`${out}/minutes-source.json`) === seal.sourceSha256);
check("Acquisition snapshot fixed", hash(`${out}/minutes-acquisition.md`) === seal.snapshotSha256);
check("Rights review fixed", hash(`${out}/rights-check.json`) === seal.rightsRecordSha256);
check("CDC cross-check fixed", hash(`${out}/cross-check-only/cdc-check.json`) === seal.crossCheckRecordSha256);
const cdc = json(`${out}/cross-check-only/cdc-check.json`);
check("CDC remains cross-check only", !cdc.retrievalIndexed && !cdc.importedAsSource && !cdc.fullCdcTextPersisted);
check("No independent study added", cdc.independentEffectStudiesAdded === 0 && source.independentEffectStudiesAdded === 0);
check("Same underlying recommendation family", cdc.evidenceFamily === source.evidenceFamily);
check("Official approval remains false", source.adoptionApproved === false && source.publicationApproved === false);
const rights = json(`${out}/rights-check.json`);
check("Original website text independently matched", rights.checks.directHtmlVerification.supportTextMatched.every(Boolean));
check("No source media acquired", rights.checks.directHtmlVerification.mediaDownloaded === false);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "p01-aggregation-review-"));
let browser, failure;
let externalRequests = 0;
const images = [], displayed = [];
try {
  globalThis.fetch = () => { throw new Error("offline verification forbids fetch"); };
  const html = renderP01(root);
  check("CDC body/URL not in rendering/search payload", !html.includes("cdc.gov"));
  fs.writeFileSync(path.join(temporary, "pilot.html"), html);
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium",
    args: ["--disable-background-networking", "--disable-component-update", "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND"] });
  const context = await browser.newContext({ offline: true, serviceWorkers: "block",
    viewport: { width: 390, height: 844 } });
  await context.route("**/*", route => {
    if (/^(file|data):/.test(route.request().url())) return route.continue();
    externalRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`file://${path.join(temporary, "pilot.html")}`);
  await page.evaluate(() => document.fonts.ready);

  async function capture(id, full = false) {
    await page.evaluate(() => scrollTo(0, 0));
    check(`${id}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const p = `${out}/${id}-mobile.png`;
    assert(!fs.existsSync(p));
    await page.screenshot({ path: p, fullPage: full });
    images.push({ id, path: p, sha256: hash(p), fullPage: full, viewport: { width: 390, height: 844 } });
    displayed.push({ id, conclusion: await page.locator("#conclusion").innerText(),
      arithmetic: await page.locator("#arithmetic").innerText(),
      comparison: await page.locator("#comparison").innerText(),
      health: await page.locator("#health").innerText(),
      citations: await page.locator("#citations a").evaluateAll(nodes => nodes.map(a => ({ title: a.textContent, url: a.href }))) });
  }
  async function noHealthConclusion(id) {
    const t = await page.locator("#health").innerText();
    check(`${id}: numeric comparison never becomes health judgment`, t.includes("結論しません") && t.includes("受診不要"));
  }
  check("New: explicitly nap-inclusive reference", (await page.locator("#conclusion").innerText()).includes("昼寝を含む11〜14時間"));
  check("New: arithmetic approx eleven", /11/.test(await page.locator("#arithmetic").innerText()));
  check("New: conditional range comparison", (await page.locator("#comparison").innerText()).includes("範囲内"));
  check("New: assumptions not silently verified", (await page.locator("#conditions").innerText()).includes("仮定"));
  check("New: separate minutes citation", await page.locator('#citations a[href="https://www.mhlw.go.jp/stf/newpage_37662.html"]').count() === 1);
  check("New: minutes distinguished from final guide/research in visible source",
    /最終ガイド/.test(await page.locator("#citations").innerText()) && /独立/.test(await page.locator("#citations").innerText()));
  check("New: editing attribution visible", (await page.locator("#citations").innerText()).includes("Replit Agent"));
  await noHealthConclusion("new");
  await capture("new-top");
  await capture("new-full", true);

  await page.locator("#version-old").click();
  check("Old: saved-source aggregation remains unknown", (await page.locator("#conclusion").innerText()).includes("保存した原文の範囲では昼寝を含むか確認できず"));
  check("Old: no numerical range comparison", (await page.locator("#comparison").innerText()).includes("比較保留"));
  check("Old: no minutes citation", await page.locator('#citations a[href="https://www.mhlw.go.jp/stf/newpage_37662.html"]').count() === 0);
  await noHealthConclusion("old");
  await capture("old-top");
  await capture("old-full", true);

  await page.locator("#version-new").click();
  await page.locator("#link-proof").check();
  check("Reattached: comparison returns only with proof", (await page.locator("#comparison").innerText()).includes("範囲内"));
  await page.locator("#link-proof").uncheck();
  check("Detached: no stale positive nap claim", !(await page.locator("#conclusion").innerText()).includes("昼寝を含む11〜14時間"));
  check("Detached: old unknown state restored", (await page.locator("#conclusion").innerText()).includes("確認できず"));
  check("Detached: derived comparison removed", (await page.locator("#comparison").innerText()).includes("比較保留"));
  check("Detached: citation and quoted addendum removed from DOM",
    await page.locator('a[href="https://www.mhlw.go.jp/stf/newpage_37662.html"]').count() === 0 &&
    !(await page.locator("#view").textContent()).includes("MINUTES-Q-1TO2-NAPS"));
  await capture("detached");
  await page.locator("#link-proof").check();
  for (const id of ["night-only", "unknown-age", "different-days", "time-in-bed"]) {
    await page.locator("#scenario").selectOption(id);
    const t = await page.locator("#comparison").innerText();
    check(`${id}: comparison withheld`, t.includes("比較保留") && !t.includes("範囲内です"));
    await noHealthConclusion(id);
    await capture(id);
  }
  await page.locator("#scenario").selectOption("valid-conditional");
  // Check exact quotations after opening disclosure; editorial text is never
  // substituted for the saved transcript.
  await page.locator("summary").filter({ hasText: "議事録の保存抜粋" }).click();
  for (const f of source.fragments)
    check(`Exact original quote displayed: ${f.id}`, (await page.locator("#view").textContent()).includes(f.text));
  check("No external browser requests", externalRequests === 0);
  check("No browser script error", errors.length === 0);

  // Fail-closed checks use an owned temporary root; no real source is edited.
  const fixtureRoot = path.join(temporary, "negative-root");
  const files = [
    `${out}/minutes-source.json`, `${out}/minutes-seal.json`, `${out}/minutes-acquisition.md`,
    "evidence-work/parent-reading-evaluation/fact-display-pilot-01/fact-catalog.json",
    "evidence-work/parent-reading-evaluation/fact-display-pilot-01/catalog-seal.json",
    "evidence-work/parent-reading-evaluation/execution-01/preflight/source-content.json",
    "evidence-work/parent-reading-evaluation/execution-01/preflight/request-packets.json",
    "evidence-work/parent-reading-evaluation/preparation-01/plan.json",
    ...["E02", "E03", "E04"].map(id => `evidence-work/v0.2/${id}.json`),
  ];
  for (const p of files) {
    const target = path.join(fixtureRoot, p);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(p, target);
  }
  fs.appendFileSync(path.join(fixtureRoot, out, "minutes-acquisition.md"), "\nchanged snapshot");
  assert.throws(() => renderP01(fixtureRoot), /snapshot|acquisition/i);
  check("Tampered acquisition fails closed before rendering", true);
  fs.rmSync(path.join(fixtureRoot, out, "minutes-source.json"));
  assert.throws(() => renderP01(fixtureRoot), /ENOENT/);
  check("Deleted addendum cannot leave a rendered positive claim", true);
} catch (e) {
  failure = e;
} finally {
  if (browser) await browser.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
check("Temporary root removed", !fs.existsSync(temporary));
for (const [p, h] of protectedFiles) check(`After: protected ${p}`, hash(p) === h);
const report = { result: failure ? "FAILED" : "PASSED", error: failure?.message ?? null,
  checks: checkResults, images, displayed, protectedFilesUnchanged: protectedFiles.size,
  newModelApiCalls: 0, sourceMediaImported: false, externalBrowserRequests: externalRequests,
  cdcAddedToRetrieval: false, independentEffectStudiesAdded: 0,
  adoptionChanged: false, databaseAccess: false, normalRouteChanged: false, productionChanged: false,
  cleanup: { temporaryRootRemoved: !fs.existsSync(temporary), browserClosed: true, serverStarted: false },
  limits: "Fixed conditional editorial examples only; source matching is not clinical approval or complete semantic verification." };
const reportPath = `${out}/${failure ? `verification-failed-${Date.now()}` : "verification"}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ result: report.result, error: report.error, checks: checkResults.length,
  protectedFiles: protectedFiles.size, cleanup: report.cleanup }));
if (failure) throw failure;