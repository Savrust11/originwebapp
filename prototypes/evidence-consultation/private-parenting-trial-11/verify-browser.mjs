import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const out = path.resolve("evidence-work/private-parenting-trial-11/offline");
const owned = fs.mkdtempSync(path.join(out, "browser-owned-"));
const home = path.join(owned, "home");
fs.mkdirSync(home);
let browser;
const checks = { externalRequests: 0, pageErrors: [], ownedHomeRemoved: false };
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
  const context = await browser.newContext({
    offline: true, serviceWorkers: "block", viewport: { width: 1280, height: 1050 },
  });
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
  assert.equal(await page.locator("#scene option").count(), 5);
  assert.match(await page.locator("body").innerText(), /実モデル回答ではなく/);
  assert.match(await page.locator("#conversation").innerText(), /固定事実から選んだ次の発言/);
  assert.equal(await page.locator("#review dt").count(), 5);
  assert.equal(await page.getByText(/rating: unrated/).count(), 5);
  for (let index = 0; index < 5; index += 1) {
    await page.locator("#scene").selectOption(String(index));
    assert.match(await page.locator("#status").innerText(), /モデルAPI送信：0/);
    assert.match(await page.locator("#attribution").innerText(), /Source|原資料|public sector/);
  }
  await page.locator("#scene").selectOption("4");
  assert.doesNotMatch(await page.locator("#attribution").innerText(), /NHS/);
  await page.screenshot({ path: path.join(out, "browser-check.png"), fullPage: true });
  assert.equal(checks.externalRequests, 0);
  assert.deepEqual(checks.pageErrors, []);
} finally {
  if (browser?.isConnected()) await browser.close();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(owned, { recursive: true, force: true });
  checks.ownedHomeRemoved = !fs.existsSync(home);
}
fs.writeFileSync(path.join(out, "browser-check.json"), `${JSON.stringify({
  status: "passed_file_only_offline",
  scenesChecked: 5,
  syntheticResponsesDisplayed: 5,
  reviewDimensionsDisplayedPerResponse: 5,
  historyContinuationDisplayed: true,
  attributionSidecarDisplayChecked: true,
  nhsAdaptationNotAttributedToNhs: true,
  externalRequests: checks.externalRequests,
  pageErrors: checks.pageErrors,
  httpServerStarted: false,
  ownedHomeRemoved: checks.ownedHomeRemoved,
  screenshot: "browser-check.png",
}, null, 2)}\n`);
console.log("PASS browser: frozen conversation surface adapter, actual pipeline records, no network.");