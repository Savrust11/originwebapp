// Local document packaging only. No app, provider, database, environment, or
// networking modules are imported. Originals are read; delivery files use wx.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const roots = {
  closure: "evidence-work/comparison-closeout/reading-comparison-02",
  regression: "evidence-work/semantic-regressions/reading-comparison-02",
  questions: "evidence-work/parent-reading-evaluation/preparation-01",
};
const output = "evidence-work/offline-parent-preparation/final-01";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const closure = read(`${roots.closure}/closure.json`);
const plan = read(`${roots.questions}/plan.json`);
const regressionReview = read(`${roots.regression}/independent-review.json`);
const questionReview = read(`${roots.questions}/independent-review.json`);
assert.equal(closure.authorization.maxNewCalls, 0);
assert.equal(closure.authorization.remainingAuthorization, 0);
assert.equal(closure.authorization.externalCallsCumulative, 42);
assert.equal(plan.cases.length, 10);
assert.equal(plan.governance.newApiCallsMade, 0);
assert.equal(plan.governance.newApiCallsAuthorized, 0);
assert.equal(plan.governance.newApiCallsReserved, 0);
assert.equal(regressionReview.scope.modelRetest, "not-retested");
assert(regressionReview.requiredChanges.length === 0);
assert(["ACCEPT", "WITH-CAVEATS"].includes(questionReview.verdict),
  "Independent question review must be ready before document packaging.");

const protectedFiles = [
  ...["closure.json", "closure.md", "evidence-manifest.json", "verify.mjs"]
    .map(f => `${roots.closure}/${f}`),
  ...["fixtures.json", "manual-mapping.json", "regression-notes.ja.md",
    "independent-review.json", "independent-review.ja.md"].map(f => `${roots.regression}/${f}`),
  ...["plan.json", "plan.md", "source-bindings.json", "independent-review.json",
    "independent-review.md"].map(f => `${roots.questions}/${f}`),
];
// The independent parent review may use the .ja.md convention.
const last = protectedFiles.at(-1);
if (!fs.existsSync(last)) protectedFiles[protectedFiles.length - 1] =
  `${roots.questions}/independent-review.ja.md`;
protectedFiles.push(
  ...["claims.mjs", "offline-loader.mjs", "offline-bootstrap.mjs", "offline.test.mjs"]
    .map(f => `prototypes/evidence-consultation/semantic-regressions/${f}`),
  ...["offline-loader.mjs", "offline-bootstrap.mjs", "offline.test.mjs"]
    .map(f => `prototypes/evidence-consultation/parent-evaluation-preparation/${f}`),
  "prototypes/evidence-consultation/offline-preparation-report.mjs",
  ...["plan.json", "plan.md", "independent-review.json", "independent-review.md"]
    .map(f => `${roots.questions}/review-revision-history/before-refinement/${f}`),
);
const bindings = protectedFiles.map(p => {
  const bytes = fs.readFileSync(p);
  return { path: p, sha256: hash(bytes), bytes: bytes.length };
});

const note = {
  schemaVersion: 1,
  kind: "append-only-interpretation-qualification-not-rescoring",
  caseId: "C-H06",
  originalVerdict: "historical-AI-meaning-fail-retained",
  currentIndependentFinding: "ambiguous-not-unambiguously-established-error",
  incorrectBroadInterpretation:
    "原文が明示する測定の種類まで、一切分からないものとして扱う。",
  permittedNarrowUncertainty:
    "測定の種類の記載は保持する一方、研究ごとの詳細な機器・割当・併用や客観的睡眠結果は、抜粋から確定できないと区別する。",
  prohibitedOvercorrection:
    "残りはすべて保護者報告である、保護者報告研究は正確に4件である、と原文を越えて確定しない。",
  primaryReviewsModified: false,
  primaryCohortModified: false,
  modelRetested: false,
  modelProblemResolved: false,
  humanOrClinicalApproval: false,
  basis: bindings.filter(b => /closure\.json$|independent-review\.json$/.test(b.path)),
};

