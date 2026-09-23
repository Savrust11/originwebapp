// Static append-only packaging; no application, DB, browser or network startup.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const out="evidence-work/parent-reading-evaluation/candidate-relevance-gate-01";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const sha=p=>createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const latest=read(`${out}/latest-success.json`),v=read(latest.verification),cleanup=read(latest.cleanup);
const seal=read(`${out}/plan-seal.json`),plan=read(`${out}/test-plan.json`);
assert.equal(v.result,"PASSED");assert.equal(cleanup.ownedRunnerExitCode,0);
assert.equal(cleanup.remainingTemporaryDirectories.length,0);
assert.equal(sha(`${out}/test-plan.json`),seal.sha256);
assert.equal(v.planSha256,seal.sha256);
const baseline=read(`${out}/preservation-baseline.json`);
for(const e of baseline.entries)assert.equal(sha(e.path),e.sha256,`historical file changed: ${e.path}`);
const h=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const csv=s=>`"${String(s??"").replaceAll('"','""')}"`;
const metricNames=["relatedCandidateRetrieved","unrelatedCandidateRetrieved","unrelatedCandidateReachedFactOrComparison","neededConfirmationStopped","relatedQuestionIncorrectlyBlocked","initialPaused","extraConfirmationActions","upfrontTopicSelectionActions"];
const rows=[["set","id","question","candidateUnitIds","relatedCandidateUnitIds","unrelatedCandidateUnitIds","finalUnitIds",...metricNames]];
for(const c of v.cases)rows.push([c.set,c.id,c.question,c.candidateUnitIds.join(" / "),c.relatedCandidateUnitIds.join(" / "),c.unrelatedCandidateUnitIds.join(" / "),c.finalUnitIds.join(" / "),...metricNames.map(k=>c.metrics[k])]);
fs.writeFileSync(`${out}/case-metrics.csv`,"\uFEFF"+rows.map(r=>r.map(csv).join(",")).join("\r\n")+"\r\n",{flag:"wx"});
const font=fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const license=fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt","utf8");
const image=(name,label)=>{
  const i=v.images.find(i=>i.name===name);assert(i);assert.equal(sha(i.path),i.sha256);
  return `<figure><figcaption>${h(label)}</figcaption><img alt="${h(label)}" src="data:image/png;base64,${fs.readFileSync(i.path).toString("base64")}"></figure>`;
};
const labels={
  relatedCandidateRetrieved:"関連候補を取得",unrelatedCandidateRetrieved:"無関係候補も取得",
  unrelatedCandidateReachedFactOrComparison:"無関係候補から事実表示・比較へ進行",
  neededConfirmationStopped:"無関係候補を含む結果を確認で保留",
  relatedQuestionIncorrectlyBlocked:"関連質問を確認後も取得できず停止",
  initialPaused:"最初の検索で一時保留",extraConfirmationActions:"追加の確認・拒否・言い直し操作",
  upfrontTopicSelectionActions:"検索前の話題選択操作"
};
const summaryRows=Object.entries(labels).map(([key,label])=>`<tr><th>${h(label)}</th><td>${v.metrics.known[key]}</td><td>${v.metrics.novel[key]}</td></tr>`).join("");
const caseRows=v.cases.map(c=>`<tr><td>${c.set==="known"?"既知":"新規"}<br><small>${h(c.id)}</small></td><td>${h(c.question)}</td><td>${h(c.relatedCandidateUnitIds.join("、")||"なし")}</td><td>${h(c.unrelatedCandidateUnitIds.join("、")||"なし")}</td><td>${c.metrics.initialPaused?"確認で一時保留":"追加確認なし"} → ${c.expected.action==="reject"?"該当しない":c.expected.action==="rephrase"?"言い直す":c.finalUnitIds.length?h(c.finalUnitIds.join("、")):"候補なし"}<br><small>追加操作 ${c.metrics.extraConfirmationActions}／事前選択 ${c.metrics.upfrontTopicSelectionActions}</small></td></tr>`).join("");
const related=v.cases.filter(c=>c.expected.relatedUnits.length);
const relatedPaused=related.filter(c=>c.metrics.initialPaused).length;
const wrong=v.observations.find(o=>o.name.startsWith("Wrong affirmative"));
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>検索候補と話題確認後の資料表示を分ける非公開検証</title>
<style>@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font:15px/1.85 JP,sans-serif;color:#253b2f;max-width:1080px;margin:auto;padding:22px;overflow-wrap:anywhere}h1{font-size:26px;line-height:1.5}h2{font-size:21px;border-top:1px solid #bfd0c4;padding-top:18px;margin-top:30px}.notice{background:#e8f2eb;border-left:4px solid #36734f;padding:16px}.warning{background:#fff1db;border-left:4px solid #966323;padding:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c5d4ca;text-align:left;vertical-align:top;padding:9px}.scroll{overflow:auto}small,code{font-size:12px}figure{margin:18px 0}figcaption{font-weight:bold}img{width:390px;max-width:100%;height:auto;display:block;margin:12px auto;border:1px solid #c5d4ca}details{margin:18px 0}summary{font-weight:bold;cursor:pointer}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pair>div{min-width:0}blockquote{background:#f0f4f1;padding:14px;margin:12px 0}pre{white-space:pre-wrap}@media(max-width:700px){body{padding:12px}.pair{grid-template-columns:1fr}th,td{font-size:12px;padding:6px}}</style>
<h1>検索候補と、話題確認後の資料表示を分ける</h1>
<p class="notice">非公開の一時環境で検証。追加モデルAPI送信0。辞書は前回の検証用変更を維持し、新しい除外語・資料・説明用事実データは追加していません。既存DB・資料承認・通常相談経路・本番公開は変更なし。</p>
<h2>今回の最小改修</h2>
<ol><li><strong>キーワード一致は候補取得のみ。</strong>候補段階では出典名などと話題確認だけを表示し、事実HTML・原文引用・睡眠数値・比較結果を返しません。年齢が合うことを話題確認の代わりにしません。</li>
<li><strong>未指定なら短く確認。</strong>「睡眠時間についての資料を探していますか？」など、候補の資料区分に対応する話題を確認します。「はい」「該当しない」「言い直す」を選べます。</li>
<li><strong>確認後に実際に再検索。</strong>明示した話題の既存辞書語と入力条件で再検索し、その話題の論理区分だけを共通表示器に渡します。別の話題の候補は混ぜません。</li>
<li><strong>確認を使い回さない。</strong>相談文・対象・年齢・健康条件・睡眠入力が変われば、確認と以前の表示を無効化します。検索中は古い表示をすぐ消し、古い応答・エラーが新しい表示を上書きしないようにしました。</li>
<li><strong>一律停止はしない。</strong>検索前に話題を明示選択した場合は追加確認なし。同じ入力と確認が続く場合も再確認しません。候補0件のときには話題確認を出しません。</li></ol>
<p>新しい意図分類器や質問別の回答カードではありません。話題確認は利用者の明示選択です。確認後も表示するのは一般的な資料情報であり、質問への結論・回答の十分性・個人への適用を承認したものではありません。</p>
<h2>画面例</h2><div class="pair"><div>${image("shopping-candidates-paused","通販の質問で睡眠候補が出ても、説明・比較には進まない")}</div><div>${image("mixed-topic-prompt","商品と育児相談が混在しても、文章全体を除外しない")}</div></div>
<details><summary>「該当しない」を選んだ結果</summary>${image("rejected-topic","候補から回答用表示へ進まず終了")}</details>
<details><summary>確認後は選んだ話題の資料だけ表示</summary>${image("confirmed-general-information","動画編集ソフトと睡眠相談の混在文で、睡眠だけを選択")}</details>
<h2>修正前に固定した検証</h2>
<p>既知5件と、新しく作った言い換え・混在文7件の、質問・関連区分・期待する停止／進行・利用者の操作を実装前に固定しました。新規セットは実装者に非公開の盲検ではなく、あらかじめ作成した別セットです。実行結果を見て12件の期待値を変更していません。</p>
<p>固定時刻：<code>${h(seal.sealedAt)}</code>。固定時に実装ディレクトリは未作成。計画SHA-256：<code>${h(seal.sha256)}</code>。検証の開始・終了時に一致を確認しました。</p>
<p>入力変更、検索中の表示消去、古い応答／エラーの無効化は、固定済みの「確認は現在の入力に結び付ける」という条件を具体化する追加のUI検証です。12件の言い換え成績には混ぜていません。</p>
<h2>既知例と新規例の結果を分離</h2>
<div class="scroll"><table><tr><th>質問単位の指標</th><th>既知5件</th><th>新規7件</th></tr>${summaryRows}</table></div>
<p>同じ質問に関連候補と無関係候補が混在できるため、両方に計上する場合があります。「確認で保留」は無関係候補を含む検索結果を止めた件数です。単にすべての停止を成功として数えていません。表の「0件」は予定した確認・拒否操作を行った12件についての結果で、下の誤確認試験まで含めたゼロではありません。</p>
<div class="scroll"><table><tr><th>セット</th><th>質問</th><th>関連候補</th><th>無関係候補</th><th>確認・進行と手間</th></tr>${caseRows}</table></div>
<h2>利用者の手間・取りこぼし</h2>
<p><strong>関連する${related.length}件のうち${relatedPaused}件は、最初の検索で一時保留になりました。</strong>これは追加の手間であり、「止めたから成功」とだけは評価しません。予定した適切な確認後は全${related.length}件で関連する区分に進み、継続して取りこぼした例は0件でした。</p>
<p>検索前の話題選択は追質問を省けますが、選択そのものは1操作です。睡眠の任意条件を編集した場合にも話題を再確認するため、追加の確認が必要になります。この負担をブラウザー操作で確認しました。辞書が候補を取得できない関連質問全般の取りこぼしを解決したものではありません。</p>
<h2>残る限界：誤って「はい」を選ぶ場合</h2>
<p class="warning"><strong>利用者が誤った話題を肯定すると、自動では見抜けません。</strong>追加の限界試験では「ねんね用品の通販」に対し「睡眠時間」を肯定すると、${h(wrong.factsShown.join("、"))}の一般情報が表示され、必要な睡眠条件も入力済みなら数値比較まで進みました（比較実行：${wrong.comparison?"あり":"なし"}）。この1件を、既知／新規12件の「不適切な進行0件」に混ぜて隠していません。</p>
<p>したがって今回の改修は、キーワード一致だけから自動で回答用表示へ進むことを止める境界です。確認された話題が本当に質問に適切か、資料が質問への回答として十分かを意味的に保証する仕組みではありません。</p>
<h2>数値比較・説明未準備の扱い</h2>
<p>睡眠の話題確認に加え、年齢・夜と昼寝の実睡眠・同じ1日・記録の完全性・昼寝込み・別出典との関連付けが揃ったときだけ、既存の数値比較を実行します。年齢未入力は推測せず保留します。</p>
${image("confirmed-numeric-detail","話題と必要条件を明示確認した後の比較")}
<blockquote>登録資料から該当箇所を見つけられませんでした</blockquote>
<blockquote>関連資料はありますが、分かりやすい説明は準備中です</blockquote>
<p>以前の平易な表示は維持しています。離乳開始を確認した場合はE01-S03の原文・文脈だけを表示し、離乳完了などの別区分は混ぜません。0件から「科学的根拠がない」「資料が存在しない」とは結論しません。</p>
<details><summary>候補0件と、離乳開始の原文表示</summary>${image("no-candidate-no-confirmation","候補0件では話題確認を要求しない")}${image("feeding-original-preparing","原文はあるが説明用事実データは準備中")}</details>
<h2>保全・検証・片付け</h2><ul><li>${v.checks.length}項目の検証が通過。別に誤肯定時の限界を${v.observations.length}件記録。</li><li>既存SQLを${v.sqlCalls}回実行。既存4資料・11区分は下書き・未レビューのまま。通常検索では候補資料を取得できないことを前後で確認。</li><li>既存${baseline.entries.length}ファイルのハッシュ一致。過去の記録・実装・資料・承認状態は上書きなし。</li><li>モデルAPI送信0、ブラウザー外部要求0、既存DB接続なし。通常アプリ・HTTPサーバー起動なし。</li><li>所有プロセス正常終了、一時DB・ブラウザー・画面用ディレクトリは終了・削除。残存なし。</li></ul>
<details><summary>失敗記録も保存</summary><p>最初の2試行は健康条件変更の検証で停止しました。既存契約にないキー、その後は睡眠資料に不要な健康回答を与えていたためです。既存の入力検証が働いた結果を「話題確認」や「資料なし」と誤表示しないよう入力エラーを明示し、固定済みの入力変更時の無効化を確認しました。試行1〜4は別ディレクトリに保持しています。</p></details>
<p>本レポートは保存済みの画面と検証記録です。常設の検索画面や通常経路への適用は残していません。</p>
<details><summary>同梱フォントのライセンス</summary><pre>${h(license)}</pre></details></html>`;
fs.writeFileSync(`${out}/candidate-relevance-report.html`,html,{flag:"wx"});
const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p)}}
walk(out);walk("prototypes/evidence-consultation/candidate-relevance-gate");
fs.writeFileSync(`${out}/delivery-manifest.json`,JSON.stringify({entries:files.map(p=>({path:p,sha256:sha(p)})),
  testPlanSha256:seal.sha256,protectedFiles:baseline.entries.length,oldFilesUnchanged:true,
  newModelApiCalls:0,normalRouteApplied:false,approvalsChanged:false,temporaryEnvironmentRemoved:true,
  primaryCaseCount:v.cases.length,wrongAffirmativeLimitCaseCount:1},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({report:`${out}/candidate-relevance-report.html`,csv:`${out}/case-metrics.csv`,checks:v.checks.length,metrics:v.metrics}));