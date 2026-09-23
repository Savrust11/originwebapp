import {renderInputPage} from "../retrieval-fact-connection/ui.mjs";
import {topics} from "./gate.mts";
export function renderGatePage(){
  const controls=`<label>探す話題（分かる場合だけ明示選択）<select id="topic"><option value="">未指定・候補を見て確認する</option>${topics.map(t=>`<option value="${t.id}">${t.label}</option>`).join("")}</select></label>`;
  const old=renderInputPage().replace('<div id="children">',controls+'<div id="children">');
  return old.replace("</script></html>",`</script><script>
  let gateToken=null, confirmedTopic=null, choosingTopic=false, requestSerial=0;
  document.querySelector('#intake').addEventListener('input',e=>{choosingTopic=e.target.id==='topic'},true);
  const oldInvalidate=invalidate;
  invalidate=function(){gateToken=null;confirmedTopic=null;if(!choosingTopic)document.querySelector('#topic').value='';choosingTopic=false;window.lastConnectionResult=null;oldInvalidate()};
  function collect(){for(const f of document.querySelectorAll('.health'))health[f.dataset.group]=Object.fromEntries([...f.querySelectorAll('[data-health]')].map(s=>[s.dataset.health,s.value]));
    for(const f of document.querySelectorAll('.sleep'))sleep[f.dataset.group]={night:number(f.querySelector('.night')),nap:number(f.querySelector('.nap')),...Object.fromEntries([...f.querySelectorAll('[data-sleep]')].map(c=>[c.dataset.sleep,c.checked]))};}
  function gateDisplay(r){
    if(r.state==='input_required'){document.querySelector('#status').textContent='入力を確認してください：'+r.diagnostics.join(' ');document.querySelector('#results').innerHTML='';return}
    if(r.state==='topic_confirmed'){confirmedTopic=r.approvedTopic;display(r);document.querySelector('#status').textContent='話題を確認して再検索しました。';document.querySelector('#results').insertAdjacentHTML('afterbegin','<p class="notice">'+h(r.relevanceNotice)+'</p>');return}
    confirmedTopic=null;
    document.querySelector('#status').textContent=r.state==='needs_topic'?'候補は見つかりました。探す話題を確認してください。':r.state==='not_applicable'?'この話題は該当しないとして終了しました。':r.state==='rephrase'?'相談文を言い直してください。':'登録資料から該当箇所を見つけられませんでした';
    document.querySelector('#results').innerHTML=r.state!=='needs_topic'?'':'<p>キーワードが一致した候補です。質問への関連性はまだ確認していません。数値の比較や説明用の事実表示には進みません。</p>'+r.prompts.map(t=>'<fieldset><legend>'+h(t.question)+'</legend><button type="button" data-confirm-topic="'+h(t.id)+'">はい、この話題です</button><button type="button" data-gate-action="reject">該当しない</button><button type="button" data-gate-action="rephrase">言い直す</button></fieldset>').join('')+'<details><summary>検索候補の出典（回答の根拠として未確認）</summary>'+r.candidates.map(c=>'<p data-candidate="'+h(c.unitId)+'">'+h(c.title)+' ／ '+h(c.unitId)+'</p>').join('')+'</details>';
  }
  search=async function(action,topic){
    const current=revision, request=++requestSerial;collect();
    const payload=JSON.parse(JSON.stringify({input:input(),sleep,token:gateToken,action:typeof action==='string'?action:undefined,topic,upfrontTopic:document.querySelector('#topic').value||undefined}));
    document.querySelector('#results').innerHTML='';
    window.lastConnectionResult=null;
    document.querySelector('#status').textContent='候補と確認状態を再確認しています…';
    try{if(typeof window.searchEvidenceBridge!=='function')throw Error('隔離接続がありません');
      const r=await window.searchEvidenceBridge(payload);
      if(current!==revision||request!==requestSerial)return;gateToken=r.token;window.lastConnectionResult=r;gateDisplay(r);
      if(r.state==='rephrase'){document.querySelector('#question').focus();document.querySelector('#question').select();}
    }catch(e){if(current!==revision||request!==requestSerial)return;document.querySelector('#results').innerHTML='';document.querySelector('#status').textContent='確認できません：'+e.message}
  };
  document.querySelector('#search').onclick=()=>search();
  document.querySelector('#results').addEventListener('click',e=>{
    if(e.target.dataset.confirmTopic)search('confirm',e.target.dataset.confirmTopic);
    if(e.target.dataset.gateAction)search(e.target.dataset.gateAction);
  });
  document.querySelector('#results').addEventListener('input',()=>{
    collect();gateToken=null;confirmedTopic=null;document.querySelector('#topic').value='';
    for(const e of document.querySelectorAll('[data-fact],.missing-original,.item-citation,.missing-fact'))e.remove();
    document.querySelector('#status').textContent='条件が変わりました。話題を再確認してください。';
  });
  </script></html>`);
}