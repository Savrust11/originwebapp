// Checked extraction of the existing generic contextual fact renderer; no case routing.
const assert = condition => { if (!condition) throw Error("incomplete contextual fact"); };
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

export {factHtml};
