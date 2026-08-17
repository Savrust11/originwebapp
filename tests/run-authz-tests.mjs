// One-command runner for the authorization test suite.
// Boots its own server instance on an ephemeral port, waits for readiness,
// runs every authz test file against it, then shuts the server down.
// Usage: node tests/run-authz-tests.mjs   (or: npm run test:authz)
// If BASE_URL is set, an already-running server is used instead.
import { spawn } from "node:child_process";
import { once } from "node:events";

const TEST_FILES = ["tests/log-authz.test.mjs", "tests/resource-authz.test.mjs", "tests/create-authz.test.mjs"];

let server = null;
let base = process.env.BASE_URL || null;

async function waitForReady(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + "/api/logs/readiness-probe-family");
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become ready at ${url} within ${timeoutMs}ms`);
}

if (!base) {
  const port = 5600 + Math.floor(Math.random() * 300);
  base = `http://127.0.0.1:${port}`;
  console.log(`[runner] starting server on port ${port}...`);
  server = spawn("npx", ["tsx", "server/index.ts"], {
    // High FAMILY_ENUM_LIMIT: suites legitimately use many distinct test
    // familyIds from one IP; the low-limit behavior is tested by
    // create-authz.test.mjs against its own server instance.
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), FAMILY_ENUM_LIMIT: "1000" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  server.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[runner] server exited unexpectedly (code=${code}, signal=${signal})`);
      process.exit(1);
    }
  });
}

let shuttingDown = false;
function cleanup() {
  shuttingDown = true;
  if (server && server.exitCode === null) server.kill("SIGTERM");
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

try {
  await waitForReady(base);
  console.log(`[runner] server ready at ${base}\n`);

  let failed = false;
  for (const file of TEST_FILES) {
    console.log(`=== ${file} ===`);
    const child = spawn(process.execPath, [file], {
      env: { ...process.env, BASE_URL: base },
      stdio: "inherit",
    });
    const [code] = await once(child, "exit");
    if (code !== 0) failed = true;
    console.log("");
  }

  if (failed) {
    console.error("[runner] AUTHORIZATION TESTS FAILED");
    process.exitCode = 1;
  } else {
    console.log("[runner] all authorization test suites passed");
  }
} finally {
  cleanup();
}
