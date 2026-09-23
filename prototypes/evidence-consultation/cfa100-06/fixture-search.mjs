import {resolveRegion,inRegion} from "../search-repair-05/geography.mjs";
const matches=(term,language,text)=>{
  const value=text.toLocaleLowerCase(),needle=term.toLocaleLowerCase();
  return language==="ja"?value.includes(needle):` ${value.replace(/[^\p{L}\p{N}_]+/gu," ")} `.includes(` ${needle} `);
};
const inOriginal=(term,language,text)=>language==="ja"?matches(term,language,text):
  term.toLocaleLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean).every(t=>text.toLocaleLowerCase().split(/[^\p{L}\p{N}_]+/u).includes(t));
// Offline evidence retrieval from exported real DB vocabulary and source links.
// Not a replay of known questions, not a model, not a live database connection.
export function createFixtureSearch({fixture,bindings}){
  if(!fixture?.runId||fixture.runId!==bindings?.runId||fixture.invocationNonce!==bindings.invocationNonce)throw Error("Measured fixture/source run mismatch");
  const tables=fixture.tables,keywords=tables.evidence_keywords.filter(k=>k.active),dictionary=tables.evidence_dictionary_terms;
  const units=new Map([...bindings.baselineUnits,...bindings.units].map(r=>[r.sectionId,r]));
  const records=new Map(fixture.results.map(r=>[r.sectionId,{...r,...units.get(r.sectionId)}]));
  const geoLabels=new Set(tables.repair05_geo_labels.map(r=>r.label.toLocaleLowerCase()));
  const conceptUnit=new Map(tables.evidence_concepts.map(c=>[c.id,fixture.units.find(u=>c.concept_key===`${fixture.runId}-${u.unitId}`)]));
  return async ({question,region=null,geography=null,signal}={})=>{
    if(signal?.aborted)throw Error("検索は取り消されました");
    if(typeof question!=="string"||!question.trim())throw Error("相談文を入力してください");
    const geo=geography??resolveRegion({question,region});
    const allowed=id=>{
      const unit=conceptUnit.get(id),binding=unit?units.get(unit.sectionId):null;
      return !binding?.isMunicipal||inRegion(binding.geography,geo);
    };
    const topicHits=tables.repair05_topic_aliases.filter(t=>allowed(t.concept_id)&&matches(t.term,"ja",question));
    const vocabularyHits=[...keywords,...dictionary].filter(t=>!geoLabels.has(t.term.toLocaleLowerCase())&&allowed(t.concept_id)&&matches(t.term,t.language,question));
    const concepts=new Set([...vocabularyHits,...topicHits].map(t=>t.concept_id));
    const keywordIds=new Set(vocabularyHits.filter(t=>keywords.some(k=>k.id===t.id)).map(t=>t.id));
    const terms=[...keywords.filter(k=>keywordIds.has(k.id)||concepts.has(k.concept_id)).map(k=>({...k,identity:`k:${k.id}`,keywordId:k.id})),
      ...dictionary.filter(d=>concepts.has(d.concept_id)&&matches(d.term,d.language,question)).map(d=>({...d,identity:`d:${d.id}`,keywordId:null}))];
    const diagnostics={engine:"offline_measured_dictionary",expansionCount:terms.length,cap:64};
    if(terms.length>64)return {results:[],diagnostics:{...diagnostics,reason:"expansion_limit"}};
    if(!terms.length)return {results:[],diagnostics:{...diagnostics,reason:"no_vocabulary"}};
    const ranked=[];
    for(const unit of fixture.units.filter(u=>!u.historical)){
      const record=records.get(unit.sectionId);if(!record)throw Error("Measured source result missing from fixture");
      if(record.isMunicipal&&!inRegion(record.geography,geo))continue;
      const links=tables.evidence_section_keywords.filter(l=>l.section_id===unit.sectionId);
      const linked=links.map(l=>keywords.find(k=>k.id===l.keyword_id)).filter(Boolean);
      const hits=terms.filter(t=>linked.some(k=>k.id===t.keywordId||k.concept_id===t.concept_id)&&inOriginal(t.term,t.language,`${record.section?.heading??""} ${record.originalText}`));
      if(hits.length){
        const aliases=topicHits.filter(t=>linked.some(k=>k.concept_id===t.concept_id));
        ranked.push({...record,matchCount:hits.length,relevanceScore:aliases.reduce((n,t)=>n+t.term.length,0)});
      }
    }
    if(ranked.length>=2000)return {results:[],diagnostics:{...diagnostics,reason:"candidate_scan_limit"}};
    ranked.sort((a,b)=>b.matchCount-a.matchCount||a.sourceId.localeCompare(b.sourceId)||a.versionId.localeCompare(b.versionId)||a.sectionId.localeCompare(b.sectionId));
    if(ranked.some(r=>(r.requiredContext??[]).length>16))return {results:[],diagnostics:{...diagnostics,reason:"context_limit"}};
    return {results:ranked.slice(0,20),diagnostics};
  };
}