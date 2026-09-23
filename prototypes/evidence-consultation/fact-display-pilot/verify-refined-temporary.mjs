// Offline display-only comparison. Own temporary files are removed in finally.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { renderPilot } from "./render.mjs";
import { renderRefinedPilot } from "./render-refined.mjs";
import { loadValidatedCatalog } from "./projection.mjs";
const root = process.cwd();
const previous = "evidence-work/parent-reading-evaluation/fact-display-pilot-01";
const out = "evidence-work/parent-reading-evaluation/display-refinement-01";
fs.mkdirSync(out, { recursive: true });
const digest = p => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const json = p => JSON.parse(fs.readFileSync(p, "utf8"));
const protectedFiles = new Map(json(`${previous}/delivery-manifest.json`).entries.map(e => [e.path, e.sha256]));
for (const b of json("evidence-work/parent-reading-evaluation/revision-01/preservation-manifest.json").protectedFiles)
  protectedFiles.set(b.path, b.sha256);
protectedFiles.set(`${previous}/delivery-manifest.json`, digest(`${previous}/delivery-manifest.json`));
const checks = [];
function check(name, value) { assert(value, name); checks.push({ name, result: "PASS" }); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fact-display-refined-"));
let browser, failure;
let network = 0;
const comparisons = [], images = [];
const metric = async page => page.evaluate(() => {
  const text = document.body.innerText;
  const strings = [...document.querySelectorAll("p, li, dd")]
    .filter(e => e.getClientRects().length > 0)
    .map(e => e.innerText.trim().replace(/\s+/g, " "))
    .filter(s => s.length >= 10);
  const counts = new Map();
  for (const s of strings) counts.set(s, (counts.get(s) ?? 0) + 1);
  return { visibleCharacters: text.length,
    repeatedExactParagraphOccurrences: [...counts.values()].reduce((n, c) => n + Math.max(0, c - 1), 0),
    rangeOccurrences: (text.match(/11[〜～–—-]14/g) ?? []).length,
    pageHeight: document.documentElement.scrollHeight };
});
try {
  globalThis.fetch = () => { throw new Error("network disabled"); };
  const catalog = loadValidatedCatalog(root);
  fs.writeFileSync(path.join(temp, "before.html"), renderPilot(root));
  fs.writeFileSync(path.join(temp, "after.html"), renderRefinedPilot(root));
  browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium",
    args: ["--disable-background-networking", "--disable-component-update", "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND"] });
  const context = await browser.newContext({ offline: true, serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await context.route("**/*", r => {
    if (/^(file|data):/.test(r.request().url())) return r.continue();
    network++; return r.abort();
  });
  const before = await context.newPage(), after = await context.newPage();
  const errors = [];
  before.on("pageerror", e => errors.push(e.message));
  after.on("pageerror", e => errors.push(e.message));
  await before.goto(`file://${path.join(temp, "before.html")}`);
  await after.goto(`file://${path.join(temp, "after.html")}`);
  await Promise.all([before.evaluate(() => document.fonts.ready), after.evaluate(() => document.fonts.ready)]);
  for (const s of catalog.scenarios) {
    await before.locator(`button[data-case="${s.caseId}"]`).click();
    await after.locator(`button[data-case="${s.caseId}"]`).click();
    const a = await metric(before), b = await metric(after);
    comparisons.push({ caseId: s.caseId, before: a, after: b });
    check(`${s.caseId}: five requested stages in order`,
      JSON.stringify(await after.locator("[data-stage]").evaluateAll(nodes =>
        nodes.filter(n => n.getClientRects().length).map(n => n.dataset.stage))) ===
      JSON.stringify(["conclusion", "explanation", "conditions", "source", "research"]));
    const visible = await after.locator("body").innerText();
    check(`${s.caseId}: exact saved question retained`, visible.includes(s.question));
    check(`${s.caseId}: private prototype notice remains visible`, visible.includes("非公開試作"));
    check(`${s.caseId}: no AI explanation field`, await after.locator("textarea, #ai").count() === 0);
    check(`${s.caseId}: no exposed hash in parent view`, !/\b[a-f0-9]{64}\b/.test(visible));
    check(`${s.caseId}: no mobile overflow`,
      await after.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`${s.caseId}: fewer initially visible characters`, b.visibleCharacters < a.visibleCharacters);
    check(`${s.caseId}: fewer exact duplicated paragraphs`, b.repeatedExactParagraphOccurrences < a.repeatedExactParagraphOccurrences);
    const conclusion = await after.locator('[data-stage="conclusion"]').innerText();
    check(`${s.caseId}: short conclusion fits initial mobile screen`,
      await after.locator('[data-stage="conclusion"]').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight));
    if (s.caseId !== "P01")
      check(`${s.caseId}: non-generic conclusion explicitly an editorial example`, conclusion.includes("編集見本"));
    if (s.caseId === "P01") {
      check("P01: requested source-bounded conclusion", conclusion.includes("保存した原文の範囲では昼寝を含むか確認できず、個別の充足判定はできない"));
      check("P01: a single combined 11–14 range initially displayed", b.rangeOccurrences === 1);
      check("P01: aggregation uncertainty and subject retained", visible.includes("1〜2歳") && /未確認|確認でき/.test(visible));
    }
    // All original conditions/exclusions/limitations must remain visibly covered.
    // Exact duplicates may be shown once; no interpretation of hidden source quotes.
    const conditions = await after.locator('[data-stage="conditions"]').innerText();
    for (const id of s.factIds) {
      const f = catalog.facts.find(f => f.id === id);
      for (const item of [...f.population.conditions, ...f.population.exclusions, ...f.limitations])
        check(`${s.caseId}/${id}: retain visible critical item: ${item}`, conditions.includes(item));
    }
    await after.evaluate(() => scrollTo(0, 0));
    const full = `${out}/${s.caseId}-mobile-full.png`, top = `${out}/${s.caseId}-mobile-top.png`;
    for (const p of [full, top]) assert(!fs.existsSync(p), "do not overwrite previous evidence");
    await after.screenshot({ path: top });
    await after.screenshot({ path: full, fullPage: true });
    images.push({ caseId: s.caseId, top, full, topSha256: digest(top), fullSha256: digest(full) });
  }
  check("No external page requests", network === 0);
  check("No script errors", errors.length === 0);
} catch (e) { failure = e; }
finally {
  if (browser) await browser.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
check("Temporary environment removed", !fs.existsSync(temp));
for (const [p, sha] of protectedFiles) check(`Unchanged protected file: ${p}`, digest(p) === sha);
const result = { result: failure ? "FAILED" : "PASSED", failure: failure?.message ?? null,
  checks, comparisons, images, newModelApiCalls: 0, externalPageRequests: network,
  fixedDataAndApprovalUnchanged: true, aiConnected: false,
  cleanup: { temporaryDirectoryRemoved: !fs.existsSync(temp), browserClosed: true, serverStarted: false },
  limitation: "Display-only validation of four frozen scenarios; not a general question-answering or semantic verification system." };
const resultName = failure ? `verification-failed-${Date.now()}.json` : "verification.json";
fs.writeFileSync(`${out}/${resultName}`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ result: result.result, failure: result.failure, checks: checks.length, comparisons, cleanup: result.cleanup }));
if (failure) throw failure;