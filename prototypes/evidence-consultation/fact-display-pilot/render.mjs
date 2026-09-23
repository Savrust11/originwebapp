// A reusable source-fact renderer. No provider, database, or application imports.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadValidatedCatalog } from "./projection.mjs";
const escape = value => String(value ?? "未確認").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const labels = {
  unknown: "未確認", hours: "時間", SMD: "標準化平均差（単位なし）",
  p_value: "（P値）", percent_I2: "％（I²）", Cohens_d: "（Cohen's d）",
  minutes_per_day: "分／日", studies: "研究", interventions: "介入",
  issuer_reports_external_recommendation: "掲載ガイドが外部の学会の推奨として紹介",
  publisher_of_research_not_recommender: "研究結果の掲載元であり、推奨主体ではありません",
  verified_exact: "原文・出典箇所との一致を確認", not_approved: "未承認", not_published: "未公開",
  "科学的確実性": "科学的確実性の評価（この試作では未実施）",
};
const describe = value => value === null || value === undefined ? "未確認"
  : typeof value === "object" ? Object.values(value).map(describe).join(" / ") : labels[value] ?? String(value);
const list = items => `<ul>${items.map(item => `<li>${escape(describe(item))}</li>`).join("")}</ul>`;
const rootRelative = "evidence-work/parent-reading-evaluation/fact-display-pilot-01";

function factHtml(fact) {
  // No quantity-only display API: a fact always includes its contextual bundle.
  assert(fact.population && Array.isArray(fact.population.conditions));
  assert(fact.limitations.length && fact.supports.length && fact.uncertainty.length);
  return `<article data-fact="${escape(fact.id)}" aria-labelledby="title-${escape(fact.id)}">
    <header><span class="tag">${escape(fact.sourceId)} / ${escape(fact.unitId)}</span>
    <h2 id="title-${escape(fact.id)}">${escape(fact.title)}</h2></header>
    <section class="explanation"><h3>資料の一般的な説明</h3><p>${escape(describe(fact.summary))}</p>
    <p>${escape(describe(fact.result))}</p></section>
    <div class="context"><section><h3>対象・適用条件</h3>
    <p>${escape(describe(fact.population.description))}</p>
    <p><strong>年齢条件の意味：</strong>${escape(describe(fact.population.ageBasis))}</p>
    ${list(fact.population.conditions)}
    <h4>研究の除外条件</h4>${fact.population.exclusions.length ? list(fact.population.exclusions) : "<p>この記述から研究の除外条件は設定していません。資料の範囲を超えて推測しません。</p>"}</section>
    <section class="limits"><h3>重要な限界・不確実性</h3>${list(fact.limitations)}${list(fact.uncertainty)}
    <h4>この表示の利用上の制限（研究の除外条件とは別）</h4>${list(fact.usageRestrictions)}
    ${fact.unknowns.length ? `<h4>未確認の項目</h4>${list(fact.unknowns)}` : ""}</section></div>
    ${fact.quantities.length ? `<section class="numbers"><h3>資料中の数値 — 上の条件・限界と一緒に読む</h3>
    ${fact.quantities.map(q => `<div class="quantity"><strong>${escape(q.label)}</strong>
    <dl><dt>値・単位</dt><dd>${escape(describe(q.value))} ${escape(describe(q.unit))}</dd>
    <dt>測定対象</dt><dd>${escape(describe(q.measurementTarget))}</dd>
    <dt>集計範囲</dt><dd>${escape(describe(q.aggregationScope))}</dd>
    ${q.ageBasis !== undefined ? `<dt>年齢の意味</dt><dd>${escape(describe(q.ageBasis))}</dd>` : ""}</dl></div>`).join("")}</section>` : ""}
    <section class="authority"><h3>発行元と推奨主体を区別する</h3><dl>
    <dt>掲載資料の発行元</dt><dd>${escape(describe(fact.authority.issuer))}</dd>
    <dt>原文が示す推奨主体</dt><dd>${fact.authority.attributedRecommender === null ? "推奨としては扱いません（研究結果の説明）" : escape(describe(fact.authority.attributedRecommender))}</dd>
    <dt>帰属の種類</dt><dd>${escape(describe(fact.authority.attributionKind))}</dd></dl></section>
    <section class="sources"><h3>出典・原文</h3>
    <p>${escape(fact.sourceTitle)}</p>
    <p>原文との一致確認と、科学的な確実性・資料採用・公開承認は別です。</p>
    ${fact.supports.map(s => `<details><summary>${escape(s.originalId)} — ${escape(describe(s.locator))}</summary>
      <blockquote>${escape(s.quote)}</blockquote><p class="hash">原文 SHA-256: ${escape(s.originalTextSha256)}</p></details>`).join("")}
    <dl class="verification"><dt>原文照合</dt><dd>${escape(describe(fact.verification.textMatch))}</dd>
    <dt>資料採用</dt><dd>${escape(describe(fact.verification.adoption))}</dd>
    <dt>公開状態</dt><dd>${escape(describe(fact.verification.publication))}</dd>
    <dt>科学的確実性の評価</dt><dd>この試作では未実施</dd></dl></section>
  </article>`;
}

