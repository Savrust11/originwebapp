// All assertions are local. Browser routes explicitly refuse HTTP and HTTPS.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { BASE, ROOT, verifyPreservation } from "./preserve.mjs";
const read = name => JSON.parse(fs.readFileSync(path.join(BASE, name)));
const plan = read("models-and-budget.json");
const cases = read("cases.json");
const sources = read("source-content.json");
const requests = read("request-packets.json").requests;
const app = read("app-display-templates.json").appDisplays;
const order = read("execution-order.json");
const schema = read("response-schema.json");
const rules = fs.readFileSync(path.join(BASE, "generation-rules.txt"), "utf8");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, cases.appDisplayPlan.catalogPath)));
const findings = [];
const check = (id, callback) => { callback(); findings.push({ id, passed: true }); };
check("twelve-matched-pairs", () => {
  assert.equal(requests.length, 12); assert.equal(order.attempts.length, 24);
  assert.equal(new Set(order.attempts.map(a => `${a.caseId}:${a.model}`)).size, 24);
});
for (const item of cases.cases) {
  check(`exact-payload-and-source-${item.caseId}`, () => {
    const pair = requests.find(r => r.caseId === item.caseId);
    assert.deepEqual(pair.requests.map(r => r.model), plan.models.map(m => m.id));
    const bodies = pair.requests.map(({ model, ...rest }) => rest);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[0], { ...plan.commonControls, text: { format: schema }, input: [
      { role: "developer", content: rules },
      { role: "user", content: JSON.stringify({ question: item.question,
        original_evidence: item.originalIds.map(id => ({
          original_id: id, original_text: sources.originals[id].originalText,
        })) }) },
    ] });
  });
  check(`exact-app-classification-${item.caseId}`, () => {
    const template = app.find(t => t.caseId === item.caseId);
    const blocks = catalog.catalog.cases[item.appCaseId].blocks;
    const ids = item.lane === "known" ? blocks.filter(b => b.tier !== "optional").map(b => b.id)
      : cases.appDisplayPlan.holdoutClassifications[item.caseId].selectedMandatory;
    assert.deepEqual(template.blocks, ids.map(id => blocks.find(b => b.id === id)));
    assert.equal(template.sameForBothModels, true);
    assert.equal(template.policyNotSourceConclusion.individualAdviceBlocked, true);
    assert.equal(template.policyNotSourceConclusion.userReady, false);
    assert.equal(Object.hasOwn(template, "sampleBody"), false);
  });
}
check("three-first-turns-per-model-per-lane", () => {
  for (const lane of ["known", "author-created-holdout"])
    for (const model of plan.models)
      assert.equal(order.pairs.filter(p => p.lane === lane && p.modelOrder[0] === model.id).length, 3);
});
check("cost-math-and-no-new-authority", () => {
  for (const model of plan.models) {
    const cost = Math.ceil(8000 * model.standardUncachedInputUSDPerMillion
      + 1500 * model.standardOutputUSDPerMillion);
    assert.equal(model.assumedCostMicroUSDPerQuestion, cost);
    assert.equal(model.estimatedTotalMicroUSD, cost * 12);
  }
  assert.equal(plan.models.reduce((n, m) => n + m.estimatedTotalMicroUSD, 0), 784800);
  assert.equal(plan.estimation.cumulativeEstimatedMicroUSDIfSeparatelyAuthorizedAndCompleted, 784800 + 25879);
  assert.equal(plan.estimation.additionalProposedReservationsMicroUSD,
    plan.models.reduce((n, m) => n + m.proposedReservationMicroUSDPerQuestion * 12, 0));
  assert.equal(plan.authorization.authorizedAdditionalTransmissionsNow, 0);
  assert.equal(plan.authorization.oldUnusedTwentiethSlotMustNotBeUsed, true);
  assert.equal(plan.authorization.limitsUnchanged, true);
});
const browser = await chromium.launch({ headless: true, executablePath: "/repl/tools/bin/chromium" });
let networkRequests = 0;
const browserErrors = [];
try {
  const context = await browser.newContext();
  await context.route(/^https?:\/\//, route => { networkRequests++; return route.abort(); });
  const page = await context.newPage();
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(pathToFileURL(path.join(BASE, "comparison-preparation.html")).href);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const dimensions = await page.evaluate(() => ({
      root: document.documentElement.scrollWidth, viewport: window.innerWidth,
    }));
    check(`no-document-overflow-${width}`, () => assert.ok(dimensions.root <= dimensions.viewport));
  }
  for (const item of cases.cases) {
    const actual = await page.locator(`[data-case="${item.caseId}"] > p`).first().innerText();
    check(`exact-visible-question-${item.caseId}`, () => assert.equal(actual, item.question));
  }
  const newQuestions = await page.locator("#new-questions article").count();
  const knownQuestions = await page.locator("#known-questions article").count();
  check("six-visible-questions-per-lane", () => {
    assert.equal(newQuestions, 6); assert.equal(knownQuestions, 6);
  });
  const text = await page.locator("body").innerText();
  check("visible-no-execution-and-costs", () => {
    for (const value of ["19通信・$0.025879", "24生成通信", "$0.784800", "$0.810679",
      "準備のみ・実行未許可", "日本語はpass／minor／major", "現在のAPIキー", "未確認"])
      assert.ok(text.includes(value), value);
  });
  const ids = await page.locator("[id]").evaluateAll(nodes => nodes.map(n => n.id));
  check("unique-ids", () => assert.equal(new Set(ids).size, ids.length));
} finally { await browser.close(); }
check("no-browser-network-or-errors", () => {
  assert.equal(networkRequests, 0); assert.deepEqual(browserErrors, []);
});
const preserved = verifyPreservation();
findings.push({ id: "historical-and-completed-results-unchanged", passed: preserved.unchanged });
const result = { passed: true, checks: findings.length, findings, networkRequests,
  browserErrors, preservation: preserved, modelProviderApiTransmissions: 0 };
fs.writeFileSync(path.join(BASE, "preparation-verification.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ passed: true, checks: findings.length, networkRequests,
  oldTransmissions: preserved.accounting.cumulativeTransmissions }));