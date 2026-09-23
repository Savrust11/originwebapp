import { randomBytes, randomUUID } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "./db";
import {
  consultationMessages,
  consultations,
  supporterAccounts,
  users,
} from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    consultationsCsrfToken?: string;
    consultationsCsrfUserId?: number;
  }
}

const MAX_CONSULTATIONS_PER_OWNER = 500;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_OFFSET = 100_000;
const MAX_MESSAGES_PER_CONSULTATION = 200;

const createConsultationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  requestId: z.string().uuid(),
}).strict();

const updateConsultationSchema = z.object({
  title: z.string().trim().min(1).max(120),
}).strict();

const createMessageSchema = z.object({
  content: z.string().min(1).max(10_000).refine((value) => value.trim().length > 0),
  requestId: z.string().uuid(),
}).strict();

type ConsultationRow = typeof consultations.$inferSelect;
type ConsultationMessageRow = typeof consultationMessages.$inferSelect;
type AuthenticatedUser = typeof users.$inferSelect;

class ConsultationHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function consultationsEnabled(env = process.env): boolean {
  return env.CONSULTATIONS_ENABLED === "true";
}

function cachePrivateResponse(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.vary("Cookie");
}

function sessionUserId(req: Request): number | null {
  const value = (req.session as any)?.userId;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Fixture sessions may only be accepted in the explicitly named disposable
 * supporter development database. This mirrors auth/me instead of treating a
 * test-only session marker as an authentication mechanism.
 */
async function fixtureSessionAllowed(req: Request): Promise<boolean> {
  const session = req.session as any;
  if (session?.supporterDevFixture !== true) return true;
  const flagsAllowFixture = process.env.NODE_ENV === "development"
    && process.env.SUPPORTER_DEV_FIXTURES_ENABLED === "true"
    && process.env.SUPPORTER_ACCESS_ENABLED === "true";
  if (!flagsAllowFixture) return false;
  try {
    const result = await pool.query("SELECT current_database() = $1 AS permitted", [
      process.env.SUPPORTER_DEV_DATABASE_NAME || "",
    ]);
    return result.rows[0]?.permitted === true;
  } catch {
    return false;
  }
}

async function currentUser(req: Request): Promise<AuthenticatedUser | null> {
  const id = sessionUserId(req);
  if (!id || !(await fixtureSessionAllowed(req))) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    // A deleted account invalidates a previously signed session at this
    // boundary. Destroying it is best-effort; the response never trusts it.
    req.session.destroy(() => {});
    return null;
  }
  return user;
}

async function userIsSupporter(user: AuthenticatedUser): Promise<boolean> {
  // The persisted role check alone is insufficient because legacy role
  // mutation can leave a supporter_accounts mapping behind.
  if (user.role === "supporter") return true;
  const [account] = await db.select({ id: supporterAccounts.id })
    .from(supporterAccounts)
    .where(eq(supporterAccounts.userId, user.id))
    .limit(1);
  return !!account;
}

async function eligibleUser(req: Request): Promise<AuthenticatedUser | null> {
  const user = await currentUser(req);
  if (!user || await userIsSupporter(user)) return null;
  return user;
}

// Reuse the existing verified-session boundary for read-only evidence search.
// Neither helper accepts a family code or client-declared account identity.
export { eligibleUser as verifiedConsultationUser, sameOriginWrite as isSameOriginRequest };

function issueCsrfToken(req: Request, userId: number): string {
  const session = req.session;
  if (
    session.consultationsCsrfUserId === userId
    && typeof session.consultationsCsrfToken === "string"
    && session.consultationsCsrfToken.length >= 32
  ) {
    return session.consultationsCsrfToken;
  }
  // Auth can replace userId in an existing session. Do not let a token issued
  // to the prior account authorize a delayed request from that browser.
  delete session.consultationsCsrfToken;
  delete session.consultationsCsrfUserId;
  const token = randomBytes(32).toString("base64url");
  session.consultationsCsrfToken = token;
  session.consultationsCsrfUserId = userId;
  return token;
}

function invalidateCsrfForDifferentUser(req: Request, userId: number) {
  const session = req.session;
  if (session.consultationsCsrfUserId !== undefined && session.consultationsCsrfUserId !== userId) {
    delete session.consultationsCsrfToken;
    delete session.consultationsCsrfUserId;
  }
}

function sameOriginWrite(req: Request): boolean {
  const host = req.get("host");
  const origin = req.get("origin");
  if (!host || !origin || origin !== `${req.protocol}://${host}`) return false;
  // Origin does the full origin comparison. Sec-Fetch-Site additionally
  // rejects a browser that explicitly reports a cross-site context.
  return req.get("sec-fetch-site") !== "cross-site";
}

function validId(id: string): boolean {
  return z.string().uuid().safeParse(id).success;
}

function listOffset(req: Request): number {
  const raw = req.query.offset;
  if (raw === undefined) return 0;
  if (typeof raw !== "string" || !/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new ConsultationHttpError(400, "一覧の開始位置を確認してください。");
  }
  const offset = Number(raw);
  if (!Number.isSafeInteger(offset) || offset > MAX_LIST_OFFSET) {
    throw new ConsultationHttpError(400, "一覧の開始位置を確認してください。");
  }
  return offset;
}

