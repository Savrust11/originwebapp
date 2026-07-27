export const DEMO_FAMILY = "we-iku-demo";
const DEMO_LS_SENTINEL = "we_iku_demo_active";
const DEMO_BACKUP_KEY = "we_iku_demo_backup";

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_LS_SENTINEL) === "1";
  } catch {
    return false;
  }
}

const DEMO_LS_KEYS: Record<string, string> = {
  familyId: DEMO_FAMILY,
  userType: "papa",
  activeChildId: "1",
  onboarding_done: "true",
  invitation_verified: "true",
  we_iku_tutorial_done: "true",
  lineDisplayName: "デモ ぱぱ",
  [DEMO_LS_SENTINEL]: "1",
};

export function enterDemoMode() {
  try {
    // Snapshot the real user's state the first time we enter demo so it can be
    // fully restored on exit. Skip if already in demo (would capture demo values).
    if (localStorage.getItem(DEMO_LS_SENTINEL) !== "1") {
      const backup: Record<string, string | null> = {};
      for (const k of Object.keys(DEMO_LS_KEYS)) {
        backup[k] = localStorage.getItem(k);
      }
      localStorage.setItem(DEMO_BACKUP_KEY, JSON.stringify(backup));
    }
    sessionStorage.setItem("splash_shown", "true");
    for (const [k, v] of Object.entries(DEMO_LS_KEYS)) {
      localStorage.setItem(k, v);
    }
  } catch {}
}

export function exitDemoMode() {
  try {
    let backup: Record<string, string | null> = {};
    try {
      const raw = localStorage.getItem(DEMO_BACKUP_KEY);
      if (raw) backup = JSON.parse(raw);
    } catch {}
    for (const k of Object.keys(DEMO_LS_KEYS)) {
      const prev = backup[k];
      if (prev === null || prev === undefined) {
        localStorage.removeItem(k);
      } else {
        localStorage.setItem(k, prev);
      }
    }
    localStorage.removeItem(DEMO_BACKUP_KEY);
  } catch {}
}

// ---------- Mock data ----------

const HOUR = 3600000;
const MIN = 60000;

function todayBase(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function at(hour: number, minute = 0): string {
  return new Date(todayBase() + hour * HOUR + minute * MIN).toISOString();
}

function eightMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 8);
  return d.toISOString().slice(0, 10);
}

let logIdSeq = 5000;
function mkLog(over: Record<string, any>): any {
  return {
    id: logIdSeq++,
    familyId: DEMO_FAMILY,
    childId: 1,
    userId: "papa",
    type: "custom",
    points: 10,
    message: null,
    subType: null,
    foodItems: null,
    foodAmount: null,
    foodNote: null,
    isNewFood: false,
    imageUrl: null,
    poopColor: null,
    poopConsistency: null,
    bodyTemperature: null,
    symptoms: null,
    symptomNote: null,
    breastLeftMin: null,
    breastRightMin: null,
    isExpressed: false,
    expressedMl: null,
    formulaMl: null,
    stoolType: null,
    stoolAmount: null,
    stoolColor: null,
    medicineName: null,
    medicineDose: null,
    performedBy: null,
    settlingMethod: null,
    settlingMinutes: null,
    sleepLocation: null,
    sleepNote: null,
    spitUp: false,
    spitUpAmount: null,
    spitUpTiming: null,
    spitUpNote: null,
    holdEndAt: null,
    walkEndAt: null,
    createdAt: at(12),
    ...over,
  };
}

type DemoState = {
  children: any[];
  settings: any;
  logs: any[];
  sleepSessions: any[];
  activeSleep: any | null;
  events: any[];
  coupons: any[];
  weBoard: any[];
  growth: any[];
  routines: any[];
};

let state: DemoState | null = null;

