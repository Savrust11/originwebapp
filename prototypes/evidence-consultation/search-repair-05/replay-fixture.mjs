import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { output } from "./prepare.mjs";
const fixture=JSON.parse(fs.readFileSync(path.join(output,"dictionary-fixture.json")));
const traces=JSON.parse(fs.readFileSync(path.join(output,"expansion-traces.json")));
assert.equal(fixture.invocationNonce,traces.invocationNonce);
const keywords=fixture.tables.evidence_keywords.filter(k=>k.active);
const dictionaries=fixture.tables.evidence_dictionary_terms;
function matched(term,language,question) {
  const q=question.toLocaleLowerCase(),t=term.toLocaleLowerCase();
  return language==="ja"?q.includes(t):(` ${q.replace(/[^\p{L}\p{N}_]+/gu," ")} `).includes(` ${t} `);
}
for(const trace of traces.traces) {
  const question=trace.original.question;
  const hits=[...keywords,...dictionaries].filter(r=>matched(r.term,r.language,question));
  const concepts=new Set(hits.map(r=>r.concept_id).filter(Boolean));
  const keywordIds=new Set(hits.map(r=>r.id));
  const expanded=[...keywords.filter(r=>keywordIds.has(r.id)||concepts.has(r.concept_id)).map(r=>({...r,id:`k:${r.id}`})),
    ...dictionaries.filter(r=>concepts.has(r.concept_id)).map(r=>({...r,id:`d:${r.id}`}))];
  assert.equal(expanded.length,trace.original.nativeCount,trace.id);
  assert.deepEqual(new Set(expanded.map(r=>r.id)),new Set(trace.original.rows.map(r=>r.id)),trace.id);
}
console.log(`Replayed ${traces.traces.length} actual original expansion sets against the exported DB dictionary fixture; no DB/network used.`);