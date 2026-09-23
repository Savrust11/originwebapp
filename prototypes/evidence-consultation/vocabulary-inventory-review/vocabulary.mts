import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { upsertEvidenceDictionaryTerm, upsertEvidenceKeyword, linkEvidenceSectionKeyword } from "../../../server/evidence/catalog.ts";
import { createConnection } from "../retrieval-fact-connection/connection.mts";

// Source concepts and keyword-to-original bindings stay unchanged. These are
// lexical aliases, never questions, case identifiers, or applicability facts.
export const aliases=[
  {concept:"child-sleep-duration",terms:["ねんね","眠る時間"]},
  {concept:"complementary-feeding-start",terms:["補完食"]},
  {concept:"feeding-choice",terms:["粉ミルク"]},
  {concept:"parent-child-interactions",terms:["親子のやりとり","親子の関わり"]},
  {concept:"screen-use-and-sleep",terms:["画面を見る時間"]},
];
// Fixed lexical compound exceptions. The remaining query is still searched:
// "ねんねアートと睡眠時間" retains 睡眠時間. No subject facts are inferred.
export const compoundExceptions=["ねんねアート","ねんねグッズ"];
export function lexicalQuery(question:string){
  let query=question.normalize("NFKC");
  const excluded:string[]=[];
  for(const term of compoundExceptions)if(query.includes(term)){
    excluded.push(term);query=query.replaceAll(term,"□".repeat(term.length));
  }
  return{query,excluded};
}
export async function createVocabularyConnection(pool:any,initialized:any){
  assert.equal((await pool.query("SELECT evidence_is_ephemeral_test_context() AS owned")).rows[0].owned,true);
  const base=await createConnection(pool,initialized);
  let installed=false;
  async function installAliases(){
    assert(!installed,"aliases installed only once per owned run");
    for(const spec of aliases){
      const rows=(await pool.query("SELECT id FROM evidence_concepts WHERE right(concept_key,length($1))=$1",[`-${spec.concept}`])).rows;
      assert.equal(rows.length,1,`one existing concept: ${spec.concept}`);
      for(const term of spec.terms)await upsertEvidenceDictionaryTerm(pool,{
        id:randomUUID(),conceptId:rows[0].id,term,language:"ja",testOnly:true,
      });
    }
    installed=true;
  }
  async function repairComplementaryKeyword(){
    assert.equal((await pool.query("SELECT evidence_is_ephemeral_test_context() AS owned")).rows[0].owned,true);
    const unit=initialized.byUnit.get("E01-S03");
    assert(unit&&unit.sourceId==="E01"&&unit.fragmentId==="E01-F-S03");
    const fragment=initialized.byFragment.get(unit.fragmentId);
    const term="離乳の開始";
    assert(fragment.originalText.includes(term),"repair keyword must occur in unchanged original");
    assert.equal(createHash("sha256").update(fragment.originalText).digest("hex"),fragment.textSha256);
    const concepts=(await pool.query("SELECT id FROM evidence_concepts WHERE right(concept_key,length($1))=$1",["-complementary-feeding-start"])).rows;
    assert.equal(concepts.length,1);
    assert.equal((await pool.query("SELECT id FROM evidence_keywords WHERE language='ja' AND term=$1",[term])).rows.length,0,
      "do not reassign an existing keyword");
    const keyword=await upsertEvidenceKeyword(pool,{id:randomUUID(),conceptId:concepts[0].id,term,language:"ja",active:true,testOnly:true});
    await linkEvidenceSectionKeyword(pool,{sourceVersionId:unit.versionDbId,sectionId:unit.sectionDbId,keywordId:keyword.id});
    return{sourceId:"E01",unitId:unit.id,fragmentId:unit.fragmentId,originalSha256:fragment.textSha256,
      term,concept:"complementary-feeding-start",temporaryOnly:true,originalModified:false,
      reason:"shared 離乳 keyword was reassigned to the later weaning concept by the existing global-keyword upsert; add a unique exact original phrase rather than changing source or eligibility"};
  }
  async function search(payload:any){
    const lexical=lexicalQuery(payload.input.question);
    const result=await base.search({...payload,input:{...payload.input,question:lexical.query}});
    return{...result,lexicalDiagnostics:{excludedCompounds:lexical.excluded,queryChanged:lexical.query!==payload.input.question,
      aliasesInstalled:installed,subjectFactsInferred:false}};
  }
  return{...base,search,searchOriginal:base.search,installAliases,repairComplementaryKeyword};
}