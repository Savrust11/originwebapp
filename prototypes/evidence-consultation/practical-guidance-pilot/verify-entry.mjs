import { safeFailureDiagnostic } from "./lifecycle-finalizer.mjs";

try {
  await import("./verify.mts");
} catch (error) {
  const stack = typeof error?.stack === "string" ? error.stack : "";
  const line = Number(stack.match(/practical-guidance-pilot\/(?:verify\.mts|verify-entry\.mjs):(\d{1,4}):\d+/u)?.[1] ?? 1);
  const diagnostic = safeFailureDiagnostic(error, "managed_module_initialization");
  console.error(`SAFE_PRACTICAL_FAILURE:${JSON.stringify({
    line,
    code: diagnostic.code,
    errorName: diagnostic.errorName,
    reason: diagnostic.reason,
  })}`);
  process.exitCode = 1;
}