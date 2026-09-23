import { safeFailureDiagnostic } from "../parenting-expansion-02/lifecycle-finalizer.mjs";
try { await import("./verify.mts"); }
catch (error) { console.error(`SAFE_EXPANSION_FAILURE:${JSON.stringify(safeFailureDiagnostic(error,"repair05_initialization"))}`); process.exitCode=1; }