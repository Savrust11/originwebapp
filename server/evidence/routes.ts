import type { Express, Request, Response, NextFunction } from "express";
import { inputSchema } from "@shared/evidence";
import { pool } from "../db";
import { verifiedConsultationUser, isSameOriginRequest } from "../consultations";
import { evidenceRequestBoundary, evidenceErrorResponse } from "../evidence-http";
import { searchEvidence } from "./search";

export function registerEvidenceRoutes(app: Express) {
  app.use("/api/evidence", evidenceRequestBoundary);
  app.post("/api/evidence/search", async (req, res) => {
    try {
      if (!(await verifiedConsultationUser(req))) {
        return res.status(401).json({ message: "ログイン済みの保護者アカウントが必要です。" });
      }
      if (!isSameOriginRequest(req)) {
        return res.status(403).json({ message: "同じサイトから検索してください。" });
      }
      if (!req.is("application/json")) {
        return res.status(415).json({ message: "JSON形式で送信してください。" });
      }
      const parsed = inputSchema.safeParse(req.body);
      if (!parsed.success) {
        // Zod issues may include input: return only this fixed message.
        return res.status(400).json({ message: "検索条件の形式または長さを確認してください。" });
      }
      return res.json(await searchEvidence(pool, parsed.data));
    } catch {
      return res.status(500).json({ message: "資料の検索を完了できませんでした。" });
    }
  });
  app.use("/api/evidence", (_req, res) => res.status(404).json({ message: "Not found" }));
  app.use("/api/evidence", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    evidenceErrorResponse(error, res);
  });
}