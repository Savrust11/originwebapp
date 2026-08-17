#!/bin/bash
# Post-merge setup: runs automatically after a task branch is merged.
# Keep idempotent, non-interactive, and fast.
set -e

# Sync dependencies in case the merged task changed package.json
npm install

# NOTE: deliberately NOT running `npm run db:push` here — drizzle-kit push
# proposes dropping the `session` table (would kill live login sessions) and
# would hang/fail non-interactively. Schema changes must be applied via
# explicit ALTER TABLE by the agent (see .agents/memory/db-push-session-table.md).
