import {renderMaterialPage as previous} from "../material-selection-preview/ui.mjs";
export function renderMaterialPage(options={}){
  return previous(options).replace("</script></html>",`</script><style>
  #end-preview{position:sticky;top:8px;z-index:10;box-shadow:0 2px 8px #777}
  .age-error{flex-basis:100%;color:#913a28}
  </style><script>
  const inheritedSleepForm=sleepForm;
  sleepForm=function(g){
    if(g.ageMonths===null)return '<p class="comparison-unavailable">年齢が未確認のため比較できません。歳と月を確認してください。</p>';
    if(g.ageMonths<12||g.ageMonths>=36)return '<p class="comparison-unavailable">この比較は1〜2歳（12か月以上36か月未満）だけが対象です。入力した年齢では比較できません。</p>';
    return inheritedSleepForm(g).replace(/<label><input type="checkbox" data-sleep="link"[^]*?<\\/label>/,'');
  };
  const inheritedInput=input;
  input=function(){const p=inheritedInput();p.children=p.children.map(c=>c.years===null?{...c,months:null}:c);return p};
  function ageFeedback(){
    for(const e of document.querySelectorAll('[data-child]')){
      let note=e.querySelector('.age-error');if(!note){note=document.createElement('p');note.className='age-error';note.setAttribute('role','status');e.append(note)}
      const y=e.querySelector('.years').value,m=e.querySelector('.months').value;
      note.textContent=y===''&&m!==''?'0歳'+m+'か月ですか？ 歳を入力してください':y===''?'年齢が未確認のため、睡眠時間の比較はできません。':'';
    }
  }
  document.querySelector('#intake').addEventListener('input',ageFeedback);ageFeedback();
  const inheritedDisplay=display;
  display=function(r){
    inheritedDisplay(r);
    for(const group of document.querySelectorAll('[data-result-group]')){
      const g=r.groups.find(x=>x.id===group.dataset.resultGroup);
      for(const unit of group.querySelectorAll('[data-unit]')){
        const details=document.createElement('details');details.className='reviewer';details.innerHTML='<summary>確認担当者向けの詳細</summary>';
        for(const el of [...unit.querySelectorAll('.tag,.item-citation small,.sources,.verification,.hash')])details.append(el);
        unit.append(details);
      }
      if(g?.hasSleep){
        for(const original of group.querySelectorAll('[data-fact="sleep-guidance"] .limits,[data-fact="sleep-guidance"] .numbers')){
          const archived=document.createElement('details');archived.innerHTML='<summary>元の睡眠資料だけで確認できる範囲（補足前）</summary>';original.before(archived);archived.append(original);
        }
        const p=document.createElement('p');p.className='aggregation-explanation';
        p.textContent=g.minutes?'元の睡眠資料だけでは昼寝を含むか未確認でした。補足の議事録では、1〜2歳の11〜14時間は昼寝を含む合計と確認されています。議事録は集計範囲の補足であり、最終ガイドや独立した効果研究ではありません。':'元の睡眠資料だけでは昼寝を含むか未確認です。補足の出典を確認できないため、目安との比較はできません。';
        group.prepend(p);
        const review=document.createElement('details');review.className='reviewer';review.innerHTML='<summary>集計範囲の出典確認（確認担当者向け）</summary><p>'+ (g.minutes?'保存済み原文・出典・対象条件の照合済み':'利用可能な補足出典なし')+'</p>';group.append(review);
      }
    }
    for(const el of document.querySelectorAll('.comparison,.comparison-inputs'))el.innerHTML=el.innerHTML.replaceAll('算術','入力した睡眠時間の合計').replace(/／集計範囲の出典関連付け：[^<]*/g,'').replaceAll('未入力か月','年齢未確認');
  };
  const inheritedMaterialDisplay=materialDisplay;
  materialDisplay=function(r){inheritedMaterialDisplay(r);if(r.state==='materials_displayed')document.querySelector('#status').textContent='選んだ資料を表示しました。比較は比較ボタンを押した場合だけ行います。'};
  </script></html>`);
}