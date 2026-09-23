import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { sourceDisplayPayload, renderSourceCard } from "./source-display.mjs";

const payload = sourceDisplayPayload({
  answer: "子どもの様子を見ながら、一つ試せる選択肢を短く示します。",
  suggestionClass: "practical_guidance",
  original: {
    title: "Official parent guidance",
    publisher: "Example public body",
    url: "https://official.example.invalid/guidance",
    passage: "A bounded original passage.",
    country: "Example country",
    language: "en",
    ageDescription: "age as stated by source",
    updatedOn: null,
    checkedOn: "2026-09-20",
  },
  derivative: {
    isOriginal: false,
    text: "We育による日本語要約です。",
  },
  rights: {
    copyrightPermission: { status: "confirmed_for_test_display" },
    contentVerified: { status: "verified_against_snapshot" },
    adoptionApproval: { status: "not_approved" },
    publicationStatus: { status: "not_published" },
    externalAI: { status: "not_authorized" },
    displayNotice: "Private test display under recorded source-specific terms.",
    termsUrl: "https://official.example.invalid/terms",
  },
});
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parenting-expansion-display-"));
const pageFile = path.join(temporary, "index.html");
fs.writeFileSync(pageFile, `<!doctype html><meta charset="utf-8"><title>source display check</title>${renderSourceCard(payload)}`);
let browser;
let externalRequests = 0;
try {
  browser = await chromium.launch({
    executablePath: "/repl/tools/bin/chromium",
    headless: true,
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
  assert.equal(await page.locator("[data-short-answer]").count(), 1);
  assert.equal(await page.locator("[data-evidence-details]").evaluate(element => element.open), false,
    "details must remain collapsed until the user asks to see the basis");
  await page.locator("summary").click();
  assert.equal(await page.locator("[data-original-source]").count(), 1);
  assert.equal(await page.locator("[data-editorial-derivative]").count(), 1);
  assert.match(await page.locator("[data-use-status]").innerText(), /not_approved.*not_published.*not_authorized/u);
  assert.equal(externalRequests, 0, "offline display check made an external request");
  console.log("offline source-display browser check: passed");
} finally {
  await browser?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}