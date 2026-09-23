import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { REVIEW_DIMENSIONS, LIMITS } from "./policy.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function validateProviderEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error("RAW_BYTES_REQUIRED");
  if (bytes.length === 0 || bytes.length > LIMITS.responseBytes) throw new Error("RESPONSE_BYTE_BOUND");
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("INVALID_RESPONSE_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || typeof parsed.id !== "string" || typeof parsed.model !== "string"
    || parsed.status !== "completed" || !Array.isArray(parsed.output)) throw new Error("INVALID_RESPONSE_FIELDS");
  if (!parsed.usage || typeof parsed.usage !== "object"
    || !Number.isSafeInteger(parsed.usage.input_tokens) || !Number.isSafeInteger(parsed.usage.output_tokens)
    || parsed.usage.input_tokens < 0 || parsed.usage.output_tokens < 0
    || parsed.usage.input_tokens > LIMITS.inputTokensPerAttempt
    || parsed.usage.output_tokens > LIMITS.outputTokensPerAttempt) throw new Error("INVALID_RESPONSE_USAGE");
  const messages = parsed.output.filter(item => item?.type === "message");
  if (parsed.output.some(item => !["message", "reasoning"].includes(item?.type))
    || messages.length !== 1 || messages[0].role !== "assistant"
    || messages[0].status !== "completed" || !Array.isArray(messages[0].content)) {
    throw new Error("UNEXPECTED_RESPONSE_OUTPUT");
  }
  const texts = messages[0].content.map(item => {
    if (item?.type !== "output_text" || typeof item.text !== "string"
      || item.annotations !== undefined && (!Array.isArray(item.annotations) || item.annotations.length)) {
      throw new Error("UNEXPECTED_RESPONSE_CONTENT");
    }
    return item.text;
  });
  const outputText = texts.join("\n");
  if (!outputText.trim() || outputText.length > 12_000) throw new Error("INVALID_RESPONSE_TEXT");
  return { parsed, outputText };
}

export function blankReview() {
  return Object.fromEntries(REVIEW_DIMENSIONS.map(key => [key, { status: "unrated", note: "" }]));
}

export function archiveRawResponse({ directory, rawBytes, requestSha256, synthetic = false } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("ABSOLUTE_ARCHIVE_REQUIRED");
  const ownedRoot = path.resolve("evidence-work/private-parenting-trial-10/offline");
  const target = path.resolve(directory);
  if (target !== ownedRoot && !target.startsWith(`${ownedRoot}${path.sep}`)) throw new Error("ARCHIVE_OUTSIDE_OWNED_PATH");
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length === 0 || rawBytes.length > LIMITS.responseBytes) {
    throw new Error("RESPONSE_BYTE_BOUND");
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const rawPath = path.join(directory, `${id}.raw.json`);
  const metaPath = path.join(directory, `${id}.metadata.json`);
  fs.writeFileSync(rawPath, rawBytes, { flag: "wx", mode: 0o600 });
  let inspected = null;
  let parseError = null;
  try { inspected = validateProviderEnvelope(rawBytes); }
  catch (error) { parseError = error instanceof Error ? error.message : "UNKNOWN_PARSE_ERROR"; }
  const metadata = {
    recordId: id,
    synthetic,
    label: synthetic ? "合成通信テスト・実モデル回答ではない" : "実モデルの未編集生回答",
    requestSha256,
    rawSha256: hash(rawBytes),
    rawBytes: rawBytes.length,
    parseStatus: parseError ? "invalid_needs_review" : "validated",
    parseError,
    parsedDisplay: inspected ? {
      text: inspected.outputText,
      model: inspected.parsed.model,
      providerResponseId: inspected.parsed.id,
    } : null,
    review: blankReview(),
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return Object.freeze({ rawPath, metaPath, metadata });
}
