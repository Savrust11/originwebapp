/*
 * Browser-only contract coverage for the isolated evidence consultation
 * prototype. All questions below are synthetic test phrases. The test uses
 * the real temporary PostgreSQL corpus and real prototype endpoint; it never
 * fulfills a request with a fabricated answer.
 */
import "./safety/require-managed.mjs";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { getManagedTestContext } from "./safety/require-managed.mjs";
import { ageNotice, ageMonthsForChild, classifyEvidence } from "../prototypes/evidence-consultation/flow.ts";
import type { ConsultationResponse } from "../prototypes/evidence-consultation/contract.ts";

const baseURL = getManagedTestContext().baseURL;
if (!baseURL) throw new Error("managed prototype browser server is unavailable");
const baseOrigin = new URL(baseURL).origin;
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium";
const artifactDirectory = path.resolve("evidence-work/consultation-prototype/screenshots");
const desktopShot = path.join(artifactDirectory, "consultation-prototype-desktop.png");
const mobileShot = path.join(artifactDirectory, "consultation-prototype-mobile.png");
const conditionShot = path.join(artifactDirectory, "consultation-prototype-conditions.png");
const multipleShot = path.join(artifactDirectory, "consultation-prototype-multiple.png");
const reportFile = path.resolve("evidence-work/consultation-prototype/test-report.json");
let externalRequests = 0;
let websocketAttempts = 0;
let storageCalls = 0;
let passedTests = 0;

test.use({ launchOptions: { executablePath: chromiumPath } });
test.describe.configure({ mode: "serial" });

function syntheticRequest(payload: unknown) {
  const value = payload as { question?: unknown };
  expect(typeof value.question).toBe("string");
  expect(String(value.question)).toMatch(/^SYNTHETIC_/);
}

async function lockBrowserToOwnedOrigin(context: BrowserContext, page: Page) {
  await context.addInitScript(() => {
    const methods = ["getItem", "setItem", "removeItem", "clear", "key"] as const;
    for (const name of methods) {
      const original = (Storage.prototype as Record<string, (...args: unknown[]) => unknown>)[name];
      Object.defineProperty(Storage.prototype, name, {
        configurable: true,
        value(...args: unknown[]) {
          (window as Window & { __prototypeStorageCalls?: number }).__prototypeStorageCalls =
            ((window as Window & { __prototypeStorageCalls?: number }).__prototypeStorageCalls || 0) + 1;
          return original.apply(this, args);
        },
      });
    }
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: class {
        constructor() {
          (window as Window & { __prototypeWebSocketAttempts?: number }).__prototypeWebSocketAttempts =
            ((window as Window & { __prototypeWebSocketAttempts?: number }).__prototypeWebSocketAttempts || 0) + 1;
          throw new Error("prototype WebSocket blocked");
        }
      },
    });
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseOrigin) {
      await route.continue();
      return;
    }
    externalRequests += 1;
    await route.abort("blockedbyclient");
  });
  page.on("websocket", () => { websocketAttempts += 1; });
}

async function open(page: Page, context: BrowserContext) {
  await lockBrowserToOwnedOrigin(context, page);
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /答えを急がず/ })).toBeVisible();
  expect(await page.locator("input").evaluateAll((inputs) =>
    inputs.every((input) => input.getAttribute("autocomplete") !== "on"),
  )).toBe(true);
}

async function setQuestion(page: Page, value: string) {
  await page.getByLabel(/考えていること|質問/).fill(value);
}

async function selectTarget(page: Page, name: string) {
  await page.getByLabel(name, { exact: true }).check();
}

async function confirm(page: Page) {
  await page.getByLabel(/この内容で.*理解しました/).check();
}

async function submit(page: Page) {
  await page.getByRole("button", { name: "根拠を確認する" }).click();
}

async function submitWithResponse(page: Page): Promise<ConsultationResponse> {
  const response = page.waitForResponse((candidate) =>
    candidate.url() === `${baseURL}/api/prototype/evidence`
      && candidate.request().method() === "POST",
  );
  await submit(page);
  const received = await response;
  expect(received.status()).toBe(200);
  return received.json() as Promise<ConsultationResponse>;
}

async function waitForSearch(page: Page) {
  await expect(page.getByRole("button", { name: "確認しています…" })).toHaveCount(0);
  await expect(page.locator(".results, [role='alert']")).toHaveCount(1, { timeout: 10_000 });
}

test.beforeAll(() => {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  for (const file of [desktopShot, mobileShot, conditionShot, multipleShot, reportFile]) fs.rmSync(file, { force: true });
});