function initState(): DemoState {
  const children = [
    {
      id: 1,
      familyId: DEMO_FAMILY,
      name: "ひなた",
      birthday: eightMonthsAgo(),
      gender: "girl",
      bloodType: null,
      color: "#805AAA",
      sleepTrainingEnabled: true,
      rotavirusVaccineType: null,
      createdAt: at(0),
    },
  ];

  const settings = {
    id: 1,
    familyId: DEMO_FAMILY,
    babyName: "ひなた",
    babyBirthday: eightMonthsAgo(),
    specialTrick: "ビニール袋の音",
    currentCaregiver: "パパ",
  };

  const logs = [
    mkLog({ type: "milk", subType: "breast", breastLeftMin: 12, breastRightMin: 8, userId: "papa", points: 15, message: "授乳しました", createdAt: at(6, 30) }),
    mkLog({ type: "diaper", stoolType: "ふつう", stoolAmount: "ふつう", stoolColor: "黄色", userId: "mama", points: 10, message: "うんち", createdAt: at(7, 10) }),
    mkLog({ type: "food", foodItems: "おかゆ・にんじん", foodAmount: "もぐもぐ完食", userId: "mama", points: 15, message: "離乳食", createdAt: at(8, 0) }),
    mkLog({ type: "walk", userId: "papa", points: 20, message: "お散歩に行きました", createdAt: at(9, 0), walkEndAt: at(9, 45) }),
    mkLog({ type: "milk", subType: "formula", formulaMl: 120, userId: "papa", points: 15, message: "ミルク 120ml", createdAt: at(12, 0) }),
    mkLog({ type: "hold", userId: "mama", points: 10, message: "抱っこ", createdAt: at(15, 30), holdEndAt: at(15, 50) }),
    mkLog({ type: "walk", userId: "mama", points: 20, message: "お散歩に行きました", createdAt: at(16, 30), walkEndAt: at(17, 10) }),
    mkLog({ type: "food", foodItems: "おかゆ・かぼちゃ・豆腐", foodAmount: "半分", userId: "papa", points: 15, message: "離乳食", createdAt: at(18, 0) }),
    mkLog({ type: "temp", bodyTemperature: 36.8, userId: "mama", points: 10, message: "検温 36.8℃", createdAt: at(19, 30) }),
  ];

  const sleepSessions = [
    { id: 9001, familyId: DEMO_FAMILY, childId: 1, startedAt: at(10, 15), endedAt: at(11, 40), durationMin: 85, createdBy: "papa", createdAt: at(10, 15) },
    { id: 9002, familyId: DEMO_FAMILY, childId: 1, startedAt: at(13, 15), endedAt: at(14, 40), durationMin: 85, createdBy: "mama", createdAt: at(13, 15) },
  ];

  const events = [
    { id: 7001, familyId: DEMO_FAMILY, title: "小児科 予防接種", date: new Date(todayBase() + 2 * 24 * HOUR).toISOString().slice(0, 10), time: "10:30", assignee: "ママ", completed: false, completedBy: null, points: 10, memo: null, icon: null, color: null, createdAt: at(0) },
    { id: 7002, familyId: DEMO_FAMILY, title: "離乳食ストック作り", date: new Date(todayBase() + 1 * 24 * HOUR).toISOString().slice(0, 10), time: null, assignee: "パパ", completed: false, completedBy: null, points: 10, memo: null, icon: null, color: null, createdAt: at(0) },
  ];

  const coupons = [
    { id: 6001, familyId: DEMO_FAMILY, title: "ひとりで30分お昼寝", cost: 50, isCustom: false, createdBy: null, createdAt: at(0) },
    { id: 6002, familyId: DEMO_FAMILY, title: "好きなスイーツ", cost: 80, isCustom: false, createdBy: null, createdAt: at(0) },
    { id: 6003, familyId: DEMO_FAMILY, title: "ゆっくりお風呂", cost: 60, isCustom: false, createdBy: null, createdAt: at(0) },
  ];

  const weBoard = [
    { id: 8001, familyId: DEMO_FAMILY, userId: "mama", message: "今日はよく食べてくれました！", createdAt: at(18, 30) },
  ];

  const growth = [
    { id: 5501, familyId: DEMO_FAMILY, childId: 1, userId: "mama", weightGrams: 7800, heightCm: 68.5, headCircumferenceCm: 43.5, measuredAt: new Date(todayBase() - 30 * 24 * HOUR).toISOString().slice(0, 10), createdAt: at(0) },
    { id: 5502, familyId: DEMO_FAMILY, childId: 1, userId: "mama", weightGrams: 8200, heightCm: 70.0, headCircumferenceCm: 44.0, measuredAt: new Date(todayBase() - 2 * 24 * HOUR).toISOString().slice(0, 10), createdAt: at(0) },
  ];

  const routines = [
    { id: 4001, familyId: DEMO_FAMILY, title: "おふろ", assignee: "パパ", sortOrder: 0, createdAt: at(0) },
    { id: 4002, familyId: DEMO_FAMILY, title: "絵本を読む", assignee: "ママ", sortOrder: 1, createdAt: at(0) },
    { id: 4003, familyId: DEMO_FAMILY, title: "おやすみのあいさつ", assignee: "未定", sortOrder: 2, createdAt: at(0) },
  ];

  return { children, settings, logs, sleepSessions, activeSleep: null, events, coupons, weBoard, growth, routines };
}

