export const LABEL="We育編集見本（実AI回答ではありません）";
const limits=["expansion_limit","candidate_scan_limit","context_limit","context_incomplete"];
export function renderEvidence({results=[],diagnostics=null,question="",region=null}={}){
  const base={status:"no_match",label:LABEL,suggestion:"この資料で説明できる内容が見つかりませんでした。",clarification:null,evidence:[],localEvidence:[],limitations:[],modelOutput:false};
  if(limits.includes(diagnostics?.reason))return {...base,status:"incomplete",suggestion:"検索を完了できませんでした。結果を省略して回答することはありません。",limitations:[diagnostics.reason]};
  const boundary=[
    [/(何グラム|何g|何ml|何ミリ)/u,"食事の具体的な数量"],
    [/(診断|病気を判断|顔色から病気)/u,"病気や診断の判断"],
    [/(預けられ|預かって|預かり可)/u,"子どもの預かりの可否"],
  ].find(([pattern])=>pattern.test(question));
  if(boundary)return {...base,status:"blocked",suggestion:`この一般ガイダンスだけでは、${boundary[1]}は判断できません。`,limitations:["資料の範囲外。別の適切な根拠や、既存の現行地域情報が必要です。"]};
  if(/(危険|道路|車道|火遊び|火のそば|火を使|高い所|高所|溺|目を離|放置)/u.test(question))return {...base,status:"blocked",suggestion:"安全を確かめられない場面で、見守ることを理由に放置する提案はできません。",limitations:["安全を確保できるか不明なため、一般的な挑戦の助言は表示しません。"]};
  const candidates=results.filter(r=>r.fact?.kind==="quoted_text").sort((a,b)=>(b.relevanceScore??0)-(a.relevanceScore??0));
  if(!candidates.length)return base;
  const result=candidates[0],fact=result.fact;
  if(fact.sourceId!==result.sourceId||fact.versionId!==result.versionId||fact.sectionId!==result.sectionId||fact.text!==result.originalText)return {...base,status:"blocked",suggestion:"本文と事実データの対応を確認できないため、編集見本を表示できません。"};
  for(const required of fact.requiredContextSupport??[]){
    if(!(result.requiredContextBindings??[]).some(b=>b.originalText===required.originalText&&b.originalSha256===required.originalSha256&&b.sourceLocation===required.sourceLocation))return {...base,status:"blocked",suggestion:"必須文脈と事実データの対応を確認できないため、この提案は表示できません。"};
  }
  for(const expected of result.requiredContextBindings??[]){
    const context=result.requiredContext?.find(c=>c.sectionId===expected.sectionId);
    if(!context||context.originalText!==expected.originalText||context.sourceLocation!==expected.sourceLocation||context.citation?.versionId!==result.versionId)return {...base,status:"blocked",suggestion:"必須の安全文脈を確認できないため、この提案は表示できません。",limitations:["required_context_missing_or_mismatched"]};
  }
  if(typeof result.editorial?.suggestion!=="string")return {...base,status:"blocked",suggestion:"出典に対応する編集見本が未準備です。"};
  const wantsLocal=/(近く|近所|施設|場所を探|どこに|所在地|受付|料金|空き)/u.test(question);
  const wantsSpecific=/(具体的|どうすれば|どうしたら|次に何|方法を教)/u.test(question);
  const clarification=result.editorial.clarificationPolicy==="local_discovery_only"
    ?wantsLocal&&!region?.municipality?result.editorial.clarification:null
    :wantsSpecific?result.editorial.clarification:null;
  return {...base,status:"ready",suggestion:result.editorial.suggestion,
    clarification,evidence:[result],
    localEvidence:wantsLocal?results.filter(r=>r.isMunicipal&&r.sourceFields):[],
    limitations:result.useLimits??[]};
}