---
name: Server-side SEO tag injection
description: How per-route title/OG/canonical are injected server-side, and the traps (mount-relative req.path, SPA fallback files bypassing rewrite)
---

Per-route meta (title/description/OG/twitter/canonical) is rewritten server-side in `server/seo.ts` (`PAGE_META` map) because OG crawlers don't run JS. Applied in both the vite dev middleware and the production static fallback.

**Traps:**
- Inside `app.use("/{*path}", ...)`, `req.path` is mount-relative (often `/`); use `req.originalUrl.split("?")[0]`.
- `script/build.ts` copies plain `index.html` into `dist/public/<route>/index.html` for its `spaRoutes` list; those files are served by `express.static` and BYPASS the rewrite. Never add a route to that list if it needs custom meta.

**How to apply:** new route needing its own OG card → add entry to `PAGE_META` in `server/seo.ts` + add URL to `client/public/sitemap.xml`.
