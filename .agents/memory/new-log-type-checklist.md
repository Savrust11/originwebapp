---
name: Adding a new log type
description: Registries that must be updated when introducing a new `logs.type` value, so it appears in dialogs, timeline, and dashboards.
---

When adding a new `type` value to the `logs` table, the value must be registered in all of these places — none of them are derived automatically, and missing one causes silent invisibility on a UI surface:

1. **`shared/schema.ts`** — add any new columns (e.g. `*_end_at` for time-band entries).
2. **`server/routes.ts` `POST /api/logs`** — if the new type has extra fields not in the insert schema (timestamps, etc.), strip them before zod parsing and `updateLog` them afterward (mirror the `holdEndAt` pattern).
3. **`client/src/lib/phases.ts`**
   - `dialogType` union on `PhaseActionConfig`
   - the action entry in each relevant phase's `actions` array (icon + color + label)
   - `ALL_LOG_TYPES` array
   - `LOG_TYPE_LABELS` map
4. **`client/src/components/ActionButtons.tsx`**
   - `DIALOG_TYPES` set — without this the dialog never opens; tapping the button silently no-ops or fires `handleAction` immediately.
   - state, `resetNewDialogs`, `handleAction` branch, dialog UI JSX, and `getDialogTitle` entry.
5. **`client/src/pages/Timeline.tsx`**
   - `LOG_TYPES_TO_SHOW` array — without this the log row is saved but hidden from the timeline.
   - `getLogIcon` switch.
6. **`client/src/pages/Dashboard.tsx`** `TYPE_LABELS` — falls back to raw type id if missing (cosmetic).

**Why:** Several "did the feature work?" bugs in this app have come from updating only one or two of these registries (e.g. schema + dialog) and the button either doing nothing or the entry not appearing in Timeline. Architect review caught exactly this on the walk feature.

**How to apply:** Treat this as a checklist for any new `type`. The hold (抱っこ) and walk (お散歩) entries are the canonical templates for a time-band log type (`*_end_at` column + start/end picker dialog).

## Dialog crash gotcha (ErrorBoundary "エラーが発生しました")
ActionButtons.tsx destructures the create-log mutation as `const { mutate, isPending } = useCreateLog()`, so inside that file use bare `isPending` — NOT `createLog.isPending`. Other pages (Health.tsx, Dashboard.tsx, Rescue.tsx) instead do `const createLog = useCreateLog()` and use `createLog.mutate` / `createLog.isPending`. Copy-pasting a submit button between these files silently introduces an undefined `createLog`, which throws at render time and trips the top-level ErrorBoundary in main.tsx ("エラーが発生しました") the moment the dialog opens — looking like "recording is broken." **Why:** the hold/walk submit buttons were pasted with `createLog.isPending` and crashed both dialogs.
