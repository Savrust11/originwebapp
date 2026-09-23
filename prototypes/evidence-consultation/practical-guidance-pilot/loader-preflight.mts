import "../../../tests/safety/require-managed.mjs";

// This TypeScript-only syntax ensures the composed loader parsed this .mts
// module before the expected managed-authorization denial was evaluated.
const loaderPreflightMarker: string = "parsed";
export { loaderPreflightMarker };