---
name: Legacy familyId rotation
description: How legacy (guessable) family codes are rotated to secure ones and how paired devices follow.
---

Legacy familyId = `family-` + ≤10 base36 chars (old Date.now()/Math.random formats). Secure formats: 16 base36 (client) or 20 hex (server) — regex must never overlap.

Rotation design:
- Rotating renames `family_id` in **every** public table discovered via information_schema (so new family-scoped tables are covered automatically); `family_id_migrations`/session tables are excluded.
- An old→new mapping row lets the partner device auto-follow, but only within a grace window (default 72h, `FAMILY_ID_MIGRATION_GRACE_MS`); after that the mapping is not disclosed and the partner must re-enter the code manually.
- **Why:** disclosing old→new forever would defeat the rotation (an attacker guessing the old ID would get the new one). During the window the attacker could have used the old ID anyway, so nothing is weakened.
- Both endpoints sit behind familyCreateGuard so familyId enumeration stays rate-limited; rotation is idempotent (unique old_family_id + return-existing-mapping) so racing devices can't split a family.
- The migrations table is bootstrapped with CREATE TABLE IF NOT EXISTS at route registration — do not rely on db:push (it wants to drop the session table).
