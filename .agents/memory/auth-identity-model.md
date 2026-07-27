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

**How to apply:** new per-user endpoints should resolve identity from
`req.body.userId / req.query.userId` (falling back to `req.session.userId` if you want to
honor a real session), not require a session. On the client, send `userId: userType` and
`familyId` with the request. Validate the owner field as `z.enum(["papa","mama"])`.

# Ownership / IDOR rule

`userId` is low-entropy (only `papa`/`mama`), so it is NOT a sufficient ownership key on
its own. For PATCH/DELETE of a per-owner row, check **both** `existing.familyId === familyId`
**and** `existing.userId === userId` before mutating.

**Why:** checking only `existing.userId === userId` lets any client edit/delete another
family's row by guessing the sequential `id` (every family has a `papa`). Found as an IDOR
in the diary routes.

**How to apply:** require `familyId` on mutation requests and compare it against the stored
row in addition to the owner; return 403 if either mismatches.