function getState(): DemoState {
  if (!state) state = initState();
  return state;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function handleGet(path: string): Response {
  const s = getState();
  if (path === "/api/auth/me") {
    return json({ authenticated: true, familyId: DEMO_FAMILY, role: "papa", displayName: "デモ ぱぱ", invitationVerified: true });
  }
  if (path.startsWith("/api/children/")) return json(s.children);
  if (path.startsWith("/api/settings/")) return json(s.settings);
  if (path.startsWith("/api/logs/")) return json(s.logs);
  if (path.includes("/api/sleep-sessions/") && path.endsWith("/active")) return json(s.activeSleep);
  if (path.startsWith("/api/sleep-sessions/")) return json(s.sleepSessions);
  if (path.startsWith("/api/events/")) return json(s.events);
  if (path.startsWith("/api/coupons/")) return json(s.coupons);
  if (path.startsWith("/api/user-coupons/")) return json([]);
  if (path.startsWith("/api/notifications/")) return json([]);
  if (path.startsWith("/api/we-board/")) return json(s.weBoard);
  if (path.startsWith("/api/growth/")) return json(s.growth);
  if (path.startsWith("/api/skills/")) return json([]);
  if (path.startsWith("/api/sleep/checklist/")) return json({ darkness: true, temperature: true, safety: true, whiteNoise: false });
  if (path.startsWith("/api/sleep/routine-logs-week")) return json([]);
  if (path.startsWith("/api/sleep/routine-logs")) return json([]);
  if (path.startsWith("/api/sleep/routines/")) return json(s.routines);
  if (path.startsWith("/api/sleep-success")) return json([]);
  if (path.startsWith("/api/health-records/")) return json([]);
  if (path.startsWith("/api/vaccination-records")) return json([]);
  if (path.startsWith("/api/custom-vaccines")) return json([]);
  if (path.startsWith("/api/diaries")) return json([]);
  if (path.startsWith("/api/mama-health-logs")) return json([]);
  if (path.includes("/food-ingredients")) return json([]);
  if (path.includes("/custom-childcare-items")) return json([]);
  if (path.includes("/custom-quick-actions")) return json([]);
  if (path.includes("/medicine-names")) return json([]);
  return json([]);
}

function handleWrite(method: string, path: string, body: any): Response {
  const s = getState();

  if (method === "POST" && path === "/api/logs") {
    const created = mkLog({ ...body, createdAt: new Date().toISOString(), points: body?.points ?? 10 });
    s.logs.push(created);
    return json(created, 201);
  }

  if (method === "POST" && path === "/api/sleep-sessions/start") {
    const sess = {
      id: logIdSeq++,
      familyId: DEMO_FAMILY,
      childId: 1,
      startedAt: body?.startedAt || new Date().toISOString(),
      endedAt: null,
      durationMin: null,
      createdBy: body?.createdBy || "papa",
      createdAt: new Date().toISOString(),
    };
    s.activeSleep = sess;
    s.sleepSessions.push(sess);
    return json(sess, 201);
  }

  if (method === "POST" && /\/api\/sleep-sessions\/\d+\/end/.test(path)) {
    const sess = s.activeSleep;
    if (sess) {
      sess.endedAt = body?.endedAt || new Date().toISOString();
      sess.durationMin = Math.max(1, Math.round((new Date(sess.endedAt).getTime() - new Date(sess.startedAt).getTime()) / MIN));
      s.activeSleep = null;
      return json(sess);
    }
    return json({ durationMin: 0 });
  }

  if (method === "POST" && path === "/api/sleep-sessions/manual") {
    const startedAt = body?.startedAt || new Date().toISOString();
    const durationMin = body?.durationMin || 30;
    const sess = {
      id: logIdSeq++,
      familyId: DEMO_FAMILY,
      childId: 1,
      startedAt,
      endedAt: new Date(new Date(startedAt).getTime() + durationMin * MIN).toISOString(),
      durationMin,
      createdBy: body?.createdBy || "papa",
      createdAt: new Date().toISOString(),
    };
    s.sleepSessions.push(sess);
    return json(sess, 201);
  }

  if (method === "POST" && path === "/api/we-board") {
    const post = { id: logIdSeq++, familyId: DEMO_FAMILY, userId: body?.userId || "papa", message: body?.message || "", createdAt: new Date().toISOString() };
    s.weBoard.unshift(post);
    return json(post, 201);
  }

  // Generic no-op success for any other write.
  return json({ success: true });
}

export function installDemoFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isDemoMode()) return orig(input, init);

    let url = "";
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.toString();
    else url = input.url;

    let path = url;
    try {
      path = new URL(url, window.location.origin).pathname;
    } catch {}

    if (!path.startsWith("/api/")) return orig(input, init);

    const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") || "GET").toUpperCase();

    let body: any = undefined;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {}
    }

    try {
      if (method === "GET") return handleGet(path);
      return handleWrite(method, path, body);
    } catch {
      return json({ success: true });
    }
  };
}
