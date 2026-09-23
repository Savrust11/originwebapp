/**
 * Server-side SEO tag injection for routes whose meta tags differ from the
 * default index.html. OG crawlers (LINE/X/Facebook) don't execute JS, so the
 * correct title/OG/canonical must already be present in the served HTML.
 */

interface PageMeta {
  title: string;
  description: string;
  url: string;
  /** Absolute URL of a large (1200x630) OG image. Switches twitter:card to summary_large_image. */
  image?: string;
}

const PAGE_META: Record<string, PageMeta> = {
  "/demo": {
    title: "We育｜育児を、ひとりの負担から、チームの営みへ。",
    description:
      "育児記録とAI予測で、家族のチーム育児を支えるWe育のサービスデモです。",
    url: "https://we-iku.com/demo",
    image: "https://we-iku.com/og-demo.png",
  },
  "/support": {
    title: "サポート・お問い合わせ｜We育（ウィーイク）",
    description:
      "We育（ウィーイク）の使い方やよくあるご質問、お問い合わせ窓口のご案内です。困ったときはこちらからご連絡ください。",
    url: "https://we-iku.com/support",
    image: "https://we-iku.com/og-support.png",
  },
  "/tips": {
    title: "育児のヒント集｜We育（ウィーイク）",
    description:
      "授乳・ねんね・離乳食など、毎日の育児に役立つヒントをまとめました。We育（ウィーイク）がふたりの育児をサポートします。",
    url: "https://we-iku.com/tips",
    image: "https://we-iku.com/og-tips.png",
  },
  "/legal": {
    title: "利用規約・プライバシーポリシー｜We育（ウィーイク）",
    description:
      "We育（ウィーイク）の利用規約とプライバシーポリシーです。サービスのご利用条件と個人情報の取り扱いについてご案内します。",
    url: "https://we-iku.com/legal",
  },
  "/privacy": {
    title: "プライバシーポリシー｜We育（ウィーイク）",
    description:
      "We育（ウィーイク）のプライバシーポリシーです。お客様の個人情報の取り扱いについてご案内します。",
    url: "https://we-iku.com/privacy",
  },
  "/terms": {
    title: "利用規約｜We育（ウィーイク）",
    description:
      "We育（ウィーイク）の利用規約です。サービスをご利用いただく際の条件についてご案内します。",
    url: "https://we-iku.com/terms",
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Rewrites title / meta description / OG / twitter / canonical tags in the
 * index.html template for routes with dedicated metadata. Returns the HTML
 * unchanged for all other paths.
 */
export function rewriteHtmlForPath(html: string, reqPath: string): string {
  const normalized = reqPath.replace(/\/+$/, "") || "/";
  const meta = PAGE_META[normalized];
  if (!meta) return html;

  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const url = escapeHtml(meta.url);

  let rewritten = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/>/,
      `<meta name="description" content="${description}" />`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*"\s*\/>/,
      `<link rel="canonical" href="${url}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*"\s*\/>/,
      `<meta property="og:title" content="${title}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*"\s*\/>/,
      `<meta property="og:description" content="${description}" />`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*"\s*\/>/,
      `<meta property="og:url" content="${url}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"\s*\/>/,
      `<meta name="twitter:title" content="${title}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"\s*\/>/,
      `<meta name="twitter:description" content="${description}" />`,
    );

  if (meta.image) {
    const image = escapeHtml(meta.image);
    rewritten = rewritten
      .replace(
        /<meta property="og:image" content="[^"]*"\s*\/>/,
        `<meta property="og:image" content="${image}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />`,
      )
      .replace(
        /<meta name="twitter:card" content="[^"]*"\s*\/>/,
        `<meta name="twitter:card" content="summary_large_image" />\n    <meta name="twitter:image" content="${image}" />`,
      );
  }

  return rewritten;
}
