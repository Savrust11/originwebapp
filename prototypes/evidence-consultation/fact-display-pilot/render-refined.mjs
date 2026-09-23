// Refined display-only renderer. No application, provider, database, or environment imports.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadValidatedCatalog } from "./projection.mjs";

const rootRelative = "evidence-work/parent-reading-evaluation/fact-display-pilot-01";
const escape = (value) => String(value ?? "未確認")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const labels = {
  unknown: "未確認", hours: "時間", SMD: "標準化平均差（単位なし）",
  p_value: "（P値）", percent_I2: "％（I²）", Cohens_d: "（Cohen's d）",
  minutes_per_day: "分／日", studies: "研究", interventions: "介入",
  issuer_reports_external_recommendation: "掲載ガイドが外部学会の推奨として紹介",
  publisher_of_research_not_recommender: "研究結果の掲載元（推奨主体ではありません）",
  verified_exact: "保存原文・出典箇所との一致を確認",
  not_approved: "未承認", not_published: "未公開",
};
const describe = (value) => value === null || value === undefined ? "未確認"
  : typeof value === "object" ? Object.values(value).map(describe).join(" / ")
    : labels[value] ?? String(value);
const conciseTitle = (title) => title.length > 66 ? `${title.slice(0, 63)}…` : title;

function isSourceScopedSleepUnknown(fact) {
  return fact.id === "sleep-guidance"
    && fact.sourceId === "E02"
    && fact.quantities.length === 2
    && fact.quantities.every((quantity) => quantity.aggregationScope === "unknown")
    && fact.unknowns.some((item) => item.includes("昼寝"))
    && fact.usageRestrictions.some((item) => item.includes("個人の睡眠充足を判定しない"));
}

function explanationHtml(fact) {
  if (isSourceScopedSleepUnknown(fact)) {
    const low = fact.quantities[0];
    const high = fact.quantities[1];
    return `<article data-fact="${escape(fact.id)}" aria-labelledby="explanation-${escape(fact.id)}">
      <h3 id="explanation-${escape(fact.id)}">${escape(fact.title)}</h3>
      <p class="key-number"><strong>${escape(low.value)}〜${escape(high.value)}${escape(describe(low.unit))}</strong>
      <span>対象：${escape(fact.population.description)}／集計範囲：${escape(describe(low.aggregationScope))}</span></p>
    </article>`;
  }
  return `<article data-fact="${escape(fact.id)}" aria-labelledby="explanation-${escape(fact.id)}">
    <h3 id="explanation-${escape(fact.id)}">${escape(fact.title)}</h3>
    <p>${escape(fact.result)}</p></article>`;
}

function unionEntries(facts, getter) {
  const entries = new Map();
  for (const fact of facts) {
    for (const text of getter(fact)) {
      const current = entries.get(text) ?? [];
      current.push(fact.id);
      entries.set(text, current);
    }
  }
  return [...entries].map(([text, factIds]) => ({ text, factIds }));
}

function entryList(entries, kind) {
  return `<ul>${entries.map(({ text, factIds }) =>
    `<li data-for-facts="${escape(factIds.join(" "))}" data-kind="${escape(kind)}">${escape(text)}</li>`).join("")}</ul>`;
}

