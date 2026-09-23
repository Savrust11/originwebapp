// Append-only audit/report. Reads saved artifacts; no DB, server or model.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const out="evidence-work/parent-reading-evaluation/vocabulary-inventory-review-01";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const digest=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const latest=read(`${out}/latest-success.json`);
const inventory=read(latest.inventory), lexical=read(latest.lexicalResults);
const verification=read(latest.verification), cleanup=read(latest.cleanup);
assert.equal(verification.result,"PASSED");
assert.equal(cleanup.ownedRunnerExitCode,0);
assert.equal(cleanup.remainingTemporaryDirectories.length,0);
const baseline=read(`${out}/preservation-baseline.json`);
for(const f of baseline.entries)assert.equal(digest(f.path),f.sha256,`changed historical file: ${f.path}`);
const oldSearchPath="evidence-work/v0.2/search-results.json";
const oldSearch=read(oldSearchPath);
const oldHit=oldSearch.queries.find(q=>q.question==="離乳食をいつ始める？");
assert(oldHit.results.some(r=>r.selectedLogicalUnitIds.includes("E01-S03")));
const e01Path="evidence-work/v0.2/E01.json", e01=read(e01Path);
const unit=e01.units.find(u=>u.id==="E01-S03");
const original=e01.fragments.find(f=>f.id===unit.fragment_id);
const historicalRoot=oldHit.results.find(r=>r.selectedLogicalUnitIds.includes(unit.id));
assert.equal(historicalRoot.returnedOriginal,original.original_text);
assert(original.original_text.includes("15　")&&original.original_text.includes("16　")&&original.original_text.includes("17　"));
assert.equal(inventory.length,11);
assert(inventory.every(i=>i.originalSaved&&i.requiredContextSaved&&i.currentEnvironmentImported&&i.currentRetrievable));
const noFacts=inventory.filter(i=>i.factIds.length===0).map(i=>i.unitId);
const correction={
  kind:"append-only-correction",supersedesHistoricalFiles:false,
  correction:"E01-S03の離乳開始本文・脚注15〜17と必須文脈は保存済みで、過去の検索成功記録も存在します。前回はE01を隔離環境への投入対象から除外しました。前回の不足説明は、保存資料全体の不足ではなく「保存済みだが、その環境に未投入」と訂正します。",
  previousRun:{sources:["E02","E03","E04"],logicalUnits:7,e01Classification:"saved_not_imported",
    selectionEvidence:"prototypes/evidence-consultation/retrieval-fact-connection/adapter-loader.mjs",
    report:"evidence-work/parent-reading-evaluation/retrieval-fact-connection-01/connection-report.html"},
  historicalEvidence:{sourcePath:e01Path,sourceSha256:digest(e01Path),unitId:unit.id,
    fragmentId:original.id,originalSha256:original.text_sha256,locator:original.locator,
    requiredContextIds:unit.required_context_ids,query:oldHit.question,
    searchRecord:oldSearchPath,searchRecordSha256:digest(oldSearchPath),
    returnedUnitIds:oldHit.results.flatMap(r=>r.selectedLogicalUnitIds)},
  currentRun:{sources:["E01","E02","E03","E04"],logicalUnits:11,
    e01S03Classification:"retrieved_without_fact",factDataCount:5,unitsWithoutFacts:noFacts,
    witness:latest.inventory},
  distinctions:{
    saved_source_absent:"保存台帳・原文・文脈の点検で判断する。検索0件だけでは判定しない。今回の11区分は全て保存あり。",
    saved_not_imported:"前回のE01-S01〜S04。検索インスタンスの投入対象から除外されていた。",
    imported_not_retrieved:"語彙・概念リンク・入力条件などに依存。前回の「ねんね」、今回の修正前「補完食」が例。資料不足とは別。",
    retrieved_without_fact:"今回のE01-S01〜S04、E02-S02・S03。原文と必須文脈は取得できるが説明用事実データは未準備。"
  },
  approvalStateChanged:false,modelApiCalls:0
};
fs.writeFileSync(`${out}/correction.json`,JSON.stringify(correction,null,2)+"\n",{flag:"wx"});
fs.writeFileSync(`${out}/correction.md`,`# 離乳食資料の収録状況に関する訂正・追記\n\n${correction.correction}\n\n- 原文：${e01Path} / ${unit.id} / ${original.id}\n- 位置：${original.locator}\n- 必須文脈：${unit.required_context_ids.join("、")}\n- 過去の検索記録：${oldSearchPath}（「${oldHit.question}」）\n- 過去の取得区分：${correction.historicalEvidence.returnedUnitIds.join("、")}\n- 前回：E02〜E04の7区分のみ投入。E01の4区分は保存済み・未投入。\n- 今回：4資料11区分を隔離環境に投入し、全区分に実検索の取得例を確認。\n- E01-S03の説明用事実データは未準備。原文・脚注・必須文脈の表示と、説明用データの有無を分ける。\n\n以前の報告、検索記録、原文、承認状態は上書きしていません。正式承認とは別の隔離評価です。\n`,{flag:"wx"});
const sourceNames={E01:"授乳・離乳の支援ガイド",E02:"睡眠ガイド2023",E03:"親子への介入研究",E04:"スクリーン関連介入研究"};
const csvCell=x=>`"${String(x??"").replaceAll('"','""')}"`;
const rows=[["資料","区分","原文保存","必須文脈保存","前回投入","今回投入","今回取得例","説明用事実データ","正式承認"]];
for(const i of inventory)rows.push([sourceNames[i.sourceId],i.unitId,"あり","あり",i.priorEnvironmentImported?"あり":"なし","あり",
  `取得確認：${i.query}（対象未指定・年齢未入力の資料検索）`,i.factIds.length?i.factIds.join(" / "):"準備中","承認記録なし・未公開"]);
