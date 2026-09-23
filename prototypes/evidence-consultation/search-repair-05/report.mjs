import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { output, root, preservation, sha } from "./prepare.mjs";
const read = name=>JSON.parse(fs.readFileSync(path.join(output,name)));
const cases=read("cases.json"), traces=read("expansion-traces.json"), sources=read("source-bindings.json"), cleanup=read("cleanup.json");
assert.equal(cases.invocationNonce,cleanup.invocationNonce);
assert.equal(traces.invocationNonce,cleanup.invocationNonce);
assert.equal(sources.invocationNonce,cleanup.invocationNonce);
assert(!fs.existsSync(cleanup.ownedRoot));
if(fs.existsSync(`/proc/${cleanup.postgresPid}/stat`)) {
  const stat=fs.readFileSync(`/proc/${cleanup.postgresPid}/stat`,"utf8");
  assert.notEqual(stat.slice(stat.lastIndexOf(")")+2).trim().split(/\s+/u)[19],cleanup.postgresStartTime);
}
const protectedFiles=preservation();
const ids=["exp04-yokohama-child-consultation-naka-boundary","exp04-yokohama-naka-boundary","exp04-nagoya-naka-boundary"];
const failures=ids.map(id=>{
  const trace=traces.traces.find(t=>t.id===id), row=cases.cases.find(c=>c.id===id);
  assert(trace&&row);
  return {id,question:row.originalQuestion,status:row.status,nativeCount:trace.original.nativeCount,
    nativeDiagnostics:row.nativeDiagnostics,uniqueNormalizedTerms:trace.original.normalizedUniqueTerms,
    uniqueConceptScopedTerms:trace.original.conceptScopedUniqueTerms,
    oneHopSiblingAliasRows:trace.original.reexpandedAliasRows,matchedRows:trace.original.matchedRows,
    repairedPreScopedCount:trace.topic.repairedCount,rawResults:row.rawResults.map(r=>r.unitId),
    finalResults:row.scopedRecordIds,cap:64};
});
const additions=JSON.parse(fs.readFileSync(path.join(root,"evidence-work/parenting-expansion-04/practical/validation-input.json"))).records.concat(
  JSON.parse(fs.readFileSync(path.join(root,"evidence-work/parenting-expansion-04/municipal/validation-input.json"))).records);
