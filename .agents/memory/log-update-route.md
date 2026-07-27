---
name: Log update route allowlist
description: Adding a new editable log column requires touching the update route's Zod schema, not just storage
---

# Editing a new log column

`storage.updateLog` persists generically via `db.update(logs).set(data)`, so any column flows through at runtime.

**But** `POST /api/logs/:id/update` (server/routes.ts) parses the body with a strict Zod **allowlist** schema and only copies whitelisted keys into `updateData`. A field absent from that schema is silently dropped before it reaches storage.

**How to apply:** to make any new `logs` column editable from the Timeline edit dialog, you MUST (1) add it to that route's Zod schema, (2) add an `if (data.x !== undefined) updateData.x = ...` mapping line (convert date strings with `new Date()`), and (3) send it in the Timeline `updateLog` mutation payload. Skipping the route changes = the edit appears to save in the UI but nothing changes.

Date-range logs (hold→holdEndAt, walk→walkEndAt) render as timeline bands keyed on the end-time column; clearing the end column drops the band, so end time is treated as required (not nullable) in the edit UI.
