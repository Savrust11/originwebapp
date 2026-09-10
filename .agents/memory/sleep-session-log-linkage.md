---
name: Sleep session ↔ sleep log linkage
description: How sleep logs are associated with sleep_sessions for duration aggregation
---

Sleep logs carry an explicit `sleepSessionId` (logs.sleep_session_id); all three creation routes (ねんね開始 /api/sleep-success, タイマー完了 /end, 手入力 manual) set it, and dev DB legacy rows were backfilled.

**Why:** Timestamp-proximity matching (createdAt vs startedAt within 2min) is unreliable — timer-completion logs are created at wake-up, manual historical entries at "now", so proximity silently drops or mismatches durations. A completion review rejected an aggregation built on it.

**How to apply:** Any new aggregation or display that needs a sleep session's durationMin from a log must use `log.sleepSessionId`, never proximity. Timeline.tsx still uses the old 2-min heuristic for display of legacy rows — if touched, migrate it to ID lookup with proximity only as legacy fallback. Guarded by tests/sleep-linkage.test.mjs (runs in `npm run test:authz`).
