import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const out = path.resolve("evidence-work/private-parenting-trial-10/offline");
const owned = fs.mkdtempSync(path.join(out, "browser-check-owned-"));
const home = path.join(owned, "home");
fs.mkdirSync(home);
let browser;
const checks = { externalRequests: 0, pageErrors: [] };
try {
  browser = await chromium.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
    env: { PATH: "/usr/bin:/bin", HOME: home, LANG: "C.UTF-8" },
    args: [
      "--disable-background-networking", "--disable-component-update", "--disable-sync",
      "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND",
    ],
  });
  const context = await browser.newContext({ offline: true, serviceWorkers: "block", viewport: { width: 1280, height: 960 } });
  await context.route("**/*", route => {
    const protocol = new URL(route.request().url()).protocol;
    if (protocol === "file:" || protocol === "data:") return route.continue();
    checks.externalRequests += 1;
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => checks.pageErrors.push(error.message));
  await page.goto(pathToFileURL(path.join(out, "index.html")).href);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.status), "loaded");
  assert.equal(await page.locator("#scene-picker option").count(), 5);
  assert.match(await page.locator("body").innerText(), /実モデル未接続/);
  const evidenceSummary = page.getByText("根拠を見る", { exact: true });
  assert.equal(await evidenceSummary.count(), 1);
  await evidenceSummary.click();
  assert.match(await evidenceSummary.locator("..").innerText(), /5場面とも/);
  await page.screenshot({ path: path.join(out, "browser-check.png"), fullPage: true });
  await page.goto(pathToFileURL(path.join(out, "reviewer.html")).href);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.getByText("回答記録：0件", { exact: true }).count(), 5);
  assert.equal(await page.getByText(/status: unrated/).count(), 25);
  assert.match(await page.locator("body").innerText(), /実回答0件/);
  assert.equal(checks.externalRequests, 0);
  assert.deepEqual(checks.pageErrors, []);
  fs.writeFileSync(path.join(out, "browser-check.json"), `${JSON.stringify({
    status: "passed_offline_file_only",
    pages: ["index.html", "reviewer.html"],
    scenes: 5,
    futureEmptyReviewRecords: 5,
    unratedDimensions: 25,
    evidenceDisclosureChecked: true,
    syntheticLabelChecked: true,
    externalRequests: checks.externalRequests,
    pageErrors: checks.pageErrors,
    screenshot: "browser-check.png",
    httpServerStarted: false,
  }, null, 2)}\n`);
} finally {
  if (browser?.isConnected()) await browser.close();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(owned, { recursive: true, force: true });
}
console.log("PASS offline file browser check: conversation surface, evidence, and empty reviews.");