const addedUnits=additions.map(record=>{
  const natural=cases.cases.find(c=>c.kind==="natural_consultation"&&c.expectedIds?.includes(record.id));
  const paraphrase=cases.cases.find(c=>c.kind==="paraphrase"&&c.expectedIds?.includes(record.id));
  assert(natural?.results.some(r=>r.unitId===record.id));assert(paraphrase?.results.some(r=>r.unitId===record.id));
  return {id:record.id,natural:{id:natural.id,question:natural.question,status:natural.status},
    paraphrase:{id:paraphrase.id,question:paraphrase.question,status:paraphrase.status},
    source:sources.units.find(u=>u.unitId===record.id)};
});
assert.equal(addedUnits.length,16);
const archiveRoot=path.join(output,"archive");
const previousRuns=fs.existsSync(archiveRoot)?fs.readdirSync(archiveRoot).map(nonce=>{
  const filename=path.join(archiveRoot,nonce,"cases.json");
  return fs.existsSync(filename)?{nonce,status:"superseded_not_erased",counts:JSON.parse(fs.readFileSync(filename)).counts,artifact:path.relative(root,filename),sha256:sha(fs.readFileSync(filename))}:{nonce,status:"initialization_failure_no_case_artifact"};
}):[];
const report={
  format:"weiku.search-repair05.measured-report.v1",invocationNonce:cases.invocationNonce,runId:cases.runId,
  status:cases.counts.fail?"completed_with_failures":"passed",counts:cases.counts,
  corpus:{current:51,historicalRetainedExcluded:1,individuallyRetrieved:cases.cases.filter(c=>c.kind==="unit_regression"&&c.status==="pass").length,
    prior35Regressions:cases.cases.filter(c=>c.kind==="unit_regression"&&c.prior35&&c.status==="pass").length,newNatural:16,newParaphrase:16},
  diagnosis:"One-hop concept fanout, not recursion. SQL UNION deduplicates k:/d: UUID identities, not normalized term strings. Pure municipality aliases match several concepts; all sibling input aliases are then added, including unmatched long natural-question aliases. The original single and compound questions each reach85 identities and are rejected before candidate scan at64. Normalized lexical dedup would give52 but conflates concept links; concept-scoped dedup is75, still over64. Geography is a contributor, not a sufficient diagnosis. The preserved historical86 prediction is not overwritten or presented as this run's measurement. Reverse compound measured60 and did not originally overflow.",
  repair:"Isolated, hash-checked search export only: structured geography filters concept eligibility before matching/expansion; pure geographic vocabulary becomes structured input, not topic evidence. Shared topical aliases are bound through preserved service categories/support sections in a separate owned DB table, not expected IDs. One-hop expansion retains source keywords and directly matched aliases, not every unmatched sibling input alias. Original questions are passed unchanged. Ordinary/native draft search,64 guard, LIMIT64, source bytes and all rights remain unchanged. No fallback cap, silent truncation or expected-ID retrieval gate.",
  modifiedScope:"Municipal source-title retrieval remains available. Pure city aliases no longer count as topical retrieval in the repaired export; original aliases are independently measured through the unchanged native export. Geographic negative cases are now pre-expansion exclusion witnesses, not falsely claimed post-search raw-candidate witnesses. Full raw and selected candidates are saved.",
  failures,addedUnits,previousRuns,
  preservation:{files:protectedFiles.length,unchanged:true,manifest:"validation/preservation.json"},
  cleanup:{...cleanup,ownedIdentityGone:true,ownedRootAbsent:true},
  geography:{existingRosterMunicipalities:219,existingAdministrativeWards:92,officialIdsInvented:false,keys:"jp/prefecture/municipality/ward, URI-encoded composite hierarchy, not official authority IDs",bareNaka:"one city clarification; general guidance only",unknown:"not_collected, never no_services",invalid:"prefecture/city/ward combinations rejected",conflict:"structured selection authoritative; explicit notice"},
  limits:["Lexical retrieval/source-linkage and policy-state verification only; not clinical safety, semantic adequacy, individual eligibility, current fees, or publication approval.",
    "General candidates may coexist with a relevant passage; their presence does not establish answer relevance.",
    "All evidence remains draft/testOnly, manual review false, fact-ready zero; no existing DB, model network, external publication or source research.",
    "NHS-derived Japanese adaptations remain We育 editorial adaptations, not NHS Japanese advice or endorsement. Internal original provenance is separate from conditional public OGL/attribution display; no new publication approval."],
  artifacts:{cases:"validation/cases.json",traces:"validation/expansion-traces.json",actualDbFixture:"validation/dictionary-fixture.json",fixtureReplay:"node prototypes/evidence-consultation/search-repair-05/replay-fixture.mjs",sourceBindings:"validation/source-bindings.json",checkedSql:"validation/search-repair-receipt.json"},
};
const work=path.dirname(output);
fs.writeFileSync(path.join(work,"report.json"),JSON.stringify(report,null,2)+"\n");
const esc=x=>String(x??"unknown").replace(/[&<>"']/gu,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Search repair05 — measured internal report</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 24px;color:#16302b;background:#f7faf8}h1,h2{color:#095b49}section,article{background:white;border:1px solid #d5e3db;border-radius:12px;padding:20px;margin:18px 0}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;border-bottom:1px solid #ddd;padding:9px;vertical-align:top;word-break:break-word}code{overflow-wrap:anywhere;font-size:12px}.note{color:#63541e}a{color:#006d61}p{line-height:1.7}</style><h1>検索修復05 / 内部検証</h1><p>${report.counts.pass} pass · ${report.counts.fail} fail · ${report.counts.not_run} not_run — 51現行＋1履歴保持。既存DB・本番検索・公開状態は変更していません。</p><section><h2>実測原因と修正</h2><p>${esc(report.diagnosis)}</p><p>${esc(report.repair)}</p><p class="note">${esc(report.modifiedScope)}</p></section>
<section><h2>元の失敗質問をそのまま検証</h2>${failures.map(f=>`<article><h3>${esc(f.id)}</h3><p>${esc(f.question)}</p><p>Original ${f.nativeCount} identities / normalized ${f.uniqueNormalizedTerms} / concept-scoped ${f.uniqueConceptScopedTerms} → repaired ${f.repairedPreScopedCount}. Guard64 unchanged. ${esc(f.status)}</p><details><summary>実DBで直接一致した辞書行</summary><table><tr><th>term</th><th>concept UUID</th><th>row UUID identity</th></tr>${f.matchedRows.map(r=>`<tr><td>${esc(r.term)}</td><td><code>${esc(r.concept_id)}</code></td><td><code>${esc(r.id)}</code></td></tr>`).join("")}</table></details></article>`).join("")}</section>
<section><h2>16追加資料 — 自然な質問・言い換えと実測出典結合</h2>${addedUnits.map(u=>`<article><h3>${esc(u.id)}</h3><p>${esc(u.natural.question)} (${u.natural.status})</p><p>${esc(u.paraphrase.question)} (${u.paraphrase.status})</p><p><a href="${esc(u.source.originalUrl)}">${esc(u.source.originalUrl)}</a></p><p>対象・年齢: ${esc(u.source.ageScope)}</p><p>節: ${esc(u.source.sourceLocation)}</p><p>更新日: ${esc(u.source.sourceUpdatedOn)}（不明は推定しない）</p><code>source ${esc(u.source.sourceId)}<br>version ${esc(u.source.versionId)}<br>section ${esc(u.source.sectionId)}</code></article>`).join("")}</section>
<section><h2>全ケース（独立継続）</h2><table><tr><th>case</th><th>kind</th><th>status</th><th>error</th></tr>${cases.cases.map(c=>`<tr><td>${esc(c.id)}</td><td>${esc(c.kind)}</td><td>${esc(c.status)}</td><td>${esc(c.error??"—")}</td></tr>`).join("")}</table></section>
<section><h2>保全・安全・限界</h2><p>Protected files: ${protectedFiles.length}; unchanged. Nonce-bound PostgreSQL cleanup complete, root and original process identity absent.</p>${report.limits.map(l=>`<p class="note">${esc(l)}</p>`).join("")}<p>Previous failed runs are retained in validation/archive; final results supersede, never erase them.</p></section></html>`;
fs.writeFileSync(path.join(work,"report.html"),html);
console.log(`Report bound to ${cases.invocationNonce}; ${addedUnits.length} additions and ${sources.units.length} exact source bindings.`);