function consultationDto(row: ConsultationRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function messageDto(row: ConsultationMessageRow) {
  return {
    id: row.id,
    content: row.content,
    authorType: row.authorType,
    createdAt: row.createdAt.toISOString(),
  };
}

function requireWriteCsrf(req: Request, userId: number) {
  const sessionToken = req.session.consultationsCsrfToken;
  const tokenOwnerId = req.session.consultationsCsrfUserId;
  const suppliedToken = req.get("x-csrf-token");
  if (
    !sameOriginWrite(req)
    || tokenOwnerId !== userId
    || typeof sessionToken !== "string"
    || !suppliedToken
    || suppliedToken !== sessionToken
  ) {
    throw new ConsultationHttpError(403, "この操作を確認できません。画面を再読み込みしてからやり直してください。");
  }
}

async function ownedConsultation(
  database: any,
  ownerUserId: number,
  consultationId: string,
  lock = false,
): Promise<ConsultationRow | null> {
  if (!validId(consultationId)) return null;
  if (lock) {
    await database.execute(sql`
      SELECT id FROM consultations
      WHERE id = ${consultationId} AND owner_user_id = ${ownerUserId}
      FOR UPDATE
    `);
  }
  const [consultation] = await database.select().from(consultations).where(and(
    eq(consultations.id, consultationId),
    eq(consultations.ownerUserId, ownerUserId),
  )).limit(1);
  return consultation ?? null;
}

function notFound() {
  return new ConsultationHttpError(404, "相談が見つかりません。");
}

function respondRouteError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ message: "入力内容を確認してください。" });
  }
  if (error instanceof ConsultationHttpError) {
    return res.status(error.status).json({ message: error.message });
  }
  return res.status(500).json({ message: "相談を処理できませんでした。" });
}

/**
 * Private, account-owned consultation endpoints. This does not add a broad
 * authorization layer to legacy APIs; it is a self-contained route mount.
 */
