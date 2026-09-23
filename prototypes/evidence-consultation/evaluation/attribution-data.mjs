// Verified source relationships for app-owned attribution display.
// This module is deliberately narrow: it does not infer relationships from
// titles, reference lists, other sources, or a model answer.
import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");

const E02_ORIGINAL_ID = "E02-F-S01-S02-SHARED";
const E02_TEXT_SHA256 = "6707676ee59249ff2b8b884429780869004eb70b7c3a44820eb671e6f9b8e066";
const E02_RELATION_QUOTE =
  "米国睡眠医学会（American Academy of Sleep Medicine）は、１〜２歳児は11〜14時間、３〜５歳児は10〜13時間、小学生は９〜12時間、中学・高校生は８〜10時間の睡眠時間の確保を推奨しています５）。";
const E02_RELATION_QUOTE_SHA256 =
  "32f94bd498d536ce4cba2cb46611df1eedee008e316280848ab573b66cc24fea";

const freeze = value => Object.freeze(value);

export const ATTRIBUTION_RELATION_ID = "ATTR-E02-GUIDE-INTRODUCES-AASM-SLEEP-DURATION";

/**
 * Validate the frozen E02 source and return the one relationship its selected
 * original excerpt states explicitly. No AASM article text is represented.
 */
export function buildVerifiedAttributionRelations(e02) {
  const source = e02?.sources?.find(item => item.id === "E02");
  const fragment = e02?.fragments?.find(item => item.id === E02_ORIGINAL_ID);
  if (!source || source.title !== "健康づくりのための睡眠ガイド2023"
    || source.version !== "健康づくりのための睡眠ガイド2023"
    || source.issuer !== "厚生労働省") {
    throw new Error("ATTRIBUTION_E02_DOCUMENT_METADATA_MISMATCH");
  }
  if (!fragment || fragment.source_id !== "E02"
    || fragment.text_sha256 !== E02_TEXT_SHA256
    || sha256(fragment.original_text) !== E02_TEXT_SHA256) {
    throw new Error("ATTRIBUTION_E02_ORIGINAL_MISMATCH");
  }
  const start = fragment.original_text.indexOf(E02_RELATION_QUOTE);
  if (start !== 0 || sha256(E02_RELATION_QUOTE) !== E02_RELATION_QUOTE_SHA256) {
    throw new Error("ATTRIBUTION_E02_RELATION_SPAN_MISMATCH");
  }

  return freeze({
    [ATTRIBUTION_RELATION_ID]: freeze({
      relation_id: ATTRIBUTION_RELATION_ID,
      relation_type: "document_introduces_external_recommendation",
      document: freeze({
        source_id: "E02",
        title: source.title,
        version: source.version,
        publisher: source.issuer,
        publisher_role: "publishing_body",
      }),
      recommendation_origin: freeze({
        organization_id: "AASM",
        name_ja: "米国睡眠医学会",
        name_en: "American Academy of Sleep Medicine",
        role: "recommendation_body_named_by_the_guide",
      }),
      display_text: "このガイドが紹介する米国睡眠医学会（AASM）の推奨",
      support: freeze({
        original_id: E02_ORIGINAL_ID,
        source_id: "E02",
        text_sha256: E02_TEXT_SHA256,
        quote: E02_RELATION_QUOTE,
        quote_sha256: E02_RELATION_QUOTE_SHA256,
        quote_span_utf16: freeze({ start, end: start + E02_RELATION_QUOTE.length }),
      }),
      eligible_cases: freeze(["Q05", "Q06"]),
      qualification:
        "帰属関係は日本語ガイドの収録原文から確認した。AASM本文は未収録であり、夜間のみか24時間合計かを支える関係ではない。",
      provenance: "verified_original_relationship_metadata",
    }),
  });
}