const escape = text => String(text).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const labels = {
  userNeed: "利用者が知りたいこと", sources: "対応資料", evidenceRefs: "根拠箇所",
  answerableScope: "原文から答えられる範囲", applicability: "対象・適用の境界",
  unknownsNotInFourSources: "4資料にはない情報",
  confirmations: "確認が必要な条件", prohibitedAssertions: "言ってはいけない断定",
  requiredBodyInfo: "本文に必要な情報", adjacentDisplayInfo: "隣接表示に必要な情報",
  rubric: "採点の観点", decisionTracks: "回答・確認・回答を控える分岐",
  primaryRouting: "基本の応答区分", question: "質問", title: "題名",
  correctInterpretation: "原文に沿う解釈", correctReading: "原文に沿う解釈",
  sourceExactExcerpts: "対応する原文（引用）",
  wrongExactSpan: "誤りを確認した説明（原文のまま）",
  wrongOrAmbiguousExactSpan: "保存された説明（解釈に幅がある箇所）",
  wrongLocator: "元の回答での位置", wrongOnlyIf: "誤りとなる読み",
  validNarrowReading: "許容される限定的な読み",
  correctBoundedReading: "原文が支える、範囲を限定した正しい解釈",
  use: "回帰事例としての扱い",
  source: "原文", wrongExplanation: "保存された説明", caveats: "留保・注意点",
  triple: "原文・保存された説明・解釈", caseId: "事例",
  body: "本文", adjacent: "隣接表示", text: "内容", reason: "理由",
  child: "子ども", caregiver: "養育者", household: "家庭",
  "bounded-answer": "原文の範囲で回答", "clarification-needed": "条件確認が必要",
  "substantive-abstention": "核心部分は資料不足で回答を控える",
};
function render(v) {
  if (v === null || v === undefined) return "<span>記載なし</span>";
  if (Array.isArray(v)) return v.length ?
    `<ul>${v.map(x => `<li>${render(x)}</li>`).join("")}</ul>` : "<span>なし</span>";
  if (typeof v === "object") return `<dl>${Object.entries(v).map(([k, x]) =>
    `<dt>${escape(labels[k] || k)}</dt><dd>${render(x)}</dd>`).join("")}</dl>`;
  return `<span>${escape(labels[v] || v)}</span>`;
}
const questionCards = plan.cases.map(c => `<article>
  <h3>${escape(c.id)}　${escape(c.title)}</h3>
  <blockquote>${escape(c.question)}</blockquote>
  <p class="route">${escape(labels[c.primaryRouting] || c.primaryRouting)}</p>
  ${["userNeed", "answerableScope", "confirmations", "prohibitedAssertions",
    "requiredBodyInfo", "adjacentDisplayInfo"].map(k =>
    `<h4>${labels[k]}</h4>${render(c[k])}`).join("")}
  <details><summary>根拠・対象条件・評価基準・判断分岐</summary>
  ${render(Object.fromEntries(["sources", "evidenceRefs", "applicability",
    "unknownsNotInFourSources", "rubric", "decisionTracks"].map(k => [k, c[k]])))}
  </details></article>`).join("");
const regressions = regressionReview.caseReviews.map(c => `<article>
  <h3>${escape(c.caseId)}　${escape(c.verdict)}</h3>${render(c.triple)}
  <h4>独立照合での留保</h4>${render(c.caveats)}
  </article>`).join("");
