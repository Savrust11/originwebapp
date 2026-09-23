import { safeFailureDiagnostic } from "../parenting-expansion-02/lifecycle-finalizer.mjs";
try { await import("./verify.mts"); } catch (error) {
  console.error(`SAFE_EXPANSION_FAILURE:${JSON.stringify({ line: 1, ...safeFailureDiagnostic(error, "managed_module_initialization") })}`);
  process.exitCode = 1;
}