// Guard for creation-type routes ("POST something new into a family").
//
// Identity model (see .agents/memory/auth-identity-model.md): this app has no
// server session for normal operations. Joining a family literally means
// entering the familyId as a pairing code, so the familyId itself is the
// family's bearer credential (a capability). Server-side "membership"
// verification therefore reduces to:
//   1. the familyId must be explicitly supplied (no silent "default" fallback),
//   2. familyIds must be unguessable (high entropy — see generateFamilyId and
//      client Onboarding), and
//   3. one client must not be able to spray/brute-force many familyIds
//      (per-IP enumeration rate limit below).
//
// This complements the getOwnedResource / getOwnedLog guards that protect
// update/delete of existing rows.

interface IpWindow {
  familyIds: Map<string, number>; // familyId -> last-seen epoch ms
}

const WINDOW_MS = Number(process.env.FAMILY_ENUM_WINDOW_MS || 10 * 60 * 1000);
// Max DISTINCT familyIds a single IP may write to within the window. A real
// household uses exactly one familyId, so even a small limit is generous.
const LIMIT = Number(process.env.FAMILY_ENUM_LIMIT || 30);

const ipWindows = new Map<string, IpWindow>();
let lastSweep = 0;

function clientIp(req: any): string {
  // Behind the Replit proxy, use the first X-Forwarded-For hop.
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  ipWindows.forEach((w, ip) => {
    w.familyIds.forEach((seen, fid) => {
      if (now - seen > WINDOW_MS) w.familyIds.delete(fid);
    });
    if (w.familyIds.size === 0) ipWindows.delete(ip);
  });
}

/**
 * Express middleware for creation routes. Requires an explicit familyId in
 * body, query, or route params, and rate-limits how many distinct familyIds
 * a single IP may target, which makes brute-forcing/guessing another family's
 * ID impractical while never affecting a normal household (one familyId).
 */
export function familyCreateGuard(req: any, res: any, next: any) {
  // The route param is canonical (handlers of /api/families/:familyId/*
  // write to the param family). Any other supplied source must match it,
  // otherwise an attacker could pin a constant body.familyId to evade the
  // enumeration limit while varying the URL family.
  const sources = [req.params?.familyId, req.body?.familyId, req.query?.familyId]
    .filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v: string) => v.trim());
  const familyId = sources[0] ?? "";
  if (!familyId) {
    return res.status(400).json({ message: "familyId is required" });
  }
  if (sources.some((v: string) => v !== familyId)) {
    return res.status(403).json({ message: "familyIdが一致しません" });
  }
  if (familyId.length > 64) {
    return res.status(400).json({ message: "familyId is invalid" });
  }

  const now = Date.now();
  sweep(now);
  const ip = clientIp(req);
  let w = ipWindows.get(ip);
  if (!w) {
    w = { familyIds: new Map() };
    ipWindows.set(ip, w);
  }
  // prune this window lazily
  w.familyIds.forEach((seen, fid) => {
    if (now - seen > WINDOW_MS) w!.familyIds.delete(fid);
  });
  const known = w.familyIds.has(familyId);
  if (!known && w.familyIds.size >= LIMIT) {
    // Too many distinct familyIds from one IP: looks like enumeration.
    // familyIds already seen in the window keep working so a legitimate
    // family is never locked out by an attacker sharing the IP window.
    return res
      .status(429)
      .json({ message: "リクエストが多すぎます。しばらくしてからお試しください" });
  }
  w.familyIds.set(familyId, now);
  next();
}
