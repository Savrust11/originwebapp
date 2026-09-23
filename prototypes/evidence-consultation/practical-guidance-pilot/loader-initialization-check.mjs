import assert from "node:assert/strict";
import { initializePilotLoaders } from "./loader-initialization.mjs";

const result = await initializePilotLoaders("d".repeat(32));
assert.deepEqual(result, { parsedMts: true, authorizationDenied: true });
console.log("composed loader preflight: managed authorization denied as expected");