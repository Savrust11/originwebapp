/**
 * End-to-end contract for private consultations.  This talks only to the
 * managed application and uses its normal connect-pg-simple sessions; no
 * request/session adapter is installed in this suite.
 */
import "./safety/require-managed.mjs";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { getManagedTestContext } from "./safety/require-managed.mjs";
import { pool } from "../server/db.ts";

const baseURL = getManagedTestContext().baseURL;
if (!baseURL) throw new Error("managed consultation server is unavailable");
const origin = new URL(baseURL).origin;
const tag = `consultations-it-${randomUUID()}`;
const familyA = `${tag}-family-a`;
const familyB = `${tag}-family-b`;

let owner = 0;
let sameFamilyOther = 0;
let otherFamily = 0;
let supporter = 0;
let deletedUser = 0;
let ownerSid = "";
let ownerCookie = "";
let sameFamilyCookie = "";
let otherFamilyCookie = "";
let supporterCookie = "";
let deletedCookie = "";

type ResponseData = { status: number; body: any };

function signedCookie(sid: string) {
  const secret = process.env.SESSION_SECRET;
  assert(secret, "the managed child supplies a session secret");
  const signature = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/u, "");
  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

async function insertSession(userId: number): Promise<{ sid: string; cookie: string }> {
  const sid = `${tag}-${randomUUID()}`;
  const sess = {
    cookie: {
      originalMaxAge: 30 * 24 * 60 * 60 * 1000,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    },
    userId,
  };
  await pool.query(
    `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2::json, now() + interval '30 days')`,
    [sid, JSON.stringify(sess)],
  );
  return { sid, cookie: signedCookie(sid) };
}