function conditionsGroupHtml(sourceId, facts) {
  const descriptions = unionEntries(facts, (fact) => [fact.population.description]);
  const ageBases = unionEntries(facts, (fact) => [fact.population.ageBasis]);
  const conditions = unionEntries(facts, (fact) => fact.population.conditions);
  const exclusions = unionEntries(facts, (fact) => fact.population.exclusions.length
    ? fact.population.exclusions
    : ["この記述から研究の除外条件は設定していません。資料の範囲を超えて推測しません。"]);
  const limitations = unionEntries(facts, (fact) => [...fact.limitations, ...fact.uncertainty]);
  const restrictions = unionEntries(facts, (fact) => fact.usageRestrictions);
  const unknowns = unionEntries(facts, (fact) => fact.unknowns.map((item) =>
    item === "科学的確実性" ? "科学的確実性（評価未実施）" : item));
  return `<article class="source-group conditions-group" data-source="${escape(sourceId)}">
    <h3>${escape(sourceId)} の対象条件・限界</h3>
    <div data-entry-group><h4>対象</h4>${entryList(descriptions, "population")}</div>
    <div data-entry-group><h4>年齢条件の意味</h4>${entryList(ageBases, "age-basis")}</div>
    <div data-entry-group><h4>対象・適用条件</h4>${entryList(conditions, "condition")}</div>
    <div data-entry-group><h4>研究の除外条件</h4>${entryList(exclusions, "exclusion")}</div>
    <div data-entry-group class="limits"><h4>限界・不確実性</h4>${entryList(limitations, "limitation")}</div>
    <div data-entry-group><h4>利用上の制限（研究の除外条件とは別）</h4>${entryList(restrictions, "usage-restriction")}</div>
    <div data-entry-group><h4>この保存資料では未確認</h4>${entryList(unknowns, "unknown")}</div>
  </article>`;
}

function sourceGroupHtml(sourceId, facts) {
  const first = facts[0];
  const recommenders = [...new Set(facts.map((fact) => fact.authority.attributedRecommender).filter(Boolean))];
  return `<article class="source-group source-summary" data-source="${escape(sourceId)}">
    <h3>${escape(sourceId)}</h3>
    <p><span title="${escape(first.sourceTitle)}">${escape(conciseTitle(first.sourceTitle))}</span></p>
    <p>掲載元：${escape(first.authority.issuer)}／${escape(describe(first.authority.attributionKind))}</p>
    ${recommenders.length ? `<p>原文が示す推奨主体：${escape(recommenders.join(" / "))}</p>` : ""}
  </article>`;
}

function researchHtml(fact) {
  return `<article data-fact="${escape(fact.id)}" aria-labelledby="research-${escape(fact.id)}">
    <h3 id="research-${escape(fact.id)}">${escape(fact.title)}</h3>
    <details><summary>研究数値の内訳</summary><div class="detail-body">
      ${fact.quantities.map((quantity) => `<dl class="quantity">
        <dt>${escape(quantity.label)}</dt><dd>${escape(quantity.value)} ${escape(describe(quantity.unit))}</dd>
        <dt>測定対象</dt><dd>${escape(quantity.measurementTarget)}</dd>
        <dt>集計範囲</dt><dd>${escape(describe(quantity.aggregationScope))}</dd>
        ${quantity.ageBasis === undefined ? "" : `<dt>年齢の意味</dt><dd>${escape(quantity.ageBasis)}</dd>`}
      </dl>`).join("")}</div></details>
    <details><summary>保存した原文と出典箇所</summary><div class="detail-body">
      ${fact.supports.map((support) => `<section class="original">
        <h4>${escape(support.originalId)} — ${escape(describe(support.locator))}</h4>
        <blockquote>${escape(support.quote)}</blockquote></section>`).join("")}
    </div></details>
    <details class="reviewer"><summary>検証者向け詳細</summary><div class="detail-body">
      <dl><dt>原文照合</dt><dd>${escape(describe(fact.verification.textMatch))}</dd>
      <dt>資料採用</dt><dd>${escape(describe(fact.verification.adoption))}</dd>
      <dt>公開状態</dt><dd>${escape(describe(fact.verification.publication))}</dd>
      <dt>科学的確実性</dt><dd>評価未実施</dd>
      <dt>資料ファイル SHA-256</dt><dd class="hash">${escape(fact.provenance.sourceFileSha256)}</dd></dl>
      ${fact.supports.map((support) =>
        `<p class="hash">${escape(support.originalId)} 原文 SHA-256: ${escape(support.originalTextSha256)}</p>`).join("")}
    </div></details>
  </article>`;
}

