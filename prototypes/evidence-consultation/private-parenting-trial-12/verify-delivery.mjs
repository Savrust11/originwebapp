import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const workspace = process.cwd();
const root = "evidence-work/private-parenting-trial-12";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "trial12-browser-"));
const metadata = fs.readdirSync(path.join(root, "run/private/responses")).sort()
  .map(name => JSON.parse(fs.readFileSync(path.join(root, "run/private/responses", name))));
const parentTexts = fs.readdirSync(path.join(root, "run/private/requests"))
  .filter(name => /^\d\d\.json$/.test(name)).sort()
  .map(name => JSON.parse(fs.readFileSync(path.join(root, "run/private/requests", name))).input.at(-1).content);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
let networkRequests = 0;
const context = await chromium.launchPersistentContext(profile, {
  executablePath: "/repl/tools/bin/chromium",
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: ["--no-sandbox"],
});
let result;
try {
  await context.route(/^https?:/, async route => {
    networkRequests += 1;
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  await page.goto(new URL(`file://${path.join(workspace, root, "delivery/index.html")}`).href);
  assert.equal(networkRequests, 0);
  const modelTexts = await page.locator(".turn.model p").allTextContents();
  const displayedParents = await page.locator(".turn.parent p").allTextContents();
  assert.deepEqual(modelTexts, metadata.map(item => item.extractedVisibleText));
  assert.deepEqual(displayedParents, parentTexts);
  assert.equal(await page.locator(".turn.model").count(), 6);
  assert.equal(await page.locator(".turn.parent").count(), 6);
  assert.equal(await page.locator(".turn, details").allTextContents()
    .then(items => items.some(text => text.includes("NHS"))), false);
  assert.equal(await page.locator("body").innerText().then(text => text.includes("$0.0033218")), true);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('16px "Noto Sans JP"', "育児相談")), true);
  const topScreenshot = path.join(root, "delivery/rendered-top.png");
  const foodScreenshot = path.join(root, "delivery/rendered-food.png");
  await page.screenshot({ path: topScreenshot });
  await page.locator("section").nth(2).scrollIntoViewIfNeeded();
  await page.screenshot({ path: foodScreenshot });
  fs.rmSync(path.join(root, "delivery/rendered-report.png"), { force: true });
  result = {
    format: "weiku.private-parenting-trial-12.render-verification.v1",
    status: "passed",
    fileBrowser: true,
    publicServerUsed: false,
    networkRequests,
    exactActualAssistantReceipts: modelTexts.length,
    exactRegisteredParentMessages: displayedParents.length,
    japaneseFontReady: true,
    screenshots: {
      top: { path: "delivery/rendered-top.png", sha256: sha(fs.readFileSync(topScreenshot)) },
      food: { path: "delivery/rendered-food.png", sha256: sha(fs.readFileSync(foodScreenshot)) },
    },
    browserProfileRemovedAfterClose: false,
  };
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
result.browserProfileRemovedAfterClose = !fs.existsSync(profile);
fs.writeFileSync(path.join(root, "delivery/render-verification.json"),
  `${JSON.stringify(result, null, 2)}\n`);
const manifestPath = path.join(root, "delivery/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath));
manifest.rendering = {
  selfContainedJapaneseFont: "Noto Sans JP 400 embedded as data URLs",
  japaneseFontReady: true,
  networkRequests: 0,
  screenshotBindings: result.screenshots,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  status: "passed", fileBrowser: true, networkRequests,
  exactActualAssistantReceipts: result.exactActualAssistantReceipts,
  screenshots: ["delivery/rendered-top.png", "delivery/rendered-food.png"],
}));