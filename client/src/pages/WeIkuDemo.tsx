import { useEffect } from "react";
import { WeIkuDemoPage } from "@/components/weiku-demo/weiku-demo-page";

const DEMO_TITLE = "We育｜育児を、ひとりの負担から、チームの営みへ。";
const DEMO_DESCRIPTION =
  "育児記録とAI予測で、家族のチーム育児を支えるWe育のサービスデモです。";
const DEMO_URL = "https://we-iku.com/demo";

function upsertMeta(selector: string, attrs: Record<string, string>): () => void {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (existing) {
    const prev: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(attrs)) {
      prev[k] = existing.getAttribute(k);
      existing.setAttribute(k, v);
    }
    return () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === null) existing.removeAttribute(k);
        else existing.setAttribute(k, v);
      }
    };
  }
  const el = document.createElement("meta");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.head.appendChild(el);
  return () => el.remove();
}

/**
 * /demo — story-style service demo landing page.
 * Fully front-end: no auth, no API, no database access.
 */
export default function WeIkuDemo() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = DEMO_TITLE;

    const restores: Array<() => void> = [];

    restores.push(
      upsertMeta('meta[name="description"]', {
        name: "description",
        content: DEMO_DESCRIPTION,
      }),
      upsertMeta('meta[property="og:title"]', {
        property: "og:title",
        content: DEMO_TITLE,
      }),
      upsertMeta('meta[property="og:description"]', {
        property: "og:description",
        content: DEMO_DESCRIPTION,
      }),
      upsertMeta('meta[property="og:url"]', {
        property: "og:url",
        content: DEMO_URL,
      }),
    );

    // canonical link
    const prevCanonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    let canonicalCleanup: () => void;
    if (prevCanonical) {
      const prevHref = prevCanonical.getAttribute("href");
      prevCanonical.setAttribute("href", DEMO_URL);
      canonicalCleanup = () => {
        if (prevHref === null) prevCanonical.removeAttribute("href");
        else prevCanonical.setAttribute("href", prevHref);
      };
    } else {
      const link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      link.setAttribute("href", DEMO_URL);
      document.head.appendChild(link);
      canonicalCleanup = () => link.remove();
    }
    restores.push(canonicalCleanup);

    return () => {
      document.title = prevTitle;
      restores.forEach((fn) => fn());
    };
  }, []);

  return <WeIkuDemoPage />;
}
