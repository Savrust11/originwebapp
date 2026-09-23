---
name: Auth identity model & ownership checks
description: How this app identifies users for normal operations, and the IDOR rule for per-owner resources.
---

# Identity model

For normal operations this app does NOT rely on a server login session. The user is
identified by a client-provided `userId` of `"papa"` or `"mama"` (localStorage `userType`)
plus `familyId` (localStorage). Most write endpoints (e.g. `POST /api/logs`) read these
from the request body/query — no `req.session`.

**Why:** the LINE/LIFF session is tied to `we-iku.com`. In the Replit preview and in the
native app being migrated to, there is no LINE auth, so `req.session.userId` is undefined.
Any endpoint gated behind `req.session.userId` returns 401 there and the feature silently
breaks (this is exactly what made 育児日記 save fail with "保存に失敗しました").

**How to apply:** This describes the legacy family-record interface only, not a
secure identity mechanism for new private data. Preserve compatibility when
maintaining those legacy routes, but do not reuse their client-provided identity
for private consultations. The user explicitly requires consultations to use a
server-verified login session and a current persisted numeric account ID.
If a preview/native session is unavailable, consultations must refuse access;
never fall back to family codes or papa/mama values to make the feature work.

# Ownership / IDOR rule

`userId` is low-entropy (only `papa`/`mama`), so it is NOT a sufficient ownership key on
its own. For PATCH/DELETE of a per-owner row, check **both** `existing.familyId === familyId`
**and** `existing.userId === userId` before mutating.

**Why:** checking only `existing.userId === userId` lets any client edit/delete another
family's row by guessing the sequential `id` (every family has a `papa`). Found as an IDOR
in the diary routes.

**How to apply:** require `familyId` on mutation requests and compare it against the stored
row in addition to the owner; return 403 if either mismatches.

# familyId is a capability (creation routes)

Joining a family literally = entering the familyId as the pairing code, so the familyId is
a bearer secret. There is no membership token: creation routes are protected by
`familyCreateGuard` (server/familyGuard.ts) which (1) requires an explicit familyId —
never rely on the schema's `"default"` fallback — and (2) rate-limits distinct familyIds
per IP (env `FAMILY_ENUM_LIMIT`, default 30/10min) to block brute-force enumeration.

**Why:** any token issued on knowledge of familyId adds nothing; sessions break in
preview/native. Entropy + enumeration limiting is the enforceable boundary.

**How to apply:** new creation-type POST routes must include the creation guard as
middleware; the URL `:familyId` param is canonical and all supplied sources must match
(otherwise a pinned body familyId can evade enumeration tracking). familyId generation
must be crypto-random (never `Date.now()`/`Math.random()`). Test suites that use many
test familyIds from one IP must raise the enumeration limit env var.

## Family code rotation
- POST /api/family/rotate-code reassigns every familyId row (23 tables, see storage.rotateFamilyId) to a fresh crypto ID in one transaction. settings.family_id (unique) is the family anchor.
- **Gotcha:** storage.getSettings auto-creates a settings row for unknown IDs — use a direct db.select when checking family existence, or you enable ID probing/side effects.
