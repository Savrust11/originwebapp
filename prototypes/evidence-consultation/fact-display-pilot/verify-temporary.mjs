// Run with a clean environment. Only this script uses the local browser.
// No HTTP server, workflow, provider SDK, or application/database import.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { loadValidatedCatalog } from "./projection.mjs";
import { renderPilot } from "./render.mjs";
const root = process.cwd();
const output = "evidence-work/parent-reading-evaluation/fact-display-pilot-01";
const catalogPath = `${output}/fact-catalog.json`;
const digest = p => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const json = p => JSON.parse(fs.readFileSync(p, "utf8"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fact-display-pilot-"));
const checks = [];
const check = (name, condition, scope = "fixed-data-and-rendering") => {
  assert(condition, name);
  checks.push({ name, result: "PASS", scope });
};
let browser;
let failure;
let externalRequests = 0;
let structuralMeaningProbe;
const images = [];
const protectedFiles = new Map();
function protect(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    assert(!item.isSymbolicLink());
    if (item.isDirectory()) protect(p); else protectedFiles.set(p, digest(p));
  }
}
for (const dir of ["execution-01", "preparation-01", "revision-01"])
  protect(`evidence-work/parent-reading-evaluation/${dir}`);
for (const b of json("evidence-work/parent-reading-evaluation/revision-01/preservation-manifest.json").protectedFiles)
  protectedFiles.set(b.path, digest(b.path));
try {
  globalThis.fetch = () => { throw new Error("offline-pilot-network-disabled"); };
  const catalog = loadValidatedCatalog(root);
  const html = renderPilot(root);
  const pagePath = path.join(temporary, "pilot.html");
  fs.writeFileSync(pagePath, html, { flag: "wx" });
  const sleep = catalog.facts.find(f => f.id === "sleep-guidance");
  check("P01: saved aggregation remains unspecified", sleep.quantities.every(q =>
    q.unit === "hours" && (q.aggregationScope === null || /未確認|不明|unknown/.test(q.aggregationScope))));
  check("P01: no nap-inclusive total supplied as measured target",
    sleep.quantities.every(q => !/昼寝を含む|24時間/.test(q.measurementTarget)));
  const screen = catalog.facts.filter(f => f.sourceId === "E04");
  check("P04: exclusions retain growth/development/behavior qualification",
    screen.every(f => f.population.exclusions.some(e => /成長/.test(e) && /発達/.test(e) && /行動/.test(e))));
  check("Research averages remain distinct from individual age",
    catalog.facts.filter(f => f.sourceId !== "E02").every(f => /平均年齢/.test(f.population.ageBasis)));
  check("Publisher is not promoted to recommending authority",
    catalog.facts.filter(f => f.sourceId !== "E02").every(f => f.authority.attributedRecommender === null));
  check("E02 attribution remains guide issuer versus attributed AASM",
    /厚生労働省/.test(sleep.authority.issuer) && /Sleep Medicine|睡眠医学/.test(sleep.authority.attributedRecommender));

  // Negative fixtures are temporary copies. Source records/history stay read-only.
  const sandbox = path.join(temporary, "negative-fixtures");
  const inputPaths = [catalogPath, `${output}/catalog-seal.json`,
    "evidence-work/parent-reading-evaluation/execution-01/preflight/source-content.json",
    "evidence-work/parent-reading-evaluation/execution-01/preflight/request-packets.json",
    "evidence-work/parent-reading-evaluation/preparation-01/plan.json",
    ...["E02", "E03", "E04"].map(id => `evidence-work/v0.2/${id}.json`)];
  for (const p of inputPaths) {
    const to = path.join(sandbox, p); fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(p, to);
  }
  function rejectFixture(name, change) {
    const value = structuredClone(catalog); change(value);
    fs.writeFileSync(path.join(sandbox, catalogPath), JSON.stringify(value));
    let rejected = false;
    try { renderPilot(sandbox); } catch (error) {
      rejected = /fact-display-pilot validation failed|fixed-data-review-seal-changed/.test(error.message);
    }
    check(name, rejected, "shape-or-frozen-integrity-rejection-not-general-semantics");
  }
  rejectFixture("Dropping all limitations prevents rendering", c => { c.facts[0].limitations = []; });
  rejectFixture("Dropping applicable conditions prevents rendering", c => { c.facts[0].population.conditions = []; });
  rejectFixture("Dropping required source context prevents rendering", c => { c.facts[0].supports.pop(); });
  rejectFixture("Changing a quantity prevents fixed-data rendering", c => { c.facts[0].quantities[0].value = 99; });
  rejectFixture("Expanding specific exclusions prevents fixed-data rendering",
    c => { c.facts.find(f => f.sourceId === "E04").population.exclusions = ["あらゆる診断がある子ども"]; });
  rejectFixture("Changing population age basis prevents rendering",
    c => { c.facts.find(f => f.sourceId === "E03").population.ageBasis = "個人の年齢"; });

  const probe = structuredClone(catalog);
  probe.facts.find(f => f.id === "interaction-results").summary =
    "【資料確認済み・編集固定文】この講座なら必ず改善します。";
  fs.writeFileSync(path.join(sandbox, catalogPath), JSON.stringify(probe));
  let acceptedByShape = false;
  try { loadValidatedCatalog(sandbox); acceptedByShape = true; } catch { /* a check may reject it */ }
  let rejectedBySeal = false;
  try { renderPilot(sandbox); } catch (error) {
    rejectedBySeal = error.message.includes("fixed-data-review-seal-changed");
  }
  check("Unreviewed explanation change cannot render with existing seal", rejectedBySeal, "integrity-not-meaning");
  structuralMeaningProbe = { acceptedByShape, rejectedBySeal,
    interpretation: "固定文の意味を完全に検査する実装ではない。sealは変更の検出で、意味の正しさの証明ではない。誤ったデータを再承認すれば防げない。" };

  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium",
    args: ["--disable-background-networking", "--disable-component-update", "--disable-sync",
      "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND"] });
  const context = await browser.newContext({ offline: true, serviceWorkers: "block",
    viewport: { width: 390, height: 844 } });
  await context.route("**/*", route => {
    if (/^(file|data):/.test(route.request().url())) return route.continue();
    externalRequests++; return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`file://${pagePath}`);
  await page.evaluate(() => document.fonts.ready);
  const fingerprints = new Map();
  for (const scenario of catalog.scenarios) {
    await page.locator(`button[data-case="${scenario.caseId}"]`).click();
    check(`${scenario.caseId}: exact saved fictional question displayed`,
      await page.locator("#question").textContent() === scenario.question);
    const actualIds = await page.locator("article:not([hidden])").evaluateAll(nodes => nodes.map(n => n.dataset.fact));
    check(`${scenario.caseId}: only mapped reusable source facts displayed`,
      JSON.stringify(actualIds.sort()) === JSON.stringify([...scenario.factIds].sort()));
    for (const id of scenario.factIds) {
      const article = page.locator(`article[data-fact="${id}"]`);
      check(`${scenario.caseId}/${id}: conditions and limits are not collapsed`,
        await article.locator(".context").isVisible() && await article.locator(".limits").isVisible());
      check(`${scenario.caseId}/${id}: source accompanies quantity bundle`, await article.locator(".sources").isVisible());
      const text = await article.innerText();
      if (fingerprints.has(id)) check(`${id}: reused text does not change with question`, fingerprints.get(id) === text);
      else fingerprints.set(id, text);
    }
    check(`${scenario.caseId}: AI remains disabled`, await page.locator("#ai").isDisabled());
    check(`${scenario.caseId}: no horizontal mobile overflow`,
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => scrollTo(0, 0));
    const file = `${output}/${scenario.caseId}-mobile.png`;
    assert(!fs.existsSync(file), "never overwrite an old screenshot");
    await page.screenshot({ path: file, fullPage: true });
    images.push({ caseId: scenario.caseId, path: file, sha256: digest(file), viewport: { width: 390, height: 844 } });
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.locator('button[data-case="P01"]').click();
  await page.screenshot({ path: path.join(temporary, "desktop-check.png") });
  // The evidence copy is an image, not an active environment or app.
  fs.copyFileSync(path.join(temporary, "desktop-check.png"), `${output}/desktop-check.png`, fs.constants.COPYFILE_EXCL);
  check("No external page requests", externalRequests === 0);
  check("No browser script errors", errors.length === 0);
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
check("Owned temporary environment removed", !fs.existsSync(temporary));
for (const [p, before] of protectedFiles) assert.equal(digest(p), before, `history changed: ${p}`);
check("All protected original artifacts unchanged", true);
const eventDir = "evidence-work/parent-reading-evaluation/execution-01/run/private/events";
const last = fs.readdirSync(eventDir).sort().at(-1);
check("Existing authorization remains closed", json(path.join(eventDir, last)).type === "authorization-closed");
const report = { schemaVersion: 1, result: failure ? "FAILED" : "PASSED",
  failure: failure?.message ?? null, checks, newModelApiCalls: 0, externalPageRequests: externalRequests,
  aiExplanationConnected: false, databaseAccess: false, serverStarted: false,
  cleanup: { ownedTemporaryDirectoryRemoved: !fs.existsSync(temporary), browserClosed: true, activePilotServer: false },
  protectedFilesUnchanged: protectedFiles.size, images, structuralMeaningProbe,
  oldModelScoresChanged: false, semanticValidationCompleted: false,
  clinicalApproval: false, adoptionApproval: false, productionPublicationChanged: false };
fs.writeFileSync(`${output}/verification.json`, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ result: report.result, checks: checks.length, cleanup: report.cleanup,
  structuralMeaningProbe, screenshots: images.map(i => i.path) }));
if (failure) throw failure;