async function request(
  method: string,
  pathname: string,
  options: {
    cookie?: string;
    body?: unknown;
    csrf?: string;
    requestOrigin?: string;
    adminKey?: string;
  } = {},
): Promise<ResponseData> {
  const response = await fetch(`${baseURL}${pathname}`, {
    method,
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.csrf ? { "x-csrf-token": options.csrf } : {}),
      ...(options.requestOrigin === undefined ? {} : { origin: options.requestOrigin }),
      ...(options.adminKey ? { "x-admin-key": options.adminKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function status(cookie?: string) {
  return request("GET", "/api/consultations/status", { cookie });
}

async function csrf(cookie: string) {
  const response = await status(cookie);
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.csrfToken, "string");
  assert.ok(response.body.csrfToken.length > 20);
  return response.body.csrfToken as string;
}

async function seed() {
  const rows = await pool.query<{ id: number }>(
    `INSERT INTO users (line_user_id, display_name, family_id, role)
     VALUES
       ($1, 'Consultation Owner', $2, 'mama'),
       ($3, 'Same Family Other', $2, 'papa'),
       ($4, 'Other Family', $5, 'mama'),
       ($6, 'Supporter', $7, 'papa'),
       ($8, 'Deleted Session', $9, 'mama')
     RETURNING id`,
    [
      `${tag}-owner`, familyA,
      `${tag}-same-family`, `${tag}-other-family`, familyB,
      `${tag}-supporter`, `${tag}-supporter-family`,
      `${tag}-deleted`, `${tag}-deleted-family`,
    ],
  );
  [owner, sameFamilyOther, otherFamily, supporter, deletedUser] = rows.rows.map((row) => row.id);
  await pool.query(
    `INSERT INTO supporter_accounts (user_id, invite_address, public_code, display_name, kind)
     VALUES ($1, $2, $3, 'Consultation Supporter', 'facility')`,
    [supporter, `${tag}@supporter.invalid`, `${tag}-supporter-code`],
  );
  const sessions = await Promise.all([
    insertSession(owner),
    insertSession(sameFamilyOther),
    insertSession(otherFamily),
    insertSession(supporter),
    insertSession(deletedUser),
  ]);
  [ownerSid] = sessions.map((session) => session.sid);
  [ownerCookie, sameFamilyCookie, otherFamilyCookie, supporterCookie, deletedCookie] = sessions
    .map((session) => session.cookie);

  // There is no users.active/status column.  A session is valid only while
  // the referenced user row still exists.
  await pool.query("DELETE FROM users WHERE id = $1", [deletedUser]);
}

async function cleanup() {
  // The feature owns its messages; this explicit check keeps cleanup safe even
  // if a later schema changes the FK cascade implementation.
  await pool.query(
    "DELETE FROM consultation_messages WHERE consultation_id IN (SELECT id FROM consultations WHERE owner_user_id = $1)",
    [owner],
  );
  await pool.query("DELETE FROM consultations WHERE owner_user_id = $1", [owner]);
  await pool.query(`DELETE FROM "session" WHERE sid LIKE $1`, [`${tag}-%`]);
  await pool.query("DELETE FROM supporter_accounts WHERE user_id = $1", [supporter]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [[owner, sameFamilyOther, otherFamily, supporter]]);
}

async function main() {
  await seed();
  const ownerStatus = await status(ownerCookie);
  assert.deepEqual(
    {
      enabled: ownerStatus.body.enabled,
      authenticated: ownerStatus.body.authenticated,
      eligible: ownerStatus.body.eligible,
      userId: ownerStatus.body.userId,
    },
    { enabled: true, authenticated: true, eligible: true, userId: String(owner) },
  );
  const token = await csrf(ownerCookie);

  for (const [method, pathname, body] of [
    ["GET", "/api/consultations", undefined],
    ["GET", `/api/consultations/${randomUUID()}`, undefined],
    ["POST", "/api/consultations", { title: "anonymous", requestId: randomUUID() }],
    ["POST", `/api/consultations/${randomUUID()}/messages`, { content: "anonymous", requestId: randomUUID() }],
    ["PATCH", `/api/consultations/${randomUUID()}`, { title: "anonymous" }],
    ["DELETE", `/api/consultations/${randomUUID()}`, undefined],
  ] as const) {
    assert.equal((await request(method, pathname, { body })).status, 401, `${method} ${pathname} rejects anonymous access`);
  }
  assert.deepEqual(
    (await status()).body,
    { enabled: true, authenticated: false, eligible: false, csrfToken: null, userId: null },
    "status never trusts a client-provided identity",
  );
  assert.equal((await status(deletedCookie)).body.authenticated, false, "a dangling session is rejected");
  let sameFamilyToken = "";
  for (const cookie of [sameFamilyCookie, otherFamilyCookie]) {
    const result = await status(cookie);
    assert.equal(result.body.authenticated, true);
    assert.equal(result.body.eligible, true, "ordinary users are eligible only for their own consultations");
    assert.equal((await request("GET", "/api/consultations", { cookie })).status, 200);
    if (cookie === sameFamilyCookie) sameFamilyToken = result.body.csrfToken;
  }
  const supporterStatus = await status(supporterCookie);
  assert.equal(supporterStatus.body.authenticated, true);
  assert.equal(supporterStatus.body.eligible, false, "a linked supporter account cannot use consultations");
  assert.equal((await request("GET", "/api/consultations", { cookie: supporterCookie })).status, 401);
  assert.equal(
    (await request("GET", "/api/consultations", { adminKey: "consultations-test-admin-key" })).status,
    401,
    "an admin key is not a consultation identity",
  );

  const forbiddenFields = {
    title: "spoof attempt",
    requestId: randomUUID(),
    ownerId: otherFamily,
    userId: otherFamily,
    familyId: familyB,
    authorType: "ai",
    messageId: randomUUID(),
  };
  assert.equal((await request("POST", "/api/consultations", {
    cookie: ownerCookie, csrf: token, requestOrigin: origin, body: forbiddenFields,
  })).status, 400);
  assert.equal((await request("POST", "/api/consultations", {
    cookie: ownerCookie, csrf: token, requestOrigin: origin,
    body: { title: "x".repeat(121), requestId: randomUUID() },
  })).status, 400);
  assert.equal((await request("POST", "/api/consultations", {
    cookie: sameFamilyCookie,
    csrf: token,
    requestOrigin: origin,
    body: { title: "token from another signed session", requestId: randomUUID() },
  })).status, 403, "an A CSRF token cannot create a consultation after the session becomes B");
  assert.equal(
    (await request("GET", "/api/consultations", { cookie: sameFamilyCookie })).body.consultations
      .some((row: any) => row.title === "token from another signed session"),
    false,
    "a rejected stale-token write creates no B consultation",
  );
  assert.equal(typeof sameFamilyToken, "string");

  const createRequestId = randomUUID();
  const createBody = { title: "夜の寝かしつけ", requestId: createRequestId };
  const [createdOne, createdTwo] = await Promise.all([
    request("POST", "/api/consultations", { cookie: ownerCookie, csrf: token, requestOrigin: origin, body: createBody }),
    request("POST", "/api/consultations", { cookie: ownerCookie, csrf: token, requestOrigin: origin, body: createBody }),
  ]);
  assert.equal(createdOne.status, 201);
  assert.equal(createdTwo.status, 201);
  assert.equal(createdOne.body.consultation.id, createdTwo.body.consultation.id);
  const consultationId = createdOne.body.consultation.id as string;
  assert.equal(createdOne.body.consultation.title, createBody.title);
  assert.equal((await request("POST", "/api/consultations", {
    cookie: ownerCookie, csrf: token, requestOrigin: origin,
    body: { title: "different request", requestId: createRequestId },
  })).status, 409, "the same creation request id cannot change its payload");

  const list = await request("GET", "/api/consultations", { cookie: ownerCookie });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.consultations));
  assert.ok(list.body.consultations.some((row: any) => row.id === consultationId));
  const detail = await request("GET", `/api/consultations/${consultationId}`, { cookie: ownerCookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.consultation.id, consultationId);
  assert.deepEqual(detail.body.messages, []);

  for (const cookie of [sameFamilyCookie, otherFamilyCookie]) {
    const foreignToken = (await status(cookie)).body.csrfToken;
    assert.equal((await request("GET", `/api/consultations/${consultationId}`, { cookie })).status, 404);
    assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
      cookie, csrf: foreignToken, requestOrigin: origin, body: { content: "not mine", requestId: randomUUID() },
    })).status, 404);
    assert.equal((await request("PATCH", `/api/consultations/${consultationId}`, {
      cookie, csrf: foreignToken, requestOrigin: origin, body: { title: "not mine" },
    })).status, 404);
    assert.equal((await request("DELETE", `/api/consultations/${consultationId}`, {
      cookie, csrf: foreignToken, requestOrigin: origin,
    })).status, 404);
  }
  assert.equal((await request("GET", `/api/consultations/${randomUUID()}`, { cookie: ownerCookie })).status, 404);

  for (const options of [
    { requestOrigin: "https://attacker.invalid", csrf: token },
    { requestOrigin: origin },
    { requestOrigin: origin, csrf: "forged" },
  ]) {
    assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
      cookie: ownerCookie, body: { content: "csrf must reject", requestId: randomUUID() }, ...options,
    })).status, 403);
  }
  assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
    cookie: "connect.sid=s%3Aforged.invalid", csrf: token, requestOrigin: origin,
    body: { content: "forged cookie", requestId: randomUUID() },
  })).status, 401);

  assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
    cookie: ownerCookie, csrf: token, requestOrigin: origin,
    body: { content: "spoof", requestId: randomUUID(), ownerId: otherFamily, userId: otherFamily, familyId: familyB, authorType: "ai", messageId: randomUUID() },
  })).status, 400);
  assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
    cookie: ownerCookie, csrf: token, requestOrigin: origin,
    body: { content: "x".repeat(10_001), requestId: randomUUID() },
  })).status, 400);

  const messageRequestId = randomUUID();
  const messageBody = { content: "<img src=x onerror=alert('must never run')>", requestId: messageRequestId };
  const [messageOne, messageTwo] = await Promise.all([
    request("POST", `/api/consultations/${consultationId}/messages`, { cookie: ownerCookie, csrf: token, requestOrigin: origin, body: messageBody }),
    request("POST", `/api/consultations/${consultationId}/messages`, { cookie: ownerCookie, csrf: token, requestOrigin: origin, body: messageBody }),
  ]);
  assert.equal(messageOne.status, 201);
  assert.equal(messageTwo.status, 201);
  assert.equal(messageOne.body.message.id, messageTwo.body.message.id);
  assert.equal(messageOne.body.message.authorType, "user");
  assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
    cookie: ownerCookie, csrf: token, requestOrigin: origin,
    body: { content: "different message", requestId: messageRequestId },
  })).status, 409);

  assert.equal((await request("PATCH", `/api/consultations/${consultationId}`, {
    cookie: ownerCookie,
    csrf: token,
    requestOrigin: origin,
    body: { title: "x".repeat(121) },
  })).status, 400);
  assert.equal((await request("PATCH", `/api/consultations/${consultationId}`, {
    cookie: ownerCookie,
    csrf: token,
    requestOrigin: origin,
    body: { title: "protected update", ownerId: otherFamily, userId: otherFamily, familyId: familyB, authorType: "ai", messageId: randomUUID() },
  })).status, 400);

  for (let index = 1; index < 200; index += 1) {
    assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
      cookie: ownerCookie,
      csrf: token,
      requestOrigin: origin,
      body: { content: `message-limit-${index}`, requestId: randomUUID() },
    })).status, 201);
  }
  assert.equal((await request("POST", `/api/consultations/${consultationId}/messages`, {
    cookie: ownerCookie,
    csrf: token,
    requestOrigin: origin,
    body: { content: "message-limit-overflow", requestId: randomUUID() },
  })).status, 409, "a consultation accepts at most 200 messages");

  assert.equal((await request("PATCH", `/api/consultations/${consultationId}`, {
    cookie: ownerCookie, csrf: token, requestOrigin: origin, body: { title: "更新した相談" },
  })).status, 200);
  const afterMessage = await request("GET", `/api/consultations/${consultationId}`, { cookie: ownerCookie });
  assert.equal(afterMessage.body.messages.length, 200);
  assert.equal(afterMessage.body.messages[0].content, messageBody.content);

  assert.equal((await request("DELETE", `/api/consultations/${consultationId}`, {
    cookie: ownerCookie, csrf: token, requestOrigin: origin,
  })).status, 204);
  assert.equal((await request("GET", `/api/consultations/${consultationId}`, { cookie: ownerCookie })).status, 404);
  const messagesAfterDelete = await pool.query(
    "SELECT count(*)::int AS count FROM consultation_messages WHERE consultation_id = $1",
    [consultationId],
  );
  assert.equal(messagesAfterDelete.rows[0].count, 0, "deleting a consultation cascades to messages");

  // The public API cap is observable rather than relying on an implementation
  // detail. Seed exactly enough owner rows to prove list pagination is bounded.
  const allRows = Array.from({ length: 55 }, () => ({
    title: `bounded-${randomUUID()}`,
    requestId: randomUUID(),
  }));
  for (const body of allRows) {
    assert.equal((await request("POST", "/api/consultations", {
      cookie: ownerCookie, csrf: token, requestOrigin: origin, body,
    })).status, 201);
  }
  const boundedList = await request("GET", "/api/consultations", { cookie: ownerCookie });
  assert.equal(boundedList.status, 200);
  assert.ok(boundedList.body.consultations.length <= 50, "consultation list is bounded to 50 rows");

  // Do not replace the cookie or give B a different session. This emulates an
  // account transition that changes the persisted session identity while an
  // old page still holds A's CSRF token. The token must be user-bound, not
  // merely associated with a durable session id.
  await pool.query(
    `UPDATE "session"
     SET sess = jsonb_set(sess::jsonb, '{userId}', to_jsonb($2::int), true)::json
     WHERE sid = $1`,
    [ownerSid, sameFamilyOther],
  );
  const switchedWriteTitle = "A token after same-session B transition";
  assert.equal((await request("POST", "/api/consultations", {
    cookie: ownerCookie,
    csrf: token,
    requestOrigin: origin,
    body: { title: switchedWriteTitle, requestId: randomUUID() },
  })).status, 403, "an A token cannot write after the same signed session becomes B");
  const switchedStatus = await status(ownerCookie);
  assert.deepEqual(
    {
      enabled: switchedStatus.body.enabled,
      authenticated: switchedStatus.body.authenticated,
      eligible: switchedStatus.body.eligible,
      userId: switchedStatus.body.userId,
    },
    { enabled: true, authenticated: true, eligible: true, userId: String(sameFamilyOther) },
  );
  assert.equal(typeof switchedStatus.body.csrfToken, "string");
  assert.notEqual(switchedStatus.body.csrfToken, token, "status rotates a token when its session user changes");
  assert.equal(
    (await request("GET", "/api/consultations", { cookie: ownerCookie })).body.consultations
      .some((row: any) => row.title === switchedWriteTitle),
    false,
    "the stale token did not create B-owned data",
  );
}

function safeFailureLine(error: unknown): number | null {
  const stack = typeof (error as { stack?: unknown })?.stack === "string"
    ? (error as { stack: string }).stack
    : "";
  const match = stack.match(/consultations-integration\.test\.mts:(\d{1,4}):\d+/);
  return match ? Number(match[1]) : null;
}

let failure: unknown = null;
try {
  await main();
} catch (error) {
  failure = error;
}
try {
  await cleanup();
} catch (error) {
  failure ||= error;
} finally {
  await pool.end();
}
if (failure) {
  const line = safeFailureLine(failure);
  // This exact marker is the only child output the managed parent accepts.
  // Do not print errors: they may contain request bodies or credentials.
  console.error(`SAFE_TEST_FAILURE_LINE:${line ?? 1}`);
  process.exitCode = 1;
}