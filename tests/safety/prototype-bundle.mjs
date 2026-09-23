/*
 * The evidence consultation prototype is deliberately built outside dist.
 * This helper is imported only by the owned prototype child after its managed
 * context guard has run; normal builds and the normal application never use it.
 */
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const OWNED_HOME = /^\/tmp\/managed-test-[A-Za-z0-9_-]+$/;

function fail() {
  throw new Error("prototype bundle requires managed owned run directory");
}

function ownedRunRoot() {
  const home = process.env.HOME;
  if (typeof home !== "string" || !OWNED_HOME.test(home)) fail();
  const stat = fs.statSync(home);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) fail();
  if (fs.realpathSync(home) !== home) fail();
  const root = path.join(home, "evidence-consultation-prototype");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  return root;
}

export async function buildEvidenceConsultationPrototype() {
  if (process.env.EVIDENCE_PROTOTYPE_TEST !== "true") fail();
  const root = ownedRunRoot();
  const assets = path.join(root, "assets");
  fs.rmSync(assets, { recursive: true, force: true });
  fs.mkdirSync(assets, { recursive: true, mode: 0o700 });
  const entry = path.resolve("prototypes/evidence-consultation/main.tsx");
  const html = path.resolve("prototypes/evidence-consultation/index.html");
  if (!fs.statSync(entry).isFile() || !fs.statSync(html).isFile()) fail();

  // esbuild reads only local repository inputs. It has no remote resolution
  // mechanism and output is private to this managed child.
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    target: ["es2020"],
    loader: {
      ".otf": "file",
      ".ttf": "file",
      ".woff2": "file",
    },
    outfile: path.join(assets, "prototype.js"),
    legalComments: "none",
    logLevel: "silent",
  });
  const script = path.join(assets, "prototype.js");
  if (!fs.statSync(script).isFile()) fail();
  const css = path.join(assets, "prototype.css");
  const index = fs.readFileSync(html, "utf8")
    .replace('src="/main.tsx"', 'src="/assets/prototype.js"')
    .replace("</head>", fs.existsSync(css)
      ? '<link rel="stylesheet" href="/assets/prototype.css"></head>'
      : "</head>");
  return Object.freeze({ root, index, assets: new Set(fs.readdirSync(assets)) });
}