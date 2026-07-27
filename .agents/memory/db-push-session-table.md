---
name: db:push wants to drop the session table
description: npm run db:push prompts to remove a table (connect-pg-simple session store); never confirm — add columns via direct ALTER TABLE instead
---

# db:push drop prompt

`npm run db:push` (drizzle-kit) diffs the dev DB against `shared/schema.ts`. The `session` table created by connect-pg-simple is NOT in the Drizzle schema, so push offers "Yes, I want to remove 1 table" — confirming would wipe all login sessions.

**Why:** session store table is managed by connect-pg-simple at runtime, intentionally outside Drizzle.

**How to apply:** for additive schema changes, edit `shared/schema.ts` then apply with a direct `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` via executeSql instead of confirming db:push. Production gets the column automatically via Replit's publish-time schema diff.
