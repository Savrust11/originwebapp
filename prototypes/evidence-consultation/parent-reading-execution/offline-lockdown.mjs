import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const production = ["runner.mjs", "cli.mjs"].map(name => ({
  name,
  text: fs.readFileSync(path.join(directory, name), "utf8"),
}));
for (const { name, text } of production) {
  assert(!/\b(?:pg|postgres|mysql|sqlite|drizzle|prisma|supabase|mongoose|mongodb)\b/i.test(text),
    `${name}: database import/reference forbidden`);
  assert(!/(?:dotenv|requestSecrets|viewEnvVars|process\.env\.(?!OPENAI_API_KEY))/i.test(text),
    `${name}: secret/environment access forbidden`);
  assert(!/from\s+["'][^"']*cli\.mjs["']/.test(text), `${name}: CLI import forbidden`);
  assert(!/(model-comparison-(?:execution|v2)\/runner|oldledger)/.test(text),
    `${name}: old runner/ledger import forbidden`);
}
const runner = production.find(file => file.name === "runner.mjs").text;
assert.equal((runner.match(/process\.env\.OPENAI_API_KEY/g) ?? []).length, 1);
assert.equal((runner.match(/\bfetch\(\.\.\.arguments_\)/g) ?? []).length, 1);
assert(runner.indexOf('append(events, "transmission-reserved"') < runner.indexOf("const credential = readCredential()"));
assert(runner.indexOf("const credential = readCredential()") < runner.indexOf("await fetchImpl(ENDPOINT"));

console.log("offline lockdown tests passed");
