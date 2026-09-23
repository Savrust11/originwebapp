---
name: Supporter operating constraints
description: Intentional shared-device and identity decisions for facility care
---

Facility care intentionally uses one shared facility account, not individual staff identities.
Do not add staff-name collection, automatic inactivity locking, or a whole-screen
lock triggered only by network loss as an assumed security improvement.

**Why:** The facility workflow explicitly requires a shared device/account,
account-level audit history, and continued screen use without automatic inactivity locks.
Network loss must block saving without pretending an unsaved record was saved.
These are product requirements, not missing functionality.

**How to apply:** Preserve these choices when improving supporter security.
Use server-side grants, expiry checks, account-level audit, and draft isolation.
Printed/saved PDFs deliberately remain with the facility; do not invent a
retention period or promise that the app can recall them.

SE clarified that the native app uses LINE, Google and Apple, while Web uses LINE
only; neither email nor Guest is a login method. The facility uses its dedicated
Google account.

**Why:** Earlier requirements incorrectly described email/Guest login. SE's
clarification supersedes that assumption; unavailable native integration details
do not authorize creating a replacement identity provider.

**How to apply:** Reuse the existing authenticated common user. Keep actual
provider-login verification separate from synthetic authenticated-user tests.
Development fixture sessions are test aids, never a facility login method.