const sourceBindings = read(`${roots.questions}/source-bindings.json`);
const html = `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>比較終了記録・回帰事例・保護者向け10問の評価準備</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#172b35;font:16px/1.75 system-ui,sans-serif}
main{max-width:1080px;margin:auto;padding:36px 24px 80px;background:white}
h1{font-size:28px;line-height:1.4}h2{margin-top:42px;border-bottom:2px solid #286378;padding-bottom:8px}
h3{font-size:20px}h4{margin-bottom:6px}article{border:1px solid #d6e1e5;border-radius:8px;padding:20px;margin:24px 0}
.notice{background:#edf5f8;border-left:4px solid #286378;padding:18px}.caution{background:#fff6e5;border-left:4px solid #a46a12;padding:18px}
blockquote{margin:12px 0;padding:12px 18px;background:#f4f6f8;border-left:3px solid #94acb5}
dt{font-weight:650;margin-top:8px}dd{margin-left:18px}li{margin-bottom:6px}ul{padding-left:24px}
span,dd,blockquote{overflow-wrap:anywhere;white-space:pre-wrap}
details{margin-top:18px;border-top:1px solid #d6e1e5;padding-top:12px}summary{cursor:pointer;font-weight:650}
.route{font-size:14px;color:#365c6d}a{color:#155d7c}footer{margin-top:36px;font-size:14px;color:#52646b}
@media(max-width:600px){main{padding:20px 14px}article{padding:14px}h1{font-size:24px}dd{margin-left:8px}}
@media print{body{background:white}main{max-width:none}details{display:block}article{break-inside:avoid}}
</style><main>
<h1>比較終了記録・回帰事例・保護者向け10問の評価準備</h1>
<div class="notice">今回の比較は終了。累計42送信で、未使用の1枠も使いません。
Lunaは非公開試作の暫定候補に限り、本番採用は保留です。
この準備での追加API送信は0。モデル設定・DB・資料承認・本番公開は変更していません。</div>
<nav><p><a href="#closed">確定保存</a> ／ <a href="#regression">回帰事例</a> ／
<a href="#questions">10問の評価案</a> ／ <a href="#audit">検証の限界と根拠</a></p></nav>
<h2 id="closed">1．比較結果の確定保存</h2>
<ul><li>主解析：既知4組＋新規4組＝8組。元の採点・対象を維持。</li>
<li>補足：H04の両モデルとK08のLuna。モデル名の開示後に行った独立補足で、主解析へ合算しません。</li>
<li>H06：参考評価。保存Solの完了証拠が不足するため、完了ペアとして扱いません。</li>
<li>検査器の公開出典ID誤検知3件と、モデルの意味判定、K08 Solの出力上限による未完了1件を分離。</li>
<li>既知費用＋Q10の未解決予約：$0.36843510。追加の通信枠・予算は確保していません。</li></ul>
<p>元の記録は上書きせず、112ファイルの内容ハッシュと77件の連鎖記録を確認して保持しています。</p>
<h2 id="regression">2．原文に結び付けた回帰事例</h2>
<div class="caution"><strong>H06についての留保：</strong>旧AI評価の「意味不合格」は消していません。
ただし、今回の独立照合では元の文言に解釈の幅があり、一義的な誤りとは断定できません。
「測定の種類まで不明」とする読みを条件付きの負例とし、
「機器や研究別の詳しい内訳は不明」という妥当な読みは拒否しない設計です。</div>
${regressions}
<p>回帰試験が確認するのは、原文との結び付けと、人が定義した構造化主張の判断境界です。
任意の日本語回答の意味を自動判定できる仕組みではありません。
モデルの再試験はしておらず、問題が解決済みとも扱いません。</p>
<h2 id="questions">3．一般の保護者向け10問の評価案</h2>
<p>すべて架空の相談です。既存4資料の範囲に限定し、資料にない実践的助言を足した回答を高く評価しません。
直接性・分かりやすさ・原文への忠実さを別々に評価し、本文の誤りを隣接表示で帳消しにしません。</p>
${questionCards}
<h2 id="audit">検証の限界と根拠</h2>
<p>モデルによる回答の生成・採点は未実施です。独立照合もAIによる準備資料のレビューであり、
人による資料承認、臨床的妥当性、本番採用の承認ではありません。送信するには新たな明示的な承認が必要です。</p>
<details><summary>10問共通の評価方法</summary>${render(plan.globalJudgingProtocol)}</details>
<details><summary>保護者向け案の独立点検</summary>${render(questionReview)}</details>
<details><summary>原文の出典・引用箇所・ハッシュ</summary>${render(sourceBindings)}</details>
<footer>通信なしで作成した準備資料。元の結果・採点・原文は変更していません。</footer>
</main></html>`;

fs.mkdirSync(output, { recursive: true });
const write = (name, bytes) => fs.writeFileSync(path.join(output, name), bytes, { flag: "wx" });
write("interpretation-qualification.json", JSON.stringify(note, null, 2) + "\n");
write("preparation-guide.html", html);
const localOutputs = ["interpretation-qualification.json", "preparation-guide.html"].map(f => {
  const p = `${output}/${f}`, bytes = fs.readFileSync(p);
  return { path: p, sha256: hash(bytes), bytes: bytes.length };
});
write("delivery-manifest.json", JSON.stringify({
  schemaVersion: 1, integrityMeaning: "local-byte-integrity-not-provider-attestation",
  newProviderCalls: 0, runtimeSettingsChanged: false, databaseApplied: false,
  modelProblemResolved: false, sourceApproved: false, productionPublished: false,
  bindings: [...bindings, ...localOutputs],
}, null, 2) + "\n");
for (const b of bindings) assert.equal(hash(fs.readFileSync(b.path)), b.sha256);
console.log(JSON.stringify({ output, questions: 10, originalFilesModified: 0,
  newProviderCalls: 0, manifestBindings: bindings.length + localOutputs.length }));