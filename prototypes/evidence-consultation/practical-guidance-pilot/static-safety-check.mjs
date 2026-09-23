import assert from "node:assert/strict";
import { assertSafeCallerEnvironment } from "./safe-caller.mjs";
import { safeFailureDiagnostic } from "./lifecycle-finalizer.mjs";

assert.doesNotThrow(() => assertSafeCallerEnvironment({
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
}));
assert.doesNotThrow(() => assertSafeCallerEnvironment({
  PATH: "/usr/bin:/bin",
  PWD: process.cwd(),
  SHLVL: "1",
}));
assert.throws(() => assertSafeCallerEnvironment({
  PATH: "/usr/bin:/bin",
  PWD: "/tmp",
  SHLVL: "1",
}));
assert.throws(() => assertSafeCallerEnvironment({
  PATH: "/usr/bin:/bin",
  PWD: process.cwd(),
  SHLVL: "not-numeric",
}));
for (const key of [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "TEST_DATABASE_APPROVED_SHA256",
  "TEST_RUN_CONTEXT",
  "TEST_RUN_CONTEXT_FILE",
  "MANAGED_TEST_CONTEXT_FILE",
  "BASE_URL",
  "SUPPORTER_DEV_BASE_URL",
  "PGHOST",
  "POSTGRES_PASSWORD",
  "OPENAI_API_KEY",
  "HTTP_PROXY",
  "NODE_OPTIONS",
  "REPLIT_DEV_DOMAIN",
  "UNRECOGNIZED_CONFIGURATION",
]) {
  assert.throws(() => assertSafeCallerEnvironment({ PATH: "/usr/bin:/bin", [key]: "forbidden" }), `${key} must be rejected`);
}
const diagnostic = safeFailureDiagnostic(Object.assign(
  new Error("schema failed at postgresql://owner:secret@127.0.0.1:5432/postgres in /tmp/ephemeral-postgres-sensitive password=bad"),
  { pilotStage: "owned_postgres_ready" },
));
assert.equal(diagnostic.code, "schema_stage_failed");
assert.equal(diagnostic.stage, "owned_postgres_ready");
assert(!JSON.stringify(diagnostic).includes("owner:secret"));
assert(!JSON.stringify(diagnostic).includes("ephemeral-postgres-sensitive"));
assert(!JSON.stringify(diagnostic).includes("password=bad"));
console.log("safe caller environment check: passed");