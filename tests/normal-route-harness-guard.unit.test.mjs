import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const launcher = fs.readFileSync("tests/run-ephemeral-tests.mjs", "utf8");
const managed = fs.readFileSync("tests/run-managed-tests.mjs", "utf8");
const harness = fs.readFileSync("tests/evidence-normal-route-verification.test.mts", "utf8");

test("normal-route group is dedicated and starts only the private draft prototype", () => {
  assert.match(managed, /"normal-route-verification"/u);
  assert.match(managed, /"normal-route-lifecycle"/u);
  assert.match(managed, /normal-route-verification"\s*\?\s*"evidence-prototype-draft"/u);
  assert.doesNotMatch(managed, /normal-route-verification"\s*\?\s*"application"/u);
  assert.match(launcher, /normal-route dedicated lifecycle/u);
});

test("normal-route harness has a closed offline import and output boundary", () => {
  assert.doesNotMatch(harness, /publication-simulation|simulateTestOnlyPublication|server\/index|https?:\/\//u);
  assert.match(harness, /fetch\(`\$\{context\.baseURL\}\/api\/prototype\/answer`/u);
  assert.doesNotMatch(harness, /process\.env|\.\.\.process\.env/u);
  const imports = [...harness.matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/gu)]
    .map((match) => match[1] ?? match[2]);
  assert.deepEqual(imports, [
    "./safety/require-managed.mjs",
    "node:assert/strict",
    "node:fs",
    "node:path",
    "node:crypto",
    "../server/db.ts",
    "./safety/require-managed.mjs",
    "../prototypes/evidence-consultation/answer-service.mts",
  ]);
  assert.match(harness, /checkOfflineAnswer/u);
  assert.match(harness, /executeFreshCandidate/u);
  assert.match(harness, /providerCalls/u);
  assert.match(harness, /state\.publication_status, "draft"/u);
  assert.match(harness, /canonicalHealthFactsRetained/u);
});

test("documented command uses the secret-free caller environment", () => {
  assert.match(launcher, /assertEphemeralCallerEnvironment\(process\.env\)/u);
  assert.match(managed, /normal-route-verification/u);
});