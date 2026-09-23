import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { renderSourceCard } from "./source-display.mjs";

const escapeAttribute = value => String(value).replace(/[&<>"']/gu, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
export async function verifyActualSourceDisplay(display) {
  assert.equal(display.format, "weiku.parenting-expansion.source-display.v1");
  assert(Array.isArray(display.examples) && display.examples.length > 0);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parenting-expansion-actual-display-"));
  const pageFile = path.join(temporary, "index.html");
  const cards = display.examples.map(example => {
    assert.match(example.sourceId, /^[a-f0-9-]{36}$/u);
    assert.match(example.versionId, /^[a-f0-9-]{36}$/u);
    assert.match(example.sectionId, /^[a-f0-9-]{36}$/u);
    assert.match(example.originalSha256, /^[a-f0-9]{64}$/u);
    assert.equal(example.payload.details.original.url, example.sourceUrl);
    return `<div data-binding data-source-id="${escapeAttribute(example.sourceId)}"
      data-version-id="${escapeAttribute(example.versionId)}"
      data-section-id="${escapeAttribute(example.sectionId)}"
      data-original-sha256="${escapeAttribute(example.originalSha256)}">${renderSourceCard(example.payload)}</div>`;
  }).join("\n");
  fs.writeFileSync(pageFile, `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>actual source display</title>${cards}`);
  let browser;
  let externalRequests = 0;
  const pageErrors = [];
  try {
    browser = await chromium.launch({
      executablePath: "/repl/tools/bin/chromium", headless: true,
      env: { PATH: "/usr/bin:/bin", HOME: temporary, LANG: "C.UTF-8" },
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND"],
    });
    const context = await browser.newContext({ offline: true, serviceWorkers: "block" });
    const target = pathToFileURL(pageFile).href;
    await context.route("**/*", route => {
      if (route.request().url() === target) return route.continue();
      externalRequests += 1;
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(target);
    assert.equal(await page.locator("[data-binding]").count(), display.examples.length);
    assert.equal(await page.locator("[data-short-answer]").count(), display.examples.length);
    assert.equal(await page.locator("[data-evidence-details][open]").count(), 0);
    for (let index = 0; index < display.examples.length; index += 1) {
      const binding = page.locator("[data-binding]").nth(index);
      const example = display.examples[index];
      assert.equal(await binding.getAttribute("data-source-id"), example.sourceId);
      assert.equal(await binding.getAttribute("data-version-id"), example.versionId);
      assert.equal(await binding.getAttribute("data-section-id"), example.sectionId);
      assert.equal(await binding.getAttribute("data-original-sha256"), example.originalSha256);
      await binding.locator("summary").click();
      assert.equal(await binding.locator("[data-original-source]").count(), 1);
      assert.equal(await binding.locator("[data-editorial-derivative]").count(), 1);
      assert.equal(await binding.locator("[data-evidence-details]").evaluate(element => element.open), true);
      await binding.locator("summary").click();
      assert.equal(await binding.locator("[data-evidence-details]").evaluate(element => element.open), false);
    }
    assert.equal(externalRequests, 0);
    assert.deepEqual(pageErrors, []);
    return { format: "weiku.parenting-expansion.offline-browser.v1", passed: true,
      examples: display.examples.length, externalRequests: 0, normalServerStarted: false };
  } finally {
    await browser?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}