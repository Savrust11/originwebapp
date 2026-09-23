import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { root, output, sha } from "./prepare.mjs";

const text = value => String(value).replaceAll("\uFF5E", "\u301C");
const escape = value => text(value).replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nhs = record => /(?:\bnhs\b|nhs\.uk)/iu.test(`${record.publisher} ${record.officialUrl}`);
export async function verifyExpansionDisplay(result, input) {
  const records = [...input.prior.records, ...input.additions];
  const bindings = result.expansion04.records;
  assert.equal(bindings.length, records.length);
  const audit = bindings.map(binding => {
    const record = records.find(r => r.id === binding.id);
    assert(record);
    assert.equal(binding.originalSha256, sha(record.originalText));
    assert(binding.sourceId && binding.versionId && binding.sectionId);
    return { ...binding, originalPublisher: record.publisher, officialUrl: record.officialUrl,
      originalText: record.originalText, checkedOn: record.checkedOn, permission: record.permission,
      sourceLocation: record.sourceLocation, attribution: record.attribution ?? null };
  });
  // Audit provenance is NOT in a parent-facing NHS adaptation card, even hidden.
  fs.writeFileSync(path.join(output, "internal-provenance.json"), JSON.stringify({
    invocationNonce: result.invocationNonce, runId: result.runId, audience: "internal_audit_only", records: audit,
  }, null, 2) + "\n");
  const font = fs.readFileSync(path.join(root, "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
  const cards = bindings.map(binding => {
    const record = records.find(r => r.id === binding.id);
    const restricted = nhs(record);
    if (restricted) {
      assert(/Open Government|OGL/iu.test(`${record.attribution?.reuseBasis} ${record.permission.basis}`),
        `${record.id}: NHS adaptation requires recorded applicable OGL basis`);
      assert(!/NHS|nhs\.uk/iu.test(record.summaryJa), "NHS adaptation cannot itself attach source attribution");
    }
    const editorial = `<p data-summary>${escape(record.summaryJa)}</p><p>編集：Weiku。独自の日本語要約であり、公式助言・正式採用・公開済み回答ではありません。</p>`;
    const provenance = restricted
      ? "<p data-licence>Contains public sector information licensed under the Open Government Licence v3.0.</p>"
      : `<details><summary>原資料と利用範囲</summary><p data-original>${escape(record.originalText)}</p>
          <p>${escape(record.publisher)}</p><a rel="noreferrer" href="${escape(record.officialUrl)}">${escape(record.officialUrl)}</a>
          <p>${escape(record.sourceLocation)}</p><p>${escape(record.attribution?.requiredCredit ?? record.permission.basis)}</p></details>`;
    return `<article data-index="${bindings.indexOf(binding)}" data-restricted="${restricted}">
      <h2>${escape(restricted ? "育児の実践情報（編集要約）" : record.title)}</h2>
      ${editorial}<p data-scope>${escape(record.scope ? JSON.stringify(record.scope) : `${record.coverage} ${Object.values(record.geography).filter(Boolean).join("・")}`)}</p>
      <p>確認日 <time>${escape(record.checkedOn)}</time></p><p>${escape(record.mustNotAssert.join("／"))}</p>
      ${provenance}<p>draft / testOnly / factReady 0 / 採用・公開未承認</p></article>`;
  }).join("\n");
  const file = path.join(output, "source-display-04.html");
  fs.writeFileSync(file, `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><title>非公開資料表示検証</title><style>@font-face{font-family:LocalJP;src:url(data:font/woff2;base64,${font})}body{font:16px LocalJP,sans-serif;line-height:1.8;max-width:1000px;margin:30px auto;padding:20px;background:#f4f7f5;color:#17352a}article{background:white;padding:24px;border:1px solid #cbd7ce;border-radius:12px;margin:20px 0}p,a{overflow-wrap:anywhere}h2{font-size:20px}</style><h1>非公開資料表示検証</h1><p>出典の保存・検索・表示確認であり、個別の助言や科学的確実性の承認ではありません。</p>${cards}</html>`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "expansion04-browser-"));
  let browser;
  let externalRequests = 0;
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
      externalRequests++; return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(target);
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.fonts.check("16px LocalJP", "非公開資料表示検証")));
    assert.equal(await page.locator("article").count(), records.length);
    for (const [index, binding] of bindings.entries()) {
      const record = records.find(r => r.id === binding.id);
      const card = page.locator("article").nth(index);
      assert.equal(await card.locator("[data-summary]").innerText(), text(record.summaryJa));
      assert.equal(await card.locator("time").innerText(), record.checkedOn);
      if (nhs(record)) {
        assert.equal(await card.locator("a,details").count(), 0);
        assert(!/NHS|nhs\.uk/iu.test(await card.innerHTML()));
        assert.equal(await card.locator("[data-licence]").count(), 1);
      } else {
        await card.locator("summary").click();
        assert.equal(await card.locator("[data-original]").innerText(), text(record.originalText));
        assert.equal(await card.locator("a").getAttribute("href"), record.officialUrl);
        await card.locator("summary").click();
      }
    }
    assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "source-display-04.png"), fullPage: true });
    await page.screenshot({ path: path.join(output, "source-display-04-viewport.png") });
  } finally {
    await browser?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
    assert.equal(fs.existsSync(temporary), false);
  }
  return { passed: true, records: records.length, externalRequests, localJapaneseFontLoaded: true,
    sourceVersionSectionBindingsVerified: true, separateInternalNhsProvenance: true,
    browserTemporaryDirectoryRemoved: true, screenshot: "source-display-04.png" };
}