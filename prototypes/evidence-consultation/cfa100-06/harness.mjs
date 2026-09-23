import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {getInputs,runCases as runBaseline} from "../search-repair-05/harness.mjs";
import {createEvidenceSource,ingestEvidenceVersion,createEvidenceConcept,upsertEvidenceKeyword,upsertEvidenceDictionaryTerm,linkEvidenceSectionKeyword,linkEvidenceRequiredContext} from "../../../server/evidence/catalog.ts";
import {emptyDocumentApplicabilityPolicy,emptySectionApplicabilityPolicy} from "../../../shared/evidence.ts";
import {resolveRegion,inRegion,places} from "../search-repair-05/geography.mjs";
import {loadCandidate,mapCandidate,editorialFor,makeFact,location} from "./mapper.mjs";
import {renderEvidence} from "./renderer.mjs";
import {createFixtureSearch} from "./fixture-search.mjs";
import {factHtml} from "./common-fact-display.mjs";
import {root,output,sha,preservation} from "./prepare.mjs";
export {getInputs};
const write=(name,x)=>fs.writeFileSync(path.join(output,name),JSON.stringify(x,null,2)+"\n");
// Concept aliases, not question or case routing. The source keyword is an exact
// substring of the audited original and anchors each concept to its source.
const vocabulary=[
  ["こどもにはこどもの",["出かけたい","やめない","帰る時間","まだ遊ぶ","切り替え"]],
  ["言葉だけでなく、表情やしぐさ",["何を考え","分からない","しぐさ","気持ち","言葉にできない"]],
  ["仕事や家事で毎日慌ただしい",["家事ばかり","余裕がない","仕事と家事","忙しい","相手をする"]],
  ["こどもが怖くて不安な時",["失敗","怖がる","不安そう","怖い","泣いて"]],
  ["自分から「挑戦」しようとしている時",["手伝ってしまう","手を出し","自分で","先回り","見守り"]],
  ["乳幼児期のこどもの生活の中心",["遊んでばかり","何を教え","遊び","遊んでいる","教材"]],
  ["抱え込まずに周囲の人に相談",["抱え込","一人で子育て","頼れる人","悩み","相談したい"]],
  ["交流の場",["親子で行け","話せる場所","親子の居場所","話し相手","支援拠点"]],
];
const probes=[
  ["出かけたいのに遊びをやめない","帰る時間なのにまだ遊ぶ"],
  ["何を考えているのか分からない","言葉にできない時、しぐさから気持ちを知りたい"],
  ["家事ばかりで相手をする余裕がない","仕事と家事で忙しいです"],
  ["失敗すると怖がる","新しいことが怖いようで不安そうです"],
  ["すぐ手伝ってしまう","自分でやりたい子に先回りしてしまいます"],
  ["遊んでばかりでいいの？","毎日遊んでいるけれど何を教えたらいい？"],
  ["一人で子育てを抱え込んでいる","頼れる人がいなくて悩みを抱えています"],
  ["親子で行けて話せる場所","親子の居場所や話し相手がほしい"],
];
export async function runCases(args){
  await runBaseline(args);
  const {pool,runId,invocationNonce,items,repairedSearch,normalSearch}=args;
  const data=loadCandidate(),cases=[],measured=new Map();
  const baselineBindings=JSON.parse(fs.readFileSync(path.join(output,"source-bindings.json")));
  const baselineFixture=JSON.parse(fs.readFileSync(path.join(output,"dictionary-fixture.json")));
  const baselineCases=JSON.parse(fs.readFileSync(path.join(output,"cases.json")));
  const current=items.filter(i=>!i.isHistorical);
  const independent=async(id,kind,fn)=>{
    const row={id,kind,status:"not_run"};cases.push(row);
    try {await fn(row);row.status="pass";}catch(error){row.status="fail";row.error=String(error.message);}
    write("cfa-cases.json",{runId,invocationNonce,counts:{pass:cases.filter(c=>c.status==="pass").length,fail:cases.filter(c=>c.status==="fail").length,not_run:cases.filter(c=>c.status==="not_run").length},cases});
  };
  const dedup=data.sections.map(s=>({
    candidateId:s.candidate_section_id,
    exactMatches:current.filter(i=>i.unit.originalSha256===s.original_text_sha256||i.unit.originalText===s.original_text).map(i=>i.unit.id),
    sameSource:current.filter(i=>[i.document.url,i.document.id].includes(data.source.pdf_url)||i.document.id===data.source.candidate_source_id).map(i=>i.unit.id),
    relatedTopics:current.filter(i=>s.search_keywords.some(t=>(i.unit.retrievalTerms?.queryTerms??[]).some(old=>old.includes(t)||t.includes(old)))).map(i=>i.unit.id),
    independentStudyIncrement:0,
  }));
  write("deduplication.json",{method:"all 51: source identity/PDF URL, exact UTF8 content/hash; topic overlap is relation only",records:dedup});
  assert(dedup.every(d=>d.exactMatches.length===0&&d.sameSource.length===0),"existing identical source/content must be linked rather than duplicated");
  const before=(await pool.query("SELECT id,source_version_id,original_text,source_location,notes FROM evidence_sections ORDER BY id")).rows;
  const source=await createEvidenceSource(pool,{sourceKey:`${runId}-CFA100-HOGOSHA`,testOnly:true});
  const mapped=mapCandidate(data,emptyDocumentApplicabilityPolicy,emptySectionApplicabilityPolicy);
  const ingest=await ingestEvidenceVersion(pool,{...mapped,sourceId:source.id});
  const contextId=ingest.sectionIds[8];
  await linkEvidenceRequiredContext(pool,{sourceVersionId:ingest.versionId,sectionId:ingest.sectionIds[4],requiredSectionId:contextId,role:"safety_distance"});
  // No production fact table exists. Preserve the old numeric pilot; this
  // isolated typed text-fact sidecar adds no fabricated quantities or grades.
  await pool.query("CREATE TABLE cfa06_text_facts (section_id uuid PRIMARY KEY REFERENCES evidence_sections(id), source_version_id uuid NOT NULL REFERENCES evidence_versions(id), payload jsonb NOT NULL)");
  await pool.query("CREATE TABLE cfa06_editorial_examples (section_id uuid PRIMARY KEY REFERENCES evidence_sections(id), payload jsonb NOT NULL)");
  const bindings=[];
  for(const [index,s] of data.sections.entries()){
    const binding={unitId:s.candidate_section_id,sourceId:source.id,versionId:ingest.versionId,sectionId:ingest.sectionIds[index],
      originalUrl:data.source.pdf_url,originalText:s.original_text,originalSha256:s.original_text_sha256,sourceLocation:location(s),title:s.title,
      publisher:data.source.publisher,sourceTitle:data.source.title,printedPage:s.printed_page,pdfPage:s.pdf_page,
      isMunicipal:false,ageScope:s.age.value,scientificCertainty:null,permission:data.rights,attribution:data.rights.attribution,useLimits:s.use_limits,
      editorial:editorialFor(data,s.candidate_section_id),requiredContextBindings:s.required_context?[{sectionId:contextId,originalText:s.required_context.original_text,sourceLocation:location(s.required_context),originalSha256:s.required_context.original_text_sha256}]:[]};
    binding.fact=makeFact(data,s,binding);bindings.push(binding);
    await pool.query("INSERT INTO cfa06_text_facts VALUES($1,$2,$3)",[binding.sectionId,binding.versionId,binding.fact]);
    await pool.query("INSERT INTO cfa06_editorial_examples VALUES($1,$2)",[binding.sectionId,binding.editorial]);
    const concept=await createEvidenceConcept(pool,{conceptKey:`${runId}-${s.candidate_section_id}`});
    const [term,aliases]=vocabulary[index];assert(s.original_text.includes(term),`${s.candidate_section_id} source keyword`);
    const keyword=await upsertEvidenceKeyword(pool,{id:randomUUID(),conceptId:concept.id,term,language:"ja",active:true,testOnly:true});
    await linkEvidenceSectionKeyword(pool,{sourceVersionId:ingest.versionId,sectionId:binding.sectionId,keywordId:keyword.id});
    for(const term of new Set([...aliases,...s.search_keywords]))await pool.query("INSERT INTO repair05_topic_aliases VALUES($1,$2,$3,$4,$5,$6)",[concept.id,term,"government_guidance",s.candidate_section_id,data.source.pdf_url,location(s)]);
  }
  const savedFacts=new Map((await pool.query("SELECT section_id,payload FROM cfa06_text_facts")).rows.map(r=>[r.section_id,r.payload]));
  const savedEditorial=new Map((await pool.query("SELECT section_id,payload FROM cfa06_editorial_examples")).rows.map(r=>[r.section_id,r.payload]));
  const bind=raw=>{
    const candidate=bindings.find(b=>b.sectionId===raw.sectionId);
    if(!candidate){
      const old=baselineCases.cases.find(c=>c.kind==="unit_regression"&&c.source.sectionId===raw.sectionId)?.source;
      const item=items.find(i=>i.sectionId===raw.sectionId);
      return {...raw,...old,geography:old?.isMunicipal?item?.record?.geography:null};
    }
    assert.equal(raw.originalText,candidate.originalText);assert.equal(raw.sourceId,candidate.sourceId);assert.equal(raw.versionId,candidate.versionId);
    return {...raw,...candidate,fact:savedFacts.get(raw.sectionId),editorial:savedEditorial.get(raw.sectionId),requiredContext:raw.requiredContext};
  };
  const concepts=(await pool.query("SELECT id,concept_key FROM evidence_concepts")).rows;
  const allowed=geo=>concepts.filter(c=>{
    const item=current.find(i=>c.concept_key===`${runId}-${i.unit.id}`);
    return !item?.record?.geography||item.record.inputKind==="practical"||inRegion(item.record.geography,geo);
  }).map(c=>c.id);
  async function retrieve(question,region=null){
    const geo=resolveRegion({question,region});
    const response=await repairedSearch(pool,{question,limit:20},runId,allowed(geo));
    const aliases=(await pool.query("SELECT * FROM repair05_topic_aliases WHERE strpos(lower($1),lower(term))>0",[question])).rows;
    const results=response.results.map(raw=>{
      const bound=bind(raw);
      return {...bound,relevanceScore:aliases.filter(a=>a.unit_id===bound.unitId).reduce((n,a)=>n+a.term.length,0)};
    });
    for(const r of results)if(bindings.some(b=>b.sectionId===r.sectionId))measured.set(r.sectionId,r);
    return {...response,results,geography:geo};
  }
  await independent("mapped-schema","mapping",async row=>{
    assert.equal(ingest.sectionIds.length,9);assert.equal(bindings.length,8);
    const saved=(await pool.query("SELECT * FROM evidence_sections WHERE source_version_id=$1",[ingest.versionId])).rows;
    assert.equal(saved.length,9);assert.equal(saved.filter(s=>s.section_type==="context").length,1);
    for(const old of before)assert.deepEqual((await pool.query("SELECT id,source_version_id,original_text,source_location,notes FROM evidence_sections WHERE id=$1",[old.id])).rows[0],old);
    row.sourceCount=1;row.versionCount=1;row.mainGuidanceCount=8;row.contextOnlyCount=1;row.independentStudyCount=0;row.baselineSectionsByteEqual=true;
    assert.equal(savedFacts.size,8);assert.equal(savedEditorial.size,8);
    for(const b of bindings){
      const fact=savedFacts.get(b.sectionId);assert.equal(fact.text,b.originalText);assert.deepEqual(fact.quantities,[]);
      assert.equal(fact.scientificCertainty,null);assert.equal(fact.versionId,ingest.versionId);
      assert(factHtml(fact).includes(b.originalSha256));
    }
    row.commonFactRendererReused=true;row.factsReadBackFromDatabase=true;
  });
  for(const [index,questions] of probes.entries())for(const [n,question] of questions.entries())await independent(`CFA100-S0${index+1}-${n?"paraphrase":"natural"}`,"source_binding",async row=>{
    const response=await retrieve(question),own=response.results.find(r=>r.sectionId===bindings[index].sectionId);
    row.question=question;row.diagnostics=response.diagnostics??null;row.results=response.results;assert(own,"intended source not retrieved");
    assert(!response.diagnostics?.reason?.endsWith("_limit"));assert(!response.results.some(r=>r.sectionId===contextId));
    row.presentation=renderEvidence({results:response.results,question,diagnostics:response.diagnostics});
    assert.equal(row.presentation.status,"ready");assert.equal(row.presentation.modelOutput,false);assert.equal(row.presentation.clarification,null);
    assert.equal(row.presentation.evidence[0].sectionId,own.sectionId);
    assert.equal((await normalSearch(pool,{question,limit:20})).results.length,0);
  });
  for(const item of current)await independent(`post-${item.unit.id}`,"post_ingest_51_regression",async row=>{
    row.unitId=item.unit.id;row.probes=[];
    const labels=new Set(places.flatMap(p=>[p.prefecture,p.municipality,p.ward]).filter(Boolean));
    for(const question of [item.unit.retrievalTerms.sourceTerms[0],item.unit.retrievalTerms.queryTerms.find(t=>/[\u3040-\u30ff\u3400-\u9fff]/u.test(t)&&!labels.has(t))]){
      const r=await repairedSearch(pool,{question,limit:20},runId);
      const native=await args.nativeSearch(pool,{question,limit:20},runId);
      row.probes.push({question,diagnostics:r.diagnostics??null,found:r.results.some(r=>r.sectionId===item.sectionId),nativeFound:native.results.some(r=>r.sectionId===item.sectionId),nativeDiagnostics:native.diagnostics??null});
      assert(r.results.some(r=>r.sectionId===item.sectionId));assert(native.results.some(r=>r.sectionId===item.sectionId),"old native outcome changed");
      assert.equal((await normalSearch(pool,{question,limit:20})).results.length,0);
    }
  });
  for(const [id,question,status] of [
    ["childcare","子どもを預けられる？","blocked"],["grams","離乳食を何グラム？","blocked"],["diagnosis","相手の顔色から病気を判断して","blocked"],
    ["unsafe","道路で自分でやりたい子を見守りたい","blocked"],["negated-safety","危険ではないと思うので目を離して自分でやらせたい","blocked"],
    ["benign-weekday","火曜日の遊びを大切にしたい","ready"],
  ])await independent(id,"boundary_keyword_policy_not_semantic_proof",async row=>{
    const response=await retrieve(question);row.question=question;row.response=response;
    row.presentation=renderEvidence({...response,question});assert.equal(row.presentation.status,status);
  });
  await independent("missing-required-context","required_context",async row=>{
    const response=await retrieve("すぐ手伝ってしまう");const own=response.results.find(r=>r.sectionId===bindings[4].sectionId);assert(own);
    assert.equal(own.requiredContext.length,1);assert.equal(own.requiredContext[0].sectionId,contextId);
    assert.equal(own.requiredContext[0].sourceLocation,"印刷4ページ / PDF5ページ");
    row.presentation=renderEvidence({results:[{...own,requiredContext:[]}],question:"自分でやりたい"});
    assert.equal(row.presentation.status,"blocked");
    assert.equal(renderEvidence({results:[{...own,requiredContextBindings:[]}]}).status,"blocked");
    assert.equal(renderEvidence({results:[{...own,requiredContext:[{...own.requiredContext[0],originalText:"incorrect"}]}]}).status,"blocked");
  });
  await independent("database-context-link-removal","required_context",async row=>{
    await pool.query("DELETE FROM evidence_section_required_context WHERE source_version_id=$1 AND section_id=$2",[ingest.versionId,bindings[4].sectionId]);
    try {
      const response=await retrieve("すぐ手伝ってしまう");
      const own=response.results.find(r=>r.sectionId===bindings[4].sectionId);assert(own);assert.equal(own.requiredContext.length,0);
      row.presentation=renderEvidence({results:[own],question:"すぐ手伝ってしまう"});assert.equal(row.presentation.status,"blocked");
    }finally{
      await linkEvidenceRequiredContext(pool,{sourceVersionId:ingest.versionId,sectionId:bindings[4].sectionId,requiredSectionId:contextId,role:"safety_distance"});
      await retrieve("すぐ手伝ってしまう");
    }
    row.contextRestored=true;
  });
  for(const reason of ["expansion_limit","candidate_scan_limit","context_limit","context_incomplete"])await independent(`guard-${reason}`,"renderer_guard",async row=>{
    row.presentation=renderEvidence({results:[...measured.values()],diagnostics:{reason}});assert.equal(row.presentation.status,"incomplete");assert.equal(row.presentation.evidence.length,0);
  });
  await independent("general-versus-local","geography",async row=>{
    const response=await retrieve("親子で行けて話せる場所");const own=response.results.find(r=>r.sectionId===bindings[7].sectionId);assert(own);
    assert.equal(renderEvidence({results:[own],question:"親子で行けて話せる場所"}).clarification,null);
    assert(renderEvidence({results:[own],question:"近くの支援拠点を探したい"}).clarification);
    assert.equal(renderEvidence({results:[own],question:"近くの支援拠点",region:{municipality:"横浜市"}}).clarification,null);
    for(const question of ["横浜市で子育て相談をしたい","名古屋市で子育て相談をしたい","中区で子育て相談をしたい"]){
      const local=await retrieve(question);row[question]={geography:local.geography,sections:local.results.map(r=>r.sectionId)};
      for(const r of local.results){const item=items.find(i=>i.sectionId===r.sectionId);if(item?.record?.geography&&item.record.inputKind!=="practical")assert(inRegion(item.record.geography,local.geography));}
    }
  });
  await independent("draft-approval-axes","approval",async row=>{
    const saved=(await pool.query("SELECT s.status,s.current_published_version_id,v.publication_status,v.manual_reviewed,v.reviewer_name,v.age_min_months,v.age_max_months FROM evidence_sources s JOIN evidence_versions v ON v.source_id=s.id WHERE s.id=$1",[source.id])).rows[0];
    assert.equal(saved.status,"draft");assert.equal(saved.publication_status,"draft");assert.equal(saved.manual_reviewed,false);assert.equal(saved.current_published_version_id,null);assert.equal(saved.reviewer_name,null);
    row.saved=saved;row.sourceAudit=data.approval_axes;row.userDirectionNotPublication=true;
  });
  for(const old of baselineCases.cases.filter(c=>c.question&&c.rawResults))await independent(`old-outcome-${old.id}`,"post_ingest_archived_outcome",async row=>{
    row.question=old.question;
    const response=await retrieve(old.question,old.location);
    const candidateIds=new Set(bindings.map(b=>b.sectionId));
    row.before=old.rawResults.map(r=>r.sectionId).sort();
    row.after=response.results.filter(r=>!candidateIds.has(r.sectionId)).map(r=>r.sectionId).sort();
    assert.deepEqual(row.after,row.before);
    if(old.repairedDiagnostics?.reason==="no_vocabulary"&&response.results.some(r=>candidateIds.has(r.sectionId))){
      row.expectedAdditiveChange="New nonmunicipal general guidance is available without validating an invalid local combination; all old/local result identities unchanged.";
      assert(!response.diagnostics?.reason);
    }else assert.equal(response.diagnostics?.reason,old.repairedDiagnostics?.reason);
    const native=await args.nativeSearch(pool,{question:old.question,limit:20},runId);
    assert.equal(native.diagnostics?.reason,old.nativeDiagnostics?.reason);
    assert.equal(native.results.length,old.nativeRawCount);
  });
  const fixture={...baselineFixture,format:"cfa100-06.measured-dictionary.v1"};
  for(const table of Object.keys(fixture.tables))fixture.tables[table]=(await pool.query(`SELECT * FROM ${table}`)).rows;
  fixture.units.push(...bindings.map(b=>({unitId:b.unitId,sourceId:b.sourceId,versionId:b.versionId,sectionId:b.sectionId,originalSha256:b.originalSha256,originalUrl:b.originalUrl,historical:false})));
  fixture.results=[...baselineCases.cases.filter(c=>c.kind==="unit_regression").map(c=>c.source),...measured.values()];
  // Baseline bindings enrich measured old-unit results for source-bound local
  // inspection, never inventing local eligibility or contact fields.
  fixture.baselineResults=cases.filter(c=>c.kind==="post_ingest_51_regression").map(c=>c.unitId);
  const exportBindings={runId,invocationNonce,units:bindings.map(b=>measured.get(b.sectionId)??b),baselineUnits:baselineBindings.units.map(b=>{
    const item=items.find(i=>i.sectionId===b.sectionId),isMunicipal=Boolean(item?.record&&item.record.inputKind!=="practical");
    return {...b,isMunicipal,geography:isMunicipal?item.record.geography:null};
  }),contextOnly:{sectionId:contextId,candidateId:"CFA100-S05-C01"},independentStudyIncrement:0};
  write("dictionary-fixture.json",fixture);
  write("source-bindings.json",exportBindings);
  const offlineSearch=createFixtureSearch({fixture,bindings:exportBindings});
  for(const question of [...probes.flat(),...current.map(i=>i.unit.retrievalTerms.sourceTerms[0]),"横浜市で子育て相談をしたい","名古屋市で子育て相談をしたい","中区で子育て相談をしたい"])await independent(`fixture-${cases.length}`,"offline_fixture_database_parity",async row=>{
    row.question=question;const actual=await retrieve(question),offline=await offlineSearch({question});
    row.database=actual.results.map(r=>r.sectionId);row.offline=offline.results.map(r=>r.sectionId);
    assert.deepEqual(row.offline,row.database);
    assert.equal(offline.diagnostics?.reason,actual.diagnostics?.reason);
  });
  write("schema-mapping.json",{source:"evidence_sources",version:"evidence_versions",originalSections:"evidence_sections: 8 excerpt + 1 context",requiredContext:"evidence_section_required_context",facts:"cfa06_text_facts: isolated typed quoted-text sidecar; shared schema has no fact table and legacy numeric pilot rejects empty quantities",editorial:"cfa06_editorial_examples: separate from original/fact/model/scientific output",auditInputSha256:data.auditInputSha256});
  preservation();
}