export function renderPilot(root) {
  const catalog = loadValidatedCatalog(root);
  const seal = JSON.parse(fs.readFileSync(path.join(root, rootRelative, "catalog-seal.json"), "utf8"));
  const bytes = fs.readFileSync(path.join(root, rootRelative, "fact-catalog.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), seal.catalogSha256, "fixed-data-review-seal-changed");
  assert.equal(seal.adoptionApproved, false);
  assert.equal(seal.publicationApproved, false);
  assert.equal(catalog.aiConnected, false);
  const font = fs.readFileSync(path.join(root, "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
  const license = fs.readFileSync(path.join(root, "prototypes/evidence-consultation/fonts/OFL-1.1.txt"), "utf8");
  const data = JSON.stringify(catalog.scenarios).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
  <title>出典から読む — 非公開オフライン試作</title><style>
  @font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}body{margin:0;background:#f3f5f4;color:#24342d;font-family:JP,sans-serif;line-height:1.85}
  main{max-width:880px;margin:auto;padding:32px 22px}h1{font-size:29px;line-height:1.4;margin:8px 0 20px}h2{font-size:23px;line-height:1.5;margin:10px 0}h3{font-size:17px;margin:0 0 10px}h4{font-size:15px;margin:16px 0 5px}
  .eyebrow{font-size:12px;letter-spacing:.09em;color:#496b5c}.notice{border-left:4px solid #53836b;background:#e8f0eb;padding:16px;margin-bottom:22px}
  nav{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;cursor:pointer;border:1px solid #9bafa4;border-radius:8px;background:white;padding:10px 18px;color:#24342d}button[aria-pressed=true]{background:#244e3a;color:white}
  .question{padding:18px 0 8px}.question h2{font-size:18px}.question p{margin:8px 0}.boundary{padding:15px;background:#fff4dc;border:1px solid #e0c792;border-radius:8px;margin:10px 0 24px}
  article{background:white;border:1px solid #d5dfd9;border-radius:14px;margin:24px 0;overflow:hidden;box-shadow:0 3px 10px #17382808}article header{padding:22px 24px 12px}.tag{font-size:12px;color:#496b5c}
  article section{padding:18px 24px;border-top:1px solid #e4e9e6}.explanation{background:#fbfcfb}.limits{background:#fff9ec}.numbers{background:#f1f6f3}.quantity{margin:12px 0;padding:12px;border:1px solid #c8d9ce;border-radius:8px}p{margin:8px 0}ul{padding-left:22px;margin:8px 0}li+li{margin-top:6px}
  dl{display:grid;grid-template-columns:160px 1fr;gap:8px;margin:10px 0}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}details{margin:12px 0}summary{cursor:pointer;overflow-wrap:anywhere}blockquote{margin:12px 0;padding:15px;background:#f4f6f5;white-space:pre-wrap;overflow-wrap:anywhere}.hash,.verification{font-size:11px;overflow-wrap:anywhere;color:#52605a}
  .ai{border:1px dashed #a9b6ad;border-radius:12px;padding:20px;color:#52605a;background:#ebefec}textarea{font:inherit;display:block;width:100%;min-height:80px;padding:12px;background:#f4f6f4;border:1px solid #bac6bd;border-radius:6px;color:#52605a;resize:none}footer{font-size:12px;color:#52605a;margin:25px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}[hidden]{display:none!important}
  @media(max-width:600px){main{padding:22px 14px}h1{font-size:25px}h2{font-size:21px}article header,article section{padding:17px}dl{display:block}dt{font-size:13px;margin-top:8px}dd{margin-top:3px}button{padding:10px 16px}article{border-radius:10px}}
  </style><main><div class="eyebrow">非公開・一時環境で検証する試作</div><h1>出典から読む</h1>
  <div class="notice"><strong>確認済みデータから組み立てた表示</strong><p>ここでの「確認済み」は保存原文との照合を指します。AI生成回答ではありません。資料の採用・公開は未承認で、科学的な確実性を保証しません。</p></div>
  <nav aria-label="保存済みの架空質問">${catalog.scenarios.map(s=>`<button type="button" data-case="${escape(s.caseId)}">${escape(s.caseId)}</button>`).join("")}</nav>
  <div class="question"><h2 id="question-title"></h2><p id="question"></p></div>
  <div class="boundary">研究の一般説明です。個人の充足・適合・効果の保証は表示しません。複数の資料を並べても、二つの介入の相乗効果や因果関係を示すものではありません。</div>
  ${catalog.facts.map(factHtml).join("")}
  <section class="ai"><h2>将来のAI説明欄</h2><label for="ai">未接続・追加API送信なし</label><textarea id="ai" disabled>AI生成回答はありません。この試作では接続できません。</textarea></section>
  <footer>保存済みの質問・資料を使った表示検証です。過去のモデル回答の採点は変更しません。通常相談経路へは接続していません。
  <details><summary>同梱フォントのライセンス</summary><pre>${escape(license)}</pre></details></footer></main>
  <script>const scenarios=${data};
  function show(id){const s=scenarios.find(x=>x.caseId===id);if(!s)return;
    document.getElementById('question-title').textContent=s.caseId+' — 保存済みの架空質問';
    document.getElementById('question').textContent=s.question;
    for(const article of document.querySelectorAll('article[data-fact]'))article.hidden=!s.factIds.includes(article.dataset.fact);
    for(const b of document.querySelectorAll('button[data-case]'))b.setAttribute('aria-pressed',String(b.dataset.case===id));
  }document.querySelector('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-case]');if(b)show(b.dataset.case)});show(scenarios[0].caseId);</script></html>`;
}