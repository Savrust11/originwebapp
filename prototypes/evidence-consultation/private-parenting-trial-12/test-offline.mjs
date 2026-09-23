import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRunner } from "./runner.mjs";
import { appendEvent } from "./preflight.mjs";
import { RESERVE_PER_ATTEMPT, LIMITS, SCENES } from "./policy.mjs";

assert.equal(RESERVE_PER_ATTEMPT, 340_000);
assert.equal(RESERVE_PER_ATTEMPT * 8, 2_720_000);
assert.ok(RESERVE_PER_ATTEMPT * 8 <= LIMITS.authorizedCentiMicroUSD);
assert.deepEqual(SCENES, {
  "sharing-toys": 3, "independent-attempt": 2, "food-preparation-burden": 3,
});
const source = fs.readFileSync(new URL("./runner.mjs", import.meta.url), "utf8");
assert.match(source, /https\.request/);
assert.doesNotMatch(source, /fetch\(|followRedirect|redirect:\s*["']follow/);
assert.match(source, /TRANSPORT_TIMEOUT/);
assert.match(source, /transmission-reserved/);
assert.match(source, /unknown|UNKNOWN/);
assert.match(source, /writeOnce/);
assert.doesNotMatch(source, /model[s]?\/list|tokeniz|fallback/i);
const trial11 = fs.readFileSync("evidence-work/private-parenting-trial-11/plan/history-reconciliation.json");
assert.ok(trial11.length > 0);
const before = await import("node:crypto").then(({ createHash }) =>
  createHash("sha256").update(trial11).digest("hex"));
const after = await import("node:crypto").then(({ createHash }) =>
  createHash("sha256").update(fs.readFileSync("evidence-work/private-parenting-trial-11/plan/history-reconciliation.json")).digest("hex"));
assert.equal(after, before);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "trial12-"));
const first = fs.openSync(path.join(temp, "lock"), "wx");
assert.throws(() => fs.openSync(path.join(temp, "lock"), "wx"), /EEXIST/);
fs.closeSync(first);
fs.rmSync(temp, { recursive: true, force: true });

const workspace = process.cwd();
function setup(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `trial12-${name}-`));
  const evidence = path.join(home, "evidence-work");
  fs.mkdirSync(evidence, { recursive: true });
  for (const directory of [
    "private-parenting-trial-11", "cfa100-06", "parenting-expansion-04",
    "comparison-closeout", "parent-reading-evaluation",
  ]) {
    fs.symlinkSync(path.join(workspace, "evidence-work", directory), path.join(evidence, directory), "dir");
  }
  const own = path.join(evidence, "private-parenting-trial-12");
  fs.mkdirSync(path.join(own, "preflight"), { recursive: true });
  fs.symlinkSync(path.join(workspace, "evidence-work/private-parenting-trial-12/public-docs"),
    path.join(own, "public-docs"), "dir");
  fs.writeFileSync(path.join(own, "preflight/main-live-go.json"), JSON.stringify({
    format: "weiku.private-parenting-trial-12.main-live-go.v1",
    approvedByMain: true,
    maximumAttempts: 8,
    maximumCostUSD: 0.03,
    serialOnly: true,
    retries: 0,
    sceneIds: Object.keys(SCENES),
  }));
  return home;
}
function successBody() {
  return Buffer.from(JSON.stringify({
    id: "resp_offline_test",
    model: "gpt-5.6-luna",
    service_tier: "default",
    store: false,
    background: false,
    truncation: "disabled",
    max_output_tokens: 1500,
    tools: [],
    reasoning: { effort: "medium" },
    prompt_cache_options: { mode: "explicit" },
    status: "completed",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 10 },
    },
    output: [{
      type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "OFFLINE INJECTED TRANSPORT", annotations: [] }],
    }],
  }));
}

const successHome = setup("success");
process.chdir(successHome);
let calls = 0;
const successful = createRunner({
  readCredential: () => "offline-test-credential-not-real",
  transport: async () => { calls += 1; return { status: 200, bytes: successBody() }; },
});
await successful.initialize();
const sent = await successful.send("sharing-toys", "initial");
assert.equal(calls, 1);
assert.equal(sent.newAttempts, 1);
assert.equal(sent.knownCentiMicroUSD, 8_000);
assert.equal(sent.unresolvedCentiMicroUSD, 0);
assert.equal(sent.latestAnswer.text, "OFFLINE INJECTED TRANSPORT");
const savedRaw = fs.readFileSync(path.join(successHome,
  "evidence-work/private-parenting-trial-12/run/private/raw/01.bin"));
assert.deepEqual(savedRaw, successBody());
assert.equal(fs.readFileSync(path.join(successHome,
  "evidence-work/private-parenting-trial-12/run/private/responses/01.json"), "utf8")
  .includes("offline-test-credential-not-real"), false);

const missingHome = setup("missing-key");
process.chdir(missingHome);
const missing = createRunner({ readCredential: () => undefined, transport: async () => {
  throw Error("MUST_NOT_RUN");
} });
await missing.initialize();
await assert.rejects(missing.send("sharing-toys", "initial"), /CREDENTIAL_UNAVAILABLE_PRE_RESERVATION/);
assert.equal((await missing.status()).newAttempts, 0);

