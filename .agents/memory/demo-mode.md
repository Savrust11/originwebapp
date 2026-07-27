---
name: Demo mode (login-free /demo)
description: How the login-free demo intercepts API calls and why window.fetch is patched
---

# Demo mode architecture

The login-free demo (`/demo`, `/demo/<path>`) works by monkey-patching
`window.fetch` (`installDemoFetch()` in `client/src/lib/demo.ts`) to return
in-memory mock JSON for `/api/*` requests while `isDemoMode()` is true.

**Why patch window.fetch instead of the React Query fetcher:** the data hooks in
`client/src/hooks/use-app-data.ts` each define their own `queryFn` that calls
`fetch()` directly — they do NOT go through the shared `getQueryFn` in
`queryClient.ts`. So intercepting the query client would miss them; patching
`window.fetch` is the only single chokepoint that covers every data hook.

**State isolation rule:** `enterDemoMode()` overwrites real localStorage identity
keys (familyId, userType, onboarding_done, etc.) so App.tsx auth gates pass. It
MUST snapshot the pre-demo values (backup key) and `exitDemoMode()` MUST restore
them — otherwise an authenticated user who opens /demo loses their real session on
exit. Demo is gated by localStorage sentinel `we_iku_demo_active`.

**How to apply:** when adding a new data hook or API endpoint, if it should work in
the demo, add a handler in demo.ts's GET/write routers. Unsupported writes return
`{success:true}` (no persist) which is acceptable for a browse-focused demo.
