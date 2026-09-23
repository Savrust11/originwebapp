// Local evidence/documents only. Deliberately does not import any runner or app.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const base = "evidence-work/parent-reading-evaluation";
const out = `${base}/revision-01`;
const old = `${base}/execution-01`;
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const hash = p => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const tests = [];
function check(name, action) { action(); tests.push({ name, result: "PASS" }); }
globalThis.fetch = () => { throw new Error("Network forbidden in offline revision"); };
const saved = read(`${out}/preservation-manifest.json`);
check("All historical files unchanged", () => {
  for (const b of saved.protectedFiles) assert.equal(hash(b.path), b.sha256, b.path);
  assert.equal(hash(saved.snapshot.path), saved.snapshot.sha256);
  assert.equal(saved.snapshot.sha256, hash(`${old}/report/final-results.json`));
});
const events = fs.readdirSync(`${old}/run/private/events`).sort()
  .map(n => read(`${old}/run/private/events/${n}`));
check("Authorization still closed; same five reservations", () => {
  assert.equal(events.at(-1).type, "authorization-closed");
  assert.equal(events.filter(e => e.type === "transmission-reserved").length, 5);
});
const sources = read(`${old}/preflight/source-content.json`).originals;
const p02 = read(`${out}/p02-edited-display.json`);
check("Edited example is explicitly separate from history and model output", () => {
  assert.equal(p02.label, "編集した見本");
  assert.equal(p02.replacesHistoricalDisplay, false);
  assert.equal(p02.normalConsultationRouteChanged, false);
});
check("General explanation precedes clarification and conditional fit", () => {
  assert.deepEqual(p02.sections.map(s => s.role),
    ["general-evidence", "necessary-clarification", "conditional-applicability"]);
  for (const section of p02.sections)
    for (const id of section.originalIds) assert(sources[id], id);
});
check("Preserved source contains positive and null sleep findings", () => {
  const source = sources["E04-F-S02"].originalText;
  assert(source.includes("Results were mixed"));
  assert(source.includes("three interventions improved"));
  assert(source.includes("had no effect on sleep duration"));
});
check("Revision contains mixed-results explanation and no promised individual effect", () => {
  const general = p02.sections[0].text;
  assert(general.includes("改善した研究と、改善が見られなかった研究"));
  assert(general.includes("この資料からはいえません"));
});
check("Clarification does not unlock unknown sleep aggregation or prescription", () => {
  assert(p02.sections[1].text.includes("十分・不足とは判定できません"));
  assert(p02.sections[2].text.includes("診断情報を一般説明の必須条件にはしません"));
  assert(p02.sections[2].text.includes("処方を可能にするものではありません"));
});
const plan = read(`${base}/preparation-01/plan.json`);
const a = read(`${old}/reviews/reviewer-a.json`);
const b = read(`${old}/reviews/reviewer-b.json`);
const local = read(`${old}/preflight/local-displays.json`).displays;
const notes = {
  P01: ["集計範囲不明の目安に夜間＋昼寝を照合した。", "目安の夜間/昼寝の定義が保存原文にない。", null, "問判定は不合格一致。直接性等の点数には差がある。"],
  P02: [null, "原因や個別の十分性を確定する根拠がない。", "混在する研究結果という一般説明を欠落。別の編集見本で補った。", "旧表示は不合格一致。採点は変更しない。"],
  P03: [null, "生後2か月の目標時間・練習方法を支える保存原文がない。", "新たな表示問題は指摘されていない。", "合格一致。"],
  P04: ["対象条件の要約に広すぎる読みがある（確定誤りとは統一しない）。", "個人の夜間覚醒改善を保証できない。", null, "Aは留保付き、Bは合格。"],
  P05: [null, "学校での個別上限を支えず、対象・場面も異なる。", "新たな表示問題は指摘されていない。", "合格一致。"],
  P06: ["『対象範囲から大きく外れていない』に人口条件と講座適合の二読がある。", "個々の講座の適合・父子への効果が未確定。", null, "留保付き一致。二つの読みを保持。"],
  P07: [null, "この家庭との適合は未確定。一般的な二つのアウトカムは説明可能。", "新たな表示問題は指摘されていない。", "合格一致。"],
  P08: [null, "追加情報があっても、この資料から補足量を算出できない。", "新たな表示問題は指摘されていない。", "合格一致。"],
  P09: ["明確な問題の指摘なし（無誤りの保証ではない）。", "個人の乳汁終了時期は決められない。", null, "合格一致。"],
  P10: ["未確認の母親属性、E03の1〜3歳への改変。E04の平均年齢表現にも問題。", "組合せ・相乗効果や因果連鎖を確認できない。科学全体の不明とは別。", null, "不合格一致だがE04年齢条件はA軽微/B明確な誤り。"],
};
const cases = plan.cases.map(c => {
  const model = ["P01", "P04", "P06", "P09", "P10"].includes(c.id);
  const response = model ? read(`${old}/run/private/responses/${c.id}.json`) : null;
  const row = notes[c.id];
  return {
    caseId: c.id, lane: model ? "model" : "local", question: c.question,
    historicalAnswer: model ? response.answer.answer : local.find(x => x.caseId === c.id).exactDisplayText,
    historicalReviews: { a: a.cases.find(x => x.caseId === c.id), b: b.cases.find(x => x.caseId === c.id) },
    classification: { modelProblem: row[0] ?? "モデル未送信のため対象外",
      retainedEvidenceLimit: row[1], applicationDisplayProblem: row[2] ?? "独立した表示問題としては分類しない",
      evaluationDifference: row[3] },
    existingTechnicalState: response?.technicalState ?? "no-model-call",
    semanticDetectionByExistingRunner: model ? "not-established-by-structural-checks" : "not-applicable",
  };
});
check("Ten original questions, outputs and both scores preserved", () => {
  assert.equal(cases.length, 10);
  assert.equal(cases.filter(c => c.lane === "model").length, 5);
  for (const c of cases) assert(c.historicalAnswer && c.historicalReviews.a && c.historicalReviews.b);
});
check("Stored faulty responses passed actual technical checks; do not claim semantic detection", () => {
  for (const id of ["P01", "P10"]) {
    const r = read(`${old}/run/private/responses/${id}.json`);
    assert.equal(r.technicalState, "completed-schema");
    assert.deepEqual(r.caseReasons, []);
    assert.deepEqual(r.stopReasons, []);
  }
});
const write = (name, text) => fs.writeFileSync(`${out}/${name}`, text, { flag: "wx" });
write("issue-register.json", JSON.stringify({ schemaVersion: 1, cases, historicalScoresChanged: false,
  categoriesAreNonExclusive: true, note: "分類は追加注記であり再採点ではない。資料不足は保存範囲の限界。" }, null, 2) + "\n");
