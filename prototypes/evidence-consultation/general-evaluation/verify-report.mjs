#!/usr/bin/env node
// Browser verification of the final self-contained report. HTTP(S) is aborted;
// this script performs no model request and reads no secrets or application data.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { CASE_IDS, RUN_ID, digest } from "./display.mjs";
import { verifyHistory } from "./history.mjs";
import { summarizeAccounting } from "./accounting.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const base = path.join(root, "evidence-work/general-audience-evaluation", RUN_ID);
const prep = path.join(base, "preparation");
const results = path.join(base, "results");
const appDisplays = path.join(base, "app-displays");
const reviews = path.join(base, "reviews");
const artifact = path.join(base, "general-audience-results.html");
const output = path.join(base, "report-verification.json");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const money = value =>
  `$${(value / 1_000_000).toFixed(6)} (${value.toLocaleString("ja-JP")} µUSD)`;
const idOf = value => value?.caseId ?? value?.case_id;
const payload = item => {
  if (item?.payload) return item.payload;
  for (const input of item?.request?.input ?? []) {
    if (typeof input?.content !== "string") continue;
    try { return JSON.parse(input.content); } catch {}
  }
  return {};
};
const originals = item => item?.originalEvidence ?? item?.original_evidence
  ?? payload(item)?.original_evidence ?? payload(item)?.originalEvidence ?? [];
const prepared = read(path.join(prep, "prepared-package.json"));
const appCatalogFile = read(path.join(prep, "app-catalog.json"));
const appCatalog = appCatalogFile?.catalog?.cases ? appCatalogFile.catalog : appCatalogFile;
const requests = new Map(prepared.requests.map(item => [idOf(item), item]));
const oldLedger = read(path.join(root, "evidence-work/model-evaluation/api-call-ledger.json"));
const ledger = read(path.join(base, "ledger.json"));
const accounting = summarizeAccounting(ledger);
const prior = new Map();
for (const entry of oldLedger.entries) if (entry.caseId) prior.set(entry.caseId, entry);
const expected = CASE_IDS.map(caseId => ({
  caseId,
  prepared: requests.get(caseId),
  result: read(path.join(results, `${caseId}.json`)),
  display: read(path.join(appDisplays, `${caseId}.json`)),
  review: read(path.join(reviews, `${caseId}.json`)),
}));
const findings = [];
const networkRequests = [];
const browserErrors = [];
const record = (id, passed, evidence) =>
  findings.push({ id, passed: Boolean(passed), evidence });
