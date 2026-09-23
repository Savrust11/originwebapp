import assert from "node:assert/strict";
import { once, pinned, output, sha } from "./prepare.mjs";
import fs from "node:fs";
import path from "node:path";

export function repairSearch(source) {
  const native = pinned("server/evidence/search.ts");
  const extract = name => {
    const start = native.indexOf(`const ${name} = \``)+`const ${name} = \``.length;
    assert(start>name.length); return native.slice(start,native.indexOf("`;",start));
  };
  const count = extract("EXPANSION_COUNT_SQL");
  const sql = extract("SEARCH_SQL");
  // Input aliases resolve a concept. Re-expanding *all* sibling input aliases is
  // unnecessary for source-keyword retrieval and was consuming the same 64 cap.
  // Keep directly matched aliases for checked derivatives; do not truncate rows.
  const guard = `    AND dictionary.concept_id IN (SELECT concept_id FROM matched_concepts)`;
  const direct = `${guard}
    AND ((dictionary.language = 'ja' AND strpos(lower($1), lower(dictionary.term)) > 0)
      OR (dictionary.language = 'en' AND strpos(
        ' ' || regexp_replace(lower($1), '[^[:alnum:]_]+', ' ', 'g') || ' ',
        ' ' || lower(dictionary.term) || ' ') > 0))`;
  function vocabularyRepair(sql) {
    const start=sql.indexOf("matched_vocabulary AS (");
    assert(start>0);
    sql=sql.slice(0,start)+`repair_vocabulary AS (
  SELECT keyword_id,concept_id,term,language FROM vocabulary
  WHERE lower(term) NOT IN (SELECT lower(label) FROM repair05_geo_labels)
  UNION ALL
  SELECT NULL::uuid AS keyword_id,concept_id,term,'ja' AS language FROM repair05_topic_aliases
),
`+sql.slice(start);
    return once(sql,"  FROM vocabulary\n  WHERE (","  FROM repair_vocabulary AS vocabulary\n  WHERE (/*REPAIR05_SCOPE*/ TRUE) AND (");
  }
  const repairedCount = vocabularyRepair(once(count,guard,direct));
  const published = `JOIN evidence_versions AS version
    ON version.id = source.current_published_version_id
    AND version.source_id = source.id
    AND version.publication_status = 'published'`;
  const draft = `JOIN evidence_versions AS version
    ON version.source_id = source.id
    AND version.publication_status = 'draft'
    AND version.test_only = true
    AND source.test_only = true
    AND source.source_key LIKE ($4::text || '-%')`;
  const repairedSql = vocabularyRepair(once(once(sql,guard,direct),published,draft).replace("WHERE source.status = 'active'","WHERE source.status = 'draft'"));
  source = once(source, "  draftRunId: string | null,\n", "  draftRunId: string | null,\n  repair = false,\n");
  source = once(source, "pool.query(EXPANSION_COUNT_SQL, [input.question])", "pool.query(repair ? REPAIRED_COUNT_SQL : EXPANSION_COUNT_SQL, [input.question])");
  source = once(source, "draftRunId === null ? SEARCH_SQL : EXPANSION_DRAFT_SEARCH_SQL", "draftRunId === null ? SEARCH_SQL : repair ? REPAIRED_DRAFT_SQL : EXPANSION_DRAFT_SEARCH_SQL");
  const tracePrefix = count.slice(0,count.indexOf("search_terms_unbounded AS"));
  const traceSql = `${tracePrefix}
  expanded AS (
    SELECT 'k:' || k.id::text AS id, k.id AS keyword_id, k.concept_id, k.term, k.language
    FROM evidence_keywords k CROSS JOIN ephemeral_context c
    WHERE k.active AND (NOT k.test_only OR c.allowed)
      AND (k.id IN (SELECT keyword_id FROM matched_keyword_ids) OR k.concept_id IN (SELECT concept_id FROM matched_concepts))
    UNION
    SELECT 'd:' || d.id::text, NULL::uuid, d.concept_id, d.term, d.language
    FROM evidence_dictionary_terms d CROSS JOIN ephemeral_context c
    WHERE (NOT d.test_only OR c.allowed) AND d.concept_id IN (SELECT concept_id FROM matched_concepts)
  )
  SELECT id,keyword_id,concept_id,term,language,
    CASE WHEN language='ja' THEN strpos(lower($1),lower(term))>0
      ELSE strpos(' '||regexp_replace(lower($1),'[^[:alnum:]_]+',' ','g')||' ',' '||lower(term)||' ')>0 END AS directly_matched
  FROM expanded ORDER BY concept_id,id`;
  source += `
const REPAIRED_COUNT_SQL = ${JSON.stringify(repairedCount)};
const REPAIRED_DRAFT_SQL = ${JSON.stringify(repairedSql)};
function repairPool(pool,conceptIds) {
  if(conceptIds === null) return pool;
  if(!Array.isArray(conceptIds) || conceptIds.some(id=>typeof id!=="string" || !/^[a-f0-9-]{36}$/.test(id))) throw Error("validated concept IDs required");
  const predicate=conceptIds.length ? "vocabulary.concept_id IN ("+conceptIds.map(id=>"'"+id+"'::uuid").join(",")+")" : "FALSE";
  return {query(sql,args){return pool.query(sql.replace("/*REPAIR05_SCOPE*/ TRUE",predicate),args);}};
}
export async function searchEvidenceRepairedDrafts(pool, rawInput, runId, conceptIds = null) {
  if(typeof runId !== "string" || !/^parenting-expansion-[a-f0-9]{24}$/.test(runId)) throw Error("exact owned run required");
  return searchEvidenceScoped(repairPool(pool,conceptIds),rawInput,runId,true);
}
export async function expansionTrace(pool,question,conceptIds = null) {
  const rows=(await pool.query(${JSON.stringify(traceSql)},[question])).rows;
  const nativeCount=Number((await pool.query(EXPANSION_COUNT_SQL,[question])).rows[0].expansion_count);
  const repairedCount=Number((await repairPool(pool,conceptIds).query(REPAIRED_COUNT_SQL,[question])).rows[0].expansion_count);
  const topicMatches=(await pool.query("SELECT * FROM repair05_topic_aliases WHERE strpos(lower($1),lower(term))>0",[question])).rows.filter(row=>conceptIds===null || conceptIds.includes(row.concept_id));
  return {question, nativeCount,repairedCount,cap:64,capSite:"server/evidence/search.ts:791 expansionCount > 64 (before candidate scan)",
    sqlUnion:"UNION by k:/d: UUID identity, not normalized terms", rows,
    topicMatches,allowedConceptIds:conceptIds,expansionDepth:"one-hop matched-concept fanout; no recursion",
    normalizedUniqueTerms:new Set(rows.map(r=>r.language+":"+r.term.toLocaleLowerCase())).size,
    conceptScopedUniqueTerms:new Set(rows.map(r=>r.concept_id+":"+r.language+":"+r.term.toLocaleLowerCase())).size,
    matchedRows:rows.filter(r=>r.directly_matched),
    reexpandedAliasRows:rows.filter(r=>r.id.startsWith("d:")&&!r.directly_matched).length};
}
`;
  fs.writeFileSync(path.join(output,"search-repair-receipt.json"),JSON.stringify({
    nativeSha256:sha(native),countSqlSha256:sha(count),repairedCountSqlSha256:sha(repairedCount),
    countSql:count,repairedCountSql:repairedCount,repairedSearchSql:repairedSql,
    unchangedCap:64,normalSearchUnchanged:true,nativeDraftDiagnosticExportPreserved:true,
    logic:"Structured geography scopes concepts before vocabulary matching; pure place-name dictionary aliases excluded only in repaired query. Source-neutral topic aliases use preserved service categories. Expand matched concepts to source keywords and directly matched dictionary terms, without one-hop fanout to unrelated sibling input aliases.",
  },null,2));
  return source;
}