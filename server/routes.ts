import type { Express } from "express";
import type { Server } from "http";
import path from "path";
import { storage } from "./storage";
import { db } from "./db";
import { api } from "@shared/routes";
import { logs, settings, feedbacks, invitationCodes, users, foodIngredients, customChildcareItems } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const DEFAULT_COUPONS = [
  { title: "1時間の一人お風呂券", cost: 300 },
  { title: "朝までぐっすり眠れる券", cost: 1000 },
  { title: "好きなランチ出前券", cost: 500 },
  { title: "30分のマッサージ券", cost: 200 },
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // --- Static marketing page (/about) ---
  // Served independently from the SPA bundle so it stays fast and
  // unaffected by app updates. In production the file is copied to
  // dist/public by the Vite build; in development it lives in client/public.
  const serverDir =
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(new URL(import.meta.url).pathname);
  const aboutHtmlPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(serverDir, "public", "about.html")
      : path.resolve(serverDir, "..", "client", "public", "about.html");

  app.get(["/about", "/about/"], (_req, res) => {
    res.sendFile(aboutHtmlPath);
  });

  
  // --- Children ---
  app.get(api.children.list.path, async (req, res) => {
    const childList = await storage.getChildren(req.params.familyId);
    res.json(childList);
  });

  app.post(api.children.create.path, async (req, res) => {
    try {
      const input = api.children.create.input.parse(req.body);
      const existing = await storage.getChildren(input.familyId);
      const duplicate = existing.find((c) => c.name === input.name);
      if (duplicate) {
        return res.status(200).json(duplicate);
      }
      const child = await storage.createChild(input);
      res.status(201).json(child);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/children/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = api.children.update.input.parse(req.body);
      const child = await storage.updateChild(id, data);
      res.json(child);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/children/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteChild(id);
    res.json({ success: true });
  });

  app.get(api.logs.list.path, async (req, res) => {
    const logs = await storage.getLogs(req.params.familyId);
    res.json(logs);
  });

  app.get("/api/families/:familyId/medicine-names", async (req, res) => {
    const logs = await storage.getLogs(req.params.familyId);
    const names = [...new Set(
      logs
        .filter((l: any) => l.type === "medicine" && l.medicineName)
        .map((l: any) => l.medicineName as string)
    )];
    res.json(names);
  });

  app.get("/api/families/:familyId/caregiver-medicine-names", async (req, res) => {
    const logs = await storage.getLogs(req.params.familyId);
    const caregiverLogs = logs
      .filter((l: any) => l.type === "caregiver_medicine")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const names = [...new Set(
      caregiverLogs.filter((l: any) => l.medicineName).map((l: any) => l.medicineName as string)
    )];
    const lastLog = caregiverLogs[0] || null;
    res.json({ names, lastLog });
  });

  app.post(api.logs.create.path, async (req, res) => {
    try {
      const customCreatedAt = req.body.createdAt;
      const customHoldEndAt = req.body.holdEndAt;
      const customWalkEndAt = req.body.walkEndAt;
      const bodyForParsing = { ...req.body };
      delete bodyForParsing.holdEndAt;
      delete bodyForParsing.walkEndAt;
      const input = api.logs.create.input.parse(bodyForParsing);
      let log = await storage.createLog(input);

      if (customCreatedAt) {
        log = await storage.updateLog(log.id, { createdAt: new Date(customCreatedAt) });
      }
      if (customHoldEndAt) {
        log = await storage.updateLog(log.id, { holdEndAt: new Date(customHoldEndAt) });
      }
      if (customWalkEndAt) {
        log = await storage.updateLog(log.id, { walkEndAt: new Date(customWalkEndAt) });
      }

      if (input.type === "thanks" && input.familyId && input.userId) {
        const partnerUser = input.userId === "papa" ? "mama" : "papa";
        const userLabel = input.userId === "papa" ? "パパ" : "ママ";
        const reason = input.message && input.message.trim() && input.message.trim() !== "ありがとう"
          ? input.message.trim()
          : "";
        await storage.createNotification({
          familyId: input.familyId,
          targetUser: partnerUser,
          message: reason
            ? `${userLabel}から「ありがとう」が届きました！「${reason}」`
            : `${userLabel}から「ありがとう」が届きました！`,
          type: "thanks",
          childId: input.childId ?? undefined,
        });
      }

      res.status(201).json(log);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.post("/api/logs/:id/update-time", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { createdAt } = z.object({ createdAt: z.string() }).parse(req.body);
      const log = await storage.updateLog(id, { createdAt: new Date(createdAt) });
      res.json(log);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/logs/:id/update", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({
        createdAt: z.string().optional(),
        message: z.string().optional(),
        bodyTemperature: z.number().nullable().optional(),
        symptoms: z.string().nullable().optional(),
        symptomNote: z.string().nullable().optional(),
        formulaMl: z.number().nullable().optional(),
        breastLeftMin: z.number().nullable().optional(),
        breastRightMin: z.number().nullable().optional(),
        expressedMl: z.number().nullable().optional(),
        performedBy: z.string().nullable().optional(),
        spitUp: z.boolean().optional(),
        spitUpAmount: z.string().nullable().optional(),
        spitUpTiming: z.string().nullable().optional(),
        spitUpNote: z.string().nullable().optional(),
        excludeFromInterval: z.boolean().optional(),
        foodNote: z.string().nullable().optional(),
        foodItems: z.string().nullable().optional(),
        holdEndAt: z.string().nullable().optional(),
        walkEndAt: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const updateData: any = {};
      if (data.createdAt !== undefined) updateData.createdAt = new Date(data.createdAt);
      if (data.message !== undefined) updateData.message = data.message;
      if (data.bodyTemperature !== undefined) updateData.bodyTemperature = data.bodyTemperature;
      if (data.symptoms !== undefined) updateData.symptoms = data.symptoms;
      if (data.symptomNote !== undefined) updateData.symptomNote = data.symptomNote;
      if (data.formulaMl !== undefined) updateData.formulaMl = data.formulaMl;
      if (data.breastLeftMin !== undefined) updateData.breastLeftMin = data.breastLeftMin;
      if (data.breastRightMin !== undefined) updateData.breastRightMin = data.breastRightMin;
      if (data.expressedMl !== undefined) updateData.expressedMl = data.expressedMl;
      if (data.performedBy !== undefined) updateData.performedBy = data.performedBy;
      if (data.spitUp !== undefined) updateData.spitUp = data.spitUp;
      if (data.spitUpAmount !== undefined) updateData.spitUpAmount = data.spitUpAmount;
      if (data.spitUpTiming !== undefined) updateData.spitUpTiming = data.spitUpTiming;
      if (data.spitUpNote !== undefined) updateData.spitUpNote = data.spitUpNote;
      if (data.excludeFromInterval !== undefined) updateData.excludeFromInterval = data.excludeFromInterval;
      if (data.foodNote !== undefined) updateData.foodNote = data.foodNote;
      if (data.foodItems !== undefined) updateData.foodItems = data.foodItems;
      if (data.holdEndAt !== undefined) updateData.holdEndAt = data.holdEndAt ? new Date(data.holdEndAt) : null;
      if (data.walkEndAt !== undefined) updateData.walkEndAt = data.walkEndAt ? new Date(data.walkEndAt) : null;
      const endAt = updateData.holdEndAt || updateData.walkEndAt;
      if (endAt && updateData.createdAt && endAt <= updateData.createdAt) {
        return res.status(400).json({ message: "終了時刻は開始時刻より後にしてください" });
      }
      const log = await storage.updateLog(id, updateData);
      res.json(log);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/logs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLog(id);
      res.json({ ok: true });
    } catch (err) {
      throw err;
    }
  });

  app.post("/api/logs/bulk-delete", async (req, res) => {
    try {
      const { ids } = z.object({ ids: z.array(z.number().int()) }).parse(req.body);
      await Promise.all(ids.map((id) => storage.deleteLog(id)));
      res.json({ ok: true, deleted: ids.length });
    } catch (err) {
      throw err;
    }
  });

  app.post("/api/sleep-sessions/:id/update-time", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({
        startedAt: z.string(),
        endedAt: z.string().optional(),
        wakingMinutes: z.number().int().min(0).optional(),
      });
      const { startedAt, endedAt, wakingMinutes } = schema.parse(req.body);
      const start = new Date(startedAt);
      const end = endedAt ? new Date(endedAt) : undefined;
      const rawDuration = end ? Math.round((end.getTime() - start.getTime()) / 60000) : undefined;
      const durationMin = rawDuration !== undefined
        ? Math.max(0, rawDuration - (wakingMinutes ?? 0))
        : undefined;
      const session = await storage.updateSleepSession(id, {
        startedAt: start,
        endedAt: end,
        durationMin,
      });
      res.json(session);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/sleep-sessions/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSleepSessionWithLog(id);
      res.json({ ok: true });
    } catch (err) {
      throw err;
    }
  });

  app.post("/api/sleep-success", async (req, res) => {
    try {
      const sleepSuccessSchema = z.object({
        familyId: z.string().min(1),
        userId: z.string().min(1),
        childId: z.number().int().nullable().optional(),
        elapsedMinutes: z.number().int().min(0).default(0),
        startedAt: z.string().optional(),
        settlingMethod: z.string().optional(),
        settlingMinutes: z.number().int().min(0).optional(),
        sleepLocation: z.string().optional(),
        performedBy: z.string().optional(),
      });
      const parsed = sleepSuccessSchema.parse(req.body);
      const { familyId, userId, childId, elapsedMinutes, startedAt, settlingMethod, settlingMinutes, sleepLocation, performedBy } = parsed;
      const userLabel = userId === "papa" ? "パパ" : "ママ";
      const partnerUser = userId === "papa" ? "mama" : "papa";

      const existing = await storage.getActiveSleepSession(familyId, childId);
      if (existing) {
        return res.status(400).json({ message: "既に睡眠セッションが進行中です" });
      }

      const session = await storage.startSleepSession({
        familyId,
        createdBy: userId,
        performedBy: performedBy ?? null,
        childId: childId ?? null,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
      });

      const settlingParts: string[] = [];
      if (settlingMethod && settlingMethod !== "なし") settlingParts.push(settlingMethod);
      if (settlingMinutes && settlingMinutes > 0) settlingParts.push(`${settlingMinutes}分`);
      if (sleepLocation) settlingParts.push(sleepLocation);
      const settlingStr = settlingParts.length > 0 ? `（${settlingParts.join("・")}）` : "";

      await storage.createNotification({
        familyId,
        targetUser: partnerUser,
        message: `${userLabel}のネントレで赤ちゃんが寝ました${settlingStr}`,
        type: "sleep_success",
        childId: childId ?? undefined,
      });

      const log = await storage.createLog({
        familyId,
        childId: childId ?? undefined,
        userId,
        type: "sleep",
        message: `入眠を記録しました${settlingStr}`,
        performedBy: performedBy ?? undefined,
        settlingMethod: settlingMethod ?? undefined,
        settlingMinutes: settlingMinutes ?? undefined,
        sleepLocation: sleepLocation ?? undefined,
        createdAt: startedAt ? new Date(startedAt) : new Date(),
      });

      res.status(201).json({ session, logId: log.id });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Sleep success error:", err);
      res.status(500).json({ message: "Failed to record sleep success" });
    }
  });

  app.patch("/api/logs/:logId/sleep-detail", async (req, res) => {
    try {
      const logId = parseInt(req.params.logId);
      if (isNaN(logId)) return res.status(400).json({ message: "Invalid logId" });
      const schema = z.object({
        settlingMethod: z.string().optional(),
        sleepLocation: z.string().optional(),
        sleepNote: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const log = await storage.updateLogSleepDetail(logId, data);
      res.json(log);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "Failed to update sleep detail" });
    }
  });

  app.get(api.settings.get.path, async (req, res) => {
    const settings = await storage.getSettings(req.params.familyId);
    res.json(settings);
  });

  app.post(api.settings.update.path, async (req, res) => {
    try {
      const input = api.settings.update.input.parse(req.body);
      const settings = await storage.updateSettings(input);
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.get(api.events.list.path, async (req, res) => {
    const events = await storage.getEvents(req.params.familyId);
    res.json(events);
  });

  app.post(api.events.create.path, async (req, res) => {
    try {
      const input = api.events.create.input.parse(req.body);
      const event = await storage.createEvent(input);
      res.status(201).json(event);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/events/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = api.events.update.input.parse(req.body);
      const event = await storage.updateEvent(id, data);
      res.json(event);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/events/:id/complete", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { completedBy } = api.events.complete.input.parse(req.body);
      const event = await storage.completeEvent(id, completedBy);

      await storage.createLog({
        familyId: event.familyId,
        userId: completedBy,
        type: "event_done",
        message: `${event.title} を完了！`,
      });

      res.json(event);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/events/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteEvent(id);
    res.json({ success: true });
  });

  // --- Coupons ---
  app.get(api.coupons.list.path, async (req, res) => {
    const familyId = req.params.familyId;
    let couponList = await storage.getCoupons(familyId);
    if (couponList.length === 0) {
      for (const c of DEFAULT_COUPONS) {
        await storage.createCoupon({ ...c, familyId, isCustom: false });
      }
      couponList = await storage.getCoupons(familyId);
    }
    res.json(couponList);
  });

  app.post(api.coupons.create.path, async (req, res) => {
    try {
      const input = api.coupons.create.input.parse(req.body);
      const coupon = await storage.createCoupon(input);
      res.status(201).json(coupon);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.coupons.update.path, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const input = api.coupons.update.input.parse(req.body);
      const coupon = await storage.updateCoupon(id, input);
      res.json(coupon);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/coupons/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteCoupon(id);
    res.json({ success: true });
  });

  app.post(api.coupons.exchange.path, async (req, res) => {
    try {
      const input = api.coupons.exchange.input.parse(req.body);
      const { familyId, couponId, ownerId } = input;

      const couponList = await storage.getCoupons(familyId);
      const coupon = couponList.find(c => c.id === couponId);
      if (!coupon) {
        return res.status(404).json({ message: "クーポンが見つかりません" });
      }

      const allLogs = await storage.getLogs(familyId);
      const userLogs = allLogs.filter(l => l.userId === ownerId);
      const totalEarned = userLogs.reduce((sum, l) => sum + (l.points || 0), 0);

      const allUserCoupons = await storage.getUserCoupons(familyId);
      const userOwned = allUserCoupons.filter(uc => uc.ownerId === ownerId);
      const totalSpent = userOwned.reduce((sum, uc) => sum + (uc.cost || 0), 0);

      const currentPoints = totalEarned - totalSpent;

      if (currentPoints < coupon.cost) {
        return res.status(400).json({
          message: `あと${coupon.cost - currentPoints}pt足りないっす！次のタスクで稼ぐっすよ！`,
          shortage: coupon.cost - currentPoints,
        });
      }

      const uc = await storage.exchangeCoupon({
        familyId,
        couponId,
        couponTitle: coupon.title,
        cost: coupon.cost,
        ownerId,
        status: "owned",
      });

      const partnerUser = ownerId === "papa" ? "mama" : "papa";
      const ownerLabel = ownerId === "papa" ? "パパ" : "ママ";
      await storage.createNotification({
        familyId,
        targetUser: partnerUser,
        message: `${ownerLabel}が『${coupon.title}』を交換しました！`,
        type: "coupon_exchange",
      });

      res.status(201).json(uc);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.coupons.userCoupons.path, async (req, res) => {
    const uc = await storage.getUserCoupons(req.params.familyId);
    res.json(uc);
  });

  app.post("/api/user-coupons/:id/redeem", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { userId, familyId } = api.coupons.redeem.input.parse(req.body);
      const uc = await storage.redeemCoupon(id);

      const partnerUser = userId === "papa" ? "mama" : "papa";
      const ownerLabel = userId === "papa" ? "パパ" : "ママ";
      await storage.createNotification({
        familyId,
        targetUser: partnerUser,
        message: `${ownerLabel}が『${uc.couponTitle}』を使いました！全力でサポートしましょう！`,
        type: "coupon_redeem",
      });

      res.json(uc);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // --- Sleep Training ---
  const DEFAULT_ROUTINES = [
    { title: "お風呂", assignee: "パパ", sortOrder: 0 },
    { title: "着替え", assignee: "ママ", sortOrder: 1 },
    { title: "授乳/ミルク", assignee: "ママ", sortOrder: 2 },
    { title: "絵本", assignee: "パパ", sortOrder: 3 },
    { title: "消灯（入眠）", assignee: "未定", sortOrder: 4 },
  ];

  app.get(api.sleep.checklist.get.path, async (req, res) => {
    const checklist = await storage.getSleepChecklist(req.params.familyId, req.params.date);
    res.json(checklist || { darkness: false, temperature: false, safety: false, whiteNoise: false });
  });

  app.post(api.sleep.checklist.update.path, async (req, res) => {
    try {
      const input = api.sleep.checklist.update.input.parse(req.body);
      const checklist = await storage.upsertSleepChecklist(input);
      res.json(checklist);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.sleep.routines.list.path, async (req, res) => {
    const familyId = req.params.familyId;
    let routines = await storage.getSleepRoutines(familyId);
    if (routines.length === 0) {
      for (const r of DEFAULT_ROUTINES) {
        await storage.createSleepRoutine({ ...r, familyId });
      }
      routines = await storage.getSleepRoutines(familyId);
    }
    res.json(routines);
  });

  app.post(api.sleep.routines.create.path, async (req, res) => {
    try {
      const input = api.sleep.routines.create.input.parse(req.body);
      const routine = await storage.createSleepRoutine(input);
      res.status(201).json(routine);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/sleep/routines/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = api.sleep.routines.update.input.parse(req.body);
      const routine = await storage.updateSleepRoutine(id, data);
      res.json(routine);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/sleep/routines/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteSleepRoutine(id);
    res.json({ success: true });
  });

  app.get(api.sleep.routineLogs.list.path, async (req, res) => {
    const logs = await storage.getSleepRoutineLogs(req.params.familyId, req.params.date);
    res.json(logs);
  });

  app.post(api.sleep.routineLogs.complete.path, async (req, res) => {
    try {
      const input = api.sleep.routineLogs.complete.input.parse(req.body);
      const { familyId, routineId, date, completedBy } = input;

      const allRoutines = await storage.getSleepRoutines(familyId);
      const completedRoutine = allRoutines.find(r => r.id === routineId);
      if (!completedRoutine || completedRoutine.familyId !== familyId) {
        return res.status(404).json({ message: "ルーティンが見つかりません" });
      }

      const existingLogs = await storage.getSleepRoutineLogs(familyId, date);
      const alreadyDone = existingLogs.some(l => l.routineId === routineId);
      if (alreadyDone) {
        return res.status(400).json({ message: "このステップは既に完了しています" });
      }

      const wasAllDoneBefore = allRoutines.every(r => existingLogs.some(l => l.routineId === r.id));

      const routineLog = await storage.completeSleepRoutineStep(input);

      const partnerUser = completedBy === "papa" ? "mama" : "papa";
      const userLabel = completedBy === "papa" ? "パパ" : "ママ";

      await storage.createNotification({
        familyId,
        targetUser: partnerUser,
        message: `${userLabel}が『${completedRoutine.title}』を完了しました！`,
        type: "routine_step",
      });

      const allLogsAfter = await storage.getSleepRoutineLogs(familyId, date);
      const allDone = allRoutines.every(r => allLogsAfter.some(l => l.routineId === r.id));

      if (allDone && !wasAllDoneBefore) {
        await storage.createLog({
          familyId,
          userId: completedBy,
          type: "routine_complete",
          message: "ねんねルーティン完了！チーム3倍ポイント！",
        });

        await storage.createNotification({
          familyId,
          targetUser: partnerUser,
          message: "ねんねルーティン全完了！チーム3倍ポイント獲得！",
          type: "routine_complete",
        });
      }

      res.status(201).json({ routineLog, allDone });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // --- Sleep Sessions ---
  app.get(api.sleepSessions.list.path, async (req, res) => {
    const sessions = await storage.getSleepSessions(req.params.familyId);
    res.json(sessions);
  });

  app.get(api.sleepSessions.active.path, async (req, res) => {
    const childIdParam = req.query.childId;
    const childId = childIdParam ? parseInt(childIdParam as string) : undefined;
    const session = await storage.getActiveSleepSession(req.params.familyId, childId);
    res.json(session);
  });

  app.post(api.sleepSessions.start.path, async (req, res) => {
    try {
      const { familyId, createdBy, childId, startedAt, performedBy } = api.sleepSessions.start.input.parse(req.body);
      const existing = await storage.getActiveSleepSession(familyId, childId);
      if (existing) {
        return res.status(400).json({ message: "既に睡眠セッションが進行中です" });
      }
      const session = await storage.startSleepSession({ familyId, createdBy, childId: childId ?? null, startedAt: startedAt ? new Date(startedAt) : new Date(), performedBy: performedBy ?? null });
      res.status(201).json(session);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/sleep-sessions/:id/end", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const customEndedAt = req.body?.endedAt ? new Date(req.body.endedAt) : undefined;
      const session = customEndedAt
        ? await storage.endSleepSessionAt(id, customEndedAt)
        : await storage.endSleepSession(id);

      const hour = (customEndedAt || new Date()).getHours();
      const isLateNight = hour >= 0 && hour < 5;
      const points = isLateNight ? 20 : 10;

      await storage.createLog({
        familyId: session.familyId,
        childId: session.childId ?? undefined,
        userId: session.createdBy,
        performedBy: session.performedBy ?? undefined,
        type: "sleep",
        points,
        message: `${session.durationMin}分のねんねを記録しました！`,
      });

      res.json(session);
    } catch (err) {
      throw err;
    }
  });

  app.post(api.sleepSessions.manual.path, async (req, res) => {
    try {
      const { familyId, createdBy, childId, durationMin, startedAt, settlingMethod, settlingMinutes, sleepLocation, sleepNote, performedBy } = api.sleepSessions.manual.input.parse(req.body);
      const start = new Date(startedAt);
      const end = new Date(start.getTime() + durationMin * 60000);
      const session = await storage.createManualSleepSession({
        familyId,
        createdBy,
        performedBy: performedBy ?? null,
        childId: childId ?? null,
        startedAt: start,
        endedAt: end,
        durationMin,
      });

      const settlingParts: string[] = [];
      if (settlingMethod && settlingMethod !== "なし") settlingParts.push(settlingMethod);
      if (settlingMinutes && settlingMinutes > 0) settlingParts.push(`${settlingMinutes}分`);
      if (sleepLocation) settlingParts.push(sleepLocation);
      const settlingStr = settlingParts.length > 0 ? `（${settlingParts.join("・")}）` : "";

      await storage.createLog({
        familyId,
        childId: childId ?? undefined,
        userId: createdBy,
        performedBy: performedBy ?? undefined,
        type: "sleep",
        message: `${durationMin}分のねんねを記録しました${settlingStr}（手入力）`,
        settlingMethod: settlingMethod ?? undefined,
        settlingMinutes: settlingMinutes ?? undefined,
        sleepLocation: sleepLocation ?? undefined,
        sleepNote: sleepNote ?? undefined,
      });

      res.status(201).json(session);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // --- Growth Records ---
  app.get(api.growth.list.path, async (req, res) => {
    const records = await storage.getGrowthRecords(req.params.familyId);
    res.json(records);
  });

  app.post(api.growth.create.path, async (req, res) => {
    try {
      const input = api.growth.create.input.parse(req.body);
      const record = await storage.createGrowthRecord(input);
      res.status(201).json(record);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch('/api/growth/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { weightGrams, heightCm, measuredAt } = req.body;
      const data: any = {};
      if (weightGrams !== undefined) data.weightGrams = weightGrams;
      if (heightCm !== undefined) data.heightCm = heightCm;
      if (measuredAt !== undefined) data.measuredAt = measuredAt;
      const record = await storage.updateGrowthRecord(id, data);
      if (!record) return res.status(404).json({ message: "Not found" });
      res.json(record);
    } catch (err) {
      throw err;
    }
  });

  app.delete('/api/growth/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteGrowthRecord(id);
    res.status(204).send();
  });

  // --- Skills ---
  app.get(api.skills.list.path, async (req, res) => {
    const completions = await storage.getSkillCompletions(req.params.familyId);
    res.json(completions);
  });

  app.post(api.skills.complete.path, async (req, res) => {
    try {
      const input = api.skills.complete.input.parse(req.body);
      const existing = await storage.getSkillCompletions(input.familyId);
      const alreadyDone = existing.some(
        (c) => c.userId === input.userId && c.skillId === input.skillId
      );
      if (alreadyDone) {
        return res.status(400).json({ message: "このスキルは既に習得済みです" });
      }
      const completion = await storage.completeSkill(input);
      res.status(201).json(completion);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.skills.uncomplete.path, async (req, res) => {
    try {
      const { familyId, userId, skillId } = api.skills.uncomplete.input.parse(req.body);
      await storage.deleteSkillCompletion(familyId, userId, skillId);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // --- Notifications ---
  app.get(api.notifications.list.path, async (req, res) => {
    const notifs = await storage.getNotifications(req.params.familyId, req.params.targetUser);
    res.json(notifs);
  });

  app.post("/api/notifications/:id/read", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.markNotificationRead(id);
    res.json({ success: true });
  });

  // --- Feedbacks ---
  app.post(api.feedbacks.create.path, async (req, res) => {
    try {
      const input = api.feedbacks.create.input.parse(req.body);
      const feedback = await storage.createFeedback(input);
      res.status(201).json(feedback);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.weBoard.list.path, async (req, res) => {
    const messages = await storage.getWeBoardMessages(req.params.familyId);
    res.json(messages);
  });

  app.post(api.weBoard.create.path, async (req, res) => {
    try {
      const input = api.weBoard.create.input.parse(req.body);
      const msg = await storage.createWeBoardMessage(input);
      res.status(201).json(msg);
    } catch (err: any) {
      if (err?.errors) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.healthRecords.list.path, async (req, res) => {
    const records = await storage.getHealthRecords(req.params.familyId);
    res.json(records);
  });

  app.post(api.healthRecords.create.path, async (req, res) => {
    try {
      const input = api.healthRecords.create.input.parse(req.body);
      const record = await storage.createHealthRecord(input);
      res.status(201).json(record);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/health-records/:id/update", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({
        title: z.string().optional(),
        detail: z.string().nullable().optional(),
        recordedAt: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const record = await storage.updateHealthRecord(id, data);
      res.json(record);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete(api.healthRecords.delete.path, async (req, res) => {
    await storage.deleteHealthRecord(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/vaccination-records/:familyId/:childId", async (req, res) => {
    const records = await storage.getVaccinationRecords(req.params.familyId, parseInt(req.params.childId));
    res.json(records);
  });

  app.get("/api/vaccination-records/:familyId", async (req, res) => {
    const records = await storage.getVaccinationRecords(req.params.familyId);
    res.json(records);
  });

  app.post("/api/vaccination-records", async (req, res) => {
    try {
      const schema = z.object({
        familyId: z.string(),
        childId: z.number().nullable().optional(),
        vaccineId: z.string(),
        administeredDate: z.string(),
        note: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const record = await storage.createVaccinationRecord(data as any);
      res.json(record);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/vaccination-records/:id/update", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const schema = z.object({
        administeredDate: z.string().optional(),
        note: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const record = await storage.updateVaccinationRecord(id, data);
      res.json(record);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/vaccination-records/:id", async (req, res) => {
    await storage.deleteVaccinationRecord(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/custom-vaccines/:familyId/:childId", async (req, res) => {
    const records = await storage.getCustomVaccines(req.params.familyId, parseInt(req.params.childId));
    res.json(records);
  });

  app.get("/api/custom-vaccines/:familyId", async (req, res) => {
    const records = await storage.getCustomVaccines(req.params.familyId);
    res.json(records);
  });

  app.post("/api/custom-vaccines", async (req, res) => {
    try {
      const schema = z.object({
        familyId: z.string(),
        childId: z.number().nullable().optional(),
        name: z.string().min(1),
      });
      const data = schema.parse(req.body);
      const record = await storage.createCustomVaccine(data);
      res.status(201).json(record);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/custom-vaccines/:id", async (req, res) => {
    await storage.deleteCustomVaccine(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/families/:familyId/food-ingredients/:childId", async (req, res) => {
    const items = await storage.getFoodIngredients(req.params.familyId, parseInt(req.params.childId));
    res.json(items);
  });

  app.post("/api/families/:familyId/food-ingredients", async (req, res) => {
    try {
      const data = {
        ...req.body,
        familyId: req.params.familyId,
      };
      const item = await storage.upsertFoodIngredient(data);
      res.status(201).json(item);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/families/:familyId/food-ingredients/bulk", async (req, res) => {
    try {
      const schema = z.object({
        childId: z.number(),
        items: z.array(z.object({
          ingredientName: z.string(),
          category: z.string(),
          status: z.string().default("ok"),
          firstTriedDate: z.string().nullable().optional(),
        })),
      });
      const { childId, items } = schema.parse(req.body);
      const today = new Date().toISOString().slice(0, 10);
      const results = await Promise.all(
        items.map(item =>
          storage.upsertFoodIngredient({
            familyId: req.params.familyId,
            childId,
            ingredientName: item.ingredientName,
            category: item.category,
            status: item.status,
            firstTriedDate: item.firstTriedDate ?? today,
            isCustom: false,
          })
        )
      );
      res.status(201).json(results);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/families/:familyId/food-ingredients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const allItems = await db.select().from(foodIngredients).where(eq(foodIngredients.id, id));
      if (allItems.length === 0 || allItems[0].familyId !== req.params.familyId) {
        return res.status(404).json({ error: "Not found" });
      }
      const schema = z.object({
        ingredientName: z.string().min(1).optional(),
        category: z.string().optional(),
        status: z.string().optional(),
        firstTriedDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const updated = await storage.updateFoodIngredientById(id, data);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/families/:familyId/food-ingredients/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const allItems = await db.select().from(foodIngredients).where(eq(foodIngredients.id, id));
    if (allItems.length === 0 || allItems[0].familyId !== req.params.familyId) {
      return res.status(404).json({ error: "Not found" });
    }
    await storage.deleteFoodIngredient(id);
    res.json({ ok: true });
  });

  app.get("/api/families/:familyId/custom-childcare-items", async (req, res) => {
    const items = await storage.getCustomChildcareItems(req.params.familyId);
    res.json(items);
  });

  app.post("/api/families/:familyId/custom-childcare-items", async (req, res) => {
    try {
      const data = {
        ...req.body,
        familyId: req.params.familyId,
      };
      const item = await storage.createCustomChildcareItem(data);
      res.status(201).json(item);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/families/:familyId/custom-childcare-items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await db.select().from(customChildcareItems).where(eq(customChildcareItems.id, id));
      if (existing.length === 0 || existing[0].familyId !== req.params.familyId) {
        return res.status(404).json({ error: "Not found" });
      }
      const item = await storage.updateCustomChildcareItem(id, req.body);
      res.json(item);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/families/:familyId/custom-childcare-items/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const existing = await db.select().from(customChildcareItems).where(eq(customChildcareItems.id, id));
    if (existing.length === 0 || existing[0].familyId !== req.params.familyId) {
      return res.status(404).json({ error: "Not found" });
    }
    await storage.deleteCustomChildcareItem(id);
    res.json({ ok: true });
  });

  app.get("/api/families/:familyId/custom-quick-actions", async (req, res) => {
    const items = await storage.getCustomQuickActions(req.params.familyId);
    res.json(items);
  });

  app.post("/api/families/:familyId/custom-quick-actions", async (req, res) => {
    const { label, iconName = "Star", colorScheme = "purple" } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "label required" });
    const existing = await storage.getCustomQuickActions(req.params.familyId);
    if (existing.length >= 10) return res.status(400).json({ error: "最大10件まで作成できます" });
    const item = await storage.createCustomQuickAction({
      familyId: req.params.familyId,
      label: label.trim(),
      iconName,
      colorScheme,
      sortOrder: existing.length,
      isActive: true,
    });
    res.json(item);
  });

  app.delete("/api/families/:familyId/custom-quick-actions/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteCustomQuickAction(id);
    res.json({ ok: true });
  });

  app.post("/api/admin/generate-codes", async (req, res) => {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY.trim()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { count = 10, prefix = "BUDOU" } = req.body;
    const codes: string[] = [];
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    for (let i = 0; i < Math.min(count, 200); i++) {
      let suffix = "";
      for (let j = 0; j < 4; j++) {
        suffix += chars[Math.floor(Math.random() * chars.length)];
      }
      codes.push(`${prefix}-${suffix}`);
    }

    const values = codes.map(code => ({ code }));
    try {
      await db.insert(invitationCodes).values(values).onConflictDoNothing();
      res.json({ success: true, codes });
    } catch (err) {
      console.error("Generate codes error:", err);
      res.status(500).json({ message: "Failed to generate codes" });
    }
  });

  app.get("/api/admin/invitation-codes", async (req, res) => {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY.trim()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const codes = await db
        .select()
        .from(invitationCodes)
        .orderBy(sql`${invitationCodes.createdAt} DESC`);
      res.json(codes);
    } catch (err) {
      console.error("Invitation codes error:", err);
      res.status(500).json({ message: "Failed to fetch codes" });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY.trim()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const allUsers = await db
        .select()
        .from(users)
        .orderBy(sql`${users.createdAt} DESC`);
      res.json(allUsers);
    } catch (err) {
      console.error("Admin users error:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/stats", async (_req, res) => {
    try {
      const totalFamilies = await db.select({ count: sql<number>`count(*)` }).from(settings);
      const totalLogs = await db.select({ count: sql<number>`count(*)` }).from(logs);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayLogs = await db.select({ count: sql<number>`count(*)` }).from(logs)
        .where(sql`${logs.createdAt} >= ${today}`);

      const papaCount = await db.select({ count: sql<number>`count(distinct ${logs.familyId})` }).from(logs)
        .where(eq(logs.userId, "papa"));
      const mamaCount = await db.select({ count: sql<number>`count(distinct ${logs.familyId})` }).from(logs)
        .where(eq(logs.userId, "mama"));
      const pairedFamilies = await db.select({ count: sql<number>`count(*)` }).from(
        sql`(SELECT ${logs.familyId} FROM ${logs} GROUP BY ${logs.familyId} HAVING count(distinct ${logs.userId}) >= 2) sub`
      );

      const feedbackCount = await db.select({ count: sql<number>`count(*)` }).from(feedbacks);

      res.json({
        totalFamilies: Number(totalFamilies[0]?.count ?? 0),
        totalLogs: Number(totalLogs[0]?.count ?? 0),
        todayLogs: Number(todayLogs[0]?.count ?? 0),
        papaFamilies: Number(papaCount[0]?.count ?? 0),
        mamaFamilies: Number(mamaCount[0]?.count ?? 0),
        pairedFamilies: Number(pairedFamilies[0]?.count ?? 0),
        feedbackCount: Number(feedbackCount[0]?.count ?? 0),
      });
    } catch (err) {
      console.error("Admin stats error:", err);
      res.status(500).json({ message: "Stats query failed" });
    }
  });

  app.get("/api/mama-health-logs/today", async (req, res) => {
    const s = req.session as any;
    if (!s.userId) return res.status(401).json({ message: "Unauthorized" });
    const log = await storage.getTodayMamaHealthLog(s.userId);
    res.json(log || null);
  });

  app.get("/api/mama-health-logs", async (req, res) => {
    const s = req.session as any;
    if (!s.userId) return res.status(401).json({ message: "Unauthorized" });
    const logs = await storage.getMamaHealthLogs(s.userId);
    res.json(logs);
  });

  app.post("/api/mama-health-logs", async (req, res) => {
    const s = req.session as any;
    if (!s.userId) return res.status(401).json({ message: "Unauthorized" });
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      bowel: z.boolean().nullish(),
      bowelNote: z.string().nullish(),
      lochia: z.string().nullish(),
      perinealPain: z.number().int().min(0).max(4).nullish(),
      mood: z.number().int().min(0).max(4).nullish(),
      sleepHours: z.number().min(0).max(24).nullish(),
      nursingIssues: z.array(z.string()).nullish(),
      nursingNote: z.string().nullish(),
      weightKg: z.number().min(0).max(300).nullish(),
      swelling: z.boolean().nullish(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data" });
    const { date, ...data } = parsed.data;
    const log = await storage.upsertMamaHealthLog(s.userId, data as any, date);
    res.json(log);
  });

  app.get("/api/diaries", async (req, res) => {
    const s = req.session as any;
    const familyId = (req.query.familyId as string) || "default";
    const userId = String(req.query.userId || s.userId || "");
    const entries = await storage.getDiaryEntriesForUser(familyId, userId);
    res.json(entries);
  });

  app.post("/api/diaries", async (req, res) => {
    const s = req.session as any;
    const schema = z.object({
      familyId: z.string().default("default"),
      userId: z.enum(["papa", "mama"]).optional(),
      childId: z.number().int().nullish(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      title: z.string().max(120).default(""),
      content: z.string().max(20000).default(""),
      mood: z.string().nullish(),
      weather: z.string().nullish(),
      tags: z.array(z.string()).max(20).default([]),
      images: z.array(z.string()).max(3).default([]),
      visibility: z.enum(["shared", "private"]).default("shared"),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    const userId = String(parsed.data.userId || s.userId || "");
    if (!userId) return res.status(400).json({ message: "Missing user" });
    const created = await storage.createDiaryEntry({
      ...parsed.data,
      userId,
    } as any);
    res.json(created);
  });

  app.patch("/api/diaries/:id", async (req, res) => {
    const s = req.session as any;
    const userId = String(req.body?.userId || req.query.userId || s.userId || "");
    const familyId = String(req.body?.familyId || req.query.familyId || "");
    const id = parseInt(req.params.id);
    const existing = await storage.getDiaryEntry(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!userId || existing.userId !== userId || existing.familyId !== familyId) return res.status(403).json({ message: "Forbidden" });
    const schema = z.object({
      title: z.string().max(120).optional(),
      content: z.string().max(20000).optional(),
      mood: z.string().nullish(),
      weather: z.string().nullish(),
      tags: z.array(z.string()).max(20).optional(),
      images: z.array(z.string()).max(3).optional(),
      visibility: z.enum(["shared", "private"]).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      childId: z.number().int().nullish(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data" });
    const updated = await storage.updateDiaryEntry(id, parsed.data as any);
    res.json(updated);
  });

  app.delete("/api/diaries/:id", async (req, res) => {
    const s = req.session as any;
    const userId = String(req.body?.userId || req.query.userId || s.userId || "");
    const familyId = String(req.body?.familyId || req.query.familyId || "");
    const id = parseInt(req.params.id);
    const existing = await storage.getDiaryEntry(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!userId || existing.userId !== userId || existing.familyId !== familyId) return res.status(403).json({ message: "Forbidden" });
    await storage.deleteDiaryEntry(id);
    res.json({ success: true });
  });

  app.get("/api/admin/feedbacks", async (_req, res) => {
    try {
      const allFeedbacks = await db
        .select()
        .from(feedbacks)
        .orderBy(sql`${feedbacks.createdAt} DESC`);
      res.json(allFeedbacks);
    } catch (err) {
      console.error("Admin feedbacks error:", err);
      res.status(500).json({ message: "Feedbacks query failed" });
    }
  });

  return httpServer;
}
