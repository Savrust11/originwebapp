import {createHash,randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {createVocabularyConnection} from "../vocabulary-inventory-review/vocabulary.mts";
export const topics=[
  {id:"sleep",label:"睡眠時間",query:"睡眠時間",units:["E02-S01","E02-S02","E02-S03"]},
  {id:"screen",label:"画面の視聴に関する研究",query:"screen use",units:["E04-S01","E04-S02"]},
  {id:"mood",label:"育児支援と保護者の気分に関する研究",query:"depressive symptoms",units:["E03-S02"]},
  {id:"interaction",label:"親子の関わりに関する研究",query:"育児支援",units:["E03-S01"]},
  {id:"feeding-start",label:"離乳食を始める時期",query:"補完食",units:["E01-S03"]},
  {id:"feeding-choice",label:"授乳方法の選択",query:"ミルク",units:["E01-S01"]},
  {id:"feeding-end",label:"離乳の完了と授乳",query:"授乳",units:["E01-S02","E01-S04"]},
];
const bound=(p:any)=>createHash("sha256").update(JSON.stringify({input:p.input,sleep:p.sleep??{}})).digest("hex");
export async function createGate(pool:any,initialized:any){
  const vocabulary=await createVocabularyConnection(pool,initialized);
  await vocabulary.installAliases();
  const repair=await vocabulary.repairComplementaryKeyword();
  const sessions=new Map<string,{binding:string,offered:string[],confirmed?:string,rejected?:boolean}>();
  let searches=0;
  async function search(p:any){
    const binding=bound(p);
    let session=p.token?sessions.get(p.token):undefined;
    const stale=!!p.token&&(!session||session.binding!==binding);
    if(stale)session=undefined;
    if(p.action==="reject"||p.action==="rephrase"){
      if(p.token)sessions.delete(p.token);
      return{state:p.action==="reject"?"not_applicable":"rephrase",candidates:[],prompts:[],groups:[],token:null,
        approvedTopic:null,answerAdequacy:"not_assessed",staleConfirmation:stale};
    }
    // Candidate-only search bypasses the existing fact renderer and arithmetic.
    const raw=await vocabulary.search({...p,candidateOnly:true});searches++;
    if(raw.state==="incomplete")return{state:"input_required",candidates:[],prompts:[],groups:[],token:null,
      approvedTopic:null,answerAdequacy:"not_assessed",staleConfirmation:stale,
      diagnostics:raw.groups.flatMap((g:any)=>g.diagnostics)};
    const candidates=raw.groups.flatMap((g:any)=>g.items.map((i:any)=>({
      groupId:g.id,unitId:i.unitId,title:i.title,sourceUrl:i.sourceUrl,
      topicId:topics.find(t=>t.units.includes(i.unitId))?.id??null
    })));
    const offered=[...new Set(candidates.map((c:any)=>c.topicId).filter(Boolean))] as string[];
    let approved=session?.confirmed;
    if(p.upfrontTopic){
      assert(topics.some(t=>t.id===p.upfrontTopic),"invalid explicit topic");
      approved=p.upfrontTopic;
    }else if(p.action==="confirm"){
      assert(session&&!stale,"confirmation expired; search again");
      assert(session.offered.includes(p.topic),"topic was not offered");
      approved=p.topic;
    }
    const token=session?p.token:randomUUID();
    session={binding,offered,confirmed:approved};sessions.set(token,session);
    if(!approved)return{state:candidates.length?"needs_topic":"no_candidates",candidates,
      prompts:topics.filter(t=>offered.includes(t.id)).map(t=>({id:t.id,label:t.label,question:`${t.label}についての資料を探していますか？`})),
      groups:[],token,approvedTopic:null,answerAdequacy:"not_assessed",staleConfirmation:stale,
      diagnostics:raw.groups.map((g:any)=>({groupId:g.id,state:g.state,diagnostics:g.diagnostics}))};
    const topic=topics.find(t=>t.id===approved)!;
    // Re-search only the explicitly confirmed topic, never interpret age as intent.
    const result=await vocabulary.search({...p,candidateOnly:false,allowedUnitIds:topic.units,input:{...p.input,question:topic.query}});searches++;
    const groups=result.groups.map((g:any)=>{
      const items=g.items.filter((i:any)=>topic.units.includes(i.unitId));
      const sleep=approved==="sleep";
      return{...g,items,hasSleep:sleep&&g.hasSleep,sleepResult:sleep?g.sleepResult:null,minutes:sleep?g.minutes:null,
        healthPrompts:g.healthPrompts.filter((q:any)=>items.length>0)};
    });
    return{...result,groups,candidates,prompts:[],state:"topic_confirmed",token,approvedTopic:approved,
      answerAdequacy:"not_assessed",staleConfirmation:stale,
      relevanceNotice:"選んだ話題に関する一般的な資料情報です。質問への結論や個人への適用を確認したものではありません。"};
  }
  return{search,repair,normalControl:vocabulary.normalControl,getSqlCalls:vocabulary.getSqlCalls,
    getSearches:()=>searches};
}