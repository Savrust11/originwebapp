---
name: Dialog scroll pattern (mobile save-button reachability)
description: All form dialogs need max-h + overflow-y-auto or expanding sections push the save button off-screen on mobile; "保存できない" reports may be UI reachability, not API failure.
---

# Form dialogs must scroll — mobile save-button reachability

**Rule:** Every `DialogContent` that hosts a form with expandable sections (chips, conditional fields, textareas) must include `max-h-[80vh] overflow-y-auto top-[45%] sm:top-[50%]`. Radix centers dialogs with `translate-y(-50%)`; without a max-height + scroll, content taller than the viewport pushes the submit button off-screen on phones and it cannot be tapped.

**Why:** Real incident (July 2026): 「吐き戻しの量とタイミングを入力すると保存できない」— the Timeline milk-edit dialog had no scroll classes; toggling 吐き戻しあり expanded 3 sub-sections and the save button became unreachable in the LINE webview. Server-side create/update APIs were verified healthy in dev AND production via direct curl before the UI cause was found.

**How to apply:**
- When adding fields/sections to any dialog, check its `DialogContent` has the scroll classes. The home milk dialog (ActionButtons) is the reference pattern.
- Several dialogs in Health.tsx / FoodTracker.tsx still lack `max-h` (audited 2026-07-27, deliberately left untouched — verify per-dialog before mass-changing).
- For "〜すると保存できない" reports: first curl the API directly (dev + prod) with the exact payload; if the server is healthy, suspect dialog height/keyboard/reachability on mobile before touching save logic.
- Adding form content to a dialog (even a small checkbox) can tip a borderline dialog into unreachability — re-check after growing any dialog.
