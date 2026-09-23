import { safeFailureDiagnostic } from "./lifecycle-finalizer.mjs";
try {
  await import("./verify.mts");
} catch (error) {
  const stack = typeof error?.stack === "string" ? error.stack : "";
  const line = Number(stack.match(/parenting-expansion-02\/(?:verify\.mts|verify-entry\.mjs):(\d{1,4}):\d+/u)?.[1] ?? 1);
  const diagnostic = safeFailureDiagnostic(error, "managed_module_initialization");
  console.error(`SAFE_EXPANSION_FAILURE:${JSON.stringify({ line, ...diagnostic })}`);
  process.exitCode = 1;
}