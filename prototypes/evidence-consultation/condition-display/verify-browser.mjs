#!/usr/bin/env node

/**
 * Browser-only verification of the self-contained condition display artifact.
 * This script does not start the application, access its DB/secrets, or invoke
 * any model/API. All browser HTTP(S) requests are aborted and recorded.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { verifyHistory } from "./history-integrity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const artifactPath = path.join(root,
  "evidence-work/condition-display-offline/conditions-and-body.html");
const catalogPath = path.join(root,
  "evidence-work/condition-display-offline/verified-condition-catalog.json");
const evaluationPath = path.join(root,
  "evidence-work/condition-display-offline/display-evaluation.json");
const outputPath = path.join(root,
  "evidence-work/condition-display-offline/browser-verification.json");
const caseIds = ["Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11"];
const expectedHistory = {
  Q05: "不合格（保持）",
  Q06: "不合格（保持）",
  Q07: "合格（当時のまま）",
  Q08: "不合格（保持）",
  Q09: "不合格（保持）",
  Q10: "不合格（保持）",
  Q11: "不合格（保持）",
};

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const evaluation = JSON.parse(fs.readFileSync(evaluationPath, "utf8"));
const findings = [];
const networkRequests = [];
const browserErrors = [];

function record(id, passed, evidence) {
  findings.push({ id, passed: Boolean(passed), evidence });
}

async function visible(locator) {
  return await locator.isVisible();
}

let browser;
try {
  const installedChromium = "/repl/tools/bin/chromium";
  browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(installedChromium) ? { executablePath: installedChromium } : {}),
  });
  const context = await browser.newContext();
  await context.route(/^https?:\/\//i, async route => {
    networkRequests.push({
      url: route.request().url(),
      method: route.request().method(),
      aborted: true,
    });
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => browserErrors.push({
    type: "pageerror", message: error.message,
  }));
  page.on("console", message => {
    if (message.type() === "error") {
      browserErrors.push({ type: "console.error", message: message.text() });
    }
  });
  await page.goto(pathToFileURL(artifactPath).href, { waitUntil: "load" });

  record("self-contained-file-url", page.url().startsWith("file:"),
    { loadedUrlScheme: new URL(page.url()).protocol });
  record("japanese-document-language",
    await page.getAttribute("html", "lang") === "ja",
    { lang: await page.getAttribute("html", "lang") });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth,
    }));
    record(`outer-body-no-horizontal-overflow-${width}`,
      dimensions.bodyScrollWidth <= dimensions.bodyClientWidth
        && dimensions.rootScrollWidth <= dimensions.rootClientWidth,
      dimensions);
    const japaneseVisible = await page.locator("h1").isVisible()
      && /短い説明|大切な条件/.test(await page.locator("h1").innerText());
    record(`japanese-visible-${width}`, japaneseVisible, {
      heading: await page.locator("h1").innerText(),
    });
  }

  for (const caseId of caseIds) {
    const button = page.locator(`[data-case-button="${caseId}"]`);
    await button.click();
    const panel = page.locator(`#example-${caseId}`);
    record(`tab-click-${caseId}`,
      await button.getAttribute("aria-selected") === "true"
        && await visible(panel),
      { selected: await button.getAttribute("aria-selected"), panelVisible: await visible(panel) });

    const research = panel.locator("details.research-detail");
    await research.evaluate(element => { element.open = false; });
    const samples = panel.locator(".body-conditions");
    let adjacentPassed = await samples.count() > 0;
    const adjacencyEvidence = [];
    for (let index = 0; index < await samples.count(); index += 1) {
      const sample = samples.nth(index);
      const body = sample.locator(":scope > .short-body");
      const conditions = sample.locator(":scope > .short-body + .condition-list");
      const displayedBlocks = await conditions.locator("[data-block-id]").evaluateAll(elements =>
        elements.filter(element => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        }).map(element => element.dataset.blockId));
      const mandatory = catalog.cases[caseId].blocks
        .filter(block => block.tier === "mandatory").map(block => block.id);
      const okay = await visible(body) && await visible(conditions)
        && mandatory.every(id => displayedBlocks.includes(id));
      adjacentPassed &&= okay;
      adjacencyEvidence.push({ mandatory, displayedBlocks, researchOpen: await research.getAttribute("open") });
    }
    record(`adjacent-mandatory-conditions-${caseId}`, adjacentPassed, adjacencyEvidence);

    for (const applicability of ["unknown", "mismatched", "matched"]) {
      await panel.locator(".applicability").selectOption(applicability);
      await panel.locator(".display-mode").selectOption("individual");
      const background = panel.locator(".background-content");
      const blocked = panel.locator(".blocked-answer");
      record(`individual-blocked-${caseId}-${applicability}`,
        !await visible(background) && await visible(blocked)
          && /個別助言を停止しています/.test(await blocked.innerText()),
        {
          backgroundVisible: await visible(background),
          blockedVisible: await visible(blocked),
          gateText: await panel.locator(".gate-state").innerText(),
        });
    }

    await panel.locator(".display-mode").selectOption("background");
    const background = panel.locator(".background-content");
    record(`switchback-fictional-not-user-ready-${caseId}`,
      await visible(background)
        && !await visible(panel.locator(".blocked-answer"))
        && /原文に照合した編集例（モデル出力ではありません）/.test(await background.innerText())
        && /診断・治療・個別助言には使用できません/.test(await background.innerText()),
      { backgroundVisible: await visible(background), blockedVisible: await visible(panel.locator(".blocked-answer")) });

    const sourceLinks = panel.locator(".body-conditions .source-link");
    let sourceChecksPassed = await sourceLinks.count() > 0;
    const sourceEvidence = [];
    for (let index = 0; index < await sourceLinks.count(); index += 1) {
      const link = sourceLinks.nth(index);
      const originalId = (await link.innerText()).split(" · ")[0];
      await link.click();
      const targetId = (await link.getAttribute("href")).slice(1);
      const expected = catalog.cases[caseId].blocks
        .flatMap(block => block.supports ?? []).find(item =>
          item.originalId === originalId && targetId.endsWith(`-${item.quoteStart}`));
      const source = page.locator(`#${targetId}`);
      const fields = await source.locator("dl").evaluate(dl => {
        const result = {};
        const children = [...dl.children];
        for (let i = 0; i < children.length; i += 2) {
          result[children[i].textContent.trim()] = children[i + 1]?.textContent.trim() ?? "";
        }
        return result;
      });
      const quote = (await source.locator("blockquote").innerText()).trim();
      const okay = Boolean(expected) && await visible(source)
        && fields["原文ID"] === expected.originalId
        && fields["版"] === expected.version
        && fields["該当箇所"] === expected.locator
        && quote === expected.quote;
      sourceChecksPassed &&= okay;
      sourceEvidence.push({
        originalId, targetId, visible: await visible(source), fields,
        quoteExact: quote === expected?.quote,
      });
    }
    record(`source-click-details-${caseId}`, sourceChecksPassed, sourceEvidence);
  }

  for (const caseId of ["Q08", "Q09", "Q10"]) {
    await page.locator(`[data-case-button="${caseId}"]`).click();
    const panel = page.locator(`#example-${caseId}`);
    const detail = panel.locator("details.research-detail");
    await detail.locator("summary").click();
    const requiredEffects = catalog.cases[caseId].blocks
      .filter(block => block.tier === "conditional" && block.kind === "researchDetail")
      .map(block => block.text);
    const detailText = await detail.innerText();
    record(`research-effect-ci-i2-${caseId}`,
      await visible(detail) && requiredEffects.length > 0
        && requiredEffects.every(text => detailText.includes(text)),
      { open: await detail.getAttribute("open"), requiredEffects });
  }

  const outcomesHeading = await page.locator("#outcomes > h2").innerText();
  record("edited-samples-and-raw-headings-separated",
    await page.locator("#examples > h2").innerText() === "架空データの画面例"
      && outcomesHeading === "保存済みQ05〜Q11で確かめたこと"
      && await page.locator(".raw-answer").count() === 7,
    {
      examples: await page.locator("#examples > h2").innerText(),
      outcomes: outcomesHeading,
      rawAnswerCount: await page.locator(".raw-answer").count(),
    });

  let rawPassed = true;
  const rawEvidence = [];
  for (const expectedCase of evaluation.cases) {
    const actual = await page.locator(`#history-${expectedCase.caseId} .raw-answer`).textContent();
    const okay = actual === expectedCase.historical.outputText;
    rawPassed &&= okay;
    rawEvidence.push({
      caseId: expectedCase.caseId,
      exact: okay,
      q06UnrepairedTotalPreserved: expectedCase.caseId !== "Q06" || actual.includes("合計"),
    });
    if (expectedCase.caseId === "Q06") rawPassed &&= actual.includes("合計");
  }
  const originalQ05 = evaluation.originalQ05.rawResult.outputText;
  const originalQ05Visible = (await page.locator("body").textContent()).includes(originalQ05);
  record("saved-raw-exact-and-q05-original", rawPassed && originalQ05Visible,
    { cases: rawEvidence, originalQ05Exact: originalQ05Visible });

  let statusesPassed = true;
  const statusEvidence = [];
  for (const [caseId, expected] of Object.entries(expectedHistory)) {
    const actual = (await page.locator(`#history-${caseId} h3 .badge`).first().innerText()).trim();
    statusesPassed &&= actual === expected;
    statusEvidence.push({ caseId, expected, actual });
  }
  record("historical-statuses-retained", statusesPassed, statusEvidence);
  record("no-console-javascript-errors", browserErrors.length === 0, browserErrors);
  record("all-http-https-aborted-and-recorded",
    networkRequests.every(request => request.aborted),
    { count: networkRequests.length, requests: networkRequests });

  await context.close();
} catch (error) {
  record("verification-runtime", false, {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
  });
} finally {
  if (browser) await browser.close();
}

// This is intentionally the final integrity verifier: browser work is complete.
try {
  record("history-integrity-at-end", true, verifyHistory());
} catch (error) {
  record("history-integrity-at-end", false, {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
  });
}

const failed = findings.filter(finding => !finding.passed);
const report = {
  schemaVersion: 1,
  verificationType: "offline-file-browser",
  artifact: "evidence-work/condition-display-offline/conditions-and-body.html",
  viewportWidths: [1440, 390],
  cases: caseIds,
  passed: failed.length === 0,
  summary: {
    checks: findings.length,
    passed: findings.length - failed.length,
    failed: failed.length,
    browserHttpRequests: networkRequests.length,
    browserErrors: browserErrors.length,
  },
  networkRequests,
  browserErrors,
  findings,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
console.log(JSON.stringify({ passed: report.passed, ...report.summary, outputPath }, null, 2));
if (!report.passed) process.exitCode = 1;