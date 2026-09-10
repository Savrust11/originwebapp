// Sleep session <-> sleep log linkage tests (寝かしつけの傾向の集計基盤).
//
// Policy under test: every route that creates a sleep log alongside a
// sleep session must persist logs.sleep_session_id so the dashboard can
// aggregate average sleep duration per settling method/location without
// timestamp-proximity heuristics.
//  1. /api/sleep-success (ねんね開始) -> log linked to the started session
//  2. /api/sleep-sessions/:id/end (タイマー完了) -> completion log linked
//  3. manual historical entry -> log linked despite createdAt != startedAt
const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`ok   - ${name}`);
  else { failures++; console.error(`FAIL - ${name} ${extra}`); }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const FAMILY = `test-sleep-linkage-${Date.now()}`;

// --- 1. ねんね開始 (sleep-success): log must reference the new session ---
let r = await api("POST", "/api/sleep-success", {
  familyId: FAMILY,
  userId: "papa",
  elapsedMinutes: 0,
  settlingMethod: "抱っこ・トントン",
  settlingMinutes: 15,
  sleepLocation: "ベビーベッド",
});
check("POST /api/sleep-success -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
const sessionId = r.json?.session?.id;
check("sleep-success returns session id", Number.isInteger(sessionId));

let logs = (await api("GET", `/api/logs/${FAMILY}`)).json || [];
let startLog = logs.find((l) => l.type === "sleep" && l.sleepSessionId === sessionId);
check("start log linked via sleepSessionId", !!startLog, JSON.stringify(logs.map((l) => [l.type, l.sleepSessionId])));
check("start log keeps settlingMethod", startLog?.settlingMethod === "抱っこ・トントン");
check("start log keeps sleepLocation", startLog?.sleepLocation === "ベビーベッド");

// --- 2. タイマー完了 (end): completion log must reference the same session ---
r = await api("POST", `/api/sleep-sessions/${sessionId}/end`, {
  familyId: FAMILY,
  userId: "papa",
  endedAt: new Date(Date.now() + 90 * 60000).toISOString(),
});
check("POST /api/sleep-sessions/:id/end -> 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
check("ended session has durationMin", (r.json?.durationMin ?? 0) > 0, JSON.stringify(r.json));

logs = (await api("GET", `/api/logs/${FAMILY}`)).json || [];
const linkedLogs = logs.filter((l) => l.type === "sleep" && l.sleepSessionId === sessionId);
check("timer completion log also linked to session", linkedLogs.length >= 2, `linked=${linkedLogs.length}`);

// --- 3. 手入力の過去記録: createdAt(now) != startedAt(過去) でもIDでひも付く ---
const pastStart = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
r = await api("POST", "/api/sleep-sessions/manual", {
  familyId: FAMILY,
  createdBy: "mama",
  durationMin: 120,
  startedAt: pastStart,
  settlingMethod: "授乳",
  settlingMinutes: 10,
  sleepLocation: "添い寝",
});
check("POST /api/sleep-sessions/manual -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
const manualSessionId = r.json?.id;
check("manual session has durationMin 120", r.json?.durationMin === 120);

logs = (await api("GET", `/api/logs/${FAMILY}`)).json || [];
const manualLog = logs.find((l) => l.type === "sleep" && l.sleepSessionId === manualSessionId);
check("manual historical log linked via sleepSessionId", !!manualLog);
check("manual log keeps settlingMethod", manualLog?.settlingMethod === "授乳");

console.log(failures === 0 ? "\nsleep-linkage: all passed" : `\nsleep-linkage: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