write("offline-verification.json", JSON.stringify({
  tests, modelApiCalls: 0, databaseAccess: false, appStartedByThisCheck: false,
  clinicalSafetyProven: false, p02SemanticReview: {
    method: "author source-reading comparison, not automated entailment or independent approval",
    basis: "E04-F-S02 mixed improvements and no-effects; E02 duration aggregation remains unspecified",
  },
  limitations: "文字列・参照・不変性テストは意味理解の証明ではない。新たな自由文意味検出器は未実装。"
}, null, 2) + "\n");
const escape = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const font = fs.readFileSync("prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2").toString("base64");
const license = fs.readFileSync("prototypes/evidence-consultation/fonts/OFL-1.1.txt", "utf8");
const diagnostic = fs.readFileSync(`${out}/diagnostics.ja.md`, "utf8");
const design = fs.readFileSync(`${out}/minimal-design.ja.md`, "utf8");
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>追加通信なし・修正案</title>
<style>@font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}body{font-family:JP,sans-serif;max-width:1000px;margin:auto;padding:24px;color:#172331;line-height:1.85}section{border-top:1px solid #ccd4db;margin-top:32px;padding-top:18px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}.notice{padding:18px;background:#fff2dc;border-left:4px solid #a86b16}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}blockquote{border-left:3px solid #889baa;margin:16px 0;padding:12px 20px;background:#f4f7f9}summary{cursor:pointer}dl{display:grid;grid-template-columns:180px 1fr;gap:10px}dd{margin:0}@media(max-width:600px){dl{display:block}dt{font-weight:bold;margin-top:16px}}</style>
<h1>追加通信なし・修正案</h1><p class="notice">送信枠は閉鎖のまま。Luna本番採用は保留。過去の回答・採点は未変更。これは検討資料で、育児助言や安全性保証ではありません。</p>
<h2>検査で分かること・分からないこと</h2><p>保存されたP01・P10は既存の技術検査に合格しています。しかし意味上の誤りは残りました。今回のオフライン検証も、表示構成・参照・保存不変性の確認であり、自由文の意味を完全に検出した実績ではありません。</p>
<h2>P02：編集した見本（実モデル回答ではありません）</h2>
${p02.sections.map(s => `<section><h3>${escape(s.heading)}</h3><p>${escape(s.text)}</p><small>対応原文：${escape(s.originalIds.join(" / "))}</small></section>`).join("")}
<details><summary>P02の対応原文全文</summary>${[...new Set(p02.sections.flatMap(s=>s.originalIds))].map(id=>`<h3>${id}</h3><pre>${escape(sources[id].originalText)}</pre>`).join("")}</details>
<h2>全10問：過去結果を保存した分類</h2><p>分類は重複可能です。モデルの誤りと資料の不足を同一視せず、ローカル表示はモデル評価へ合算しません。</p>
${cases.map(c=>`<section><h3>${c.caseId} — ${c.lane === "model" ? "実モデル回答" : "過去のローカル表示"}</h3><p>${escape(c.question)}</p><blockquote>${escape(c.historicalAnswer)}</blockquote><p>過去判定 A: ${escape(c.historicalReviews.a.verdict)} / B: ${escape(c.historicalReviews.b.verdict)}</p><dl>${Object.entries(c.classification).map(([k,v])=>`<dt>${({modelProblem:"モデルの問題",retainedEvidenceLimit:"保存資料の限界",applicationDisplayProblem:"アプリ表示の問題",evaluationDifference:"評価の一致・相違"})[k]}</dt><dd>${escape(v)}</dd>`).join("")}</dl><details><summary>元の採点・理由（未修正）</summary><pre>${escape(JSON.stringify(c.historicalReviews,null,2))}</pre></details></section>`).join("")}
<section><h2>P01・P10の診断とP04・P06の解釈境界</h2><pre>${escape(diagnostic)}</pre></section>
<section><h2>最小限の改修案</h2><pre>${escape(design)}</pre></section>
<section><h2>通信なし検証</h2><ul>${tests.map(t=>`<li>${escape(t.name)}: ${t.result}</li>`).join("")}</ul><p>文字列チェックを意味検証の成功とは扱いません。既存DB・資料承認・通常相談経路・公開設定への変更はありません。</p></section><details><summary>同梱フォントのライセンス</summary><pre>${escape(license)}</pre></details></html>`;
write("revision-report.html", html);
console.log(JSON.stringify({ checksPassed: tests.length, historicalCases: cases.length,
  protectedFilesUnchanged: saved.protectedFiles.length, newModelApiCalls: 0,
  authorizationRemainsClosed: true, output: `${out}/revision-report.html` }));