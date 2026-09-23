import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { renderSourceCard } from "./source-display.mjs";

export async function verifyParentDisplayRevision(parent, audit) {
  assert.equal(parent.runId, audit.runId);
  const serializedParent = JSON.stringify(parent);
  assert(!/nhs\.uk|NHS website|Department of Health/iu.test(serializedParent),
    "parent-facing adaptation payload must not contain NHS source attribution");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parent-display-revision-"));
  const pageFile = path.join(temporary, "index.html");
  fs.writeFileSync(pageFile, `<!doctype html><meta charset="utf-8"><title>display revision</title>${parent.examples.map(example =>
    `<div data-display-key="${example.displayKey}">${renderSourceCard(example.payload)}</div>`).join("")}`);
  let browser;
  let externalRequests = 0;
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
    await page.goto(target);
    const nhs = page.locator('[data-display-key="infant-play-from-four-months"]');
    assert.equal(await nhs.locator("[data-evidence-details]").evaluate(element => element.open), false);
    await nhs.locator("summary").click();
    assert.equal(await nhs.locator("[data-original-source]").count(), 0);
    assert.equal(await nhs.locator("[data-editorial-derivative]").count(), 1);
    assert.equal(await nhs.locator("[data-display-conditions]").count(), 1);
    const nhsText = await nhs.innerText();
    assert(!/NHS|Baby and toddler play ideas|Department of Health/iu.test(nhsText));
    const nhsHrefs = await nhs.locator("a").evaluateAll(links => links.map(link => link.getAttribute("href")));
    assert(nhsHrefs.every(href => !href?.includes("nhs.uk")));
    const care = page.locator('[data-display-key="nidirect-share-newborn-care"] [data-short-answer]');
    assert.match(await care.innerText(), /新生児期/u);
    assert.match(await care.innerText(), /安全に頼める別の養育者がいる場合/u);
    const nidirect = page.locator('[data-display-key="nidirect-school-daily-routine"]');
    await nidirect.locator("summary").click();
    assert.equal(await nidirect.locator("[data-original-source]").count(), 1);
    assert.equal(externalRequests, 0);
    return {
      format: "weiku.parenting-expansion.parent-display-browser.v1",
      passed: true,
      nhsParentCardPublisherAttribution: false,
      nhsOriginalUrlInParentCard: false,
      nhsInternalAuditBindingCount: audit.examples.length,
      careSharingSafetyConditionInShortAnswer: true,
      externalRequests: 0,
      normalServerStarted: false,
    };
  } finally {
    await browser?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}