test.afterAll(() => {
  // This report intentionally contains only fixed test accounting. It never
  // includes a question, response, URL, error, cookie, or database detail.
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify({
    suite: "evidence-prototype",
    declaredTests: 5,
    passedTests,
    suitePassed: passedTests === 5,
    screenshots: [desktopShot, mobileShot, conditionShot, multipleShot].filter(fs.existsSync).map((file) => path.basename(file)),
    externalNetworkBlocked: externalRequests === 0,
    websocketBlocked: websocketAttempts === 0,
    storageCalls,
    cleanup: "managed ephemeral launcher owns process and PostgreSQL cleanup",
  }) + "\n", { mode: 0o600 });
});
test.afterEach(({}, testInfo) => {
  if (testInfo.status === "passed") passedTests += 1;
});

test("uses actual corpus results while preserving empty, zero, infant, and citation/context distinctions", async ({ page, context }) => {
  await open(page, context);
  const requests: unknown[] = [];
  page.on("request", (request) => {
    if (request.url() === `${baseURL}/api/prototype/evidence` && request.method() === "POST") {
      requests.push(JSON.parse(request.postData() || "{}"));
    }
  });

  await setQuestion(page, "SYNTHETIC_睡眠時間");
  await selectTarget(page, "子どもについて");
  await confirm(page);
  const defaultAge = await submitWithResponse(page);
  await waitForSearch(page);
  syntheticRequest(requests.at(-1));
  expect((requests.at(-1) as { children: Array<{ years: number | null; months: number | null }> }).children[0]
    ?.years === null && (requests.at(-1) as { children: Array<{ years: number | null; months: number | null }> }).children[0]
    ?.months === null).toBe(true);
  expect(defaultAge.state).toBe("unverified");

  const firstChild = page.locator(".child").first();
  await firstChild.getByLabel("年", { exact: true }).fill("0");
  await firstChild.getByLabel("か月", { exact: true }).fill("0");
  await confirm(page);
  const zeroAge = await submitWithResponse(page);
  await waitForSearch(page);
  expect((requests.at(-1) as { children: Array<{ years: number; months: number }> }).children[0]
    ?.years === 0 && (requests.at(-1) as { children: Array<{ years: number; months: number }> }).children[0]
    ?.months === 0).toBe(true);
  expect(zeroAge.state).toBe("no_matching");
  await firstChild.getByLabel("年", { exact: true }).fill("1");
  await firstChild.getByLabel("か月", { exact: true }).fill("0");
  await confirm(page);
  const infant = await submitWithResponse(page);
  await waitForSearch(page);

  // The corpus response is not mocked. If it supplies a source, assert the
  // rendered primary material, version, location, and context disclosure—not
  // a count or an invented approval claim.
  const cards = page.locator(".evidence");
  const actualResults = infant.groups.flatMap((group) => group.results);
  expect(actualResults.length > 0).toBe(true);
  const actual = actualResults[0];
  expect(actual.requiredContext.length > 0).toBe(true);
  const card = cards.first();
  await expect(card).toBeVisible();
  expect((await card.locator(":scope > p").nth(0).textContent()) === actual.originalText).toBe(true);
  const primaryCitation = card.locator(":scope > p").filter({ hasText: "原資料：" }).first().getByRole("link");
  expect((await primaryCitation.textContent()) === actual.citation.title).toBe(true);
  expect((await primaryCitation.getAttribute("href")) === actual.citation.originalUrl).toBe(true);
  const versionLocation = card.locator(":scope > p").filter({ hasText: "版：" }).first();
  const versionLocationText = await versionLocation.textContent();
  expect(Boolean(versionLocationText?.includes(actual.citation.version) && versionLocationText.includes(actual.sourceLocation))).toBe(true);
  await expect(card.locator(":scope > details").filter({ hasText: "資料の適用条件・確認状況" })).toHaveCount(1);
  await expect(card.locator(":scope > details").filter({ hasText: "注記・出典の利用条件" })).toHaveCount(1);
  const required = card.locator(":scope > details").filter({ hasText: "一緒に確認が必要な原文箇所" });
  await expect(required).toHaveCount(1);
  expect((await required.textContent())?.includes(actual.requiredContext[0].originalText) === true).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: desktopShot, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: mobileShot, fullPage: true });
});