fs.writeFileSync(`${out}/inventory.csv`,"\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n",{flag:"wx"});
const h=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const font=fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const fontLicense=fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt","utf8");
const image=(name,label)=>{
  const i=verification.images.find(i=>i.name===name);assert(i);assert.equal(digest(i.path),i.sha256);
  return `<figure><figcaption>${h(label)}</figcaption><img alt="${h(label)}" src="data:image/png;base64,${fs.readFileSync(i.path).toString("base64")}"></figure>`;
};
const unitsHTML=inventory.map(i=>`<tr><th>${i.unitId}</th><td>あり</td><td>${i.priorEnvironmentImported?"投入済み":"未投入"}</td><td>投入済み</td><td>取得確認<br><small>${h(i.query)}</small></td><td>${i.factIds.length?"あり":"準備中"}</td></tr>`).join("");
const positive=lexical.positive.map(t=>`<tr><td>${h(t.query)}</td><td>${h(t.before.join("、")||"取得なし")}</td><td>${h(t.after.join("、")||"取得なし")}</td></tr>`).join("");
const negative=lexical.negative.map(t=>`<tr><td>${h(t.query)}</td><td>${h(t.before.join("、")||"取得なし")}</td><td>${h(t.rawAfter.join("、")||"取得なし")}</td><td>${h(t.after.join("、")||"取得なし")}</td></tr>`).join("");
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>資料収録状況の訂正・11区分一覧と日常語検索</title>
<style>@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font:15px/1.85 JP,sans-serif;color:#253a2f;max-width:1080px;margin:auto;padding:22px;overflow-wrap:anywhere}h1{font-size:26px;line-height:1.5}h2{font-size:21px;border-top:1px solid #c7d6cb;padding-top:18px;margin-top:30px}.notice{background:#e8f2eb;border-left:4px solid #36714d;padding:16px}.warning{background:#fff2df;border-left:4px solid #9c661e;padding:16px}.tablescroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c6d4ca;padding:9px;text-align:left;vertical-align:top}small{font-size:12px}code{font-size:12px}blockquote{margin:12px 0;padding:14px;background:#f0f4f1;white-space:pre-wrap}figure{margin:18px 0}figcaption{font-weight:bold}img{max-width:100%;width:390px;height:auto;display:block;margin:12px auto;border:1px solid #c6d4ca}details{margin:18px 0}summary{font-weight:bold;cursor:pointer}pre{white-space:pre-wrap}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pair>div{min-width:0}a{color:#195b3d}@media(max-width:700px){body{padding:12px}.pair{grid-template-columns:1fr}th,td{font-size:12px;padding:6px}}</style>
<h1>資料収録状況の訂正・11区分一覧と日常語検索</h1>
<p class="notice">追加モデルAPI送信0。新規資料の収集・事実データの追加なし。新しい専用の一時環境だけで検証し、既存DB・資料承認・通常相談経路・本番公開は変更していません。一時環境は削除済みです。</p>
<h2>1. 離乳食資料についての訂正</h2><p><strong>${h(correction.correction)}</strong></p>
<ul><li>保存済み：E01-S03／原文E01-F-S03。離乳の開始の本文・脚注15〜17と、個別性を扱う必須文脈を保存。</li><li>過去の実検索：「離乳食をいつ始める？」でE01-S03・E01-S02・E01-S04を取得。</li><li>前回の投入：E02・E03・E04だけ。E01を明示的に除外していた。</li><li>今回の投入：E01を含む4資料・11区分。E01-S03の本文と必須文脈を取得・表示。</li><li>説明用事実データ：E01-S03には未準備。原文が存在しないわけではない。</li></ul>
<p>保存原文と過去の検索結果は文字一致を確認しました。以前の報告・検索記録は上書きせず、<code>correction.json / correction.md</code>として別保存しています。</p>
<details><summary>原文の位置・脚注と保存証跡</summary><p>${h(original.locator)}</p><p><a href="${h(original.url)}">保存原文の引用先</a></p><blockquote>${h(original.original_text)}</blockquote><p>保存原文SHA-256：<code>${h(original.text_sha256)}</code></p><p>旧検索記録：<code>${oldSearchPath}</code></p><p>必須文脈：<code>${h(unit.required_context_ids.join("、"))}</code></p></details>
<h2>2. 原因は4段階に分ける</h2><div class="tablescroll"><table><tr><th>区別</th><th>今回の整理</th></tr>
<tr><td>保存資料に存在しない</td><td>保存台帳と原文を点検して判断する。今回の11区分には該当せず、すべて保存済み。検索0件だけでは判断しない。</td></tr>
<tr><td>保存済みだが環境に未投入</td><td>前回のE01の4区分。離乳食の食い違いの主因。</td></tr>
<tr><td>投入済みだが入力語で取得できない</td><td>前回の「ねんね」や、今回の修正前「補完食」。語彙・概念の対応や対象条件の問題と、資料不足を分ける。</td></tr>
<tr><td>原文は取得できるが説明用データがない</td><td>E01の4区分、E02-S02・E02-S03。原文と必須文脈を表示し、説明は準備中と示す。</td></tr></table></div>
<h2>3. 4資料・11区分の収録状況</h2>
<p>E01＝授乳・離乳、E02＝睡眠、E03＝親子への介入研究、E04＝スクリーン関連介入研究。以下は<strong>収録・検索・表示の準備状況</strong>で、正式な承認状態とは別です。</p>
<div class="tablescroll"><table><thead><tr><th>区分</th><th>原文・必須文脈保存</th><th>前回環境</th><th>今回環境</th><th>検索可能性・確認した語</th><th>説明用事実データ</th></tr></thead><tbody>${unitsHTML}</tbody></table></div>
<p>全11区分について実際の取得例を保存しました。年齢・対象を未指定にした資料検索による一覧確認であり、個人への適用承認ではありません。任意の言い方や条件で必ず取得できるという意味でもありません。各区分の全ヒット集合・入力・原文・必須文脈は<code>inventory.json</code>に記録しています。</p>
<p><strong>正式承認：</strong>全区分で人間による承認記録なし・未公開のままです。一時DBでも下書き・未レビューのまま維持し、通常検索では取得できないことを確認しました。事実データは既存の5件のままです。</p>
<h2>4. 日常語の追加と検索結果</h2>
<p>既存の概念辞書に「ねんね」「眠る時間」「粉ミルク」「親子のやりとり」「親子の関わり」「画面を見る時間」を追加しました。補足的な専門的言い換えとして「補完食」も確認しました。質問全文やケースIDによる分岐ではありません。</p>
<p>「補完食」は、追加直後には原文へ到達しませんでした。既存投入処理で共通語「離乳」が別の概念に再割り当てされるためです。保存原文に実在する固有の語句「離乳の開始」を、既存の離乳開始の概念とE01-S03に結び付ける限定的な修正を一時環境だけで行いました。原文・適用条件・承認状態は変更していません。</p>
<div class="tablescroll"><table><tr><th>確認した入力</th><th>追加前</th><th>追加・限定修正後</th></tr>${positive}</table></div>
<p>この6例では、意図した区分を取得できた例が<strong>${lexical.positiveBeforeHits}/6 → ${lexical.positiveAfterHits}/6</strong>になりました。小さな確認セットの結果であり、検索全体の再現率を測ったものではありません。</p>
<h2>5. 異なる意味を拾う例も確認</h2>
<p>単純な同義語追加だけでは誤検索が増えました。「ねんねアート」「ねんねグッズ」は複合語として辞書上の除外を設け、その箇所だけを検索語から除きました。「ねんねアートと睡眠時間」のように別の明確な検索語を含む場合は、その語による検索を残します。対象者・年齢・診断を推定する処理ではありません。</p>
<div class="tablescroll"><table><tr><th>別の意図の入力</th><th>従来</th><th>同義語追加のみ</th><th>複合語除外後</th></tr>${negative}</table></div>
<p class="warning"><strong>誤検索は残っています。</strong>負例6件中の誤ヒットは、従来${lexical.negativeBeforeHits}件 → 単純追加${lexical.negativeRawAfterHits}件 → 限定的な複合語除外後${lexical.negativeAfterHits}件です。「ねんね用品の通販」は今回の追加で新たに拾ってしまう例、「動画編集ソフト」「うつ伏せの写真」は既存検索にもあった例です。意味を一般的に理解して除外できる機能にはなっておらず、通常経路への適用は行っていません。</p>
<h2>6. 利用者向けの表示</h2><blockquote>登録資料から該当箇所を見つけられませんでした</blockquote><blockquote>関連資料はありますが、分かりやすい説明は準備中です</blockquote>
<p>内部では語彙不一致・条件付き検索結果・投入状況・事実データの有無を保持します。画面には平易な文を表示し、0件だけを理由に「科学的根拠がない」「資料が存在しない」とは表示しません。</p>
<div class="pair"><div>${image("unrelated-no-hit","見つからなかった場合の表示")}</div><div>${image("compound-no-hit","異なる意味の複合語を除外した例")}</div></div>
<details><summary>離乳食の原文が見つかり、説明は準備中となる画面</summary>${image("feeding-full","離乳食の検索結果")}${image("feeding-original-context","E01-S03の原文・脚注・必須文脈")}</details>
<details><summary>日常語から既存の事実データへ到達した画面</summary>${image("daily-sleep-full","「ねんね」から睡眠資料へ")}</details>
<h2>7. 保全と片付け</h2><ul><li>${cleanup.passedChecks}項目の確認が通過。別に${cleanup.observations}件を観測事項として記録し、誤検索を成功扱いしていません。</li><li>${cleanup.cases}件の検索記録、${cleanup.sqlCalls}回の既存SQL実行。追加モデルAPI送信0。</li><li>既存${baseline.entries.length}ファイルのハッシュ一致。過去の資料・検索記録・回答・採点・実装は上書きなし。</li><li>新規資料の収集と説明用事実データの追加なし。既存DB・承認・通常相談経路・本番公開の変更なし。</li><li>所有確認付き一時DB・ブラウザー・画面用ディレクトリを終了・削除。正常終了と残存なしを確認。</li></ul>
<p>このレポートは保存した画面例と検証記録です。常設の検索画面は残していません。</p>
<details><summary>同梱フォントのライセンス</summary><pre>${h(fontLicense)}</pre></details></html>`;
fs.writeFileSync(`${out}/inventory-search-report.html`,html,{flag:"wx"});
const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p)}}
walk(out);walk("prototypes/evidence-consultation/vocabulary-inventory-review");
fs.writeFileSync(`${out}/delivery-manifest.json`,JSON.stringify({entries:files.map(p=>({path:p,sha256:digest(p)})),
  oldFilesUnchanged:baseline.entries.length,appendOnlyCorrection:true,modelApiCalls:0,approvalChanged:false,
  remainingFalsePositiveCount:lexical.negativeAfterHits,negativeTestCount:lexical.negativeTestCount,
  normalRouteApplied:false,temporaryEnvironmentRemoved:true},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({report:`${out}/inventory-search-report.html`,inventory:`${out}/inventory.csv`,
  preserved:baseline.entries.length,units:inventory.length,facts:inventory.flatMap(i=>i.factIds).length}));