import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { resolveRegion } from "../geography.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../..");
const evidence = path.join(root, "evidence-work/search-repair-05/browser");
const measuredFile = path.join(root, "evidence-work/search-repair-05/validation/cases.json");
const bindingsFile = path.join(root, "evidence-work/search-repair-05/validation/source-bindings.json");
fs.mkdirSync(path.join(evidence, "screenshots"), { recursive: true });
const measured = JSON.parse(fs.readFileSync(measuredFile));
const bindings = JSON.parse(fs.readFileSync(bindingsFile)).units;
const fileHash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const measuredHash = fileHash(measuredFile), bindingsHash = fileHash(bindingsFile);
const hashes = new Map(bindings.map(binding => [binding.sectionId, binding.originalSha256]));
const bindingBySection = new Map(bindings.map(binding => [binding.sectionId, binding]));
const wanted = new Set(["bare-naka", "unknown-municipality", "yokohama-naka", "nagoya-naka", "tokyo-koto-family"]);
const sourceRows = [], sourceSections = new Set();
const firstQueries = new Map();
for (const row of measured.cases) {
  const key = JSON.stringify([row.question, row.location ?? null]);
  if (!firstQueries.has(key)) firstQueries.set(key, row);
}
for (const row of [...firstQueries.values()].filter(candidate => candidate.status === "pass" && candidate.question && candidate.results?.length)) {
  const geography = resolveRegion({ question: row.question, region: row.location ?? null });
  const visible = row.results.filter(result => geography.status === "resolved" || !result.isMunicipal);
  if (!visible.length) continue;
  row.browserVisibleResults = visible;
  if (visible.some(result => !sourceSections.has(result.sectionId))) sourceRows.push(row);
  for (const result of visible) sourceSections.add(result.sectionId);
  if (sourceSections.size >= 16) break;
}
const replay = measured.cases.filter(row => wanted.has(row.id) || sourceRows.includes(row)).map(row => ({
  ...row,
  results: (row.results ?? []).map(result => ({ ...result, originalSha256: hashes.get(result.sectionId) })),
  browserVisibleResults: (row.browserVisibleResults ?? []).map(result => ({ ...result, originalSha256: hashes.get(result.sectionId) })),
}));
const baseMeasured = replay.find(row => row.id === "tokyo-koto-family");
assert(baseMeasured?.results.length);
replay.push(
  { id: "browser-bare-chosen", question: "中区で育児に疲れました。子どもを少し預けたいです。",
    location: { prefecture: "神奈川県", municipality: "横浜市", ward: "中区" }, results: [], preparedFromCaseId: "bare-naka" },
  { id: "browser-invalid-city", question: "地域の制度を確認したい", location: { prefecture: "愛知県", municipality: "横浜市" },
    results: baseMeasured.results, preparedFromCaseId: baseMeasured.id },
  { id: "browser-invalid-ward", question: "地域の制度を確認したい", location: { prefecture: "神奈川県", municipality: "横浜市", ward: "架空区" },
    results: baseMeasured.results, preparedFromCaseId: baseMeasured.id },
  { id: "browser-incomplete", question: "検索上限の確認", location: null, results: baseMeasured.results,
    diagnostics: { reason: "expansion_limit" }, preparedFromCaseId: "repaired-overflow-preserved" },
  { id: "browser-conflict", question: "横浜市の制度と比べて相談したい", location: { prefecture: "愛知県", municipality: "名古屋市" },
    results: [], preparedFromCaseId: baseMeasured.id },
);
const outcomes = [];
let browser;
const browserHome = fs.mkdtempSync(path.join(os.tmpdir(), "search-repair-browser-"));
async function independent(id, run) {
  const outcome = { id, status: "not_run" };
  outcomes.push(outcome);
  try { await run(outcome); outcome.status = "pass"; }
  catch (error) { outcome.status = "fail"; outcome.error = String(error.stack ?? error); }
  fs.writeFileSync(path.join(evidence, "outcomes.json"), JSON.stringify({
    format: "weiku.search-repair-05.offline-browser.v1",
    measuredRunId: measured.runId,
    invocationNonce: measured.invocationNonce,
    casesSha256: measuredHash,
    sourceBindingsSha256: bindingsHash,
    coreCounts: measured.counts,
    finalCoreSuccessClaimed: measured.counts.fail === 0 && measured.counts.not_run === 0,
    outcomes,
  }, null, 2) + "\n");
}
try {
  browser = await chromium.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    env: { PATH: "/usr/bin:/bin", HOME: browserHome, LANG: "C.UTF-8" },
    args: ["--allow-file-access-from-files", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  async function pageFor(delays = {}) {
    const context = await browser.newContext({ offline: true, serviceWorkers: "block", viewport: { width: 1100, height: 850 } });
    let externalRequests = 0;
    await context.addInitScript(({ replay, delays }) => {
      window.__SEARCH_REPAIR_REPLAY__ = replay;
      window.__SEARCH_REPAIR_DELAYS__ = delays;
    }, { replay, delays });
    await context.route("**/*", route => {
      const protocol = new URL(route.request().url()).protocol;
      if (protocol === "file:" || protocol === "data:") return route.continue();
      externalRequests += 1;
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(directory, "index.html")).href);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('16px "Noto Sans JP"', "地域を取り違えない検索")), true);
    await page.locator("#question").waitFor();
    return { context, page, errors, external: () => externalRequests };
  }
  const fill = async (page, question, region = {}) => {
    region ??= {};
    await page.locator("#question").fill(question);
    for (const key of ["prefecture", "municipality", "ward"]) await page.locator(`#${key}`).fill(region[key] ?? "");
  };
  await independent("bare-naka-clarifies-once", async outcome => {
    const { context, page, errors, external } = await pageFor();
    await fill(page, "中区で育児に疲れました。子どもを少し預けたいです。");
    await page.locator("#submit").click();
    await page.locator('[data-status="needs_city"]').waitFor();
    assert.equal(await page.locator(".clarification").count(), 1);
    assert.equal(await page.locator("article").count(), 0);
    assert(!/(料金|対象者|連絡先|電話)/u.test(await page.locator("#results").innerText()));
    await page.screenshot({ path: path.join(evidence, "screenshots/bare-naka-clarification.png"), fullPage: true });
    await fill(page, "中区で育児に疲れました。子どもを少し預けたいです。", { prefecture: "神奈川県", municipality: "横浜市", ward: "中区" });
    await page.locator("#submit").click(); await page.locator('[data-status="ready"]').waitFor();
    assert.equal(await page.locator(".clarification").count(), 0);
    await page.screenshot({ path: path.join(evidence, "screenshots/bare-naka-city-selected.png"), fullPage: true });
    assert.deepEqual(errors, []); assert.equal(external(), 0);
    outcome.statusSeen = "needs_city"; outcome.cityChoiceReachedReady = true; outcome.municipalDetails = 0;
    await context.close();
  });
  await independent("naka-structured-keys-differ", async outcome => {
    const { context, page, errors, external } = await pageFor();
    const question = "横浜市中区に住んでいます。産後の家事を手伝ってほしいです。";
    await fill(page, question, { prefecture: "神奈川県", municipality: "横浜市", ward: "中区" });
    await page.locator("#submit").click(); await page.locator('[data-status="ready"]').waitFor();
    const yokohama = await page.locator("#panel").getAttribute("data-region-key");
    await fill(page, "名古屋市中区に住んでいます。産後の家事を手伝ってほしいです。", { prefecture: "愛知県", municipality: "名古屋市", ward: "中区" });
    await page.locator("#submit").click(); await page.locator('[data-status="ready"]').waitFor();
    const nagoya = await page.locator("#panel").getAttribute("data-region-key");
    assert(yokohama && nagoya); assert.notEqual(yokohama, nagoya);
    await page.screenshot({ path: path.join(evidence, "screenshots/distinct-naka.png"), fullPage: true });
    assert.deepEqual(errors, []); assert.equal(external(), 0);
    outcome.keys = { yokohama, nagoya };
    await context.close();
  });
  await independent("unsupported-means-not-collected", async outcome => {
    const { context, page, errors, external } = await pageFor();
    await fill(page, "札幌市で育児に疲れました。子どもを少し預けたいです。", { prefecture: "北海道", municipality: "札幌市" });
    await page.locator("#submit").click(); await page.locator('[data-status="not_collected"]').waitFor();
    const text = await page.locator("#status").innerText();
    assert.match(text, /まだ収集していません/u); assert.doesNotMatch(text, /サービス(は|が)ありません/u);
    await page.screenshot({ path: path.join(evidence, "screenshots/not-collected.png"), fullPage: true });
    assert.deepEqual(errors, []); assert.equal(external(), 0); outcome.message = text;
    await context.close();
  });
  await independent("invalid-city-and-ward-block-local-details", async outcome => {
    const { context, page, errors, external } = await pageFor();
    for (const row of replay.filter(candidate => ["browser-invalid-city", "browser-invalid-ward"].includes(candidate.id))) {
      await fill(page, row.question, row.location); await page.locator("#submit").click();
      await page.locator('[data-status="invalid_region"]').waitFor();
      assert.equal(await page.locator("article").count(), 0);
      assert(!/(800円|03-5683)/u.test(await page.locator("#panel").innerText()));
    }
    await page.screenshot({ path: path.join(evidence, "screenshots/invalid-region.png"), fullPage: true });
    assert.deepEqual(errors, []); assert.equal(external(), 0);
    outcome.cityBlocked = true; outcome.wardBlocked = true;
    await context.close();
  });
  await independent("incomplete-and-conflict-notice", async outcome => {
    const { context, page, errors, external } = await pageFor();
    const incomplete = replay.find(row => row.id === "browser-incomplete");
    await fill(page, incomplete.question, incomplete.location); await page.locator("#submit").click();
    await page.locator('[data-status="incomplete"]').waitFor();
    const incompleteText = await page.locator("#status").innerText();
    assert.match(incompleteText, /検索を完了できませんでした/u);
    assert.doesNotMatch(incompleteText, /サービス(は|が)ありません/u);
    assert.equal(await page.locator("article").count(), 0);
    await page.screenshot({ path: path.join(evidence, "screenshots/incomplete-search.png"), fullPage: true });
    const conflict = replay.find(row => row.id === "browser-conflict");
    await fill(page, conflict.question, conflict.location); await page.locator("#submit").click();
    await page.locator('[data-status="ready"]').waitFor();
    assert.match(await page.locator("#geography-notice").innerText(), /別の自治体名/u);
    await page.screenshot({ path: path.join(evidence, "screenshots/conflicting-city-notice.png"), fullPage: true });
    assert.deepEqual(errors, []); assert.equal(external(), 0);
    outcome.incompleteHasNoSuccessClaim = true; outcome.conflictNoticeShown = true;
    await context.close();
  });
  await independent("question-and-region-clear-stale", async outcome => {
    const slow = replay.find(row => row.id === "tokyo-koto-family");
    assert(slow?.results.length);
    const { context, page, errors, external } = await pageFor({ [slow.question]: 350 });
    await fill(page, slow.question, slow.location); await page.locator("#submit").click();
    await page.locator('[data-status="searching"]').waitFor();
    await page.locator("#question").fill("変更後の質問");
    assert.equal(await page.locator("article").count(), 0);
    await page.waitForTimeout(450);
    assert.equal(await page.locator("article").count(), 0);
    await fill(page, slow.question, slow.location); await page.locator("#submit").click();
    await page.locator('[data-status="searching"]').waitFor();
    await page.locator("#municipality").fill("横浜市");
    assert.equal(await page.locator("article").count(), 0);
    await page.waitForTimeout(450);
    assert.equal(await page.locator("article").count(), 0);
    assert.deepEqual(errors, []); assert.equal(external(), 0);
    outcome.questionInvalidated = true; outcome.regionInvalidated = true; outcome.lateResultBlocked = true;
    await context.close();
  });
  await independent("actual-source-bindings", async outcome => {
    const { context, page, errors, external } = await pageFor();
    const checked = new Set();
    for (const sourceRow of sourceRows) {
      const row = replay.find(candidate => candidate.id === sourceRow.id);
      outcome.currentRow = row.id;
      await fill(page, row.question, row.location); await page.locator("#submit").click();
      await page.locator("article").first().waitFor();
      const cards = page.locator("article");
      assert.equal(await cards.count(), row.browserVisibleResults.length);
      for (let index = 0; index < row.browserVisibleResults.length; index += 1) {
        const card = cards.nth(index), result = row.browserVisibleResults[index];
        for (const [attribute, value] of Object.entries({
          "data-result-id": result.unitId, "data-source-id": result.sourceId,
          "data-version-id": result.versionId, "data-section-id": result.sectionId,
          "data-original-url": result.originalUrl, "data-original-sha256": result.originalSha256,
          "data-age-scope": result.ageScope,
        })) assert.equal(await card.getAttribute(attribute), value);
        assert.match(result.originalSha256, /^[a-f0-9]{64}$/u);
        const provenance = bindingBySection.get(result.sectionId);
        assert(provenance);
        assert.equal(result.originalUrl, provenance.originalUrl);
        assert.equal(result.originalSha256, provenance.originalSha256);
        assert.equal(result.ageScope, provenance.ageScope);
        checked.add(result.sectionId);
      }
    }
    assert(checked.size >= 16);
    delete outcome.currentRow;
    await page.locator("article").first().locator("summary").click();
    await page.screenshot({ path: path.join(evidence, "screenshots/source-binding.png"), fullPage: true });
    assert.deepEqual(errors, []); assert.equal(external(), 0);
    outcome.cards = checked.size; outcome.boundToMeasuredResults = true;
    await context.close();
  });
} finally {
  await browser?.close();
  fs.rmSync(browserHome, { recursive: true, force: true });
}
if (outcomes.some(outcome => outcome.status === "fail")) process.exitCode = 1;