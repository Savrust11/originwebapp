import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {root,sha} from "./prepare.mjs";
const sourceRoot=path.join(root,"evidence-work/cfa100-06/source");
export const location=s=>`印刷${s.printed_page}ページ / PDF${s.pdf_page}ページ`;
export function loadCandidate(){
  const raw=fs.readFileSync(path.join(sourceRoot,"audited-input.json"));
  const data=JSON.parse(raw),audit=JSON.parse(fs.readFileSync(path.join(sourceRoot,"source-verification.json")));
  assert.equal(audit.source.hash_match,true);assert.equal(audit.source.landing_pdf_url_match,true);
  assert.equal(sha(fs.readFileSync(path.join(sourceRoot,"original.pdf"))),data.source.sha256);
  assert.equal(data.sections.length,8);assert.equal(new Set(data.sections.map(s=>s.candidate_section_id)).size,8);
  assert.equal(audit.approval_axes.production_publication_approved,false);
  assert.equal(audit.required_context_uniqueness.count,1);
  for(const s of data.sections){
    const verified=audit.units.find(u=>u.candidate_section_id===s.candidate_section_id);assert(verified);
    assert.equal(s.original_text,verified.originalText);assert.equal(sha(s.original_text),verified.contentHash);
    assert.equal(s.original_text_sha256,verified.contentHash);assert.equal(s.pdf_page,s.printed_page+1);
    assert.equal(s.scientific_certainty_grade,null);assert.equal(s.age_min_months,null);assert.equal(s.age_max_months,null);assert.deepEqual(s.diagnosis_conditions,[]);
    if(s.required_context)assert.equal(sha(s.required_context.original_text),audit.required_context_uniqueness.hash);
  }
  return {...data,auditInputSha256:sha(raw),audit};
}
export function mapCandidate(data,emptyDocumentPolicy,emptySectionPolicy){
  const policy=structuredClone(emptyDocumentPolicy);
  policy.usage={mode:"specific",terms:JSON.stringify({evidenceType:"government_practical_guidance",originalVerification:data.approval_axes.original_verification,userImportDirection:true,formalAdoption:"not_approved",publication:"draft",rights:data.rights.basis,pdfSha256:data.source.sha256,ageDescription:data.sections[0].age.value}),exceptions:[]};
  const sections=data.sections.map(s=>({sectionType:"excerpt",heading:s.heading,originalText:s.original_text,sourceLocation:location(s),notes:JSON.stringify({candidateId:s.candidate_section_id,originalSha256:s.original_text_sha256,role:"main_guidance"}),applicabilityPolicy:structuredClone(emptySectionPolicy)}));
  const owner=data.sections.find(s=>s.required_context),context=owner.required_context;
  sections.push({sectionType:"context",heading:"助けられる距離感（必須文脈）",originalText:context.original_text,sourceLocation:location(context),notes:JSON.stringify({candidateId:context.candidate_context_id,role:"required_context_only",originalSha256:context.original_text_sha256}),applicabilityPolicy:structuredClone(emptySectionPolicy)});
  return {version:`audited-${data.source.sha256.slice(0,16)}`,title:data.source.title,publisher:data.source.publisher,authors:[],originalUrl:data.source.pdf_url,externalIdentifier:data.source.candidate_source_id,documentType:"government_practical_guidance",language:"ja",publishedOn:null,revisedOn:null,age:{scope:"unknown",minMonths:null,maxMonths:null},regions:{scope:"unknown",values:[]},conditions:{scope:"unknown",values:[],exceptions:[]},certainty:{level:null,assessmentMethod:null,assessmentSource:null},documentApplicabilityPolicy:policy,testOnly:true,sections};
}
export function editorialFor(data,id){
  const example=data.editorial_examples.find(e=>e.section_id===id);assert(example);
  const sentences=example.text.match(/[^。！？？]+[。！？？]?/gu)??[];
  const question=sentences.at(-1)?.endsWith("？")?sentences.pop():null;
  // Local discovery is an optional next step, not a condition on general guidance.
  const local=sentences.findIndex(s=>s.includes("市区町村を教えて"));
  const localPrompt=local>=0?sentences.splice(local,1)[0]:null;
  return {suggestion:sentences.join(""),clarification:question??localPrompt,label:example.label,isModelOutput:false,clarificationPolicy:localPrompt?"local_discovery_only":"concrete_next_step_only"};
}
export function makeFact(data,s,binding){
  return {id:`${s.candidate_section_id}-text-fact`,kind:"quoted_text",text:s.original_text,
    sourceId:binding.sourceId,versionId:binding.versionId,sectionId:binding.sectionId,unitId:s.candidate_section_id,title:s.title,
    requiredContextSupport:s.required_context?[{originalText:s.required_context.original_text,sourceLocation:location(s.required_context),originalSha256:s.required_context.original_text_sha256}]:[],
    summary:`We育編集固定文：${s.editorial_summary}`,result:s.original_text,quantities:[],
    population:{description:s.age.value,ageBasis:"原文の定性的範囲。数値月齢条件ではない",conditions:[],exclusions:[]},
    limitations:s.use_limits,uncertainty:["個人の原因・診断・効果を保証しない。科学的確実性は未評価。"],
    usageRestrictions:["編集見本であり実AI回答ではありません。未採用・未公開。"],unknowns:["刊行日・正式版番号"],
    authority:{issuer:data.source.publisher,attributedRecommender:data.source.publisher,attributionKind:"公的機関の一般的な実践ガイダンス（独立した研究ではない）"},
    sourceTitle:data.source.title,supports:[{originalId:binding.sectionId,locator:location(s),quote:s.original_text,originalTextSha256:s.original_text_sha256}],
    verification:{textMatch:"verified_exact",adoption:"not_approved",publication:"not_published"},scientificCertainty:null};
}