import type { Express, Request, Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { db } from "./db";
import { users, invitationCodes } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { pool } from "./db";

const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID!;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

export async function setupAuth(app: Express) {
  const PgStore = connectPgSimple(session);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  app.use(
    session({
      store: new PgStore({
        pool: pool,
        tableName: "session",
        createTableIfMissing: false,
      }),
      secret: process.env.SESSION_SECRET || "we-iku-session-secret",
      resave: true,
      saveUninitialized: true,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );

  app.get("/api/auth/line", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const callbackUrl = `${baseUrl}/api/auth/line/callback`;
    const state = Math.random().toString(36).substring(2);
    (req.session as any).lineState = state;

    const authUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", LINE_CHANNEL_ID);
    authUrl.searchParams.set("redirect_uri", callbackUrl);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", "profile openid");

    req.session.save((err) => {
      if (err) {
        console.error("LINE auth session save error:", err);
      }
      res.redirect(authUrl.toString());
    });
  });

  app.get("/api/auth/line/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query;
      const savedState = (req.session as any).lineState;

      if (!code || state !== savedState) {
        console.error("LINE callback invalid_state:", {
          hasCode: !!code,
          state,
          savedState,
          sessionId: req.sessionID,
        });
        return res.redirect("/?auth_error=invalid_state");
      }

      const baseUrl = getBaseUrl(req);
      const callbackUrl = `${baseUrl}/api/auth/line/callback`;

      const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: callbackUrl,
          client_id: LINE_CHANNEL_ID,
          client_secret: LINE_CHANNEL_SECRET,
        }),
      });

      if (!tokenRes.ok) {
        console.error("LINE token error:", await tokenRes.text());
        return res.redirect("/?auth_error=token_failed");
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      const profileRes = await fetch("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!profileRes.ok) {
        console.error("LINE profile error:", await profileRes.text());
        return res.redirect("/?auth_error=profile_failed");
      }

      const profile = await profileRes.json();
      const lineUserId = profile.userId;
      const displayName = profile.displayName;
      const pictureUrl = profile.pictureUrl || null;

      let [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.lineUserId, lineUserId));

      if (!existingUser) {
        const familyId = `family-${Math.random().toString(36).substring(2, 10)}`;
        [existingUser] = await db
          .insert(users)
          .values({
            lineUserId,
            displayName,
            pictureUrl,
            familyId,
            role: "papa",
          })
          .returning();
      } else {
        await db
          .update(users)
          .set({ displayName, pictureUrl })
          .where(eq(users.lineUserId, lineUserId));
      }

      (req.session as any).userId = existingUser.id;
      (req.session as any).lineUserId = lineUserId;
      (req.session as any).familyId = existingUser.familyId;
      (req.session as any).role = existingUser.role;
      (req.session as any).displayName = displayName;
      (req.session as any).pictureUrl = pictureUrl;
      (req.session as any).invitationVerified = existingUser.invitationVerified;

      const authData = {
        login_success: true,
        familyId: existingUser.familyId,
        role: existingUser.role,
        displayName,
        pictureUrl: pictureUrl || "",
        invitationVerified: existingUser.invitationVerified,
      };

      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ログイン完了</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;background:linear-gradient(135deg,#f3e8ff,#fff,#ecfdf5);min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{text-align:center;padding:40px 24px;max-width:360px;width:90%}
  .icon{width:80px;height:80px;border-radius:50%;background:#f3e8ff;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
  .icon svg{width:40px;height:40px;color:#805AAA}
  h1{font-size:22px;font-weight:900;color:#805AAA;margin-bottom:8px}
  .sub{font-size:14px;color:#6b7280;margin-bottom:24px}
  .name{font-size:16px;font-weight:700;color:#374151;margin-bottom:24px}
  .btn{display:block;width:100%;padding:16px;border-radius:16px;background:#805AAA;color:#fff;font-size:16px;font-weight:900;text-decoration:none;border:none;cursor:pointer;margin-bottom:12px}
  .hint{font-size:12px;color:#9ca3af;line-height:1.6}
</style></head><body>
<div class="card">
  <div class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
  <h1>ログイン完了</h1>
  <p class="name">${displayName}さん、ようこそ！</p>
  <a href="/" class="btn" id="openApp">アプリを開く</a>
  <p class="hint">ホーム画面にアプリを追加している場合は、<br>ホーム画面のアイコンからお開きください</p>
</div>
<script>
  var data = ${JSON.stringify(authData)};
  localStorage.setItem('familyId', data.familyId);
  localStorage.setItem('userType', data.role);
  localStorage.setItem('lineDisplayName', data.displayName);
  localStorage.setItem('linePictureUrl', data.pictureUrl);
  localStorage.setItem('onboarding_done', 'true');
  if (data.invitationVerified) localStorage.setItem('invitation_verified', 'true');
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) {
    window.location.href = '/';
  }
</script>
</body></html>`);
    } catch (error) {
      console.error("LINE auth error:", error);
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>エラー</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;background:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{text-align:center;padding:40px 24px}
  h1{font-size:20px;font-weight:900;color:#dc2626;margin-bottom:12px}
  .btn{display:inline-block;padding:12px 32px;border-radius:16px;background:#805AAA;color:#fff;font-size:14px;font-weight:700;text-decoration:none;margin-top:16px}
</style></head><body>
<div class="card">
  <h1>ログインに失敗しました</h1>
  <p style="color:#6b7280;font-size:14px">もう一度お試しください</p>
  <a href="/" class="btn">戻る</a>
</div>
</body></html>`);
    }
  });

  app.post("/api/auth/line-liff", async (req: Request, res: Response) => {
    try {
      const { accessToken } = req.body;
      if (!accessToken || typeof accessToken !== "string") {
        return res.status(400).json({ message: "accessToken required" });
      }

      const verifyRes = await fetch(
        `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
      );
      if (!verifyRes.ok) {
        console.error("LIFF token verify failed:", await verifyRes.text());
        return res.status(401).json({ message: "invalid_token" });
      }
      const verifyData = await verifyRes.json();
      if (verifyData.client_id !== LINE_CHANNEL_ID) {
        console.error("LIFF token client_id mismatch:", verifyData.client_id, "expected", LINE_CHANNEL_ID);
        return res.status(401).json({ message: "client_id_mismatch" });
      }

      const profileRes = await fetch("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileRes.ok) {
        console.error("LIFF profile fetch failed:", await profileRes.text());
        return res.status(401).json({ message: "profile_failed" });
      }
      const profile = await profileRes.json();
      const lineUserId = profile.userId;
      const displayName = profile.displayName;
      const pictureUrl = profile.pictureUrl || null;

      let [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.lineUserId, lineUserId));

      if (!existingUser) {
        const familyId = `family-${Math.random().toString(36).substring(2, 10)}`;
        [existingUser] = await db
          .insert(users)
          .values({
            lineUserId,
            displayName,
            pictureUrl,
            familyId,
            role: "papa",
          })
          .returning();
      } else {
        await db
          .update(users)
          .set({ displayName, pictureUrl })
          .where(eq(users.lineUserId, lineUserId));
      }

      const s = req.session as any;
      s.userId = existingUser.id;
      s.lineUserId = lineUserId;
      s.familyId = existingUser.familyId;
      s.role = existingUser.role;
      s.displayName = displayName;
      s.pictureUrl = pictureUrl;
      s.invitationVerified = existingUser.invitationVerified;

      req.session.save((err) => {
        if (err) {
          console.error("LIFF session save error:", err);
          return res.status(500).json({ message: "session_save_failed" });
        }
        res.json({
          authenticated: true,
          userId: existingUser.id,
          lineUserId,
          familyId: existingUser.familyId,
          role: existingUser.role,
          displayName,
          pictureUrl,
          invitationVerified: existingUser.invitationVerified,
        });
      });
    } catch (error) {
      console.error("LIFF auth error:", error);
      res.status(500).json({ message: "internal_error" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const s = req.session as any;
    if (s.userId) {
      let invitationVerified = s.invitationVerified ?? false;
      if (!invitationVerified) {
        const [user] = await db.select().from(users).where(eq(users.id, s.userId));
        if (user) {
          invitationVerified = user.invitationVerified;
          s.invitationVerified = invitationVerified;
        }
      }
      res.json({
        authenticated: true,
        userId: s.userId,
        lineUserId: s.lineUserId,
        familyId: s.familyId,
        role: s.role,
        displayName: s.displayName,
        pictureUrl: s.pictureUrl,
        invitationVerified,
      });
    } else {
      res.json({ authenticated: false });
    }
  });

  app.post("/api/auth/verify-code", async (req: Request, res: Response) => {
    const s = req.session as any;
    if (!s.userId) {
      return res.status(401).json({ message: "ログインが必要です" });
    }

    const { code } = req.body;
    if (!code || typeof code !== "string") {
      return res.status(400).json({ message: "招待コードを入力してください" });
    }

    const normalizedCode = code.trim().toUpperCase();

    const [invitation] = await db
      .select()
      .from(invitationCodes)
      .where(eq(invitationCodes.code, normalizedCode));

    if (!invitation) {
      return res.status(400).json({ message: "無効な招待コードです" });
    }

    if (invitation.isUsed) {
      return res.status(400).json({ message: "この招待コードは既に使用されています" });
    }

    await db
      .update(invitationCodes)
      .set({ isUsed: true, usedBy: s.lineUserId, usedAt: new Date() })
      .where(eq(invitationCodes.id, invitation.id));

    await db
      .update(users)
      .set({ invitationVerified: true })
      .where(eq(users.id, s.userId));

    s.invitationVerified = true;

    res.json({ success: true, message: "招待コードが確認されました" });
  });

  app.post("/api/auth/update-role", async (req: Request, res: Response) => {
    const s = req.session as any;
    if (!s.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { role } = req.body;
    if (role !== "papa" && role !== "mama") {
      return res.status(400).json({ message: "Invalid role" });
    }
    await db.update(users).set({ role }).where(eq(users.id, s.userId));
    s.role = role;
    res.json({ success: true, role });
  });

  app.post("/api/auth/join-family", async (req: Request, res: Response) => {
    const s = req.session as any;
    if (!s.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { familyId } = req.body;
    if (!familyId) {
      return res.status(400).json({ message: "Family ID required" });
    }
    await db.update(users).set({ familyId }).where(eq(users.id, s.userId));
    s.familyId = familyId;
    res.json({ success: true, familyId });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ success: true });
    });
  });
}
