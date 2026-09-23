import {createHash,randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {createVocabularyConnection} from "../vocabulary-inventory-review/vocabulary.mts";
import {topics} from "../candidate-relevance-gate/gate.mts";
export {topics};
const bound=(p:any)=>createHash("sha256").update(JSON.stringify(p.input)).digest("hex");
export async function createMaterialGate(pool:any,initialized:any){
  const vocabulary=await createVocabularyConnection(pool,initialized);
  await vocabulary.installAliases();
  const repair=await vocabulary.repairComplementaryKeyword();
  const sessions=new Map<string,{binding:string,offered:string[],selected?:string}>();
  async function search(p:any){
    const binding=bound(p);
    let session=p.token?sessions.get(p.token):undefined;
    const stale=!!p.token&&(!session||session.binding!==binding);
    if(stale)session=undefined;
    if(p.action==="reject"||p.action==="rephrase"){
      if(p.token)sessions.delete(p.token);
      return{state:p.action==="reject"?"not_applicable":"rephrase",groups:[],candidates:[],choices:[],token:null,selectedTopic:null};
    }
    // The old gate's candidate projection is reused; no facts or arithmetic.
    const raw=await vocabulary.search({...p,candidateOnly:true,compare:false});
    if(raw.state==="incomplete")return{state:"input_required",groups:[],candidates:[],choices:[],token:null,selectedTopic:null,
      diagnostics:raw.groups.flatMap((g:any)=>g.diagnostics)};
    const candidates=raw.groups.flatMap((g:any)=>g.items.map((i:any)=>({
      unitId:i.unitId,title:i.title,topicId:topics.find(t=>t.units.includes(i.unitId))?.id??null
    })));
    const offered=[...new Set(candidates.map((c:any)=>c.topicId).filter(Boolean))] as string[];
    let selected=session?.selected;
    if(p.action==="compare"){
      assert(session&&!stale&&session.selected==="sleep","比較する資料を選び直してください。");
      assert(!p.upfrontTopic||p.upfrontTopic==="sleep","比較する資料が変更されています。");
      assert(typeof p.compareGroupId==="string"&&raw.groups.some((g:any)=>g.id===p.compareGroupId),"比較する対象を選んでください。");
    }else if(p.upfrontTopic){
      assert(topics.some(t=>t.id===p.upfrontTopic),"資料の選択を確認してください。");selected=p.upfrontTopic;
    }else if(p.action==="select"){
      assert(session&&!stale&&session.offered.includes(p.topic),"候補を検索し直してください。");
      selected=p.topic;
    }
    const token=session?p.token:randomUUID();
    sessions.set(token,{binding,offered,selected});
    if(!selected)return{state:candidates.length?"choose_material":"no_candidates",groups:[],candidates,
      choices:topics.filter(t=>offered.includes(t.id)).map(({id,label})=>({id,label})),token,selectedTopic:null,staleSelection:stale};
    const topic=topics.find(t=>t.id===selected)!;
    const compare=p.action==="compare"&&selected==="sleep";
    const result=await vocabulary.search({...p,candidateOnly:false,compare,allowedUnitIds:topic.units,input:{...p.input,question:topic.query}});
    const groups=result.groups.map((g:any)=>({...g,items:g.items.filter((i:any)=>topic.units.includes(i.unitId)),
      sleepResult:compare&&p.compareGroupId===g.id?g.sleepResult:null,
      comparisonInputs:compare&&p.compareGroupId===g.id&&g.hasSleep?{ageMonths:g.ageMonths,...(p.sleep?.[g.id]??{})}:null}));
    return{...result,groups,state:"materials_displayed",candidates,choices:[],token,selectedTopic:selected,
      comparisonRequested:compare,answerAdequacy:"not_assessed",staleSelection:stale,
      materialNotice:(selected==="sleep"?"睡眠":topic.label)+"についての資料を表示しています。元の質問への回答が成立したという意味ではありません。"};
  }
  return{search,repair,normalControl:vocabulary.normalControl,getSqlCalls:vocabulary.getSqlCalls};
}