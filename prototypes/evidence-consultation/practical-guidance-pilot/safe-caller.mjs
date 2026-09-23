import { assertEphemeralCallerEnvironment } from "../../../tests/safety/policy.mjs";
// A query-distinct pure import avoids populating the canonical module URL
// before the checked loader adapts that URL for the managed pilot invocation.
import { assertNoCallerOverrides } from "../../../tests/run-managed-tests.mjs?safe-caller";
import path from "node:path";

const ALLOWED = new Set(["PATH", "LANG", "LC_ALL", "TZ", "PWD", "SHLVL"]);

export function assertSafeCallerEnvironment(env) {
  assertEphemeralCallerEnvironment(env);
  assertNoCallerOverrides(env);
  if (!env || typeof env !== "object" || Array.isArray(env)
    || Object.keys(env).some((key) => !ALLOWED.has(key))) {
    throw new Error("safe entry requires a clean allowlisted caller environment");
  }
  if (Object.hasOwn(env, "PWD")
    && (typeof env.PWD !== "string" || path.resolve(env.PWD) !== path.resolve(process.cwd()))) {
    throw new Error("safe entry rejects a caller working-directory override");
  }
  if (Object.hasOwn(env, "SHLVL")
    && (typeof env.SHLVL !== "string" || !/^(?:0|[1-9][0-9]{0,2})$/u.test(env.SHLVL))) {
    throw new Error("safe entry rejects invalid shell-level metadata");
  }
}