const crashHome = setup("crash");
process.chdir(crashHome);
let crashCalls = 0;
const crash = createRunner({
  readCredential: () => "offline-test-credential-not-real",
  transport: async () => { crashCalls += 1; return { status: 200, bytes: successBody() }; },
});
await crash.initialize();
const crashEventsDir = "evidence-work/private-parenting-trial-12/run/private/events";
const crashEvents = (await import("./preflight.mjs")).readEvents(crashEventsDir);
appendEvent(crashEventsDir, crashEvents, "transmission-reserved", {
  attempt: 1, sceneId: "sharing-toys", parentMessageId: "initial",
  requestSha256: "a".repeat(64), reservationCentiMicroUSD: RESERVE_PER_ATTEMPT,
});
const failClosed = await crash.send("independent-attempt", "initial");
assert.equal(crashCalls, 0);
assert.equal(failClosed.stopped, true);
assert.equal(failClosed.unresolvedCentiMicroUSD, RESERVE_PER_ATTEMPT);

for (const [name, mutate, expectedReason] of [
  ["wrong-settings", body => { body.service_tier = "priority"; }, "ECHOED_CONTROLS_UNKNOWN_OR_MISMATCHED"],
  ["missing-usage", body => { delete body.usage; }, "USAGE_UNKNOWN"],
  ["nonzero-cache", body => { body.usage.input_tokens_details.cache_write_tokens = 1; }, "CACHE_PRICE_UNEXPECTED"],
]) {
  const home = setup(name);
  process.chdir(home);
  const raw = successBody();
  const body = JSON.parse(raw);
  mutate(body);
  let count = 0;
  const runner = createRunner({
    readCredential: () => "offline-test-secret-sentinel",
    transport: async () => {
      count += 1;
      return { status: 200, bytes: Buffer.from(JSON.stringify(body)) };
    },
  });
  await runner.initialize();
  const result = await runner.send("sharing-toys", "initial");
  assert.equal(count, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.knownCentiMicroUSD + result.unresolvedCentiMicroUSD, RESERVE_PER_ATTEMPT);
  const eventText = fs.readdirSync(path.join(home,
    "evidence-work/private-parenting-trial-12/run/private/events"))
    .map(file => fs.readFileSync(path.join(home,
      "evidence-work/private-parenting-trial-12/run/private/events", file), "utf8")).join("");
  assert.match(eventText, new RegExp(expectedReason));
  const allPrivate = fs.readdirSync(path.join(home,
    "evidence-work/private-parenting-trial-12/run/private"), { recursive: true })
    .filter(file => fs.statSync(path.join(home,
      "evidence-work/private-parenting-trial-12/run/private", file)).isFile())
    .map(file => fs.readFileSync(path.join(home,
      "evidence-work/private-parenting-trial-12/run/private", file))).join("");
  assert.equal(allPrivate.includes("offline-test-secret-sentinel"), false);
  fs.rmSync(home, { recursive: true, force: true });
}

const incompleteHome = setup("output-limit");
process.chdir(incompleteHome);
let incompleteCalls = 0;
const incompleteRunner = createRunner({
  readCredential: () => "offline-test-credential-not-real",
  transport: async () => {
    incompleteCalls += 1;
    if (incompleteCalls === 1) {
      const body = JSON.parse(successBody());
      body.status = "incomplete";
      body.incomplete_details = { reason: "max_output_tokens" };
      body.usage.output_tokens = 1500;
      body.usage.total_tokens = 1600;
      return { status: 200, bytes: Buffer.from(JSON.stringify(body)) };
    }
    return { status: 200, bytes: successBody() };
  },
});
await incompleteRunner.initialize();
const limited = await incompleteRunner.send("sharing-toys", "initial");
assert.equal(limited.stopped, false);
assert.deepEqual(limited.haltedScenes, [{
  sceneId: "sharing-toys", reason: "OUTPUT_LIMIT_NO_RETRY",
}]);
await assert.rejects(incompleteRunner.send("sharing-toys", "st-no-force"), /SCENE_ALREADY_HALTED/);
const anotherScene = await incompleteRunner.send("independent-attempt", "initial");
assert.equal(incompleteCalls, 2);
assert.equal(anotherScene.newAttempts, 2);

const tamperHome = setup("ledger-tamper");
process.chdir(tamperHome);
const comparisonLink = path.join(tamperHome, "evidence-work/comparison-closeout");
fs.unlinkSync(comparisonLink);
const comparisonTarget = path.join(comparisonLink, "reading-comparison-02");
fs.mkdirSync(comparisonTarget, { recursive: true });
for (const file of ["closure.json", "evidence-manifest.json"]) {
  fs.copyFileSync(path.join(workspace,
    "evidence-work/comparison-closeout/reading-comparison-02", file),
  path.join(comparisonTarget, file));
}
fs.appendFileSync(path.join(comparisonTarget, "closure.json"), " ");
const tamperRunner = createRunner();
await assert.rejects(tamperRunner.initialize(), /HISTORICAL_LEDGER_EVIDENCE_CHANGED/);

process.chdir(workspace);
for (const directory of [successHome, missingHome, crashHome, incompleteHome, tamperHome])
  fs.rmSync(directory, { recursive: true, force: true });
console.log("trial12 injected offline tests passed; provider requests: 0");