import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = path.resolve("evidence-work/practical-guidance-pilot-01");
const font = fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const result = read("validation/result.json");
const summary = read("validation/brief-summary.json");
assert.equal(summary.status, "passed_cleanup_complete");
assert.equal(result.invocationNonce, summary.invocationNonce);
assert.equal(result.cleanupAttestation.ownedRootRemoved, true);
assert.equal(result.cleanupAttestation.ownedPostgresIdentityGone, true);
assert.equal(summary.retrievalVerifiedUnits, 17);
assert.equal(summary.normalSearchPilotCandidateCount, 0);
const primary = result.queries.filter(q => q.kind === "primary");
assert.equal(primary.length, 4);
const examples = [
  {
    title: "出かける前の支度が進まない",
    unit: "cdc-routines-simple",
    audience: "原資料のシリーズ対象は2〜4歳。個別の適合は未確認。",
    text: "出発前の流れを「おもちゃを置く→靴を履く」など短くして、一緒に確認してみる選択肢があります。どの場面で支度が止まりますか？",
    distinction: "手順の具体例はWe育側の応用例で、原文の具体例ではありません。成功や効果を保証しません。",
  },
  {
    title: "子どもとどう遊べばよいか分からない",
    unit: "cdc-communication-follow-play-interest",
    audience: "原資料のシリーズ対象は2〜4歳。安全な遊びの場面を想定。",
    text: "新しい遊びを用意する代わりに、子どもが今している安全な遊びを少しまねてみる方法があります。車を転がしていたら、隣で同じように転がす、といった形です。今はどんな遊びをしていますか？",
    distinction: "車の例はWe育側の応用例。子どもが望まない関わりを強制せず、発達や関係改善の効果を保証しません。",
  },
  {
    title: "食べないので毎回作り直して疲れる",
    unit: "nhs-fussy-eaters-no-force-retry",
    audience: "原資料に数値の年齢境界なし。一般的な食事場面の関わりに限定。",
    text: "食べないたびに作り直すのは負担ですね。拒んだ食べ物を今は無理に食べさせず、別の機会にもう一度出す、という選択肢があります。これは「代わりの食事を用意しない」という指示ではありません。",
    distinction: "We育編集の翻案であり、公的機関の日本語回答・監修済み助言ではありません。栄養状態、病気、必要量は判定しません。",
    license: "Contains public sector information licensed under the Open Government Licence v3.0.",
  },
  {
    title: "頼れる人がいなくて休めない",
    unit: "cfa-regional-parenting-support-current-functions",
    audience: "原資料は乳幼児と保護者。自治体別の条件は未確認。",
    text: "地域子育て支援拠点で、休めない状況を相談する選択肢があります。子育ての相談や情報提供を行う地域の場です。子どもを預かってもらえるとは限らないため、相談方法や利用条件は地域の公式案内で確認します。どの市区町村の案内を確認したいですか？",
    distinction: "こども家庭庁の現行実施要綱をもとにWe育が編集。拠点への相談と一時預かりは別の事業で、利用・紹介・空きを保証しません。",
  },
];
examples.forEach((example, i) => {
  assert.equal(primary[i].question, example.title);
  assert(primary[i].results.some(hit => hit.unitId === example.unit));
  assert((example.text.match(/[？?]/g) || []).length <= 1);
});
const editorial = {
  label: "検索結果を使った編集見本・AI未接続・未承認",
  modelPerformanceEvaluation: false,
  resultSha256: createHash("sha256").update(fs.readFileSync(path.join(root, "validation/result.json"))).digest("hex"),
  examples: examples.map((example, i) => ({
    ...example,
    retrievalUnitIds: primary[i].results.map(hit => hit.unitId),
    retrievedSectionId: primary[i].results.find(hit => hit.unitId === example.unit).sectionId,
  })),
};
fs.writeFileSync(path.join(root, "editorial-examples.json"), JSON.stringify(editorial, null, 2) + "\n");
const e = text => String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const rows = [
  ["CDC：日課・ルール", "4", "簡単な日課／見通し／能力と安全に合う役割／変更の説明"],
  ["CDC：関わり・会話", "5", "聞く／感情を受け止める／遊びへの関心／行動の描写／接触の意思尊重"],
  ["食事場面の実践ガイダンス", "4", "一緒に食べる／少量の盛り付け／無理強いせず別の機会に試す／食卓の会話"],
  ["こども家庭庁：現行制度", "4", "一時預かりの概要・自治体確認／地域事業全体の位置づけ／拠点の現行機能"],
];
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:">
<title>実践的な育児情報：準備・検索検証報告</title>
<style>@font-face{font-family:LocalJP;src:url(data:font/woff2;base64,${font})}body{font-family:LocalJP,system-ui,sans-serif;max-width:980px;margin:40px auto;padding:0 22px;color:#243347;line-height:1.8}h1{font-size:28px}h2{margin-top:36px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:10px;text-align:left;vertical-align:top}.note,article{background:#f1f5f9;padding:18px;border-radius:8px;margin:16px 0}small{color:#526278}code{overflow-wrap:anywhere}a{color:#1d4ed8}blockquote{margin:12px 0;border-left:3px solid #64748b;padding-left:16px}@media print{body{margin:0}article{break-inside:avoid}}</style>
<h1>実践的な育児情報：準備・検索検証報告</h1>
<p class="note"><b>4資料群・7出典レコード・18区分を一時DBに読み込み。現行17区分の検索確認を完了しました。</b><br>旧制度説明1区分は履歴として隔離し、検索対象外です。全件が未承認の下書きです。</p>
<h2>準備できた本文区分</h2><table><tr><th>資料群</th><th>現行区分</th><th>内容</th></tr>${rows.map(row=>`<tr>${row.map(x=>`<td>${e(x)}</td>`).join("")}</tr>`).join("")}</table>
<p>原文と箇所、日本語要旨、対象、提案可能範囲、条件、禁止する断定、原資料の例とWe育の応用例を分けて保存しました。日本語要旨は未確認の派生文として保持し、原文や専門職確認済み情報にはしていません。</p>
<p>分類は「科学的根拠」「実践ガイダンス」「制度・支援情報」「専門職の実践知」の4つ。今回は後者の専門職確認済み情報は0件です。発行元の知名度で科学的確実性を上げていません。</p>
<h2>検索確認</h2><p>指定4相談：4/4、言い換え4件：4/4で候補を取得。17現行区分それぞれについて原文語と一般的な日本語語句の両方で本文区分への到達を確認。無関係・診断用の対照2件は0件でした。通常の承認済み検索への混入は0件です。</p>
<p>これは隔離した候補検索の検証であり、全相談への検索性能、臨床的妥当性、実モデルの性能の評価ではありません。モデルAPIは呼んでいません。</p>
<h2>短い編集見本</h2><p>以下は未承認のWe育編集例です。具体例の言い回しは原資料そのものではなく、効果や個別の適合を保証しません。原資料の来歴は末尾の監査情報と別ファイルで管理しています。</p>
${examples.map((x,i)=>`<article><h3>${i+1}．${e(x.title)}</h3><small>${e(x.audience)}<br>検索：${primary[i].results.length}件／使用区分：<code>${e(x.unit)}</code></small><blockquote>${e(x.text)}</blockquote><p><small>${e(x.distinction)}</small></p>${x.license?`<p><small>${e(x.license)} <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener">OGL v3.0</a></small></p>`:""}</article>`).join("")}
<h2>対応年齢・不足領域</h2><p>CDCはシリーズの2〜4歳向けという範囲を保持し、細かな月齢境界には換算しません。食事資料の数値年齢は不明、制度資料は乳幼児等の原文表現を保持。0〜6歳全体の裏付けが揃ったとは扱いません。特に5〜6歳への外挿、個別の栄養・病気の判断、自治体別の対象・料金・空き・申込手順は不足しています。</p>
<h2>利用条件・保留</h2><ul>
<li>CDC：原文保存は条件付きで準備。帰属、目立つ非推奨表示、原文が無料である旨、非フレームのリンク、更新確認を保持。日本語加工の公開時の実装・条件確認は保留。</li>
<li>食事資料：原文と翻案の表示条件を分離。原文は取得日の表示または規定の更新、リンク、帰属、OGL告知。日本語翻案には標準OGL告知を使い、翻案を原機関の日本語回答として帰属させません。原文の来歴と分離して扱います。</li>
<li>こども家庭庁：PDL1.0に従い出典・URL・We育による加工表示を保持。旧ガイドだけでは現行と扱わず、令和8年4月8日の実施要綱等で照合。旧説明1区分は現行検索から保留。</li>
<li>全資料：画像・動画・ロゴは根拠データに取り込まず、第三者素材は対象外。将来の外部AI送信は、保持・学習・再配布・表示条件など未確認のため運用上保留。著作権条件の確認を、外部送信の実施許可とは扱いません。</li></ul>
<p>栄養・病気の判定、一律の食形態や量、「毎回代わりの食事を作らない」といった原文にないルールは追加していません。</p>
<h2>後片付けと変更範囲</h2><p>一時DBを停止・削除し、所有ディレクトリの消滅とPostgreSQLプロセス識別子の消滅を同じ実行の証跡で確認しました。準備用本文・監査記録・検証結果のみプロジェクトに残しています。既存DB、通常相談経路、採用・公開承認、本番公開は変更していません。</p>
<h2>原資料・利用条件の監査情報</h2><p>以下は取得した原資料の来歴で、上の日本語編集文を各機関の公式回答として帰属させるものではありません。</p>
<ul>${[
["CDC / Routines and Rules","https://www.cdc.gov/parenting-toddlers/structure-rules/"],
["CDC / Connecting and Communicating","https://www.cdc.gov/parenting-toddlers/communication/index.html"],
["原文：Fussy eaters / NHS website","https://www.nhs.uk/baby/weaning-and-feeding/fussy-eaters/"],
["こども家庭庁 / すくすく（旧制度説明の入口）","https://www.cfa.go.jp/policies/kokoseido/sukusuku"],
["こども家庭庁 / 家庭支援事業","https://www.cfa.go.jp/policies/katei_shien"],
["CDC利用条件","https://www.cdc.gov/other/agencymaterials.html"],
["NHS利用条件（特に3.6の原文・翻案の区別）","https://www.nhs.uk/our-policies/terms-and-conditions/"],
["こども家庭庁利用条件","https://www.cfa.go.jp/copyright-policy"],
].map(([label,url])=>`<li><a href="${e(url)}" target="_blank" rel="noopener">${e(label)}</a></li>`).join("")}</ul>
<p><small>CDC資料はCDCが作成したもので原サイトで無料公開されています。本報告での利用・リンクはCDC、ATSDR、HHSまたは米国政府によるWe育の推奨を意味しません。</small></p>
</html>`;
fs.writeFileSync(path.join(root, "report.html"), html);
console.log("Report and editorial examples written; four examples bound to actual retrieved sections. No DB, model or network used.");