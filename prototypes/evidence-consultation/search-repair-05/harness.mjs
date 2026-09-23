import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadInputs } from "../parenting-expansion-04/input.mjs";
import { expansionItems } from "../parenting-expansion-04/harness.mjs";
import { resolveRegion, inRegion, regionKey, places } from "./geography.mjs";
import { topicAliases, serviceTopic } from "./topics.mjs";
import { createController } from "./controller.mjs";
import { root, output, sha, preservation } from "./prepare.mjs";

export function getInputs() {
  // Frozen loader's nonce refers to its own obsolete authorization. Validate the
  // new nonce separately; never overwrite that historical authorization.
  const nonce = process.env.PARENTING_EXPANSION_NONCE;
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,"authorization.json"))).nonce,nonce);
  delete process.env.PARENTING_EXPANSION_NONCE;
  let input;
  try { input=loadInputs(); } finally { process.env.PARENTING_EXPANSION_NONCE=nonce; }
  preservation();
  return { input,items:expansionItems(input) };
}
const write = (name,value) => fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+"\n");
const isMunicipal = item => Boolean(item.record && item.record.inputKind !== "practical");
export async function runCases({pool,runId,invocationNonce,items,input,nativeSearch,repairedSearch,normalSearch,expansionTrace}) {
  const current=items.filter(i=>!i.isHistorical), cases=[], traces=[];
  const bySection=new Map(items.map(i=>[i.sectionId,i]));
  const concepts=(await pool.query("SELECT id,concept_key FROM evidence_concepts")).rows;
  const conceptFor=item=>concepts.find(c=>c.concept_key===`${runId}-${item.unit.id}`)?.id;
  // Pool queries can use different connections: owned permanent test tables are
  // removed with this disposable cluster, never created in an existing DB.
  await pool.query("CREATE TABLE repair05_topic_aliases (concept_id uuid NOT NULL,term text NOT NULL,topic text NOT NULL,unit_id text NOT NULL,source_url text NOT NULL,source_section text NOT NULL,PRIMARY KEY(concept_id,term))");
  await pool.query("CREATE TABLE repair05_geo_labels (label text PRIMARY KEY)");
  for(const label of new Set(places.flatMap(p=>[p.prefecture,p.municipality,p.ward]).filter(Boolean))) await pool.query("INSERT INTO repair05_geo_labels VALUES ($1)",[label]);
  const services=["03","04"].flatMap(n=>JSON.parse(fs.readFileSync(path.join(root,`evidence-work/parenting-expansion-${n}/municipal/services.json`))).records);
  for(const item of current.filter(isMunicipal)) {
    const service=services.find(s=>s.id===item.unit.id);if(!service)continue;
    const topic=serviceTopic(service);if(!topic)continue;
    for(const term of topicAliases[topic]) await pool.query("INSERT INTO repair05_topic_aliases VALUES($1,$2,$3,$4,$5,$6)",[conceptFor(item),term,topic,item.unit.id,service.officialUrl,service.fields.support.sourceSection]);
  }
  const binding = result => {
    const item=bySection.get(result.sectionId); assert(item,"unexpected section outside corpus");
    const service=services.find(s=>s.id===item.unit.id);
    assert.equal(result.sourceId,item.sourceId); assert.equal(result.versionId,item.versionId);
    assert.equal(result.originalUrl,item.document.url); assert.equal(sha(result.originalText),item.unit.originalSha256);
    assert.equal(result.source.testOnly,true); assert.equal(result.source.review.manualReviewed,false);
    return { ...result, unitId:item.unit.id, isMunicipal:isMunicipal(item),
      summaryJa:item.unit.summaryJa, sourceLocation:item.unit.sourceLocation,
      checkedOn:item.record?.checkedOn ?? item.document.checkedOn ?? null,
      ageScope:service?.fields.age?.value ?? service?.fields.eligibility?.value ?? item.record?.ageScope ?? item.record?.targetDescription ?? item.document.ageDescription ?? item.unit.targetDescription ?? "unknown",
      sourceUpdatedOn:service?.sourceUpdatedOn ?? item.document.updatedOn ?? null,
      sourceFields:service?.fields ?? null,
      permission:item.record?.permission ?? item.document.usageTerms,
      attribution:item.record?.attribution ?? null,
      adaptationLabel:"We育編集の日本語要約・翻案（未採用）",
      publicAttribution:item.document.id.startsWith("nhs-") ? "We育編集の翻案。NHSによる日本語助言・監修・推奨ではありません。OGL条件を要確認。" : null,
      auditProvenance:{publisher:item.document.publisher,originalUrl:item.document.url,sourceId:item.sourceId,versionId:item.versionId,sectionId:item.sectionId},
      factReady:false };
  };
  async function independent(id,kind,fn,context={}) {
    const row={id,kind,status:"not_run",...context}; cases.push(row);
    try { await fn(row); row.status="pass"; } catch(e) { row.status="fail"; row.error=String(e.message); }
    write("cases.json",{runId,invocationNonce,counts:{pass:cases.filter(c=>c.status==="pass").length,fail:cases.filter(c=>c.status==="fail").length,not_run:cases.filter(c=>c.status==="not_run").length},cases});
  }
  async function retrieve(query,row) {
    const geography=resolveRegion({question:query.question,region:query.location??null});
    const original=await nativeSearch(pool,{question:query.question,limit:20},runId);
    const trace=await expansionTrace(pool,query.question);
    const allowedConcepts=current.filter(item=>!isMunicipal(item)||inRegion(item.record.geography,geography)).map(conceptFor);
    const topicTrace=await expansionTrace(pool,query.question,allowedConcepts);
    traces.push({id:query.id,original:trace,topic:topicTrace,geography});
    const raw=await repairedSearch(pool,{question:query.question,limit:20},runId,allowedConcepts);
    const ordinary=await normalSearch(pool,{question:query.question,limit:20});
    row.originalQuestion=query.question; row.question=query.question; row.location=query.location??null;
    row.geography=geography; row.nativeDiagnostics=original.diagnostics??null;
    row.nativeRawCount=original.results.length; row.nativeExpansionCount=trace.nativeCount;
    row.repairedExpansionCount=topicTrace.repairedCount; row.repairedDiagnostics=raw.diagnostics??null;
    row.rawResults=raw.results.map(binding);
    row.results=row.rawResults.filter(result=>{
      const item=bySection.get(result.sectionId);
      if(isMunicipal(item) && !inRegion(item.record.geography,geography)) return false;
      const scope=item.record?.scope;
      if(query.scope && scope) return scope.population.includes(query.scope.population) && scope.supports.includes(query.scope.support) && !scope.doesNotSupport.includes(query.scope.support);
      return true;
    });
    row.scopedRecordIds=row.results.map(r=>r.unitId);
    row.ordinarySearchCount=ordinary.results.length;
    assert.equal(ordinary.results.length,0);
    assert.notEqual(raw.diagnostics?.reason,"expansion_limit","repaired query exceeds unchanged expansion cap");
    assert(!raw.results.some(r=>bySection.get(r.sectionId).isHistorical),"historical section leaked");
    for(const id of query.expectedIds??[]) assert(row.scopedRecordIds.includes(id),`missing ${id}`);
    for(const id of query.excludedIds??[]) assert(!row.scopedRecordIds.includes(id),`excluded ${id}`);
    // A modified-scope negative now proves exclusion at structured selection;
    // raw lexical witnessing is additionally retained, never fabricated.
    row.excludedRawWitnesses=row.rawResults.filter(r=>query.excludedIds?.includes(r.unitId)).map(r=>r.unitId);
    row.expectedIdsUsedForRetrieval=false;
  }
  await independent("corpus-complete","corpus",async row=>{
    assert.equal(current.length,51);assert.equal(items.filter(i=>i.isHistorical).length,1);
    const saved=await pool.query("SELECT count(*)::integer AS n FROM evidence_sections WHERE id = ANY($1::uuid[])",[items.map(i=>i.sectionId)]);
    assert.equal(saved.rows[0].n,52);row.current=51;row.historicalRetained=1;
  });
  // Capture the actual DB dictionaries and links, not an offline prediction.
  const fixture={runId,invocationNonce,reproduce:"env -i PATH=\"$PATH\" LANG=C.UTF-8 node prototypes/evidence-consultation/search-repair-05/safe-entry.mjs --authorize-repair05-owned-validation",tables:{}};
  for(const table of ["evidence_concepts","evidence_keywords","evidence_dictionary_terms","evidence_section_keywords","repair05_topic_aliases","repair05_geo_labels"]) fixture.tables[table]=(await pool.query(`SELECT * FROM ${table}`)).rows;
  fixture.units=items.map(i=>({unitId:i.unit.id,sourceId:i.sourceId,versionId:i.versionId,sectionId:i.sectionId,originalSha256:i.unit.originalSha256,originalUrl:i.document.url,sourceTerms:i.unit.retrievalTerms?.sourceTerms,queryTerms:i.unit.retrievalTerms?.queryTerms,historical:i.isHistorical}));
  write("dictionary-fixture.json",fixture);
  for(const item of current) {
    await independent(`unit-${item.unit.id}`,"unit_regression",async row=>{
      const nativeTerm=item.unit.retrievalTerms.sourceTerms[0];
      const geoLabels=new Set(places.flatMap(p=>[p.prefecture,p.municipality,p.ward]).filter(Boolean));
      const originalAlias=item.unit.retrievalTerms.queryTerms.find(t=>/[\u3040-\u30ff\u3400-\u9fff]/u.test(t));
      const alias=item.unit.retrievalTerms.queryTerms.find(t=>/[\u3040-\u30ff\u3400-\u9fff]/u.test(t) && !geoLabels.has(t));
      assert(alias);
      row.unitId=item.unit.id;row.prior35=!item.record?.inputKind;
      const originalResponse=await nativeSearch(pool,{question:originalAlias,limit:20},runId);
      row.originalAlias={question:originalAlias,found:originalResponse.results.some(r=>r.sectionId===item.sectionId),diagnostics:originalResponse.diagnostics??null,
        modifiedScope:geoLabels.has(originalAlias)?"pure geography now structured input; topic alias tested separately":"unchanged"};
      assert(row.originalAlias.found,`${item.unit.id}: native original alias regression`);
      row.probes=[];
      for(const question of [nativeTerm,alias]) {
        const response=await repairedSearch(pool,{question,limit:20},runId);
        const native=await nativeSearch(pool,{question,limit:20},runId);
        const normal=await normalSearch(pool,{question,limit:20});
        const own=response.results.find(r=>r.sectionId===item.sectionId);
        row.probes.push({question,nativeDiagnostic:native.diagnostics??null,repairedDiagnostic:response.diagnostics??null,found:Boolean(own)});
        assert(own,`${item.unit.id} missing for ${question}`);assert.equal(normal.results.length,0);
        row.source=binding(own);
        assert(!response.results.some(r=>bySection.get(r.sectionId).isHistorical));
      }
    });
  }
  const archive=JSON.parse(fs.readFileSync(path.join(root,"evidence-work/parenting-expansion-04/municipal/archived-regression-cases.json"))).records;
  for(const query of [...input.prior.queries,...input.queries,...archive]) {
    await independent(query.id,query.kind,row=>retrieve(query,row),{expectedIds:query.expectedIds,excludedIds:query.excludedIds,scope:query.scope});
  }
  for(const [id,question,location] of [
    ["bare-naka","中区で育児に疲れました。子どもを少し預けたいです。",null],
    ["unknown-municipality","札幌市で育児に疲れました。子どもを少し預けたいです。",{prefecture:"北海道",municipality:"札幌市"}],
    ["yokohama-naka","横浜市中区に住んでいます。産後の家事を手伝ってほしいです。",{prefecture:"神奈川県",municipality:"横浜市",ward:"中区"}],
    ["nagoya-naka","名古屋市中区に住んでいます。産後の家事を手伝ってほしいです。",{prefecture:"愛知県",municipality:"名古屋市",ward:"中区"}],
  ]) await independent(id,"structured_geography",async row=>{
    await retrieve({id,question,location},row);
    if(id==="bare-naka") {assert.equal(row.geography.status,"ambiguous");assert(row.results.every(r=>!r.isMunicipal));}
    if(id==="unknown-municipality") {assert.equal(row.geography.status,"not_collected");assert(row.results.every(r=>!r.isMunicipal));}
    row.statusLabel=row.geography.status;
  });
  await independent("distinct-naka-keys","structured_geography",async row=>{
    row.keys=[regionKey({prefecture:"神奈川県",municipality:"横浜市",ward:"中区"}),regionKey({prefecture:"愛知県",municipality:"名古屋市",ward:"中区"})]; assert.notEqual(...row.keys);
  });
  for(const [id,region] of [
    ["wrong-prefecture",{prefecture:"東京都",municipality:"横浜市",ward:"中区"}],
    ["wrong-parent-ward",{prefecture:"神奈川県",municipality:"横浜市",ward:"熱田区"}],
  ]) await independent(id,"structured_geography",async row=>{
    await retrieve({id,question:"家事と育児がつらい。相談したいです。",location:region},row);
    assert.equal(row.geography.status,"invalid_region");assert(row.results.every(r=>!r.isMunicipal));
  });
  await independent("explicit-region-authoritative","structured_geography",async row=>{
    await retrieve({id:"explicit-region-authoritative",question:"横浜市の子育て相談を教えてください。",location:{prefecture:"愛知県",municipality:"名古屋市",ward:"中区"}},row);
    assert.equal(row.geography.region.municipality,"名古屋市");assert.equal(row.geography.conflictingMention,true);assert(row.geography.notice);
    assert(row.results.filter(r=>r.isMunicipal).every(r=>bySection.get(r.sectionId).record.geography.municipality==="名古屋市"));
  });
  for(const reason of ["expansion_limit","candidate_scan_limit","context_limit"]) await independent(`controller-${reason}`,"controller",async row=>{
    const controller=createController({resolveRegion,search:async()=>({results:[],diagnostics:{reason}})});
    controller.setInput({question:"育児の相談がしたいです。"});await controller.submit();assert.equal(controller.getState().status,"incomplete");
    controller.setInput({question:"別の相談です。"});assert.equal(controller.getState().geography,null);assert.equal(controller.getState().diagnostics,null);
    row.diagnostic=reason;row.explicitIncomplete=true;controller.dispose();
  });
  await independent("controller-stale-guards","controller",async row=>{
    const pending=[];const controller=createController({resolveRegion,search:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
    controller.setInput({question:"中区で相談したいです。"});const a=controller.submit();
    assert.equal(controller.getState().clarification,"中区はどちらの市ですか？");
    controller.setInput({question:"別の質問です。",region:{prefecture:"愛知県",municipality:"名古屋市",ward:"中区"}});
    assert.equal(controller.getState().results.length,0);const b=controller.submit();
    pending[1].resolve({results:[]});await b;pending[0].resolve({results:[{isMunicipal:true,contact:"must never appear"}]});assert((await a).stale);
    assert.equal(controller.getState().question,"別の質問です。");assert.equal(controller.getState().results.length,0);
    const c=controller.submit();controller.setInput({region:{prefecture:"神奈川県",municipality:"横浜市",ward:"中区"}});
    pending[2].reject(Error("obsolete failure"));assert((await c).stale);assert.equal(controller.getState().status,"idle");
    row.questionAndRegionInvalidation=true;row.staleSuccessAndErrorBlocked=true;controller.dispose();
  });
  await independent("native-overflow-preserved","guard",async row=>{
    const failed=traces.find(t=>t.original.nativeCount>64);assert(failed,"real baseline overflow must be reproduced");
    const response=await nativeSearch(pool,{question:failed.original.question,limit:20},runId);
    assert.equal(response.diagnostics.reason,"expansion_limit");assert.equal(response.results.length,0);
    row.originalQuestion=failed.original.question;row.nativeCount=failed.original.nativeCount;row.cap=64;
  });
  await independent("repaired-overflow-preserved","guard",async row=>{
    // Deliberately synthetic boundary fixture, rolled back before rights/count
    // checks. Not a production path, not source material, never displayed.
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const concept=(await client.query("INSERT INTO evidence_concepts(id,concept_key) VALUES(gen_random_uuid(),$1) RETURNING id",[`${runId}-synthetic-guard-only`])).rows[0].id;
      await client.query(`INSERT INTO evidence_keywords(id,concept_id,term,language,active,test_only)
        SELECT gen_random_uuid(),$1,'syntheticguardword '||i::text,'en',true,true FROM generate_series(1,65) AS i`,[concept]);
      const question="syntheticguardword 1";
      const measured=await expansionTrace(client,question,[concept]);
      const response=await repairedSearch(client,{question,limit:20},runId,[concept]);
      assert.equal(measured.repairedCount,65);assert.equal(response.diagnostics.reason,"expansion_limit");assert.equal(response.results.length,0);
      row.syntheticBoundaryFixture=true;row.expansionCount=65;row.cap=64;row.diagnostics=response.diagnostics;
    } finally {await client.query("ROLLBACK");client.release();}
    row.fixtureRolledBack=true;
  });
  await independent("draft-rights-state","rights",async row=>{
    const state=(await pool.query(`SELECT s.status,s.test_only,s.current_published_version_id,v.publication_status,v.test_only AS version_test_only,v.manual_reviewed,v.reviewer_name,v.reviewed_at,v.adoption_reason FROM evidence_sources s JOIN evidence_versions v ON v.source_id=s.id WHERE s.source_key LIKE ($1||'-%')`,[runId])).rows;
    for(const r of state) {assert.equal(r.status,"draft");assert.equal(r.publication_status,"draft");assert(r.test_only&&r.version_test_only);assert.equal(r.manual_reviewed,false);for(const k of ["current_published_version_id","reviewer_name","reviewed_at","adoption_reason"])assert.equal(r[k],null);}
    row.versions=state.length;row.factReadyUnits=0;row.permissionsChanged=false;
  });
  write("expansion-traces.json",{runId,invocationNonce,traces});
  write("source-bindings.json",{runId,invocationNonce,units:current.map(i=>{
    const service=services.find(s=>s.id===i.unit.id);
    return {unitId:i.unit.id,sourceId:i.sourceId,versionId:i.versionId,sectionId:i.sectionId,originalUrl:i.document.url,sourceLocation:i.unit.sourceLocation,originalSha256:i.unit.originalSha256,
      ageScope:service?.fields.age?.value??service?.fields.eligibility?.value??i.record?.ageScope??i.record?.targetDescription??i.document.ageDescription??i.unit.targetDescription,
      sourceUpdatedOn:service?.sourceUpdatedOn??i.document.updatedOn??null,sourceFields:service?.fields??null,
      permission:i.record?.permission??i.document.usageTerms,attribution:i.record?.attribution??null};
  })});
  preservation();
}