let browser;
try {
  const executablePath = fs.existsSync("/repl/tools/bin/chromium")
    ? "/repl/tools/bin/chromium" : undefined;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext();
  await context.route(/^https?:\/\//i, async route => {
    networkRequests.push({ url: route.request().url(), method: route.request().method() });
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => browserErrors.push({ type: "pageerror", message: error.message }));
  page.on("console", message => {
    if (message.type() === "error")
      browserErrors.push({ type: "console.error", message: message.text() });
  });
  await page.goto(pathToFileURL(artifact).href, { waitUntil: "load" });
  record("self-contained-japanese-file",
    page.url().startsWith("file:") && await page.getAttribute("html", "lang") === "ja",
    { url: page.url(), lang: await page.getAttribute("html", "lang") });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.evaluate(() => ({
      bodyScroll: document.body.scrollWidth, bodyClient: document.body.clientWidth,
      rootScroll: document.documentElement.scrollWidth,
      rootClient: document.documentElement.clientWidth,
    }));
    record(`no-horizontal-overflow-${width}`,
      size.bodyScroll <= size.bodyClient && size.rootScroll <= size.rootClient, size);
  }
  const checkedCaseIds = new Set();
  for (const row of expected) {
    try {
    const card = page.locator(`#${row.caseId}`);
    const raw = await card.locator(".raw-answer").textContent();
    record(`raw-response-exact-${row.caseId}`, raw === row.result.outputText, {
      expectedSha256: digest(Buffer.from(row.result.outputText)),
      actualSha256: digest(Buffer.from(raw)),
    });
    const responseBytes = fs.readFileSync(path.join(results, `${row.caseId}.json`));
    record(`response-display-review-bound-${row.caseId}`,
      row.display.responseFileSha256 === digest(responseBytes)
      && row.review.responseSha256 === row.display.responseFileSha256
      && row.review.appDisplaySha256 === digest(fs.readFileSync(
        path.join(appDisplays, `${row.caseId}.json`))),
      {
        displayResponseSha256: row.display.responseFileSha256,
        reviewResponseSha256: row.review.responseSha256,
        reviewAppDisplaySha256: row.review.appDisplaySha256,
      });
    const conditionClaims = card.locator(".claim");
    const mandatory = appCatalog.cases[row.display.baseCaseId].blocks
      .filter(block => block.tier === "mandatory").map(block => block.id);
    let adjacent = await conditionClaims.count() > 0;
    const evidence = [];
    for (let index = 0; index < await conditionClaims.count(); index++) {
      const claim = conditionClaims.nth(index);
      const condition = claim.locator(":scope > .conditions");
      const shown = await condition.locator("[data-condition-block]").evaluateAll(elements =>
        elements.map(element => element.getAttribute("data-condition-block")));
      const exactSibling = await claim.evaluate(element =>
        Boolean(element.querySelector(":scope > p + p + aside.conditions")));
      adjacent &&= await condition.isVisible()
        && mandatory.every(id => shown.includes(id)) && exactSibling;
      evidence.push({ mandatory, shown, exactSibling });
    }
    record(`mandatory-conditions-adjacent-${row.caseId}`, adjacent, evidence);
    await card.locator(".support-details").evaluate(element => { element.open = true; });
    let supportsExact = row.display.appDisplay.sourceSupports.length > 0;
    const supportEvidence = [];
    for (const support of row.display.appDisplay.sourceSupports) {
      const sourceId =
        `source-${row.caseId}-${support.originalId}-${support.quoteStart}-${support.quoteEnd}`;
      const source = card.locator(`#${sourceId}`);
      const text = await source.innerText();
      const okay = await source.count() === 1 && await source.isVisible()
        && [support.originalId, support.title, support.version, support.locator,
          support.originalTextSha256, support.quote].every(value => text.includes(value));
      supportsExact &&= okay;
      supportEvidence.push({ originalId: support.originalId,
        quoteStart: support.quoteStart, quoteEnd: support.quoteEnd,
        sourceId, exact: okay });
    }
    record(`source-version-locator-quote-${row.caseId}`, supportsExact, supportEvidence);
    const details = appCatalog.cases[row.display.baseCaseId].blocks
      .filter(block => block.tier === "conditional").map(block => block.text);
    await card.locator(".research-details").evaluate(element => { element.open = true; });
    const detailText = await card.locator(".research-details").innerText();
    record(`conditional-details-preserved-${row.caseId}`,
      details.every(text => detailText.includes(text)), { details });
    await card.locator("details.originals").evaluate(element => { element.open = true; });
    const sourceText = await card.locator("details.originals").innerText();
    const missing = originals(row.prepared).map(source =>
      source.original_text ?? source.originalText ?? source.text)
      .filter(text => !sourceText.includes(text));
    record(`complete-sent-originals-${row.caseId}`, missing.length === 0
      && originals(row.prepared).length > 0, { sourceCount: originals(row.prepared).length,
        missingCount: missing.length });
    const grades = await card.locator(".grades").innerText();
    record(`three-separate-verdicts-${row.caseId}`,
      grades.includes(`本文単体：${row.review.bodyVerdict === "pass" ? "合格" : "不合格"}`)
      && grades.includes(`アプリ表示：${row.review.appVerdict === "pass" ? "合格" : "不合格"}`)
      && grades.includes(`画面全体：${row.review.screenVerdict === "pass" ? "合格" : "不合格"}`),
      { body: row.review.bodyVerdict, app: row.review.appVerdict,
        screen: row.review.screenVerdict });
    record(`recurrence-and-new-issues-${row.caseId}`,
      grades.includes("過去の問題が再発したか") && grades.includes("新たに発生した問題"),
      { recurrence: row.review.recurrence, newIssues: row.review.newIssues });
    } catch (error) {
      record(`case-runtime-${row.caseId}`, false, {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
      });
    }
    checkedCaseIds.add(row.caseId);
  }
  record("all-six-cases-checked-without-early-exit",
    checkedCaseIds.size === CASE_IDS.length
      && CASE_IDS.every(caseId => checkedCaseIds.has(caseId)),
    { checkedCaseIds: [...checkedCaseIds] });
  const bodyText = await page.locator("body").innerText();
  const duplicateIds = await page.locator("[id]").evaluateAll(elements => {
    const counts = new Map();
    for (const element of elements)
      counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    return [...counts].filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
  });
  record("all-dom-ids-unique", duplicateIds.length === 0, duplicateIds);
  record("ai-reviewer-distinguished",
    bodyText.includes("agent-source-comparison-not-clinical-review")
      && bodyText.includes("人による採用審査・臨床評価ではありません"),
    {});
  record("individual-advice-disabled",
    bodyText.includes("個別助言は無効です")
      && expected.every(row => row.display.individualAdviceBlocked === true
        && row.display.userReady === false), {});
  const total = page.locator("#accounting-total");
  const totalStrong = (await total.locator("strong").innerText()).trim();
  const totalText = await total.innerText();
  const accountingExact = accounting.displayMeasuredTotalMicroUSD === null
    ? totalStrong === "利用量未確定・総額算出停止"
      && !totalStrong.includes(money(accounting.knownCostMicroUSD))
    : totalStrong === money(accounting.displayMeasuredTotalMicroUSD);
  record("accounting-unknown-safe-and-unused-twentieth-visible",
    accountingExact
      && await total.getAttribute("data-usage-known") === String(accounting.usageKnown)
      && totalText.includes(`既知額 ${money(accounting.knownCostMicroUSD)}`)
      && bodyText.includes(`${accounting.cumulativeTransmissions} / 19通信`)
      && bodyText.includes("20回目は使用禁止") && bodyText.includes("$1.000000"),
    { accounting, totalStrong });
  const priorChecks = await Promise.all(expected.map(async row => {
    const old = prior.get(row.display.baseCaseId);
    const label = old?.review?.verdict === "pass" ? "合格" : "不合格";
    const text = await page.locator(`#${row.caseId} .past`).innerText();
    return { caseId: row.caseId, expected: label,
      passed: text.includes(label) && text.includes("変更なし") };
  }));
  record("past-verdicts-retained", priorChecks.every(item => item.passed), priorChecks);
  record("no-console-errors", browserErrors.length === 0, browserErrors);
  record("no-http-resources", networkRequests.length === 0, networkRequests);
  await context.close();
} catch (error) {
  record("browser-runtime", false, { name: error?.name, message: error?.message ?? String(error) });
} finally {
  if (browser) await browser.close();
}
try { record("historical-integrity", true, verifyHistory()); }
catch (error) { record("historical-integrity", false, { message: error.message }); }
const failed = findings.filter(item => !item.passed);
const report = {
  schemaVersion: 1,
  type: "offline-self-contained-general-six-report-verification",
  runId: RUN_ID,
  artifact: path.relative(root, artifact),
  passed: failed.length === 0,
  summary: { checks: findings.length, passed: findings.length - failed.length,
    failed: failed.length, browserHttpRequests: networkRequests.length,
    browserErrors: browserErrors.length },
  findings,
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ overallPassed: report.passed, ...report.summary,
  output: path.relative(root, output) }, null, 2));
if (!report.passed) process.exitCode = 1;