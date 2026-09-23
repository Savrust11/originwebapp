/**
 * Browser coverage uses the managed application and normal signed
 * connect-pg-simple session cookies. Only the failed-save case intercepts a
 * request, so all identity and successful data paths remain real.
 */
import "./safety/require-managed.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { getManagedTestContext } from "./safety/require-managed.mjs";
import { pool } from "../server/db.ts";

const baseURL = getManagedTestContext().baseURL;
if (!baseURL) throw new Error("managed consultation browser server is unavailable");
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium";
test.use({
  viewport: { width: 430, height: 900 },
  launchOptions: { executablePath: chromiumPath },
});
// The final case deliberately mutates the one persisted session used by the
// preceding real-browser cases, so this file must retain declaration order.
test.describe.configure({ mode: "serial" });

const tag = `consultations-browser-${randomUUID()}`;
const family = `${tag}-family`;
let userId = 0;
let sid = "";
let cookieValue = "";
let otherUserId = 0;

function signSession(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("managed session secret is unavailable");
  const signature = createHmac("sha256", secret).update(value).digest("base64").replace(/=+$/u, "");
  return encodeURIComponent(`s:${value}.${signature}`);
}

async function setup() {
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO users (line_user_id, display_name, family_id, role)
     VALUES ($1, 'Browser Consultation Owner', $2, 'mama'),
            ($3, 'Browser Consultation Other', $2, 'papa')
     RETURNING id`,
    [`${tag}-owner`, family, `${tag}-other`],
  );
  userId = inserted.rows[0].id;
  otherUserId = inserted.rows[1].id;
  sid = `${tag}-${randomUUID()}`;
  await pool.query(
    `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2::json, now() + interval '30 days')`,
    [sid, JSON.stringify({ cookie: { path: "/", httpOnly: true, sameSite: "lax" }, userId })],
  );
  cookieValue = signSession(sid);
}

async function cleanup() {
  await pool.query(
    "DELETE FROM consultation_messages WHERE consultation_id IN (SELECT id FROM consultations WHERE owner_user_id = $1)",
    [userId],
  );
  await pool.query("DELETE FROM consultations WHERE owner_user_id = $1", [userId]);
  await pool.query(`DELETE FROM "session" WHERE sid = $1`, [sid]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [[userId, otherUserId]]);
  await pool.end();
}

async function addSessionCookie(context: BrowserContext) {
  await context.addCookies([{
    name: "connect.sid",
    value: cookieValue,
    url: baseURL,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

async function waitForJapaneseFonts(page: Page) {
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Noto Sans JP"', "個別相談 赤ちゃんの様子を相談したい"),
      document.fonts.load('700 16px "Noto Sans JP"', "個別相談 赤ちゃんの様子を相談したい"),
      document.fonts.ready,
    ]);
  });
}

test.beforeAll(setup);
test.afterAll(cleanup);

test("an unlogged visitor is told that consultation requires login", async ({ page }) => {
  await page.goto(`${baseURL}/consultations`);
  await expect(page.getByRole("heading", { name: "個別相談" })).toBeVisible();
  await expect(page.getByText("相談を利用するにはログインが必要です。")).toBeVisible();
});

test("private consultation list and detail use real sessions, keep drafts, and render text safely", async ({ page, context }) => {
  await addSessionCookie(context);
  await page.goto(`${baseURL}/consultations`);
  await expect(page.getByRole("heading", { name: "個別相談" })).toBeVisible();
  await expect(page.getByText("まだ相談はありません")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "相談タイトル" })).toBeVisible();
  await expect(page.getByRole("button", { name: "相談を作成" })).toBeDisabled();

  await page.getByRole("textbox", { name: "相談タイトル" }).fill("夜の寝かしつけ");
  await page.getByRole("button", { name: "相談を作成" }).dblclick();
  await expect(page).toHaveURL(/\/consultations\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "個別相談" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "夜の寝かしつけ" })).toBeVisible();
  const consultationId = page.url().split("/").at(-1);
  expect(consultationId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "相談タイトルを変更" }).click();
  await page.getByRole("textbox", { name: "相談タイトルを変更" }).fill("夜の寝かしつけ（更新）");
  await page.getByRole("button", { name: "タイトルの変更を保存" }).click();
  await expect(page.getByRole("heading", { name: "夜の寝かしつけ（更新）" })).toBeVisible();

  let dialogTriggered = false;
  page.on("dialog", (dialog) => { dialogTriggered = true; void dialog.dismiss(); });
  await page.getByRole("textbox", { name: "相談内容" }).fill("夜中に何度も目が覚めるので、日中の様子を整理しておきたいです。");
  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("夜中に何度も目が覚めるので、日中の様子を整理しておきたいです。", { exact: true })).toBeVisible();
  await waitForJapaneseFonts(page);
  const home = process.env.HOME;
  if (!home) throw new Error("managed browser HOME is unavailable");
  const detailShot = path.join(home, "consultations-detail-fake.png");
  await page.screenshot({ path: detailShot, fullPage: true });
  fs.mkdirSync("screenshots", { recursive: true });
  fs.copyFileSync(detailShot, "screenshots/consultations-detail.png");

  const xss = `<img src=x onerror="alert('xss')">相談メモ`;
  await page.getByRole("textbox", { name: "相談内容" }).fill(xss);
  await page.getByRole("button", { name: "追加" }).dblclick();
  await expect(page.getByText(xss, { exact: true })).toBeVisible();
  await expect(page.locator("article img")).toHaveCount(0);
  expect(dialogTriggered).toBe(false);

  await page.getByRole("button", { name: "この相談を削除" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "相談を削除しますか？" })).toBeVisible();
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByRole("heading", { name: "夜の寝かしつけ（更新）" })).toBeVisible();

  await page.getByRole("button", { name: "この相談を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).dblclick();
  await expect(page).toHaveURL(`${baseURL}/consultations`);
  await expect(page.getByText("まだ相談はありません")).toBeVisible();
  await page.getByRole("textbox", { name: "相談タイトル" }).fill("明日の健診について");
  await page.getByRole("button", { name: "相談を作成" }).click();
  await expect(page).toHaveURL(/\/consultations\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "相談一覧に戻る" }).click();
  await expect(page.getByText("明日の健診について", { exact: true })).toBeVisible();
  await waitForJapaneseFonts(page);
  const listShot = path.join(home, "consultations-list-fake.png");
  await page.screenshot({ path: listShot, fullPage: true });
  fs.copyFileSync(listShot, "screenshots/consultations-list.png");
});

test("a local failed message save retains the draft and retries with one stable request id", async ({ page, context }) => {
  await addSessionCookie(context);
  await page.goto(`${baseURL}/consultations`);
  await page.getByRole("textbox", { name: "相談タイトル" }).fill("下書きの確認");
  await page.getByRole("button", { name: "相談を作成" }).click();
  await expect(page).toHaveURL(/\/consultations\/[0-9a-f-]{36}$/);

  let failed = false;
  let failedRequestId = "";
  let retriedRequestId = "";
  await page.route("**/api/consultations/*/messages", async (route) => {
    if (!failed) {
      failed = true;
      failedRequestId = JSON.parse(route.request().postData() || "{}").requestId;
      await route.abort("failed");
      return;
    }
    retriedRequestId = JSON.parse(route.request().postData() || "{}").requestId;
    await route.continue();
  });
  await page.getByRole("textbox", { name: "相談内容" }).fill("失敗後も残す文章");
  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByRole("alert")).toContainText("内容はそのままです");
  await expect(page.getByRole("textbox", { name: "相談内容" })).toHaveValue("失敗後も残す文章");
  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("失敗後も残す文章", { exact: true })).toBeVisible();
  expect(retriedRequestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(retriedRequestId).toBe(failedRequestId);
  await page.unroute("**/api/consultations/*/messages");
});

test("the same mounted tab cannot retain A detail or draft after its signed session becomes B", async ({ page, context }) => {
  await addSessionCookie(context);
  await page.goto(`${baseURL}/consultations`);
  await page.getByRole("textbox", { name: "相談タイトル" }).fill("Aだけの相談");
  await page.getByRole("button", { name: "相談を作成" }).click();
  await expect(page.getByRole("heading", { name: "Aだけの相談" })).toBeVisible();
  await page.getByRole("textbox", { name: "相談内容" }).fill("Aだけの未送信下書き");

  // Retain the exact signed cookie while changing only the persisted session
  // user. The view must react to a normal status refetch, rather than needing
  // a reload or a new browser context to discard A's cache and draft.
  await pool.query(
    `UPDATE "session"
     SET sess = jsonb_set(sess::jsonb, '{userId}', to_jsonb($2::int), true)::json
     WHERE sid = $1`,
    [sid, otherUserId],
  );
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByText("通信状態を確認して、もう一度お試しください。")).toBeVisible();
  await expect(page.getByText("Aだけの相談", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "相談内容" })).toHaveCount(0);
  await expect.poll(() => page.locator("textarea").evaluateAll((elements) =>
    elements.map((element) => (element as HTMLTextAreaElement).value),
  )).not.toContain("Aだけの未送信下書き");
  await page.evaluate(() => {
    history.pushState({}, "", "/consultations");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("まだ相談はありません")).toBeVisible();
});