import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { renderEvidence } from "../renderer.mjs";
import { createFixtureSearch } from "../fixture-search.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const output = path.join(root, "evidence-work/cfa100-06/browser");
const html = path.join(output, "offline.html");
const provenance = JSON.parse(fs.readFileSync(path.join(output, "build-provenance.json")));
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(sha(html), provenance.offlineHtmlSha256, "Built final artifact has changed");
for (const [name, hash] of Object.entries(provenance.artifacts)) {
  assert.equal(sha(path.join(root, `evidence-work/cfa100-06/validation/${name}.json`)), hash, "Measured run changed; rebuild first");
}
const probes = [
  ["S01-natural", "出かけたいのに遊びをやめない", "CFA100-S01"],
  ["S01-paraphrase", "帰る時間なのにまだ遊ぶ", "CFA100-S01"],
  ["S02-natural", "何を考えているのか分からない", "CFA100-S02"],
  ["S02-paraphrase", "言葉で伝えられない気持ちを知りたい", "CFA100-S02"],
  ["S03-natural", "家事ばかりで相手をする余裕がない", "CFA100-S03"],
  ["S03-paraphrase", "仕事と家事が重なって忙しくて余裕がない", "CFA100-S03"],
  ["S04-natural", "失敗すると怖がる", "CFA100-S04"],
  ["S04-paraphrase", "失敗したあと不安そうな子にどう寄り添う", "CFA100-S04"],
  ["S05-natural", "すぐ手伝ってしまう", "CFA100-S05"],
  ["S05-paraphrase", "自分でやろうとしている時つい代わりにやる", "CFA100-S05"],
  ["S06-natural", "遊んでばかりでいいの？", "CFA100-S06"],
  ["S06-paraphrase", "遊びの時間に何を教えるとよいのでしょう", "CFA100-S06"],
  ["S07-natural", "一人で子育てを抱え込んでいる", "CFA100-S07"],
  ["S07-paraphrase", "頼れる人がいないので相談したい", "CFA100-S07"],
  ["S08-natural", "親子で行けて話せる場所", "CFA100-S08"],
  ["S08-paraphrase", "地域の相談ができる親子の居場所を知りたい", "CFA100-S08"],
];
const cases = [
  ...probes.map(([id]) => ({ id, status: "not_run" })),
  ...["unsupported-childcare", "unsupported-grams", "unsupported-medical", "unsafe-watch",
    "source-citations", "missing-context-blocked", "missing-context-binding-blocked", "mismatched-fact-blocked", "optional-region", "nearby-city-then-local", "bare-naka-then-resolved", "benign-tuesday", "input-invalidation", "review-gates", "no-network",
    "japanese-screenshot"].map(id => ({ id, status: "not_run" })),
];
fs.mkdirSync(path.join(output, "screenshots"), { recursive: true });
const save = () => fs.writeFileSync(path.join(output, "outcomes.json"), JSON.stringify({
  ...provenance, counts: Object.fromEntries(["pass", "fail", "not_run"].map(status => [status, cases.filter(c => c.status === status).length])), cases,
}, null, 2));
save();
async function independent(id, run) {
  const result = cases.find(c => c.id === id);
  try { await run(result); result.status = "pass"; }
  catch (error) { result.status = "fail"; result.error = String(error.stack ?? error); }
  save();
}
const fixtureSearch = createFixtureSearch({
  fixture: JSON.parse(fs.readFileSync(path.join(root, "evidence-work/cfa100-06/validation/dictionary-fixture.json"))),
  bindings: JSON.parse(fs.readFileSync(path.join(root, "evidence-work/cfa100-06/validation/source-bindings.json"))),
});
for (const [id, mutate] of [
  ["missing-context-blocked", result => { result.requiredContext = []; }],
  ["missing-context-binding-blocked", result => { result.requiredContextBindings = []; }],
  ["mismatched-fact-blocked", result => { result.fact.versionId = "mismatched"; }],
]) await independent(id, async () => {
  const response = await fixtureSearch({ question: "すぐ手伝ってしまう", region: null });
  const result = structuredClone(response.results.find(r => r.fact?.unitId === "CFA100-S05"));
  assert(result);
  mutate(result);
  assert.equal(renderEvidence({ results: [result], question: "すぐ手伝ってしまう" }).status, "blocked");
});
let browser;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cfa100-offline-browser-"));
try {
  assert(fs.existsSync("/repl/tools/bin/chromium"), "Existing Chromium required; do not download");
  browser = await chromium.launch({
    executablePath: "/repl/tools/bin/chromium", headless: true,
    env: { PATH: "/usr/bin:/bin", HOME: home, LANG: "C.UTF-8" },
    args: ["--allow-file-access-from-files", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  const context = await browser.newContext({ offline: true, serviceWorkers: "block", viewport: { width: 430, height: 900 } });
  let remoteRequests = 0;
  await context.route("**/*", route => {
    if (/^https?:/u.test(route.request().url())) { remoteRequests++; return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(html).href);
  await page.evaluate(() => document.fonts.ready);
  async function query(question) {
    await page.locator("#question").fill(question);
    await page.locator("button[type=submit]").click();
    await page.waitForFunction(() => window.__CFA_BROWSER__?.getState().status !== "searching");
    return page.evaluate(() => window.__CFA_BROWSER__.getState());
  }
  for (const [id, question, expected] of probes) await independent(id, async result => {
    const state = await query(question);
    const presentation = state.presentation;
    result.question = question;
    result.retrieved = state.results.map(r => r.fact?.unitId ?? r.unitId ?? r.sectionId);
    result.displayed = presentation?.evidence?.map(r => r.fact?.unitId);
    assert.equal(presentation?.status, "ready");
    assert(result.displayed.includes(expected), `Expected ${expected}; displayed ${result.displayed}`);
    assert.equal(presentation.modelOutput, false);
    assert(await page.locator(".label").innerText().then(text => text.includes("編集見本・実際のAI回答ではない")));
    assert(await page.locator(".clarification").count() <= 1);
    if (expected === "CFA100-S05") {
      assert.match(presentation.suggestion, /助けられる距離/u);
      assert(presentation.evidence[0].requiredContext.length > 0);
    }
  });
  for (const [id, question] of [
    ["unsupported-childcare", "子どもを預けられる？"], ["unsupported-grams", "離乳食を何グラム？"],
    ["unsupported-medical", "相手の顔色から病気を判断して"], ["unsafe-watch", "危険な道路でも挑戦を見守って目を離してよい？"],
  ]) await independent(id, async () => {
    const state = await query(question);
    assert.equal(state.presentation?.status, "blocked");
    assert.equal(await page.locator(".evidence").count(), 0);
  });
  await independent("source-citations", async () => {
    const state = await query("すぐ手伝ってしまう");
    const evidence = state.presentation.evidence[0];
    assert(evidence?.sourceId && evidence.versionId);
    await page.locator(".evidence > summary").first().click();
    const text = await page.locator(".evidence").innerText();
    assert(text.includes(evidence.sourceId) && text.includes(evidence.versionId));
    assert.match(text, /印刷5ページ.*PDF6ページ/u);
    assert.match(text, /印刷4ページ.*PDF5ページ/u);
    assert.match(text, /いざとなったら助けられる距離感/u);
    assert.equal(await page.locator(".contextual-fact article[data-fact]").count(), 1);
  });
  await independent("optional-region", async () => {
    const state = await query("親子で行けて話せる場所");
    assert.equal(state.region, null);
    assert.equal(state.presentation.status, "ready");
    assert.match(state.presentation.suggestion, /親子|交流/u);
    const html = await page.locator("#answer").innerHTML();
    assert.equal(await page.locator(".clarification").count(), 0, "General explanation needs no city question");
    assert(html.includes('class="suggestion"'));
  });
  await independent("nearby-city-then-local", async result => {
    const question = "近くの親子で行けて話せる場所、子育て相談の施設を知りたい";
    let state = await query(question);
    assert.equal(state.presentation.status, "ready");
    assert.equal(await page.locator(".clarification").count(), 1);
    assert.equal(await page.locator(".local-evidence").count(), 0);
    await page.locator("form details > summary").click();
    await page.locator("#prefecture").fill("神奈川県");
    await page.locator("#municipality").fill("横浜市");
    await page.locator("#ward").fill("中区");
    state = await query(question);
    result.localSections = state.presentation.localEvidence.map(r => r.sectionId);
    assert.equal(state.geography.status, "resolved");
    assert(state.presentation.localEvidence.length > 0);
    assert.equal(await page.locator(".clarification").count(), 0);
    for (const record of state.presentation.localEvidence) {
      assert.equal(record.geography.municipality, "横浜市");
      const panel = page.locator(`.local-evidence[data-section="${record.sectionId}"]`);
      for (const field of Object.values(record.sourceFields)) if (field.status === "verified") {
        assert((await panel.innerText()).includes(String(field.value)));
      }
    }
    await page.screenshot({ path: path.join(output, "screenshots/local-yokohama-source-fields.png"), fullPage: true });
    for (const key of ["prefecture", "municipality", "ward"]) await page.locator(`#${key}`).fill("");
  });
  await independent("bare-naka-then-resolved", async () => {
    for (const key of ["prefecture", "municipality", "ward"]) await page.locator(`#${key}`).fill("");
    let state = await query("中区で近くの親子で行けて話せる場所、子育て相談の施設を知りたい");
    assert.equal(state.geography.status, "ambiguous");
    assert.equal(await page.locator(".clarification").count(), 1);
    assert.equal(await page.locator(".local-evidence").count(), 0);
    await page.locator("#prefecture").fill("愛知県");
    await page.locator("#municipality").fill("名古屋市");
    await page.locator("#ward").fill("中区");
    state = await query("中区で近くの親子で行けて話せる場所、子育て相談の施設を知りたい");
    assert.equal(state.geography.status, "resolved");
    assert(state.presentation.localEvidence.length > 0);
    assert(state.presentation.localEvidence.every(r => r.geography.municipality === "名古屋市"));
    for (const key of ["prefecture", "municipality", "ward"]) await page.locator(`#${key}`).fill("");
  });
  await independent("benign-tuesday", async () => {
    const state = await query("火曜日にすぐ手伝ってしまう");
    assert.equal(state.presentation.status, "ready");
  });
  await independent("input-invalidation", async () => {
    await query("すぐ手伝ってしまう");
    await page.locator("#question").fill("入力を変更");
    assert.equal(await page.locator(".evidence").count(), 0);
    assert.equal(await page.locator(".suggestion").count(), 0);
  });
  await independent("review-gates", async () => {
    assert.equal(provenance.formalAdoption, "not_approved");
    assert.equal(provenance.publication, "not_published");
    assert.match(await page.locator(".admin").textContent(), /ファイル名の日付を発行日として扱いません/u);
  });
  await independent("japanese-screenshot", async () => {
    await page.locator("form details").evaluate(element => { element.open = false; });
    await query("すぐ手伝ってしまう");
    await page.locator(".evidence > summary").first().click();
    await page.screenshot({ path: path.join(output, "screenshots/s05-japanese-mobile.png"), fullPage: true });
    await query("親子で行けて話せる場所");
    await page.screenshot({ path: path.join(output, "screenshots/s08-general-before-region.png"), fullPage: true });
  });
  await independent("no-network", async result => {
    result.remoteRequests = remoteRequests; assert.equal(remoteRequests, 0);
    assert.equal(provenance.modelAPICalls, 0);
  });
} finally {
  await browser?.close();
  fs.rmSync(home, { recursive: true, force: true });
  save();
}
if (cases.some(c => c.status !== "pass")) process.exitCode = 1;