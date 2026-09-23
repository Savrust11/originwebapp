import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  createRunner, hash, OPENING, ORDER, RATES, ENDPOINT, LIMITS, INPUT_OVERHEAD_TOKENS,
  validatePackets,
} from "./runner.mjs";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "citations"],
  properties: {
    answer: { type: "string" },
    citations: { type: "array", items: { type: "string" } },
  },
};

function request(caseId) {
  return {
    model: "gpt-5.6-luna",
    service_tier: "default",
    reasoning: { effort: "medium" },
    max_output_tokens: 1500,
    store: false,
    background: false,
    tools: [],
    truncation: "disabled",
    prompt_cache_options: { mode: "explicit" },
    text: { format: { type: "json_schema", name: "parent_reading_answer", strict: true, schema } },
    input: [
      { role: "system", content: "Synthetic common instructions." },
      { role: "user", content: JSON.stringify({
        question: `Synthetic ${caseId}`,
        original_evidence: [{
          original_id: `public-source-${caseId}`,
          original_text: "synthetic",
          source_id: `source-${caseId}`,
          title: "Synthetic source",
        }],
      }) },
    ],
  };
}

function packetDocument() {
  const makePacket = caseId => {
    const request_ = request(caseId);
    const tokenBound = Buffer.byteLength(JSON.stringify(request_), "utf8") + INPUT_OVERHEAD_TOKENS;
    return {
      caseId,
      request: request_,
      reserveCentiMicroUSD: tokenBound * RATES.cacheWrite + 1500 * RATES.output,
      localInputEstimate: {
        tokenBound,
        method: "UTF-8 serialized payload byte length plus 2048 operational proxy; not an invoice guarantee",
      },
    };
  };
  return {
    schemaVersion: 1,
    packets: ORDER.map(makePacket),
    pricing: {
      endpoint: ENDPOINT,
      model: "gpt-5.6-luna",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      ratesCentiMicroUSDPerToken: RATES,
      cachePolicy: "explicit-no-reads-or-writes",
    },
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parent-reading-runner-"));
  const preflight = "preflight";
  const output = "run";
  fs.mkdirSync(path.join(root, preflight), { recursive: true });
  const packets = packetDocument();
  fs.writeFileSync(path.join(root, preflight, "request-packets.json"),
    `${JSON.stringify(packets, null, 2)}\n`);
  const roleFiles = {
    protocol: "protocol.txt",
    source: "source.txt",
    price: "price.txt",
    controlcode: "controlcode.txt",
    "historical-closure": "closure.txt",
  };
  const bindings = [];
  for (const [role, name] of Object.entries(roleFiles)) {
    const relative = `${preflight}/${name}`;
    fs.writeFileSync(path.join(root, relative), `${role}\n`);
    bindings.push({ path: relative, sha256: hash(fs.readFileSync(path.join(root, relative))), role });
  }
  const payloadPath = `${preflight}/request-packets.json`;
  bindings.push({ path: payloadPath, sha256: hash(fs.readFileSync(path.join(root, payloadPath))), role: "payload" });
  fs.writeFileSync(path.join(root, preflight, "preflight-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    audit: { decision: "authorized", completedAt: "2026-01-02T00:00:00.000Z" },
    historicalClosure: OPENING,
    bindings,
  }, null, 2)}\n`);
  return { root, preflight, output };
}

function responseFor(request_, { text = null, cache = false, status = "completed" } = {}) {
  const caseId = JSON.parse(request_.input[1].content).original_evidence[0].original_id;
  const output = text ?? JSON.stringify({ answer: "Synthetic answer", citations: [caseId] });
  return {
    status,
    incomplete_details: status === "completed" ? null : { reason: "max_output_tokens" },
    error: null,
    model: request_.model,
    service_tier: "default",
    background: false,
    truncation: "disabled",
    max_output_tokens: 1500,
    tools: [],
    reasoning: { effort: "medium" },
    prompt_cache_options: { mode: "explicit", ttl: "30m", prewarm: false },
    text: request_.text,
    output: [{
      type: "message",
      role: "assistant",
      status: status === "completed" ? "completed" : "incomplete",
      content: [{ type: "output_text", text: output, annotations: [] }],
    }],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: cache ? 10 : 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 5 },
    },
  };
}

function transport(body) {
  const bytes = Buffer.from(JSON.stringify(body));
  return { status: 200, body: Readable.from([bytes]) };
}

// Preflight/status/init cannot read a credential or transmit.
{
  const f = fixture();
  let reads = 0, sends = 0;
  const runner = createRunner({ ...f, readCredential: () => { reads++; return "synthetic-key"; },
    fetchImpl: async () => { sends++; throw new Error("not expected"); } });
  await runner.status();
  await runner.initialize();
  await runner.status();
  assert.equal(reads, 0);
  assert.equal(sends, 0);
}

// A sealed reservation and request exist before the only synthetic send.
{
  const f = fixture();
  let sends = 0;
  const runner = createRunner({ ...f, readCredential: () => "synthetic-key",
    fetchImpl: async (_url, options) => {
      sends++;
      const events = path.join(f.root, f.output, "private/events/000002.json");
      assert.equal(JSON.parse(fs.readFileSync(events)).type, "transmission-reserved");
      const request_ = JSON.parse(options.body);
      assert(fs.existsSync(path.join(f.root, f.output, "private/requests/P01.json")));
      return transport(responseFor(request_));
    } });
  await runner.initialize();
  const state = await runner.next();
  assert.equal(sends, 1);
  assert.equal(state.newNetworkAttempts, 1);
  assert.equal(state.accounting.newKnownCentiMicroUSD, 4400);
  assert.equal(state.accounting.newUnresolvedCentiMicroUSD, 0);
}

// Content failure is case-local and the next explicit case can proceed.
{
  const f = fixture();
  let sends = 0;
  const runner = createRunner({ ...f, readCredential: () => "synthetic-key",
    fetchImpl: async (_url, options) => {
      sends++;
      const request_ = JSON.parse(options.body);
      return transport(responseFor(request_, { text: sends === 1 ? "not json" : null }));
    } });
  await runner.initialize();
  const first = await runner.next();
  assert.equal(first.stopped, false);
  assert.equal(first.nextCaseId, "P04");
  const second = await runner.next();
  assert.equal(second.newNetworkAttempts, 2);
  assert.equal(sends, 2);
}

// Transport uncertainty retains the reservation, stops, and is never retried.
{
  const f = fixture();
  let sends = 0;
  const runner = createRunner({ ...f, readCredential: () => "synthetic-key",
    fetchImpl: async () => { sends++; throw new Error("synthetic transport failure"); } });
  await runner.initialize();
  const state = await runner.next();
  assert.equal(state.stopped, true);
  assert.equal(state.accounting.newUnresolvedCentiMicroUSD,
    packetDocument().packets[0].reserveCentiMicroUSD);
  await assert.rejects(runner.next(), /continuation_stopped/);
  assert.equal(sends, 1);
}

// Unexpected cache use is a global stop and retains the unused reservation.
{
  const f = fixture();
  const runner = createRunner({ ...f, readCredential: () => "synthetic-key",
    fetchImpl: async (_url, options) => transport(responseFor(JSON.parse(options.body), { cache: true })) });
  await runner.initialize();
  const state = await runner.next();
  assert.equal(state.stopped, true);
  assert.equal(state.accounting.newKnownCentiMicroUSD, 4220);
  assert.equal(state.accounting.newUnresolvedCentiMicroUSD,
    packetDocument().packets[0].reserveCentiMicroUSD - 4220);
}

// Exactly five distinct ordered calls are possible; a sixth cannot transmit.
{
  const f = fixture();
  let sends = 0;
  const runner = createRunner({ ...f, readCredential: () => "synthetic-key",
    fetchImpl: async (_url, options) => { sends++; return transport(responseFor(JSON.parse(options.body))); } });
  await runner.initialize();
  for (const caseId of ORDER) {
    const state = await runner.next();
    assert.equal(state.newNetworkAttempts, ORDER.indexOf(caseId) + 1);
  }
  await assert.rejects(runner.next(), /network_attempt_limit/);
  assert.equal(sends, 5);
}

// The shared project lock fails closed rather than allowing concurrent work.
{
  const f = fixture();
  const lock = path.join(f.root, "evidence-work/model-evaluation/.isolated-reading.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, "other\n");
  const runner = createRunner({ ...f });
  await assert.rejects(runner.status(), error => error?.code === "EEXIST");
  assert.equal(fs.readFileSync(lock, "utf8"), "other\n");
}

// Exact integer budget and price validation rejects a one-unit mutation.
{
  const packets = packetDocument();
  assert(packets.packets.reduce((sum, packet) => sum + packet.reserveCentiMicroUSD, 0)
    < LIMITS.newAuthorizationCentiMicroUSD);
  validatePackets(packets);
  packets.packets[0].reserveCentiMicroUSD++;
  assert.throws(() => validatePackets(packets), /reservation_calculation_invalid/);
  assert.equal(LIMITS.newAuthorizationCentiMicroUSD, 5000000);
  assert.equal(LIMITS.cumulativeCentiMicroUSD, 100000000);
}

// An understated local estimate fails preflight and cannot reach fetch.
{
  const f = fixture();
  const packetPath = path.join(f.root, f.preflight, "request-packets.json");
  const packets = JSON.parse(fs.readFileSync(packetPath));
  packets.packets[0].localInputEstimate.tokenBound = 1;
  packets.packets[0].reserveCentiMicroUSD = 1500 * RATES.output + RATES.cacheWrite;
  fs.writeFileSync(packetPath, `${JSON.stringify(packets, null, 2)}\n`);
  const manifestPath = path.join(f.root, f.preflight, "preflight-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.bindings.find(item => item.role === "payload").sha256 = hash(fs.readFileSync(packetPath));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let sends = 0;
  const runner = createRunner({ ...f, readCredential: () => "synthetic-key",
    fetchImpl: async () => { sends++; throw new Error("must not fetch"); } });
  await assert.rejects(runner.initialize(), /packet_invalid/);
  assert.equal(sends, 0);
}

// A disallowed request field is rejected by the exact request allowlist.
{
  const packets = packetDocument();
  packets.packets[0].request.temperature = 0;
  packets.packets[0].localInputEstimate.tokenBound =
    Buffer.byteLength(JSON.stringify(packets.packets[0].request), "utf8") + INPUT_OVERHEAD_TOKENS;
  packets.packets[0].reserveCentiMicroUSD =
    packets.packets[0].localInputEstimate.tokenBound * RATES.cacheWrite + 1500 * RATES.output;
  assert.throws(() => validatePackets(packets), /request_controls_or_shape_changed/);
}

console.log("offline runner tests passed");
