// Offline-only P01 display. It reads sealed local evidence and emits one self-contained HTML string.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadValidatedCatalog } from "../fact-display-pilot/projection.mjs";
import { evaluateSleep } from "./model.mjs";

const OLD_DIR = "evidence-work/parent-reading-evaluation/fact-display-pilot-01";
const NEW_DIR = "evidence-work/parent-reading-evaluation/p01-aggregation-addendum-01";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const esc = (value) => String(value ?? "未確認")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function readJson(root, relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function validateMinutes(root) {
  const sourceFile = readJson(root, `${NEW_DIR}/minutes-source.json`);
  const seal = readJson(root, `${NEW_DIR}/minutes-seal.json`).value;
  const source = sourceFile.value;
  assert.equal(hash(sourceFile.bytes), seal.sourceSha256, "minutes source seal changed");
  assert.equal(seal.adoptionApproved, false, "minutes must remain unadopted");
  assert.equal(seal.publicationApproved, false, "minutes must remain unpublished");
  assert.equal(source.sourceId, "MHLW-MINUTES-20231221");
  assert.equal(source.meetingDate, "2023-12-21");
  assert.equal(source.sourceKind, "draft-guide-meeting-minutes");
  assert.equal(source.scope?.purpose, "aggregation-includes-naps-only");
  assert.deepEqual(source.scope?.ageMonths, { minInclusive: 12, maxExclusive: 36 });
  assert.equal(source.scope?.includesNaps, true);
  assert.equal(source.linkedUnitId, "E02-S01");
  assert.equal(source.adoptionApproved, false);
  assert.equal(source.publicationApproved, false);
  assert.equal(typeof source.title, "string");
  assert.ok(source.title.length > 0);
  assert.match(source.url, /^https:\/\//);
  assert.equal(typeof source.attribution, "string");
  assert.ok(source.attribution.length > 0);
  assert.equal(typeof source.processingNotice, "string");
  assert.ok(source.processingNotice.length > 0);
  assert.ok(Array.isArray(source.limitations) && source.limitations.length > 0);
  assert.ok(source.limitations.every((item) => typeof item === "string" && item.length > 0));
  assert.ok(Array.isArray(source.fragments) && source.fragments.length > 0);
  const acquisitionBytes = fs.readFileSync(path.join(root, NEW_DIR, "minutes-acquisition.md"));
  const acquisitionHash = hash(acquisitionBytes);
  assert.equal(acquisitionHash, seal.snapshotSha256, "minutes acquisition seal changed");
  assert.equal(acquisitionHash, source.acquisition?.snapshotSha256,
    "minutes acquisition hash differs from source metadata");
  assert.equal(source.acquisition?.snapshotFile, "minutes-acquisition.md");
  assert.equal(source.acquisition?.truncated, false);
  const acquisition = acquisitionBytes.toString("utf8");
  for (const fragment of source.fragments) {
    assert.equal(typeof fragment.id, "string");
    assert.ok(fragment.id.length > 0);
    assert.equal(typeof fragment.speaker, "string");
    assert.ok(fragment.speaker.length > 0);
    assert.equal(typeof fragment.text, "string");
    assert.ok(fragment.text.length > 0);
    assert.equal(typeof fragment.locator, "string");
    assert.ok(fragment.locator.length > 0);
    assert.match(fragment.textSha256, /^[a-f0-9]{64}$/);
    assert.equal(hash(Buffer.from(fragment.text, "utf8")), fragment.textSha256,
      `minutes fragment hash changed: ${fragment.id}`);
    assert.ok(acquisition.includes(fragment.text),
      `minutes acquisition snapshot omits fragment: ${fragment.id}`);
    assert.ok(fragment.role === "support" || fragment.role === "context");
  }
  const actualSupportIds = source.fragments
    .filter((fragment) => fragment.role === "support").map((fragment) => fragment.id);
  const actualContextIds = source.fragments
    .filter((fragment) => fragment.role === "context").map((fragment) => fragment.id);
  assert.deepEqual(source.supportIds, actualSupportIds,
    "minutes supportIds must exactly identify support fragments");
  assert.deepEqual(source.requiredContextIds, actualContextIds,
    "minutes requiredContextIds must exactly identify context fragments");
  assert.ok(source.supportIds.length > 0, "minutes support is missing");
  assert.ok(source.requiredContextIds.length > 0, "minutes required context is missing");
  return {
    source,
    proof: {
      sourceId: source.sourceId,
      linkedUnitId: source.linkedUnitId,
      ageMinMonths: 12,
      ageMaxMonthsExclusive: 36,
      includesNaps: true,
      verified: true,
    },
    sourceSha256: seal.sourceSha256,
  };
}

export function renderP01(root = process.cwd()) {
  const catalog = loadValidatedCatalog(root);
  const oldSeal = readJson(root, `${OLD_DIR}/catalog-seal.json`).value;
  const oldBytes = fs.readFileSync(path.join(root, OLD_DIR, "fact-catalog.json"));
  assert.equal(hash(oldBytes), oldSeal.catalogSha256, "previous E02 catalog seal changed");
  assert.equal(oldSeal.adoptionApproved, false);
  assert.equal(oldSeal.publicationApproved, false);
  const sleep = catalog.facts.find((fact) => fact.id === "sleep-guidance");
  assert.ok(sleep, "immutable E02 sleep fact missing");
  const e02 = readJson(root, "evidence-work/v0.2/E02.json").value;
  const e02Source = e02.sources.find((source) => source.id === "E02");
  assert.ok(e02Source?.url, "E02 source URL missing");
  const minutes = validateMinutes(root);
  const font = fs.readFileSync(path.join(root,
    "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
  const license = fs.readFileSync(path.join(root,
    "prototypes/evidence-consultation/fonts/OFL-1.1.txt"), "utf8");

  const data = JSON.stringify({
    proof: minutes.proof,
    e02: {
      title: e02Source.title,
      url: e02Source.url,
      supports: sleep.supports,
      sourceHash: sleep.provenance.sourceFileSha256,
    },
    minutes: {
      title: minutes.source.title,
      url: minutes.source.url,
      sourceId: minutes.source.sourceId,
      sourceKind: minutes.source.sourceKind,
      meetingDate: minutes.source.meetingDate,
      fragments: minutes.source.fragments,
      attribution: minutes.source.attribution,
      processingNotice: minutes.source.processingNotice,
      limitations: minutes.source.limitations,
      sourceHash: minutes.sourceSha256,
    },
  }).replaceAll("<", "\\u003c");

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src data:;script-src 'unsafe-inline';img-src data:;connect-src 'none';form-action 'none';base-uri 'none'">
  <title>P01 睡眠時間の集計 — 編集見本</title><style>
  @font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}
  body{margin:0;background:#f3f5f2;color:#21372c;font-family:JP,sans-serif;line-height:1.72;overflow-wrap:anywhere}
  main{width:min(760px,100%);margin:auto;padding:22px 16px 35px}h1{font-size:25px;line-height:1.42;margin:5px 0}
  h2{font-size:19px;margin:24px 0 8px;border-bottom:2px solid #b9cabf;padding-bottom:6px}
  h3{font-size:16px;margin:7px 0}p{margin:7px 0}a{color:#175940;overflow-wrap:anywhere}
  .status{font-size:12px;font-weight:bold;color:#35624d;letter-spacing:.03em}.notice{font-size:13px;color:#586c61}
  .toolbar,.version{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0;padding:13px;background:#e5ede8;border-radius:10px}
  label{font-size:14px}select,button{font:inherit;color:inherit;background:#fff;border:1px solid #8da397;border-radius:7px;padding:8px}
  button[aria-pressed=true]{background:#285c43;color:#fff}.control-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0;width:100%}
  select{max-width:100%;min-width:0;width:100%}
  article{background:#fff;border:1px solid #d2ddd6;border-radius:10px;padding:16px 18px;margin:10px 0}
  .answer{background:#e8f2eb;border-left:5px solid #377154}.answer p{font-size:17px;font-weight:bold}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px}.grid article{margin:0}
  .tag{display:inline-block;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:10px;background:#e2eae5}
  .withheld{color:#8a4a25}.ok{color:#256443}ul{padding-left:21px;margin:6px 0}
  details{background:#fff;border:1px solid #d2ddd6;border-radius:8px;margin:9px 0;padding:11px 14px}
  summary{font-weight:bold;cursor:pointer}.body{padding-top:9px}blockquote{margin:8px 0;padding:11px;background:#f3f5f4;white-space:pre-wrap}
  dl{display:grid;grid-template-columns:125px 1fr;gap:4px 10px}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}
  .hash{font-size:10px;overflow-wrap:anywhere;color:#617168}.fine{font-size:12px;color:#586a60}
  footer{font-size:11px;color:#5b6d63;margin-top:25px}
  @media(max-width:600px){main{padding:16px 12px}.grid{grid-template-columns:1fr}article{padding:14px}h1{font-size:22px}dl{display:block}dd{margin:0 0 7px}}
  </style></head><body><main>
  <div class="status">常時非公開・固定データによる編集見本</div>
  <h1>1〜2歳の睡眠時間：集計条件を分けて読む</h1>
  <p class="notice">AI回答ではありません。自由文の抽出や推測は行わず、選択した固定条件だけを決定的に計算します。</p>
  <div class="version" aria-label="表示版">
    <button type="button" id="version-old">従来表示（E02のみ）</button>
    <button type="button" id="version-new" aria-pressed="true">追補リンク付き表示</button>
  </div>
  <div class="toolbar">
    <div class="control-row"><label for="scenario">固定シナリオ</label><select id="scenario">
      <option value="valid-conditional">20か月・夜10時間＋昼寝1時間（条件付き）</option>
      <option value="night-only">夜のみ</option><option value="unknown-age">年齢未確認</option>
      <option value="different-days">異なる日の記録</option><option value="time-in-bed">床にいた時間</option>
    </select></div>
    <label><input id="link-proof" type="checkbox" checked> 議事録の集計根拠をリンクする</label>
  </div>
  <div id="view"></div>
  <footer>一般的な回答生成、診断、受診判断は実装していません。
    <details><summary>同梱フォントのライセンス</summary><pre>${esc(license)}</pre></details>
  </footer></main><script>
  const evidence=${data};
  ${evaluateSleep.toString()}
  const fixtures={
    'valid-conditional':{ageMonths:20,night:{value:10,unit:'hours',kind:'actual-sleep',dayId:'day-1',complete:true,approximate:true},nap:{value:1,unit:'hours',kind:'actual-sleep',dayId:'day-1',complete:true,approximate:true}},
    'night-only':{ageMonths:20,night:{value:10,unit:'hours',kind:'actual-sleep',dayId:'day-1',complete:true,approximate:true},nap:null},
    'unknown-age':{ageMonths:null,night:{value:10,unit:'hours',kind:'actual-sleep',dayId:'day-1',complete:true,approximate:true},nap:{value:1,unit:'hours',kind:'actual-sleep',dayId:'day-1',complete:true,approximate:true}},
    'different-days':{ageMonths:20,night:{value:10,unit:'hours',kind:'actual-sleep',dayId:'day-1',complete:true,approximate:true},nap:{value:1,unit:'hours',kind:'actual-sleep',dayId:'day-2',complete:true,approximate:true}},
    'time-in-bed':{ageMonths:20,night:{value:10,unit:'hours',kind:'time-in-bed',dayId:'day-1',complete:true,approximate:true},nap:{value:1,unit:'hours',kind:'time-in-bed',dayId:'day-1',complete:true,approximate:true}}
  };
  let edition='new';
  const h=value=>String(value??'未確認').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const reason={aggregation_link_unverified:'昼寝を含む集計根拠が未リンクまたは無効',age_unknown:'年齢未確認',age_out_of_scope:'対象年齢（12か月以上36か月未満）の範囲外',missing_night:'夜の記録なし',missing_nap:'昼寝の記録なし',invalid_record:'数値・単位・記録項目が無効',not_actual_sleep:'実睡眠時間ではない',mixed_units:'単位が混在',incomplete_day:'1日分が未完了',different_days:'同じ日の記録ではない',implausible_total:'合計が1日24時間を超える'};
  function quoteDetails(source,label){
    return '<details><summary>'+h(label)+'</summary><div class="body">'+source.fragments.map(f=>'<section><p class="fine">'+h(f.id)+'／'+h(f.speaker)+'／'+h(f.locator)+'／役割: '+h(f.role)+'</p><blockquote>'+h(f.text)+'</blockquote><p class="hash">本文 SHA-256: '+h(f.textSha256)+'</p></section>').join('')+'</div></details>';
  }
  function rebuild(){
    const fixture=fixtures[document.getElementById('scenario').value];
    const proofAttached=edition==='new'&&document.getElementById('link-proof').checked;
    const result=evaluateSleep(fixture,proofAttached?evidence.proof:null);
    const compared=result.comparison.performed;
    const within=result.comparison.status==='within_numeric_range';
    const outside=result.comparison.status==='outside_numeric_range';
    const total=result.comparison.totalHoursUsed;
    const totalText=(result.arithmetic.approximate?'約':'')+h(total)+'時間';
    const healthLimit='この時間数だけでは、睡眠が十分か、健康上の問題がないか、受診が不要かは判断できません。';
    const detached='保存した原文の範囲では昼寝を含むか確認できず、個別の充足判定はできない。';
    const conclusion=!proofAttached
      ?detached+' '+healthLimit
      :within
        ?'1〜2歳の目安は昼寝を含む11〜14時間。選択した固定値が同じ1日の完全な実睡眠記録なら、'+totalText+'で、時間数として範囲内です。 '+healthLimit
        :outside
          ?'1〜2歳の目安は昼寝を含む11〜14時間。選択した固定値は'+totalText+'で、時間数として範囲外です。 '+healthLimit
          :'1〜2歳の11〜14時間という目安は昼寝を含みますが、現在の入力条件では数値比較を行いません。 '+healthLimit;
    const arithmetic=result.arithmetic.totalHours!==null
      ?'夜と昼寝の固定値を加算：'+h(result.arithmetic.totalHours)+'時間'+(result.arithmetic.approximate?'（約）':'')
      :result.arithmetic.rawSum!==null?'数値上の和は'+h(result.arithmetic.rawSum)+'ですが、1日分として集計しません。':'完全な合計は計算できません。';
    const comparison=within?totalText+'は11〜14時間の数値範囲内です。'
      :outside?totalText+'は11〜14時間の数値範囲外です。'
      :(result.reference.status==='aggregation_verified'?'参照する目安が昼寝を含むことは確認済み。':'昼寝を含む集計範囲は未確認。')+' 比較保留：'+result.comparison.reasonCodes.map(code=>reason[code]||code).join('／');
    const minutesCitation=proofAttached?'<li><a href="'+h(evidence.minutes.url)+'">'+h(evidence.minutes.title)+'</a>（会議日 '+h(evidence.minutes.meetingDate)+'）<p><strong>資料の位置づけ：</strong>ガイド案の策定過程の議事録であり、最終ガイドでも独立した効果研究でもありません。用途は1〜2歳の目安が昼寝を含むという集計範囲の確認だけです。</p><p><strong>出典・帰属：</strong>'+h(evidence.minutes.attribution)+'</p><p><strong>編集加工：</strong>'+h(evidence.minutes.processingNotice)+'</p></li>':'';
    const minutesDetail=proofAttached?quoteDetails(evidence.minutes,'議事録の保存抜粋と照合情報')+'<details><summary>議事録のレビュー用メタデータ</summary><div class="body"><dl><dt>資料種別</dt><dd>睡眠ガイド作成検討会の議事録（draft guide formation。最終ガイドでも独立研究でもありません）</dd><dt>処理表示</dt><dd>'+h(evidence.minutes.processingNotice)+'</dd><dt>帰属表示</dt><dd>'+h(evidence.minutes.attribution)+'</dd><dt>資料採用</dt><dd>false（未採用）</dd><dt>公開承認</dt><dd>false（未承認）</dd><dt>資料 SHA-256</dt><dd class="hash">'+h(evidence.minutes.sourceHash)+'</dd></dl><ul>'+evidence.minutes.limitations.map(x=>'<li>'+h(x)+'</li>').join('')+'</ul></div></details>':'';
    document.getElementById('view').innerHTML=
      '<section><h2>短い結論</h2><article class="answer"><span class="tag">'+(within?'条件付き・範囲内':outside?'条件付き・範囲外':'比較保留')+'</span><p id="conclusion">'+conclusion+'</p></article></section>'+
      '<section><h2>説明</h2><div class="grid"><article><h3>算術</h3><p id="arithmetic">'+arithmetic+'</p><p class="fine">状態: '+h(result.arithmetic.status)+'</p></article><article><h3>目安との比較</h3><p id="comparison" class="'+(compared?'ok':'withheld')+'">'+comparison+'</p></article><article><h3>健康判断</h3><p id="health">常に評価していません。睡眠が十分、健康上問題なし、受診不要とは結論しません。</p><p class="fine">not_assessed／noReassurance: true</p></article></div></section>'+
      '<section><h2>欠かせない条件</h2><article id="conditions"><ul><li>年齢が12か月以上36か月未満であること（固定例は20か月。ユーザーについて確認した事実ではありません）。</li><li>夜10時間と昼寝1時間は、同じ1日の実睡眠を漏れなく記録した値であること。</li><li>値は概算の固定例です。床にいた時間、別の日、単位混在、不完全な1日は比較に使いません。</li><li>これらはすべて条件付き仮定であり、ユーザーの確認済み事実ではありません。</li></ul></article></section>'+
      '<section><h2>出典</h2><article id="citations"><ul><li><a href="'+h(evidence.e02.url)+'">'+h(evidence.e02.title)+'</a>（11〜14時間という目安。従来のE02保存内容は変更していません）</li>'+minutesCitation+'</ul></article></section>'+
      '<section><h2>抜粋とレビュー情報</h2><details><summary>E02の保存原文（変更なし）</summary><div class="body">'+evidence.e02.supports.map(s=>'<p class="fine">'+h(s.originalId)+'／'+h(typeof s.locator==='object'?JSON.stringify(s.locator):s.locator)+'</p><blockquote>'+h(s.quote)+'</blockquote><p class="hash">原文 SHA-256: '+h(s.originalTextSha256)+'</p>').join('')+'<dl><dt>採用</dt><dd>未承認</dd><dt>公開</dt><dd>未公開</dd><dt>科学的確実性</dt><dd>評価未実施</dd><dt>資料 SHA-256</dt><dd class="hash">'+h(evidence.e02.sourceHash)+'</dd></dl></div></details>'+minutesDetail+'</section>';
    document.getElementById('version-old').setAttribute('aria-pressed',String(edition==='old'));
    document.getElementById('version-new').setAttribute('aria-pressed',String(edition==='new'));
  }
  document.getElementById('scenario').addEventListener('change',rebuild);
  document.getElementById('link-proof').addEventListener('change',rebuild);
  document.getElementById('version-old').addEventListener('click',()=>{edition='old';document.getElementById('link-proof').checked=false;rebuild()});
  document.getElementById('version-new').addEventListener('click',()=>{edition='new';document.getElementById('link-proof').checked=true;rebuild()});
  rebuild();
  </script></body></html>`;
}