test("keeps target and multi-child age choices explicit and requires acknowledgement for conflicting age wording", async ({ page, context }) => {
  await open(page, context);
  await setQuestion(page, "SYNTHETIC_寝不足");
  await selectTarget(page, "保護者自身について");
  await expect(page.getByText("年齢（必要な場合のみ）")).toHaveCount(0);
  await confirm(page);
  const caregiver = await submitWithResponse(page);
  await waitForSearch(page);
  expect(caregiver.groups.length === 1 && caregiver.groups[0].id === "caregiver").toBe(true);
  expect(caregiver.groups[0].results.every((result) => result.applicability.target !== "mismatched")).toBe(true);

  await selectTarget(page, "両方");
  await page.getByRole("button", { name: /子どもを追加/ }).click();
  await expect(page.getByLabel("年", { exact: true })).toHaveCount(2);
  await confirm(page);
  const both = await submitWithResponse(page);
  await waitForSearch(page);
  expect(both.groups.map((group) => group.id).join(",") === "child:child1,child:child2,caregiver").toBe(true);
  const caregiverSections = new Set(caregiver.groups[0].results.map((result) => result.sectionId));
  expect(caregiverSections.size).toBeGreaterThan(0);
  // Broad sleep vocabulary can also retrieve child material. The boundary is
  // that caregiver-only originals must never be reused as child results.
  expect(both.groups.filter((group) => group.id.startsWith("child:"))
    .every((group) => group.results.every((result) => !caregiverSections.has(result.sectionId)))).toBe(true);
  expect(both.groups.find((group) => group.id === "caregiver")?.results.length === caregiver.groups[0].results.length).toBe(true);

  await setQuestion(page, "SYNTHETIC_睡眠時間");
  for (const [index, years] of ["2", "6"].entries()) {
    await page.locator(".child").nth(index).getByLabel("年", { exact: true }).fill(years);
    await page.locator(".child").nth(index).getByLabel("か月", { exact: true }).fill("0");
  }
  await confirm(page);
  const distinctAges = await submitWithResponse(page);
  expect(distinctAges.groups[0].state).toBe("unverified");
  expect(distinctAges.groups[1].state).toBe("no_matching");
  expect(distinctAges.groups[2].id).toBe("caregiver");
  expect(distinctAges.groups[2].results.length).toBeGreaterThan(0);
  await page.locator(".results").screenshot({ path: multipleShot });

  await page.locator(".child").first().getByLabel("年", { exact: true }).fill("0");
  await setQuestion(page, "SYNTHETIC_1歳6か月_睡眠時間");
  await confirm(page);
  await expect(page.getByRole("button", { name: "根拠を確認する" })).toBeDisabled();
  await page.getByLabel("年齢候補の違いを確認しました").check();
  await expect(page.getByRole("button", { name: "根拠を確認する" })).toBeEnabled();
  const acknowledged = await submitWithResponse(page);
  await waitForSearch(page);
  expect(acknowledged.ageNotice.conflict).toBe(true);
});

test("uses actual conditional/exclusion/no-vocabulary states and clears stale UI when inputs change", async ({ page, context }) => {
  await open(page, context);
  const requests: unknown[] = [];
  page.on("request", (request) => {
    if (request.url() === `${baseURL}/api/prototype/evidence` && request.method() === "POST") {
      requests.push(JSON.parse(request.postData() || "{}"));
    }
  });
  await setQuestion(page, "SYNTHETIC_発達障害のある子にも使える");
  await selectTarget(page, "子どもについて");
  await page.locator(".child").first().getByLabel("年", { exact: true }).fill("0");
  await confirm(page);
  const conditional = await submitWithResponse(page);
  await waitForSearch(page);
  const groupsWithPrompts = conditional.groups.filter((group) => group.healthPrompts.length > 0);
  expect(groupsWithPrompts.length > 0).toBe(true);
  const excludedSectionIds = conditional.groups.flatMap((group) => group.results)
    .filter((result) => result.source.conditions.exceptions.length > 0)
    .map((result) => result.sectionId);
  expect(excludedSectionIds.length > 0).toBe(true);
  await page.locator(".results").screenshot({ path: conditionShot });

  const unknown = page.locator(".health").first().getByLabel("分からない", { exact: true }).first();
  await expect(unknown).toBeVisible();
  await unknown.check();
  await expect(page.locator(".evidence")).toHaveCount(0);
  await confirm(page);
  await submitWithResponse(page);
  await waitForSearch(page);
  const unknownSent = requests.at(-1) as { health?: Record<string, Record<string, string>> };
  expect(Object.values(unknownSent.health ?? {}).some((answers) => Object.values(answers).includes("unknown"))).toBe(true);
  const present = page.locator(".health").first().getByLabel("ある", { exact: true });
  await expect(present.first()).toBeVisible();
  // Each research exclusion is an independent fact, not implied by answering
  // the other study's question.
  for (const answer of await present.all()) await answer.check();
  await confirm(page);
  const explicitExclusion = await submitWithResponse(page);
  await waitForSearch(page);
  const sent = requests.at(-1) as { health?: Record<string, Record<string, string>> };
  expect(Object.values(sent.health ?? {}).some((answers) => Object.values(answers).includes("present"))).toBe(true);
  expect(explicitExclusion.groups.flatMap((group) => group.results)
    .every((result) => !excludedSectionIds.includes(result.sectionId))).toBe(true);
  await setQuestion(page, "SYNTHETIC_NO_VOCABULARY_REFERENCE");
  await confirm(page);
  await submit(page);
  await waitForSearch(page);
  await expect(page.getByRole("heading", { level: 2, name: /検索語に対応できず、資料の有無を判断できません/ })).toBeVisible();
  await setQuestion(page, "SYNTHETIC_睡眠時間");
  await selectTarget(page, "子どもについて");
  await page.locator(".child").first().getByLabel("年", { exact: true }).fill("6");
  await page.locator(".child").first().getByLabel("か月", { exact: true }).fill("0");
  await confirm(page);
  await submit(page);
  await waitForSearch(page);
  await expect(page.getByRole("heading", { level: 2, name: /指定条件に合う資料が見つかりません/ })).toBeVisible();
  await page.getByRole("button", { name: "入力と表示を消去" }).click();
  await expect(page.locator("textarea")).toHaveValue("");
  await expect(page.locator(".results")).toHaveCount(0);
});