export function renderRefinedPilot(root = process.cwd()) {
  const catalog = loadValidatedCatalog(root);
  const seal = JSON.parse(fs.readFileSync(path.join(root, rootRelative, "catalog-seal.json"), "utf8"));
  const catalogBytes = fs.readFileSync(path.join(root, rootRelative, "fact-catalog.json"));
  assert.equal(createHash("sha256").update(catalogBytes).digest("hex"), seal.catalogSha256, "fixed-data-review-seal-changed");
  assert.equal(seal.adoptionApproved, false);
  assert.equal(seal.publicationApproved, false);
  assert.equal(catalog.aiConnected, false);

  const sleepFact = catalog.facts.find((fact) => fact.id === "sleep-guidance");
  assert(sleepFact && isSourceScopedSleepUnknown(sleepFact), "sleep source-level stopping rule unavailable");
  const font = fs.readFileSync(path.join(root,
    "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
  const license = fs.readFileSync(path.join(root,
    "prototypes/evidence-consultation/fonts/OFL-1.1.txt"), "utf8");
  const scenarios = JSON.stringify(catalog.scenarios).replaceAll("<", "\\u003c");
  const factSources = JSON.stringify(Object.fromEntries(
    catalog.facts.map((fact) => [fact.id, fact.sourceId]),
  )).replaceAll("<", "\\u003c");
  const stoppingFactIds = JSON.stringify(catalog.facts
    .filter(isSourceScopedSleepUnknown).map((fact) => fact.id));
  const groupedFacts = {};
  for (const fact of catalog.facts) (groupedFacts[fact.sourceId] ??= []).push(fact);
  const sourceGroups = Object.entries(groupedFacts);

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src data:;script-src 'unsafe-inline';img-src data:;connect-src 'none';form-action 'none';base-uri 'none'">
  <title>出典から読む — 表示試作</title><style>
  @font-face{font-family:JP;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}
  body{margin:0;background:#f4f6f4;color:#20342a;font-family:JP,sans-serif;line-height:1.75}
  main{width:min(900px,100%);margin:auto;padding:26px 20px}h1{font-size:28px;line-height:1.35;margin:5px 0 3px}
  h2{font-size:21px;line-height:1.45;margin:7px 0}h3{font-size:17px;margin:0 0 9px;line-height:1.5}
  h2 .step{display:inline-grid;place-items:center;width:27px;height:27px;border-radius:50%;background:#315f49;color:#fff;font-size:14px}
  h4{font-size:14px;margin:15px 0 4px}.status{font-size:12px;letter-spacing:.05em;color:#315f49;font-weight:bold}
  .ai-note{font-size:13px;margin:0 0 17px;color:#52685d}nav{display:flex;gap:7px;flex-wrap:wrap}
  button{font:inherit;color:inherit;background:#fff;border:1px solid #92a99d;border-radius:8px;padding:9px 16px;cursor:pointer}
  button[aria-pressed=true]{background:#234d39;color:#fff}.question{padding:14px 1px 4px}.question h2{font-size:17px}
  [data-stage]{margin:19px 0}[data-stage]>h2{border-bottom:2px solid #b7c9bf;padding-bottom:7px}
  article{background:#fff;border:1px solid #d3dfd8;border-radius:11px;margin:11px 0;padding:18px 21px;box-shadow:0 2px 9px #17382809}
  [data-stage=conclusion] article{background:#eaf3ed;border-left:5px solid #397057}.conclusion{font-size:18px;line-height:1.65;margin:3px 0;font-weight:bold}
  .editorial-label{font-size:12px;color:#526f61;margin:0}.key-number{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
  .key-number strong{font-size:25px}.key-number span{font-size:14px}.limits{border-top:1px dashed #d9cba9;margin-top:16px}
  p{margin:7px 0}ul{padding-left:21px;margin:6px 0}li+li{margin-top:5px}
  details{border-top:1px solid #e1e7e3;padding:11px 0}details:first-of-type{border-top:0}
  summary{cursor:pointer;font-weight:bold;overflow-wrap:anywhere}.detail-body{padding:8px 2px}
  .quantity{display:grid;grid-template-columns:145px 1fr;gap:6px;margin:8px 0;padding:11px;background:#f4f7f5;border-radius:6px}
  dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}.original+.original{border-top:1px dashed #cfd9d3}
  blockquote{margin:8px 0;padding:13px;background:#f4f6f5;white-space:pre-wrap;overflow-wrap:anywhere}
  .hash{font-size:11px;color:#55665e;overflow-wrap:anywhere}footer{font-size:12px;color:#52635b;margin:25px 0}
  pre{white-space:pre-wrap;overflow-wrap:anywhere}[hidden]{display:none!important}
  @media(max-width:600px){main{padding:19px 13px}h1{font-size:24px}article{padding:16px 15px;border-radius:8px}
    .quantity{display:block}.quantity dt{margin-top:7px}.quantity dd{margin-top:2px}button{padding:9px 14px}.conclusion{font-size:17px}}
  </style></head><body><main><div class="status">非公開試作・固定データ表示</div><h1>出典から読む</h1>
  <p class="ai-note">AI生成回答ではありません</p>
  <nav aria-label="保存済みの架空質問">${catalog.scenarios.map((scenario) =>
    `<button type="button" data-case="${escape(scenario.caseId)}">${escape(scenario.caseId)}</button>`).join("")}</nav>
  <div class="question"><h2 id="question-title"></h2><p id="question"></p></div>

  <section data-stage="conclusion"><h2><span class="step">1</span> 短い答え</h2>
    <article><p id="conclusion-label" class="editorial-label"></p><p id="conclusion" class="conclusion"></p></article>
  </section>
  <section data-stage="explanation"><h2><span class="step">2</span> わかること</h2>
    ${catalog.facts.map(explanationHtml).join("")}
  </section>
  <section data-stage="conditions"><h2><span class="step">3</span> 欠かせない対象条件・限界</h2>
    ${sourceGroups.map(([sourceId, facts]) => conditionsGroupHtml(sourceId, facts)).join("")}
  </section>
  <section data-stage="source"><h2><span class="step">4</span> 出典</h2>
    ${sourceGroups.map(([sourceId, facts]) => sourceGroupHtml(sourceId, facts)).join("")}
  </section>
  <section data-stage="research"><h2><span class="step">5</span> 原文と詳しい研究情報</h2>
    ${catalog.facts.map(researchHtml).join("")}
  </section>
  <footer>一般的な文章理解や質問別回答の生成機能は実装していません。
    <details><summary>同梱フォントのライセンス</summary><pre>${escape(license)}</pre></details></footer>
  </main><script>const scenarios=${scenarios};const factSources=${factSources};const stoppingFactIds=${stoppingFactIds};
  function show(id){const scenario=scenarios.find(item=>item.caseId===id);if(!scenario)return;
    const activeFacts=scenario.factIds;const activeSources=[...new Set(activeFacts.map(factId=>factSources[factId]))];
    document.getElementById('question-title').textContent=scenario.caseId+' — 保存済みの架空質問';
    document.getElementById('question').textContent=scenario.question;
    for(const node of document.querySelectorAll('[data-fact]'))node.hidden=!activeFacts.includes(node.dataset.fact);
    for(const group of document.querySelectorAll('[data-source]'))group.hidden=!activeSources.includes(group.dataset.source);
    for(const item of document.querySelectorAll('[data-for-facts]')){
      item.hidden=!item.dataset.forFacts.split(' ').some(factId=>activeFacts.includes(factId));
    }
    for(const group of document.querySelectorAll('[data-entry-group]')){
      group.hidden=![...group.querySelectorAll('[data-for-facts]')].some(item=>!item.hidden);
    }
    const sleepStop=activeFacts.some(factId=>stoppingFactIds.includes(factId));
    document.getElementById('conclusion-label').textContent=sleepStop?'':'編集見本（汎用的な質問回答ではありません）';
    document.getElementById('conclusion').textContent=sleepStop
      ?'保存した原文の範囲では昼寝を含むか確認できず、個別の充足判定はできない。'
      :'個人への効果や適合は、この表示では判定しません。'+(activeSources.length>1?' 複数の介入の相乗効果も判定しません。':'');
    for(const button of document.querySelectorAll('button[data-case]'))button.setAttribute('aria-pressed',String(button.dataset.case===id));
  }
  document.querySelector('nav').addEventListener('click',event=>{const button=event.target.closest('button[data-case]');if(button)show(button.dataset.case)});
  show(scenarios[0].caseId);</script></body></html>`;
}