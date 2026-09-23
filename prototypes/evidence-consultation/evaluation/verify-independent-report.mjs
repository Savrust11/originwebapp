#!/usr/bin/env node

/**
 * Read-only offline integrity/browser verification. No API, network, DB,
 * secret, ledger, result, preparation, or source mutation is performed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildVerifiedAttributionRelations } from "./attribution-data.mjs";
import { assembleAttributionDisplay } from "./attribution-display.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const base = path.join(root, "evidence-work/model-evaluation");
const runId = process.argv[2] ?? "independent-cases-20260918";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) throw new Error("invalid_run_id");
const prep = path.join(base, "independent-preparation", runId);
const reportPath = path.join(base, "independent-reading-results.html");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const escaped = value => String(value).replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const optionalJson = async file => {
  try { return await json(file); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};
const [report, ledger, prepared, catalogFile, q05Result, q05Review] = await Promise.all([
  readFile(reportPath, "utf8"), json(path.join(base, "api-call-ledger.json")),
  optionalJson(path.join(prep, "prepared-package.json")),
  optionalJson(path.join(prep, "citable-catalog.json")),
  json(path.join(base, "revision-results/source-roles-20260918/Q05.json")),
  json(path.join(base, "revision-results/source-roles-20260918/Q05-review.json")),
]);
const catalog = catalogFile?.catalog ?? catalogFile ?? {};
const cases = ["Q06", "Q07", "Q08", "Q09", "Q10", "Q11"];
const expectedProblems = {
  Q06: "AASM推奨という帰属を省略。「合計」という原文外の語を付加したが、24時間合計とは明示していない。",
  Q07: "重大な逸脱なし。養育者と新生児を分け、選定した養育者向け原文の三要点を保持。",
  Q08: "I²=93%と、病気・障害と診断された子または親の集団除外を省略。",
  Q09: "子・親の診断済み病気・障害除外と平均36か月超の境界を省略。非有意を効果ゼロとはしていない。",
  Q10: "Cohen's d=−0.92、95% CI −1.66〜−0.18と、診断済み医学的状態の除外を省略。",
  Q11: "改善・非改善結果は保持したが、医学的・教育場面の除外と年齢基準のプロトコル例外を省略。",
};
const baselineHash = "44cbee72645e2ff9d94e177d27336b36b7feba1ab358046aa2a8dfdf31c13e31";
assert.equal(digest(JSON.stringify(ledger.entries.slice(0, 7))), baselineHash,
  "frozen first seven ledger entries changed");
assert.equal(ledger.entries.length, 13, "completed ledger count changed");
assert.equal(ledger.limits?.maxApiTransmissions, 20, "transmission limit changed");
assert.equal(ledger.entries.slice(7).reduce((sum, entry) => sum + entry.measuredMicroUSD, 0),
  8984, "independent cost changed");
assert.equal(ledger.entries.reduce((sum, entry) =>
  sum + (Number.isSafeInteger(entry.measuredMicroUSD) ? entry.measuredMicroUSD : 0), 0),
  17093, "total cost changed");
for (const [id, expected] of Object.entries({
  E01: "ff938483ebd2970f71cf51884b30999dca185d82be097c7e2f08bf29b01237c3",
  E02: "97ddaddb95db1d8581c4bfa7aa9f7e79bebf9a20269023832dbb136f63d1b5b5",
  E03: "cf6da398b615a2ac96ca65145b949475bc26f211fcfcd0563854e20541168a76",
  E04: "061bf103c8b1056fbc8d1744fc5ac4e47e3dc67418c2042f3614ba0f3706f352",
})) {
  assert.equal(digest(await readFile(path.join(root, `evidence-work/v0.2/${id}.json`))), expected,
    `${id} source changed`);
}
assert.ok(report.includes(escaped(q05Result.outputText)), "saved Q05 answer not verbatim");
assert.ok(report.includes(escaped(q05Review.findings[0])), "Q05 failed review not preserved");
assert.doesNotMatch(q05Result.outputText, /このガイドが紹介する米国睡眠医学会（AASM）の推奨/,
  "app attribution unexpectedly exists in raw model answer");
assert.match(report, /このガイドが紹介する米国睡眠医学会（AASM）の推奨/);
if (prepared) {
  for (const request of prepared.requests ?? []) {
    const payload = JSON.parse(request.request.input.find(item => item.role === "user").content);
    for (const original of payload.original_evidence ?? []) {
      assert.ok(report.includes(escaped(original.original_text)), `${request.case_id} original missing`);
    }
  }
}
const independentEntriesList = ledger.entries.filter(item =>
  item.independentRunId === runId || item.independent_run_id === runId);
assert.deepEqual(independentEntriesList.map(entry => [entry.caseId, entry.review?.verdict]), [
  ["Q06", "fail"], ["Q07", "pass"], ["Q08", "fail"],
  ["Q09", "fail"], ["Q10", "fail"], ["Q11", "fail"],
], "independent verdicts changed");
let q06Verification = null;
for (const entry of independentEntriesList) {
  const resultBytes = await readFile(path.join(root, entry.responseFile));
  const reviewBytes = await readFile(path.join(root, entry.reviewFile));
  assert.equal(digest(resultBytes), entry.responseFileSha256, `${entry.caseId} result hash changed`);
  assert.equal(digest(reviewBytes), entry.reviewFileSha256, `${entry.caseId} review hash changed`);
  const result = await optionalJson(path.join(base, "independent-results", runId, `${entry.caseId}.json`));
  const review = JSON.parse(reviewBytes);
  assert.equal(review.responseSha256, entry.responseFileSha256,
    `${entry.caseId} reviewed a different result`);
  assert.ok(report.includes(escaped(JSON.stringify(result, null, 2))),
    `${entry.caseId} raw result JSON missing`);
  assert.ok(report.includes(escaped(JSON.stringify(review, null, 2))),
    `${entry.caseId} raw review JSON missing`);
  assert.ok(report.includes(`${entry.measuredMicroUSD.toLocaleString("ja-JP")} µUSD`),
    `${entry.caseId} measured cost missing`);
  assert.ok(report.includes(escaped(expectedProblems[entry.caseId])),
    `${entry.caseId} concise documented summary missing`);
  if (result?.outputText) assert.ok(report.includes(escaped(result.outputText)), `${entry.caseId} answer missing`);
  for (const ref of result?.contract?.presentation?.references ?? []) {
    assert.equal(catalog[ref.original_id]?.citable, true, `untrusted reference ${ref.original_id}`);
    for (const field of ["title", "version", "locator", "url"]) {
      assert.equal(ref[field], catalog[ref.original_id][field], `untrusted ${field}`);
    }
  }
  const appDisplay = await optionalJson(
    path.join(base, "independent-results", runId, `${entry.caseId}-app-display.json`));
  if (appDisplay) {
    assert.deepEqual(appDisplay.raw_model_answer, result.answer,
      `${entry.caseId} app display changed raw model answer`);
    const attached = (appDisplay.app_display?.explanations ?? [])
      .flatMap(claim => claim.app_attributions ?? []);
    if (entry.caseId !== "Q06") assert.equal(attached.length, 0,
      `${entry.caseId} received an inferred recommendation attribution`);
    for (const attribution of attached) {
      assert.equal(attribution.relation_id,
        "ATTR-E02-GUIDE-INTRODUCES-AASM-SLEEP-DURATION");
      assert.equal(attribution.supporting_original_id, "E02-F-S01-S02-SHARED");
      assert.equal(attribution.model_supplied, false);
      assert.equal(attribution.semantic_approval, false);
      assert.equal(attribution.provenance, "app_attached_verified_relationship_not_model_output");
    }
    if (entry.caseId === "Q06") {
      assert.equal(appDisplay.rawResultSha256, entry.responseFileSha256);
      assert.equal(appDisplay.modelReviewSha256, entry.reviewFileSha256);
      assert.equal(appDisplay.modelVerdict, "fail");
      assert.equal(appDisplay.appDisplayDoesNotChangeModelVerdict, true);
      const e02 = await json(path.join(root, "evidence-work/v0.2/E02.json"));
      const reassembled = assembleAttributionDisplay(result.answer, {
        caseId: "Q06",
        relations: buildVerifiedAttributionRelations(e02),
        assessments: appDisplay.assessments,
      });
      assert.deepEqual(appDisplay.raw_model_answer, reassembled.raw_model_answer);
      assert.deepEqual(appDisplay.app_display, reassembled.app_display);
      assert.deepEqual(appDisplay.separation, reassembled.separation);
      q06Verification = appDisplay;
    }
  }
}
assert.ok(q06Verification, "Q06 app display verification missing");
const q06Result = await json(path.join(base, "independent-results", runId, "Q06.json"));
assert.doesNotMatch(report, /<(?:script|img|iframe|link)\b|@import/i);
assert.doesNotMatch(report, /\b(?:src|srcset)=["'][^"']+/i);

const browser = await chromium.launch({
  headless: true, executablePath: "/repl/tools/bin/chromium",
  args: ["--no-sandbox", "--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage();
  const external = [];
  page.on("request", request => {
    if (!["file:", "data:"].includes(new URL(request.url()).protocol)) external.push(request.url());
  });
  await page.goto(pathToFileURL(reportPath).href, { waitUntil: "load" });
  assert.deepEqual(external, [], "external resource loaded");
  assert.equal(await page.locator("#Q05-display").getAttribute("data-case-status"), "不合格（保持）");
  assert.equal(await page.locator("#Q05-display .app-attribution").count(), 1);
  assert.match(await page.locator("#Q05-display .app-attribution").innerText(),
    /掲載資料の発行元：厚生労働省[\s\S]*推奨の主体：米国睡眠医学会/);
  const q05Raw = await page.locator("#q05-raw-model-answer .answer").innerText();
  assert.equal(q05Raw, q05Result.outputText);
  assert.doesNotMatch(q05Raw, /このガイドが紹介する米国睡眠医学会（AASM）の推奨/);
  assert.equal(await page.locator("#Q06 .app-attribution").count(), 2);
  assert.equal(await page.locator("#Q06 .claim.explanation > p + .app-attribution").count(), 2,
    "Q06 attribution is not adjacent to each assessed explanation");
  assert.equal(await page.locator("#Q06 .answer").innerText(), q06Result.outputText);
  assert.doesNotMatch(q06Result.outputText,
    /このガイドが紹介する米国睡眠医学会（AASM）の推奨/);
  for (const id of ["Q07", "Q08", "Q09", "Q10", "Q11"]) {
    assert.equal(await page.locator(`#${id} .app-attribution`).count(), 0,
      `${id} received inferred AASM display`);
  }
  const independentEntries = new Map(ledger.entries.filter(item =>
    item.independentRunId === runId || item.independent_run_id === runId).map(item => [item.caseId, item]));
  for (const id of cases) {
    const entry = independentEntries.get(id);
    const actual = await page.locator(`#${id}`).getAttribute("data-case-status");
    const review = entry?.review?.verdict ?? entry?.caseVerdict;
    const expected = !entry ? "未送信"
      : ["acceptable", "pass", "passed"].includes(review) ? "合格"
        : ["stop", "fail", "failed", "unacceptable"].includes(review) ? "不合格"
          : (await optionalJson(path.join(base, "independent-results", runId, `${id}.json`)))
            ? "意味照合待ち" : entry.state === "reserved" ? "送信結果未確定" : "結果未記録";
    assert.equal(actual, expected, `${id} status does not match ledger`);
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${viewport.width}px viewport overflow ${overflow}`);
  }
} finally { await browser.close(); }
process.stdout.write(JSON.stringify({
  runId, q05RawPreserved: true, q05FailurePreserved: true,
  appAttributionSeparatedAndAdjacent: true, q06DisplayReassembledAndHashed: true,
  frozenLedgerEntries: 7, completedLedgerEntries: 13,
  frozenSources: 4, independentCaseStatusesVerified: 6,
  independentCostMicroUSD: 8984, totalCostMicroUSD: 17093,
  externalResources: 0, responsiveWidths: [1440, 390],
}, null, 2) + "\n");