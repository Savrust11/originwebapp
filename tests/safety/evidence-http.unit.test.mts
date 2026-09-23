import "./require-managed.mjs";
import assert from "node:assert/strict";
import {
  evidenceRequestBoundary,
  evidenceErrorResponse,
  isEvidenceRequestPath,
} from "../../server/evidence-http.ts";
import { managedFeatureEnvironment } from "./policy.mjs";

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    vary(_key: string) {},
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

const originalFlag = process.env.EVIDENCE_SEARCH_ENABLED;
let assertions = 0;
try {
  for (const flag of [undefined, "", "false", "1", "TRUE"]) {
    if (flag === undefined) delete process.env.EVIDENCE_SEARCH_ENABLED;
    else process.env.EVIDENCE_SEARCH_ENABLED = flag;
    const res = response();
    let nextCalls = 0;
    const req = {
      // Disabled handling must terminate before even reading the input.
      get query() { throw new Error("Disabled feature read a private query"); },
    };
    evidenceRequestBoundary(req as any, res as any, () => { nextCalls++; });
    assert.equal(res.statusCode, 404);
    assert.equal(nextCalls, 0);
    assert.equal(res.headers["Cache-Control"], "private, no-store");
    assertions += 3;
  }
  process.env.EVIDENCE_SEARCH_ENABLED = "true";
  const forbidden = response();
  evidenceRequestBoundary({ query: { question: "PRIVATE_SENTINEL" } } as any, forbidden as any, () => assert.fail("URL query accepted"));
  assert.equal(forbidden.statusCode, 400);
  assert(!JSON.stringify(forbidden.body).includes("PRIVATE_SENTINEL"));
  assertions += 2;

  const permitted = response();
  let nextCalls = 0;
  evidenceRequestBoundary({ query: {} } as any, permitted as any, () => { nextCalls++; });
  assert.equal(nextCalls, 1);
  assertions++;

  for (const [type, expected] of [["entity.parse.failed", 400], ["entity.too.large", 413], ["other", 500]] as const) {
    const res = response();
    evidenceErrorResponse({ type, message: "PRIVATE_SENTINEL", body: "PRIVATE_SENTINEL", stack: "PRIVATE_SENTINEL" }, res as any);
    assert.equal(res.statusCode, expected);
    assert(!JSON.stringify(res.body).includes("PRIVATE_SENTINEL"));
    assertions += 2;
  }
  assert.equal(isEvidenceRequestPath("/api/evidence"), true);
  assert.equal(isEvidenceRequestPath("/api/evidence/private-question"), true);
  assert.equal(isEvidenceRequestPath("/api/evidences"), false);
  assert.deepEqual(managedFeatureEnvironment("evidence"), { EVIDENCE_SEARCH_ENABLED: "true" });
  assert.deepEqual(managedFeatureEnvironment("authz"), {});
  assert.deepEqual(managedFeatureEnvironment("consultation"), { CONSULTATIONS_ENABLED: "true" });
  assertions += 6;
  console.info(`evidence HTTP boundary: ${assertions} assertions passed`);
} finally {
  if (originalFlag === undefined) delete process.env.EVIDENCE_SEARCH_ENABLED;
  else process.env.EVIDENCE_SEARCH_ENABLED = originalFlag;
}