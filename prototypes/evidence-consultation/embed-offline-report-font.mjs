// Append-only delivery rendering: use an existing licensed local font, never
// fetch one or rewrite the original report/manifest or any comparison record.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = "evidence-work/offline-parent-preparation/final-01";
const manifestPath = `${root}/delivery-manifest.json`;
const sourcePath = `${root}/preparation-guide.html`;
const fontPath = "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2";
const licensePath = "prototypes/evidence-consultation/fonts/OFL-1.1.txt";
const codePath = "prototypes/evidence-consultation/embed-offline-report-font.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const b of manifest.bindings) assert.equal(hash(fs.readFileSync(b.path)), b.sha256);
const font = fs.readFileSync(fontPath);
const license = fs.readFileSync(licensePath, "utf8");
const esc = s => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
let html = fs.readFileSync(sourcePath, "utf8");
html = html.replace("<style>", `<style>
@font-face{font-family:LocalJapanese;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2");font-weight:400;font-style:normal;font-display:block}`);
html = html.replace("system-ui,sans-serif", "LocalJapanese,system-ui,sans-serif");
html = html.replace("</footer>", `</footer><details><summary>日本語フォントのライセンス</summary>
<p>Noto Sans JP — 既存のローカルフォントを埋め込み。外部のフォントサーバーへ接続しません。</p>
<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(license)}</pre></details>`);
const target = `${root}/preparation-guide-japanese.html`;
fs.writeFileSync(target, html, { flag: "wx" });
const added = [manifestPath, fontPath, licensePath, codePath, target].map(p => {
  const bytes = fs.readFileSync(p);
  return { path: p, sha256: hash(bytes), bytes: bytes.length };
});
fs.writeFileSync(`${root}/delivery-manifest-japanese.json`, JSON.stringify({
  schemaVersion: 1, kind: "append-only-offline-font-embedding",
  originalContentAndScoresUnchanged: true,
  externalRequests: 0, existingLicensedFontOnly: true,
  bindings: [...manifest.bindings, ...added],
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ path: target, bytes: Buffer.byteLength(html),
  originalFilesModified: 0, externalRequests: 0 }));