import type { Request, Response, NextFunction } from "express";

/** Keep privacy and disabled-by-default behavior ahead of body parsing/auth. */
export function evidenceRequestBoundary(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.vary("Cookie");
  if (process.env.EVIDENCE_SEARCH_ENABLED !== "true") {
    return res.status(404).json({ message: "Not found" });
  }
  // Questions belong in a bounded POST body, never a URL/access-log parameter.
  if (Object.keys(req.query).length) {
    return res.status(400).json({ message: "検索条件はJSON本文で送信してください。" });
  }
  next();
}

export function isEvidenceRequestPath(path: string): boolean {
  return path === "/api/evidence" || path.startsWith("/api/evidence/");
}

/** Never return/log parser errors: they can contain the submitted question. */
export function evidenceErrorResponse(error: unknown, res: Response) {
  const code = (error as { type?: unknown } | null)?.type;
  const status = code === "entity.too.large" ? 413 : code === "entity.parse.failed" ? 400 : 500;
  return res.status(status).json({
    message: status === 500 ? "資料の検索を完了できませんでした。" : "検索入力の形式または長さを確認してください。",
  });
}