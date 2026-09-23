import {renderInputPage} from "../retrieval-fact-connection/ui.mjs";
import {topics} from "./gate.mts";
export function renderMaterialPage({live=false}={}){
  const controls=`<label>表示する資料を先に選ぶ（任意）<select id="topic"><option value="">検索候補から選ぶ</option>${topics.map(t=>`<option value="${t.id}">${t.label}</option>`).join("")}</select></label>`;
  return renderInputPage().replace('<div id="children">',controls+'<div id="children">')
    .replace('<h1>資料から確認できる情報</h1>',`<h1>資料の選択と睡眠時間の比較</h1><p class="notice">架空の相談だけを入力してください。実在の個人情報や健康情報は入力しないでください。入力はこの一時セッション内だけで扱い、相談文をファイルや既存DBへ保存しません。</p>${live?'<p>非公開VNCプレビュー。起動から60分で自動終了します。外部ページへの接続は無効です。</p><button type="button" id="end-preview">プレビューを終了</button>':''}`)
    .replace("</script></html>",`</script><script>
    let materialToken=null,selectedTopic=null,requestSerial=0,intakeField=null;
    document.querySelector('#intake').addEventListener('input',e=>{intakeField=e.target.id},true);
    const oldInvalidate=invalidate;
    invalidate=function(){materialToken=null;selectedTopic=null;requestSerial++;window.lastConnectionResult=null;oldInvalidate();if(intakeField!=='topic')document.querySelector('#topic').value='';intakeField=null};
    const oldSleepForm=sleepForm;
    sleepForm=function(g){return oldSleepForm(g).replace('<button class="apply" type="button">明示した条件で再確認</button>','<button class="compare" type="button">入力した睡眠時間を目安と比べる</button>')};
    const oldComparison=comparison;
    comparison=function(g){if(!g.sleepResult)return '';const u=g.comparisonInputs||{},yes=v=>v===true?'確認済み':'未確認';
      return oldComparison(g)+'<section class="comparison-inputs"><strong>今回の比較に使用した入力</strong><p>年齢：'+h(u.ageMonths??'未入力')+'か月／夜：'+h(u.night??'未入力')+'時間／昼寝：'+h(u.nap??'未入力')+'時間／合計：'+h(g.sleepResult.arithmetic.totalHours??'保留')+'時間</p><p>同じ1日：'+yes(u.sameDay)+'／実睡眠：'+yes(u.actual)+'／漏れなく記録：'+yes(u.complete)+'／昼寝込み：'+yes(u.napIncluded)+'／集計範囲の出典関連付け：'+yes(u.link)+'</p><p>これは選んだ入力と資料の目安との比較です。元の相談文への回答や健康判断ではありません。</p></section>'};
    function collect(){for(const f of document.querySelectorAll('.health'))health[f.dataset.group]=Object.fromEntries([...f.querySelectorAll('[data-health]')].map(s=>[s.dataset.health,s.value]));
      for(const f of document.querySelectorAll('.sleep'))sleep[f.dataset.group]={night:number(f.querySelector('.night')),nap:number(f.querySelector('.nap')),...Object.fromEntries([...f.querySelectorAll('[data-sleep]')].map(c=>[c.dataset.sleep,c.checked]))};}
    function materialDisplay(r){
      if(r.state==='materials_displayed'){selectedTopic=r.selectedTopic;display(r);document.querySelector('#status').textContent=r.materialNotice;document.querySelector('#results').insertAdjacentHTML('afterbegin','<p class="notice">'+h(r.materialNotice)+'</p>');return}
      selectedTopic=null;
      const status=r.state==='choose_material'?'表示する資料を一か所で選んでください。':r.state==='not_applicable'?'該当しないとして終了しました。':r.state==='rephrase'?'相談文を言い直してください。':r.state==='input_required'?'入力を確認してください：'+r.diagnostics.join(' '):'登録資料から該当箇所を見つけられませんでした';
      document.querySelector('#status').textContent=status;
      document.querySelector('#results').innerHTML=r.state!=='choose_material'?'':'<fieldset id="material-chooser"><legend>表示する資料を選択</legend><p>候補は質問への回答として確認されたものではありません。</p><label>資料の話題<select id="candidate-topic"><option value="">選んでください</option>'+r.choices.map(t=>'<option value="'+h(t.id)+'">'+h(t.label)+'</option>').join('')+'</select></label><button type="button" id="show-material">選んだ資料を表示</button><button type="button" data-material-action="reject">該当しない</button><button type="button" data-material-action="rephrase">言い直す</button></fieldset>';
    }
    search=async function(action,topic,compareGroupId){
      const current=revision,serial=++requestSerial;collect();
      const payload=JSON.parse(JSON.stringify({input:input(),sleep,token:materialToken,action:typeof action==='string'?action:undefined,topic,compareGroupId,upfrontTopic:document.querySelector('#topic').value||undefined}));
      document.querySelector('#results').innerHTML='';window.lastConnectionResult=null;document.querySelector('#status').textContent='選択した操作を確認しています…';
      try{const r=await window.searchEvidenceBridge(payload);if(serial!==requestSerial||current!==revision)return;
        materialToken=r.token;window.lastConnectionResult=r;materialDisplay(r);if(r.state==='rephrase'){document.querySelector('#question').focus();document.querySelector('#question').select();}
      }catch(e){if(serial!==requestSerial||current!==revision)return;document.querySelector('#results').innerHTML='';document.querySelector('#status').textContent='確認できません：'+e.message}
    };
    document.querySelector('#search').onclick=()=>search();
    document.querySelector('#results').addEventListener('click',e=>{
      if(e.target.id==='show-material'){const topic=document.querySelector('#candidate-topic').value;if(!topic){document.querySelector('#status').textContent='表示する資料を選んでください。';return}search('select',topic);}
      if(e.target.dataset.materialAction)search(e.target.dataset.materialAction);
      if(e.target.matches('.compare'))search('compare',undefined,e.target.closest('.sleep').dataset.group);
    });
    document.querySelector('#results').addEventListener('input',e=>{
      if(e.target.closest('#material-chooser'))return;
      collect();requestSerial++;window.lastConnectionResult=null;
      for(const el of document.querySelectorAll('.comparison,.comparison-inputs'))el.remove();
      if(e.target.closest('.health')){materialToken=null;selectedTopic=null;document.querySelector('#topic').value='';for(const el of document.querySelectorAll('[data-fact],.missing-original,.item-citation,.missing-fact'))el.remove();}
      document.querySelector('#status').textContent=e.target.closest('.sleep')?'睡眠の入力が変わりました。資料の選び直しは不要です。比較する場合は比較ボタンを押してください。':'条件が変わりました。資料を再検索してください。';
    });
    document.querySelector('#end-preview')?.addEventListener('click',async()=>{document.body.innerHTML='<p>終了しています。入力と一時環境を片付けます。</p>';await window.endPreviewBridge()});
    document.addEventListener('click',e=>{if(e.target.closest('a')){e.preventDefault();document.querySelector('#status').textContent='非公開プレビューでは外部ページを開きません。出典URLは表示用です。';}});
    </script></html>`);
}