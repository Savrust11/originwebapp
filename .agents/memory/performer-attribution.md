---
name: performedBy multi-performer attribution
description: performedBy can be a multi-value string; equality checks break it
---

# performedBy is sometimes a multi-value string

Log rows and sleep_sessions store `performedBy` (the actual caregiver, falling
back to `userId`). For activities that two caregivers can do together (notably
ねんね/sleep, plus other multi-select dialogs), the UI joins selected roles with
the `・` separator, e.g. `"papa・mama"` means both parents.

**Rule:** any attribution, contribution %, or points-split logic that inspects
`performedBy` must split on `・` and use `includes()` — never `=== "papa"` /
`=== "mama"`. A strict-equality comparison silently drops every "both parents"
log from both totals.

**Why:** Dashboard contribution charts originally used
`(l.performedBy || l.userId) === "papa"`, which excluded `"papa・mama"` logs from
both parents, corrupting the split. Fixed with a `performersOf(l)` helper that
splits on `・`.

**How to apply:** when adding a new place that reads `performedBy`, parse it as a
list: `String(l.performedBy || l.userId || "").split("・").filter(Boolean)`.