export function registerConsultationRoutes(app: Express) {
  app.get("/api/consultations/status", async (req, res) => {
    cachePrivateResponse(res);
    // Keep the disabled default usable before the additive tables/migration
    // exist: no users, supporter, or consultation query is made in this path.
    if (!consultationsEnabled()) {
      return res.json({ enabled: false, authenticated: false, eligible: false, csrfToken: null, userId: null });
    }
    try {
      const user = await currentUser(req);
      if (user) invalidateCsrfForDifferentUser(req, user.id);
      const supporter = user ? await userIsSupporter(user) : false;
      const eligible = !!user && !supporter;
      return res.json({
        enabled: true,
        authenticated: !!user,
        eligible,
        csrfToken: eligible && user ? issueCsrfToken(req, user.id) : null,
        // The database identity remains a numeric ID; serialize it for the
        // browser cache key so it is never confused with a client authority.
        userId: user ? String(user.id) : null,
      });
    } catch {
      return res.status(500).json({
        enabled: true,
        authenticated: false,
        eligible: false,
        csrfToken: null,
        userId: null,
      });
    }
  });

  // Every non-status endpoint is deliberately invisible until the feature is
  // explicitly enabled, including when its future migration has not run.
  app.use("/api/consultations", (req, res, next) => {
    cachePrivateResponse(res);
    if (!consultationsEnabled()) {
      return res.status(404).json({ message: "Not found" });
    }
    next();
  });

  app.get("/api/consultations", async (req, res) => {
    try {
      const user = await eligibleUser(req);
      if (!user) return res.status(401).json({ message: "ログイン済みの保護者アカウントが必要です。" });
      const offset = listOffset(req);
      const rows = await db.select().from(consultations).where(eq(consultations.ownerUserId, user.id))
        .orderBy(desc(consultations.updatedAt), desc(consultations.id))
        .limit(MAX_LIST_ITEMS + 1)
        .offset(offset);
      const hasMore = rows.length > MAX_LIST_ITEMS;
      return res.json({
        consultations: rows.slice(0, MAX_LIST_ITEMS).map(consultationDto),
        nextOffset: hasMore ? offset + MAX_LIST_ITEMS : null,
      });
    } catch (error) {
      return respondRouteError(res, error);
    }
  });

  app.post("/api/consultations", async (req, res) => {
    try {
      const user = await eligibleUser(req);
      if (!user) return res.status(401).json({ message: "ログイン済みの保護者アカウントが必要です。" });
      requireWriteCsrf(req, user.id);
      const input = createConsultationSchema.parse(req.body);
      const consultation = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`consultation:${user.id}:${input.requestId}`}))`);
        const [existing] = await tx.select().from(consultations).where(and(
          eq(consultations.ownerUserId, user.id),
          eq(consultations.requestId, input.requestId),
        )).limit(1);
        if (existing) {
          if (existing.title !== input.title) {
            throw new ConsultationHttpError(409, "この送信IDは別の内容に使用されています。");
          }
          return existing;
        }
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(consultations).where(eq(consultations.ownerUserId, user.id));
        if (Number(count) >= MAX_CONSULTATIONS_PER_OWNER) {
          throw new ConsultationHttpError(409, "作成できる相談件数の上限に達しています。");
        }
        const [created] = await tx.insert(consultations).values({
          id: randomUUID(),
          ownerUserId: user.id,
          title: input.title,
          requestId: input.requestId,
        }).returning();
        return created;
      });
      return res.status(201).json({ consultation: consultationDto(consultation) });
    } catch (error) {
      return respondRouteError(res, error);
    }
  });

  app.get("/api/consultations/:id", async (req, res) => {
    try {
      const user = await eligibleUser(req);
      if (!user) return res.status(401).json({ message: "ログイン済みの保護者アカウントが必要です。" });
      const consultation = await ownedConsultation(db, user.id, req.params.id);
      if (!consultation) throw notFound();
      // Fetch one additional row so an unexpected pre-existing overflow is
      // refused rather than silently truncating a consultation's history.
      const messages = await db.select().from(consultationMessages).where(
        eq(consultationMessages.consultationId, consultation.id),
      ).orderBy(asc(consultationMessages.createdAt), asc(consultationMessages.id))
        .limit(MAX_MESSAGES_PER_CONSULTATION + 1);
      if (messages.length > MAX_MESSAGES_PER_CONSULTATION) {
        throw new ConsultationHttpError(409, "この相談のメッセージ数が上限を超えているため表示できません。");
      }
      return res.json({ consultation: consultationDto(consultation), messages: messages.map(messageDto) });
    } catch (error) {
      return respondRouteError(res, error);
    }
  });

  app.post("/api/consultations/:id/messages", async (req, res) => {
    try {
      const user = await eligibleUser(req);
      if (!user) return res.status(401).json({ message: "ログイン済みの保護者アカウントが必要です。" });
      requireWriteCsrf(req, user.id);
      const input = createMessageSchema.parse(req.body);
      if (!validId(req.params.id)) throw notFound();
      const message = await db.transaction(async (tx) => {
        const consultation = await ownedConsultation(tx, user.id, req.params.id, true);
        if (!consultation) throw notFound();
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`message:${consultation.id}:${input.requestId}`}))`);
        const [existing] = await tx.select().from(consultationMessages).where(and(
          eq(consultationMessages.consultationId, consultation.id),
          eq(consultationMessages.requestId, input.requestId),
        )).limit(1);
        if (existing) {
          if (existing.content !== input.content || existing.authorType !== "user") {
            throw new ConsultationHttpError(409, "この送信IDは別の内容に使用されています。");
          }
          return existing;
        }
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
          .from(consultationMessages)
          .where(eq(consultationMessages.consultationId, consultation.id));
        if (Number(count) >= MAX_MESSAGES_PER_CONSULTATION) {
          throw new ConsultationHttpError(409, "この相談にはこれ以上メッセージを追加できません。");
        }
        const [created] = await tx.insert(consultationMessages).values({
          id: randomUUID(),
          consultationId: consultation.id,
          content: input.content,
          authorType: "user",
          requestId: input.requestId,
        }).returning();
        await tx.update(consultations).set({ updatedAt: new Date() }).where(and(
          eq(consultations.id, consultation.id),
          eq(consultations.ownerUserId, user.id),
        ));
        return created;
      });
      return res.status(201).json({ message: messageDto(message) });
    } catch (error) {
      return respondRouteError(res, error);
    }
  });

  app.patch("/api/consultations/:id", async (req, res) => {
    try {
      const user = await eligibleUser(req);
      if (!user) return res.status(401).json({ message: "ログイン済みの保護者アカウントが必要です。" });
      requireWriteCsrf(req, user.id);
      const input = updateConsultationSchema.parse(req.body);
      if (!validId(req.params.id)) throw notFound();
      const [updated] = await db.update(consultations).set({
        title: input.title,
        updatedAt: new Date(),
      }).where(and(
        eq(consultations.id, req.params.id),
        eq(consultations.ownerUserId, user.id),
      )).returning();
      if (!updated) throw notFound();
      return res.json({ consultation: consultationDto(updated) });
    } catch (error) {
      return respondRouteError(res, error);
    }
  });

  app.delete("/api/consultations/:id", async (req, res) => {
    try {
      const user = await eligibleUser(req);
      if (!user) return res.status(401).json({ message: "ログイン済みの保護者アカウントが必要です。" });
      requireWriteCsrf(req, user.id);
      if (!validId(req.params.id)) throw notFound();
      const [deleted] = await db.delete(consultations).where(and(
        eq(consultations.id, req.params.id),
        eq(consultations.ownerUserId, user.id),
      )).returning({ id: consultations.id });
      if (!deleted) throw notFound();
      return res.status(204).send();
    } catch (error) {
      return respondRouteError(res, error);
    }
  });

  // express.json runs earlier in the app. Its parsing errors skip normal
  // handlers and arrive here; do not pass them to the generic error handler,
  // which can expose parser text containing a consultation request body.
  app.use("/api/consultations", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? "入力内容を確認してください。" : "相談を処理できませんでした。",
    });
  });
}