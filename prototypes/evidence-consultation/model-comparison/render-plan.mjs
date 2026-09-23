import fs from "node:fs";
import path from "node:path";
import { BASE, verifyPreservation } from "./preserve.mjs";
const read = name => JSON.parse(fs.readFileSync(path.join(BASE, name), "utf8"));
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = micro => `$${(micro / 1_000_000).toFixed(6)}`;
const cases = read("cases.json");
const models = read("models-and-budget.json");
const rubric = read("rubric.json");
const sources = read("source-content.json");
const policy = read("comparison-policy.json");
const preservation = verifyPreservation();
const details = (label, value) => `<details><summary>${escape(label)}</summary><pre>${escape(value)}</pre></details>`;
const questionList = lane => cases.cases.filter(item => item.lane === lane).map(item =>
  `<article class="question" data-case="${escape(item.caseId)}"><h3>${escape(item.caseId)}</h3>
  <p>${escape(item.question)}</p><p class="muted">完全原文：${item.originalIds.map(escape).join(" / ")}</p>
  ${details("事前固定した採点項目（生成モデルには送らない）", JSON.stringify(rubric.cases[item.caseId], null, 2))}</article>`).join("");
const modelRows = models.models.map(model => `<tr><td><a href="${escape(model.source)}">${escape(model.id)}</a></td>
  <td>$${model.standardUncachedInputUSDPerMillion.toFixed(2)}</td><td>$${model.standardOutputUSDPerMillion.toFixed(2)}</td>
  <td>${money(model.assumedCostMicroUSDPerQuestion)}</td><td>12</td><td>${money(model.estimatedTotalMicroUSD)}</td></tr>`).join("");
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>別モデル比較・実行前計画｜追加送信なし</title><link rel="icon" href="data:,"><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f5;color:#17352e;font:16px/1.8 system-ui,-apple-system,"Noto Sans JP",sans-serif}
main{max-width:1080px;margin:auto;padding:32px 18px 80px}h1{font-size:30px;line-height:1.5}h2{font-size:23px;border-bottom:2px solid #bad3cb;padding-bottom:9px}
h3{font-size:18px;margin:8px 0}section,.hero{background:white;border:1px solid #d4dfda;border-radius:14px;padding:26px;margin:20px 0}
.badge{display:inline-block;background:#e7f3ed;border:1px solid #98b9ab;padding:3px 12px;border-radius:30px;font-weight:700}
.notice{padding:14px;background:#fff5de;border-left:4px solid #b97822}.muted{color:#5a7068;font-size:14px}.table{overflow:auto}
table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:12px;border-bottom:1px solid #dbe4e0;text-align:left;vertical-align:top}
th{background:#edf3ef}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f4f1;padding:15px;font:14px/1.8 monospace}
details{margin:12px 0}summary{cursor:pointer;font-weight:600}a{color:#176253}code{overflow-wrap:anywhere}
.question{border-top:1px solid #dbe4e0;padding:16px 0}blockquote{margin:10px 0;padding:12px 18px;border-left:3px solid #9cbcb0;background:#f4f7f5}
@media(max-width:600px){main{padding:14px 10px 40px}section,.hero{padding:17px}h1{font-size:25px}h2{font-size:21px}th,td{padding:8px}table{font-size:13px}}
</style></head><body><main>
<header class="hero"><span class="badge">準備のみ・実行未許可</span><h1>育児資料の読解<br>別モデル比較の実行前計画</h1>
<p>現在の累計 <strong>19通信・$0.025879</strong> を保持。今回の追加モデルAPI通信は <strong>0</strong>。残る旧枠の20回目は使いません。</p>
<p class="muted">保存済み結果・判定・費用は不変。既存DB、実利用者情報、通常相談経路、資料の採用・公開承認、本番公開は対象外。</p></header>
<section id="roles"><h2>1. Q05：省略と誤帰属を分ける</h2>
<p>以前の不合格は「AASMへの帰属を本文に書く」という送信前の固定基準によります。隣接表示では省略を補えないという一般原則ではありません。過去の不合格は変更せず、以下を次回の前向き基準にします。</p>
<div class="table"><table><thead><tr><th>本文の状態</th><th>本文単体</th><th>画面全体</th></tr></thead><tbody>
<tr><td>主体を直接問われておらず、省略しただけ</td><td>書いた内容が正しければ、省略だけで意味を不合格にしない。帰属はabsent、帰属情報の完備性は別記録。</td><td>確認済みの正しい紹介主体・推奨主体の関係を隣接表示し、他の条件も満たせば合格可能。</td></tr>
<tr><td>誤った主体への帰属、未取得原文を読んだとの主張</td><td>意味は不合格。</td><td>正しいカードがあっても本文の誤り・矛盾を修復できず不合格。</td></tr>
<tr><td>質問が「誰の推奨か」を直接尋ねたのに省略</td><td>質問への回答不足。本文必須項目として不合格。</td><td>アプリだけで直接質問への本文回答を代替しない。不合格。</td></tr>
</tbody></table></div>
<p>Q05のような省略では、意味の正確さと情報の提示場所を分けます。Q06のように推奨主体を直接尋ねる質問は本文必須です。正しい出典IDが付いているだけでは、主張の意味が支持される証明にはなりません。</p></section>
<section id="q10"><h2>2. Q10：誤読の内容</h2><div class="table"><table><tbody>
<tr><th>原文</th><td>“children aged less than six years at baseline” → “the mean age of participants at baseline was less than six years”<br>子どもの年齢6歳未満という条件から、集団の平均年齢6歳未満という条件へ精緻化。</td></tr>
<tr><th>モデルの説明</th><td>「平均年齢が6歳以上の研究は除外する条件」から「参加者の平均年齢が6歳未満」の研究を含める基準へ変更。</td></tr>
<tr><th>違い</th><td>モデルの変更前後は実質的に同じ条件です。原文にある「個人の年齢条件→集団の平均年齢条件」という変更を取り違えました。</td></tr>
</tbody></table></div><p class="muted">対応原文：E04-C-PROTOCOL-DEVIATIONS。保存済みQ10の本文・不合格判定は変更しません。</p></section>
<section id="models"><h2>3. 比較候補と公式料金</h2>
<p>候補は <strong>gpt-5.6-sol</strong>。公式はSolを複雑な専門業務向けの旗艦モデル、現行Lunaを費用重視・大量処理向けと説明しています。同系列の上位用途として読解向上を期待する合理的な候補ですが、<strong>今回の育児資料で優れるとは未検証です</strong>。</p>
<div class="table"><table><thead><tr><th>モデルID／公式情報</th><th>入力／100万token</th><th>出力／100万token</th><th>1問見積り</th><th>問数</th><th>合計</th></tr></thead><tbody>${modelRows}</tbody></table></div>
<p>2026-09-18に公開公式ページで確認。Standard、キャッシュなし、1問あたり入力8,000＋推論分込み出力1,500 tokenを仮定。Solのプロモーション料金は少なくとも2026-11-21までと記載されています。実行を後日に行うなら料金の再確認が必要です。</p>
<p>送信先は現行と同じ <code>https://api.openai.com/v1/responses</code>。新しい接続先・契約追加を前提としません。公開仕様でResponses・構造化出力・medium対応を確認しましたが、現在のAPIキーでのSol利用権限・契約上の利用可否は<strong>未確認</strong>です。確認用API通信はしていません。</p></section>
<section id="budget"><h2>4. 実行前の通信数・予算</h2>
<ul><li>既知6問＋新規6問を両モデルで各1回：<strong>24生成通信</strong>。現モデルの既知6問も再生成し、過去回答を比較対照に流用しません。</li>
<li>認証・モデル一覧・token数確認の事前API通信：計画上0。外部の採点専用モデルAPIも追加しません。</li>
<li>追加見積り：<strong>${money(models.estimation.additionalEstimatedMicroUSD)}</strong>。過去費用込みの計算見積り：<strong>${money(models.estimation.cumulativeEstimatedMicroUSDIfSeparatelyAuthorizedAndCompleted)}</strong>。</li>
<li>余裕を含む予約案：Luna $0.003800／問、Sol $0.070000／問。追加予約合計$0.885600、過去費用込み$0.911479。</li>
<li>推奨は<strong>現行と同じ累計$1の運用予算</strong>。見積りはtoken仮定に基づき、最終請求額の保証ではありません。</li></ul>
<p class="notice">24通信には別途の明示許可が必要です。旧枠の残り1通信は充当せず、今回の上限・台帳変更はありません。将来24通信が新規に許可され全て実行された場合の通算は43ですが、現在は19のままです。</p>
<p>利用不可・認証エラーも許可後の試行1件として数え、全体停止します。認証確認を別に追加したり、別モデルへ自動切替したりしません。利用量・通信結果が不明なら0円で補わず停止。同時実行1、再試行0です。</p></section>
<section id="fairness"><h2>5. 公平性と評価方法</h2>
<ul><li>各質問の原文全文、共通生成指示、出力schema、reasoning=medium、最大出力1,500、tier・cache・tools等を一致させます。送信パケットの差分はmodelフィールドだけです。</li>
<li>アプリ表示は同じ確認済み条件・隣接配置に固定。既知と新規を交互にし、各グループで各モデルが先に生成される回数を3回ずつに均衡化します。</li>
<li>採点表、期待要点、正解例、過去回答、アプリ補完文は生成モデルに送りません。</li>
<li>新しい文脈のAI採点者にはX/Yの匿名回答と資料・基準だけを提示。モデル名、token、費用、時間、生成順を隠します。対応鍵は別保管し、採点固定後に開示します。文章の癖による推測までは防げません。</li>
<li>意味の正確さ、質問への回答充足、帰属の提示、アプリ表示、画面全体を別記録。<strong>日本語はpass／minor／majorを別採点</strong>し、日英混在・用語の曖昧さ・係り受け・自然さに根拠を付けます。</li>
<li>主比較は新規6問の画面意味合格を1問1票で比較。既知6問は別集計。同点なら意味成績は同点とし、日本語や費用を後付けの重みで混ぜて勝者を作りません。</li></ul>
<p>新規問題は今回作成した未実行の質問ですが、資料自体は既知です。独立した未見コーパスの試験ではなく、6問各1回で一般的・統計的な優越性を断定しません。上限到達を片方だけ再試行・延長しません。</p>
<p class="notice">評価はAIによる原文比較・日本語評価です。人による資料採用審査、臨床評価、個別適用の承認とは別です。</p></section>
<section id="new-questions"><h2>6. 新規6問（両モデルで評価・未送信）</h2>${questionList("author-created-holdout")}</section>
<section id="known-questions"><h2>7. 既知6問（質問は完全一致・両モデルで再生成予定）</h2>${questionList("known")}</section>
<section id="materials"><h2>8. 固定資料と保存確認</h2>
<p>旧142ファイル＋完了試験の${preservation.completedRunFiles}ファイルをhash照合で保護。モデル比較の実行台帳や結果は作成していません。</p>
${details("共通生成指示（生成モデルへ送る部分）", fs.readFileSync(path.join(BASE,"generation-rules.txt"),"utf8"))}
${details("共通採点規則（生成モデルへ送らない部分）",JSON.stringify(rubric.global,null,2))}
${details("比較・匿名採点・集計方針",JSON.stringify(policy,null,2))}
${Object.entries(sources.originals).map(([id, source])=>details(`完全原文：${id}`,source.originalText)).join("")}
<p class="muted">同梱のrequest-packets.jsonは送信内容案、app-display-templates.jsonはモデル間で共通の表示案です。送信機能・APIキー・接続情報の秘密値は含みません。</p></section>
</main></body></html>`;
fs.writeFileSync(path.join(BASE, "comparison-preparation.html"), html);
console.log(path.relative(process.cwd(), path.join(BASE, "comparison-preparation.html")));