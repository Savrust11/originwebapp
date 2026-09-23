/*
 * Narrow JavaScript port of OpenAI's educational BPE implementation:
 * https://github.com/openai/tiktoken/blob/main/tiktoken/_educational.py
 * Copyright (c) 2022 OpenAI, MIT License.
 *
 * This is deliberately only an o200k_base ordinary-text encoder. It neither
 * recognizes special tokens nor estimates provider request framing.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const O200K_SHA256 = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d";
const SPECIAL = /<\|(?:endoftext|endofprompt)\|>/;
const CONTRACTION = "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?";
const pieces = [
  new RegExp(`[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+${CONTRACTION}`, "uy"),
  new RegExp(`[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*${CONTRACTION}`, "uy"),
  /\p{N}{1,3}/uy,
  / ?[^\s\p{L}\p{N}]+[\r\n/]*/uy,
  /\s*[\r\n]+/uy,
  /\s+(?!\S)/uy,
  /\s+/uy,
];

function validateText(text) {
  if (typeof text !== "string") throw new TypeError("LOCAL_TOKEN_TEXT_REQUIRED");
  if (SPECIAL.test(text)) throw new Error("LOCAL_TOKEN_SPECIAL_LITERAL_UNSUPPORTED");
  for (let i = 0; i < text.length; i += 1) {
    const n = text.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("LOCAL_TOKEN_UNPAIRED_SURROGATE");
      i += 1;
    } else if (n >= 0xdc00 && n <= 0xdfff) {
      throw new Error("LOCAL_TOKEN_UNPAIRED_SURROGATE");
    }
  }
  // Python regex and ECMAScript disagree on these whitespace code points.
  // Rejecting them is safer than silently changing pre-tokenization.
  if (/[\u001c-\u001f\u0085\ufeff]/u.test(text)) {
    throw new Error("LOCAL_TOKEN_PYTHON_JS_WHITESPACE_DIFFERENCE");
  }
}

function splitOrdinary(text) {
  validateText(text);
  const found = [];
  let offset = 0;
  while (offset < text.length) {
    let match;
    for (const pattern of pieces) {
      pattern.lastIndex = offset;
      match = pattern.exec(text);
      if (match) break;
    }
    if (!match || match.index !== offset || match[0].length === 0) {
      throw new Error(`LOCAL_TOKEN_UNSUPPORTED_CHARACTER_AT_${offset}`);
    }
    found.push(match[0]);
    offset += match[0].length;
  }
  return found;
}

const key = (bytes) => Buffer.from(bytes).toString("latin1");

export function loadO200k(path) {
  const data = readFileSync(path);
  const digest = createHash("sha256").update(data).digest("hex");
  if (digest !== O200K_SHA256) throw new Error("LOCAL_TOKEN_DATA_HASH_MISMATCH");
  const ranks = new Map();
  const decoder = new Map();
  for (const line of data.toString("ascii").trimEnd().split("\n")) {
    const [encoded, rankText, extra] = line.trim().split(/\s+/);
    const rank = Number(rankText);
    if (extra !== undefined || !encoded || !Number.isSafeInteger(rank)) {
      throw new Error("LOCAL_TOKEN_DATA_MALFORMED");
    }
    const bytes = Buffer.from(encoded, "base64");
    ranks.set(key(bytes), rank);
    decoder.set(rank, bytes);
  }
  for (let byte = 0; byte < 256; byte += 1) {
    if (!ranks.has(key(Buffer.from([byte])))) throw new Error("LOCAL_TOKEN_BYTE_COVERAGE_MISSING");
  }

  function encodePiece(piece) {
    let parts = [...Buffer.from(piece, "utf8")].map((byte) => Buffer.from([byte]));
    for (;;) {
      let minIndex = -1;
      let minRank = Infinity;
      for (let i = 0; i + 1 < parts.length; i += 1) {
        const rank = ranks.get(key(Buffer.concat([parts[i], parts[i + 1]])));
        if (rank !== undefined && rank < minRank) {
          minRank = rank;
          minIndex = i;
        }
      }
      if (minIndex < 0) break;
      parts.splice(minIndex, 2, Buffer.concat([parts[minIndex], parts[minIndex + 1]]));
    }
    return parts.map((part) => {
      const rank = ranks.get(key(part));
      if (rank === undefined) throw new Error("LOCAL_TOKEN_INTERNAL_RANK_MISSING");
      return rank;
    });
  }

  function encode(text) {
    return splitOrdinary(text).flatMap(encodePiece);
  }
  function decodeBytes(tokens) {
    return Buffer.concat(tokens.map((token) => {
      const bytes = decoder.get(token);
      if (!bytes) throw new Error("LOCAL_TOKEN_UNKNOWN_ID");
      return bytes;
    }));
  }
  return Object.freeze({ name: "o200k_base", digest, encode, decodeBytes });
}
