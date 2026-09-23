import { chromium } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";

const root = resolve(process.cwd(), "dist/public");
const screenshotDir = resolve(process.cwd(), "screenshots");
const syntheticOrigin = "https://public-check.invalid";
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium";

const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

const pages = [
  { name: "about", route: "/about", file: "about.html", expectedBadges: 4 },
  { name: "demo", route: "/demo", file: "index.html", expectedBadges: 4 },
];
const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

function localFileForUrl(url) {
  const parsed = new URL(url);
  if (parsed.origin !== syntheticOrigin) return null;
  const pathname = decodeURIComponent(parsed.pathname);
  if (pathname === "/about" || pathname === "/about/") return join(root, "about.html");
  if (pathname === "/demo" || pathname === "/demo/") return join(root, "index.html");
  if (pathname.startsWith("/api/")) return null;
  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return null;
  return candidate;
}

function isExternal(url) {
  try {
    return new URL(url).origin !== syntheticOrigin;
  } catch {
    return true;
  }
}

async function main() {
  const browserHome = await mkdtemp(join(tmpdir(), "weiku-static-browser-"));
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    env: { HOME: browserHome },
  });
  const results = [];
  const externalBlocked = new Set();
  const consoleCategories = new Map();
  const pageErrors = [];

  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      ignoreHTTPSErrors: true,
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (request.resourceType() === "websocket" || url.startsWith("ws:") || url.startsWith("wss:")) {
        await route.abort();
        return;
      }
      if (isExternal(url)) {
        try {
          externalBlocked.add(new URL(url).hostname || "external");
        } catch {
          externalBlocked.add("external");
        }
        await route.abort();
        return;
      }
      const parsed = new URL(url);
      if (parsed.pathname === "/api/auth/me") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ authenticated: false }),
        });
        return;
      }
      if (parsed.pathname === "/api/consultations/status") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ enabled: false, disabled: true }),
        });
        return;
      }
      const filename = localFileForUrl(url);
      if (!filename || !existsSync(filename)) {
        await route.fulfill({ status: 404, body: "Not found" });
        return;
      }
      const body = await readFile(filename);
      await route.fulfill({
        status: 200,
        contentType: mimeTypes[extname(filename).toLowerCase()] || "application/octet-stream",
        body,
      });
    });

    for (const pageConfig of pages) {
      for (const viewport of viewports) {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const pageConsoleErrors = [];
        page.on("pageerror", (error) => pageErrors.push({ page: pageConfig.name, viewport: viewport.name }));
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          const text = message.text();
          const category = /font|fonts\.googleapis|fontsource/i.test(text)
            ? "unsupported external font"
            : /failed to load resource|net::err|blocked/i.test(text)
              ? "blocked resource"
              : "browser console error";
          pageConsoleErrors.push(category);
          consoleCategories.set(category, (consoleCategories.get(category) || 0) + 1);
        });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${syntheticOrigin}${pageConfig.route}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        if (await page.getByText(/We育を試す|実際の画面を体験する|アプリを開く|近日公開/).count()) {
          throw new Error(`${pageConfig.name} contains a removed app-entry or coming-soon label`);
        }
        if (await page.locator('a[href="/demo/app"]').count()) {
          throw new Error(`${pageConfig.name} contains a removed demo-app entry`);
        }

        const state = await page.evaluate((expectedBadges) => {
          const links = [...document.querySelectorAll("a")];
          const externalTargetLinks = links.filter((link) => {
            try {
              return new URL(link.href, location.href).origin !== location.origin && link.target === "_blank";
            } catch {
              return false;
            }
          });
          const badgeLinks = links.filter((link) => /apps\.apple\.com|play\.google\.com/.test(link.href));
          const badgeLabels = badgeLinks.map((link) => ({
            label: link.getAttribute("aria-label") || link.textContent?.trim() || "",
            href: link.href,
            target: link.target,
            rel: link.rel,
          }));
          const dimensions = {
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
            viewport: window.innerWidth,
          };
          return {
            title: document.title,
            badgeCount: badgeLinks.length,
            badgeLabels,
            invalidNoopener: externalTargetLinks.filter((link) => !/\bnoopener\b/.test(link.rel)),
            overflow: Math.max(dimensions.document, dimensions.body) > dimensions.viewport + 1,
            dimensions,
            visibleBadges: badgeLinks.filter((link) => {
              const rect = link.getBoundingClientRect();
              const style = getComputedStyle(link);
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
            }).length,
            expectedBadges,
          };
        }, pageConfig.expectedBadges);

        if (viewport.name === "desktop") {
          await page.screenshot({
            path: resolve(screenshotDir, `${pageConfig.name}-recheck.png`),
            fullPage: true,
          });
        }
        results.push({
          page: pageConfig.name,
          viewport: viewport.name,
          titlePresent: Boolean(state.title),
          badgeCount: state.badgeCount,
          visibleBadges: state.visibleBadges,
          invalidNoopener: state.invalidNoopener.length,
          overflow: state.overflow,
          dimensions: state.dimensions,
          consoleErrors: pageConsoleErrors.length,
        });
        if (state.badgeCount !== pageConfig.expectedBadges) {
          throw new Error(`${pageConfig.name} badge count ${state.badgeCount} (expected ${pageConfig.expectedBadges})`);
        }
        if (state.visibleBadges !== pageConfig.expectedBadges) {
          throw new Error(`${pageConfig.name} visible badge count ${state.visibleBadges} (expected ${pageConfig.expectedBadges})`);
        }
        if (state.invalidNoopener.length) throw new Error(`${pageConfig.name} external target missing noopener`);
        if (state.overflow) throw new Error(`${pageConfig.name} ${viewport.name} horizontal overflow`);
        for (const badge of state.badgeLabels) {
          if (!badge.label || !badge.href || badge.target !== "_blank" || !/\bnoopener\b/.test(badge.rel)) {
            throw new Error(`${pageConfig.name} badge label/link security check failed`);
          }
        }
        await page.close();
      }
    }
    if (pageErrors.length) throw new Error(`${pageErrors.length} page error(s)`);
    console.log(JSON.stringify({
      ok: true,
      results,
      externalBlocked: [...externalBlocked].sort(),
      browserConsoleErrorCategories: Object.fromEntries(consoleCategories),
      screenshots: ["screenshots/about-recheck.png", "screenshots/demo-recheck.png"],
    }, null, 2));
  } finally {
    await browser.close();
    await rm(browserHome, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`STATIC_BROWSER_CHECK_FAILED: ${error.message}`);
  process.exitCode = 1;
});