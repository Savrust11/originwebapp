import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { root, output } from "./prepare.mjs";
// The locally licensed Japanese subset has U+301C but not U+FF5E.
// Normalize only this visually equivalent range punctuation in presentation;
// all stored research text/hashes remain unchanged.
const displayText = value => String(value).replaceAll("\uFF5E", "\u301C");
const escape = value => displayText(value).replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function verifyMunicipalDisplay(result, input) {
  const font = fs.readFileSync(path.join(root, "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
  const cards = result.municipal.records.map(binding => {
    const record = input.records.find(r => r.id === binding.id);
    assert(record);
    return `<article data-id="${escape(record.id)}" data-source="${escape(binding.sourceId)}" data-version="${escape(binding.versionId)}" data-section="${escape(binding.sectionId)}">
      <h2>${escape(record.title)}</h2><p data-summary>編集した事実要約（公式助言・採用済み回答ではありません）：${escape(record.summaryJa)}</p>
      <p>確認範囲：${escape(record.coverage)}／${escape(Object.values(record.geography).filter(Boolean).join("・"))}</p>
      <p>確認日：<time>${escape(record.checkedOn)}</time>。空き状況・予約成立は保証しません。</p>
      <details><summary>出典と利用条件を確認</summary><p>原資料の識別用短見出し（本文抜粋ではありません）</p><p data-original>${escape(record.originalText)}</p>
      <a href="${escape(record.officialUrl)}" rel="noreferrer">${escape(record.officialUrl)}</a>
      <p>${escape(record.sourceLocation)}</p><p data-permission>${escape(JSON.stringify(record.permission))}</p>
      <p>draft / testOnly / factReady 0 / 採用・公開未承認 / externalAI ${escape(record.permission.externalAI)}</p>
      <p>source ${escape(binding.sourceId)} / version ${escape(binding.versionId)} / section ${escape(binding.sectionId)}</p></details></article>`;
  }).join("\n");
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><title>自治体情報・非公開検証</title>
    <style>@font-face{font-family:LocalJP;src:url(data:font/woff2;base64,${font})}body{font:16px LocalJP,sans-serif;line-height:1.7;max-width:1050px;margin:30px auto;padding:20px;color:#153029;background:#f6f8f5}article{background:white;border:1px solid #ccd9d0;border-radius:12px;padding:20px;margin:20px 0}h1{font-size:26px}h2{font-size:20px}a{overflow-wrap:anywhere}summary{cursor:pointer;color:#245c44}p{overflow-wrap:anywhere}</style>
    <h1>自治体情報・非公開検証</h1><p>全域を網羅した資料ではありません。既存DBへの適用・正式採用・公開は行っていません。</p>${cards}</html>`;
  const file = path.join(output, "municipal-source-display.html");
  fs.writeFileSync(file, html);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "expansion03-browser-"));
  let browser;
  let attemptedExternalRequests = 0;
  const errors = [];
  try {
    const executablePath = ["/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
    assert(executablePath, "installed offline Chromium required");
    browser = await chromium.launch({ executablePath, headless: true,
      env: { PATH: "/usr/bin:/bin", HOME: temporary, LANG: "C.UTF-8" },
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND"],
    });
    const context = await browser.newContext({ offline: true, serviceWorkers: "block", viewport: { width: 1200, height: 900 } });
    const target = pathToFileURL(file).href;
    await context.route("**/*", route => {
      const url = route.request().url();
      if (url === target || url.startsWith("data:")) return route.continue();
      attemptedExternalRequests++; return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(target);
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.fonts.check("16px LocalJP", "自治体情報・非公開検証")));
    assert.equal(await page.locator("article").count(), input.records.length);
    assert.equal(await page.locator("details[open]").count(), 0);
    for (const [index, binding] of result.municipal.records.entries()) {
      const record = input.records.find(r => r.id === binding.id);
      const card = page.locator("article").nth(index);
      assert.equal(await card.getAttribute("data-source"), binding.sourceId);
      assert.equal(await card.getAttribute("data-version"), binding.versionId);
      assert.equal(await card.getAttribute("data-section"), binding.sectionId);
      assert((await card.locator("[data-summary]").textContent()).includes(displayText(record.summaryJa)), `${record.id}: summary text binding changed`);
      assert((await card.locator("[data-summary]").innerText()).replace(/\s+/gu, " ").includes(displayText(record.summaryJa).replace(/\s+/gu, " ")), `${record.id}: visible summary differs beyond layout whitespace`);
      await card.locator("summary").click();
      assert.equal(await card.locator("[data-original]").innerText(), record.originalText);
      assert.equal(await card.locator("a").getAttribute("href"), record.officialUrl);
      assert.equal(await card.locator("time").innerText(), record.checkedOn);
      await card.locator("summary").click();
    }
    assert.equal(attemptedExternalRequests, 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "municipal-source-display.png"), fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, "municipal-source-display-viewport.png") });
    return { passed: true, records: input.records.length, attemptedExternalRequests, localJapaneseFontLoaded: true, bindingsVerified: true, presentationOnlyRangePunctuation: "U+FF5E to U+301C; stored text unchanged", screenshot: "municipal-source-display.png", browserTemporaryDirectoryRemoved: true };
  } finally {
    await browser?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
    assert.equal(fs.existsSync(temporary), false);
  }
}