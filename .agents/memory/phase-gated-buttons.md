---
name: Phase-gated record buttons
description: Record buttons are generated per age phase from lib/phases.ts; types absent from the next phase vanish on the birthday. Override semantics make auto-append unsafe.
---

# Phase-gated record buttons (age-based disappearance)

**Rule:** Home record buttons, the profile ボタンカスタマイズ list, and Settings button lists are all generated from the per-phase `actions` arrays in `client/src/lib/phases.ts` (乳児期 0–11mo / 幼児前期 12–23mo / 幼児後期 24–47mo / 就学準備期 48mo+). If a log type exists in one phase but not the next, the button **silently disappears everywhere on the child's birthday** when `getPhaseForAge()` crosses the boundary — this looks like data loss to users ("〜が消えた").

**Why:** Real incident (July 2026): 離乳食 existed only in 乳児期; a family's child turned 1 and the 離乳食 button vanished from home AND the customize list (toddler mode = phase 1+2 union). Fixed by adding `food` to 幼児前期 actions. Data was always intact — only the button was gated.

**How to apply:**
- For any "ボタン/記録が消えた" report: first check the child's birthday vs phase boundaries (12/24/48 months), then whether the type exists in the new phase's array in `phases.ts`.
- When adding a log type, decide explicitly which phases carry it; a type used across an age boundary must appear in every phase it spans.
- localStorage `phase_button_overrides_<childId>` stores **enabled ids only** (order = display order). Absence of an id is indistinguishable from "user turned it off" — therefore **never auto-append defaults into stored overrides**; it would resurrect intentionally disabled buttons. Recovery path for saved-override users is toggling it back on in ボタンカスタマイズ. Home resolves override ids via `getAllActions()` (all phases), so overridden buttons survive phase flips; base (no-override) users get exactly the phase array.
- LINE webview localStorage eviction can wipe overrides, making a months-old phase flip surface "suddenly".