test("reports only injected transport failure, retries actual endpoint, and forbids external, storage, and stale response leakage", async ({ page, context }) => {
  await open(page, context);
  await setQuestion(page, "SYNTHETIC_睡眠時間");
  await selectTarget(page, "子どもについて");
  await confirm(page);
  let injected = false;
  await page.route(`${baseURL}/api/prototype/evidence`, async (route) => {
    if (!injected) {
      injected = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await submit(page);
  await expect(page.getByRole("alert")).toContainText(/通信に失敗|完了できませんでした/);
  await page.getByRole("button", { name: "もう一度試す" }).click();
  await waitForSearch(page);
  await page.unroute(`${baseURL}/api/prototype/evidence`);

  const routeStatuses = await page.evaluate(async () => {
    const [unknown, wrongType, oversized] = await Promise.all([
      fetch("/not-an-allowed-prototype-route").then((response) => response.status),
      fetch("/api/prototype/evidence", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "SYNTHETIC_WRONG_CONTENT_TYPE",
      }).then((response) => response.status),
      fetch("/api/prototype/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(32 * 1024 + 1),
      }).then((response) => response.status),
    ]);
    return { unknown, wrongType, oversized };
  });
  expect(routeStatuses).toEqual({ unknown: 404, wrongType: 403, oversized: 413 });

  // Changing data invalidates the in-flight revision in the UI; no previous
  // result may remain while a later synthetic request is being prepared.
  await setQuestion(page, "SYNTHETIC_STALE_RESPONSE_REFERENCE");
  await expect(page.locator(".results")).toHaveCount(0);
  storageCalls += await page.evaluate(() =>
    (window as Window & { __prototypeStorageCalls?: number }).__prototypeStorageCalls || 0,
  );
  expect(externalRequests).toBe(0);
  expect(websocketAttempts).toBe(0);
});

test("classifies a fully specified result only in the pure status shell", () => {
  expect(ageMonthsForChild({ id: "child1", years: 2, months: null })).toBeUndefined();
  expect(ageNotice({ question: "生後６ヶ月の睡眠時間", children: [{ id: "child1", years: 2, months: 0 }] }).conflict).toBe(true);
  expect(ageNotice({ question: "2歳の睡眠時間", children: [{ id: "child1", years: null, months: 6 }] }).conflict).toBe(true);
  expect(ageNotice({ question: "2歳の睡眠時間", children: [{ id: "child1", years: 2, months: 6 }] }).conflict).toBe(false);
  expect(classifyEvidence({ status: "no_results", results: [], diagnostics: { reason: "candidate_scan_limit" } })).toBe("incomplete");
  expect(classifyEvidence({ status: "no_results", results: [], diagnostics: { reason: "no_vocabulary" } })).toBe("no_vocabulary");
  // This is deliberately not a browser/API response and contains no citation,
  // approval, publication, or corpus metadata. It tests only the conservative
  // classifier branch, while all displayed evidence above comes from the
  // initialized current corpus.
  expect(classifyEvidence({
    status: "results",
    results: [{
      applicability: {
        target: "matched", age: "matched", region: "matched",
        conditions: "matched", japan: "matched",
      },
    }],
  } as never)).toBe("matched");
});