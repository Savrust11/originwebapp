import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { LIMITS, REVIEW_DIMENSIONS } from "./policy.mjs";

const ownedRoot = path.resolve("evidence-work/private-parenting-trial-11/offline");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const statuses = new Set(["pass", "partial", "fail", "not_applicable", "unrated"]);

function owned(target) {
  const resolved = path.resolve(target);
  if (resolved !== ownedRoot && !resolved.startsWith(`${ownedRoot}${path.sep}`)) {
    throw new Error("WRITE_OUTSIDE_OWNED_PATH");
  }
  return resolved;
}

export function validateProviderEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > LIMITS.responseBytes) {
    throw new Error("RESPONSE_BYTE_BOUND");
  }
  let response;
  try { response = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("INVALID_RESPONSE_JSON"); }
  if (!response || typeof response !== "object" || Array.isArray(response)
    || typeof response.id !== "string" || typeof response.model !== "string"
    || response.status !== "completed" || !Array.isArray(response.output)) {
    throw new Error("INVALID_RESPONSE_FIELDS");
  }
  if (!response.usage || !Number.isSafeInteger(response.usage.input_tokens)
    || !Number.isSafeInteger(response.usage.output_tokens)
    || response.usage.input_tokens < 0 || response.usage.input_tokens > LIMITS.inputTokens
    || response.usage.output_tokens < 0 || response.usage.output_tokens > LIMITS.outputTokens) {
    throw new Error("INVALID_RESPONSE_USAGE");
  }
  const messages = response.output.filter(item => item?.type === "message");
  if (response.output.some(item => !["message", "reasoning"].includes(item?.type))
    || messages.length !== 1 || messages[0].role !== "assistant"
    || messages[0].status !== "completed" || !Array.isArray(messages[0].content)) {
    throw new Error("UNEXPECTED_RESPONSE_OUTPUT");
  }
  const outputText = messages[0].content.map(item => {
    if (item?.type !== "output_text" || typeof item.text !== "string"
      || !Array.isArray(item.annotations) || item.annotations.length !== 0) {
      throw new Error("UNEXPECTED_RESPONSE_CONTENT");
    }
    return item.text;
  }).join("\n");
  if (!outputText.trim() || Buffer.byteLength(outputText) > 16_000) throw new Error("INVALID_RESPONSE_TEXT");
  return Object.freeze({ response, outputText });
}

export function blankReview() {
  return Object.freeze(Object.fromEntries(REVIEW_DIMENSIONS.map(key => [
    key, Object.freeze({ rating: "unrated", evidence: "", notes: "" }),
  ])));
}

export function archiveRawResponse({
  directory,
  rawBytes,
  requestSha256,
  sceneId,
  turnNumber,
  synthetic = false,
} = {}) {
  const target = owned(directory);
  if (!/^[a-f0-9]{64}$/.test(requestSha256 ?? "")) throw new Error("REQUEST_HASH_REQUIRED");
  if (typeof sceneId !== "string" || !Number.isSafeInteger(turnNumber)) throw new Error("RESPONSE_CONTEXT_REQUIRED");
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length === 0 || rawBytes.length > LIMITS.responseBytes) {
    throw new Error("RESPONSE_BYTE_BOUND");
  }
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const rawPath = path.join(target, `${id}.raw.json`);
  const metadataPath = path.join(target, `${id}.metadata.json`);
  const inspected = validateProviderEnvelope(rawBytes);
  fs.writeFileSync(rawPath, rawBytes, { flag: "wx", mode: 0o600 });
  const metadata = {
    recordId: id,
    classification: synthetic ? "synthetic_pipeline_test_not_real_model_answer" : "actual_model_raw_response",
    synthetic,
    immutableRaw: true,
    sceneId,
    turnNumber,
    requestSha256,
    rawSha256: sha(rawBytes),
    rawBytes: rawBytes.length,
    parsedDisplay: {
      text: inspected.outputText,
      model: inspected.response.model,
      providerResponseId: inspected.response.id,
      usage: inspected.response.usage,
    },
    reviewState: "separate_append_only_revision_files",
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return Object.freeze({ rawPath, metadataPath, metadata });
}

export function persistReviewRevision({ directory, responseMetadataPath, review, continuation } = {}) {
  const target = owned(directory);
  const metadataPath = owned(responseMetadataPath);
  const metadataBytes = fs.readFileSync(metadataPath);
  const metadata = JSON.parse(metadataBytes);
  if (!review || typeof review !== "object"
    || !REVIEW_DIMENSIONS.every(key => statuses.has(review[key]?.rating)
      && typeof review[key]?.evidence === "string"
      && typeof review[key]?.notes === "string")) throw new Error("INVALID_REVIEW");
  const allowedContinuation = new Set([
    "continue", "completed", "answer_quality_failure", "protocol_cannot_continue",
    "safety_stop", "transport_stop",
  ]);
  if (!continuation || !allowedContinuation.has(continuation.classification)
    || typeof continuation.reason !== "string") throw new Error("INVALID_CONTINUATION_DECISION");
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const revisions = fs.existsSync(target)
    ? fs.readdirSync(target).filter(name => name.endsWith(".review.json")).length : 0;
  const file = path.join(target, `${metadata.recordId}.${String(revisions + 1).padStart(4, "0")}.review.json`);
  const record = {
    reviewRevision: revisions + 1,
    responseRecordId: metadata.recordId,
    responseMetadataSha256: sha(metadataBytes),
    review,
    continuation,
  };
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return Object.freeze({ path: file, record });
}

export function verifyReceiptPath(receipt) {
  owned(receipt.rawPath);
  owned(receipt.metadataPath);
}