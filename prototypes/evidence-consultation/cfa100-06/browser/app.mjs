import { createController } from "../controller.mjs";
import { resolveRegion } from "../../search-repair-05/geography.mjs";
import { factHtml } from "../common-fact-display.mjs";

const escape = value => String(value ?? "").replace(/[&<>"']/gu, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const show = value => typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "未確認");
const list = values => `<ul>${values.map(value => `<li>${escape(show(value))}</li>`).join("")}</ul>`;
const fieldLabels = { support: "支援内容", eligibility: "対象・条件", fees: "料金", reductions: "減免", application: "申込方法", contact: "連絡先", hours: "時間", limits: "制限・注意", cancellation: "取消条件" };

// Presentation only. Matching, contextual safety and recommendation decisions belong
// to the shared controller/renderer, never to this DOM adapter.
export function boot({ search, document: doc = document, provenance = {} }) {
  if (typeof search !== "function") throw Error("実測DB由来の検索アダプターが必要です。");
  const question = doc.querySelector("#question");
  const regionFields = ["prefecture", "municipality", "ward"];
  const readRegion = () => {
    const values = Object.fromEntries(regionFields.map(key => [key, doc.getElementById(key).value.trim() || null]));
    return Object.values(values).some(Boolean) ? values : null;
  };
  const render = state => {
    doc.querySelector("#panel").dataset.status = state.status;
    doc.querySelector("#status").textContent = ({
      idle: "入力を変更すると前の表示を消します。", searching: "資料を検索しています…",
      ready: "資料検索の結果", incomplete: "検索未完了", needs_city: "地域の確認が必要です",
      invalid_region: "地域の組み合わせを確認してください", not_collected: "具体的な地域情報は未収集です",
      error: "検索できませんでした",
    })[state.status] ?? state.status;
    const panel = doc.querySelector("#answer");
    panel.replaceChildren();
    const presentation = state.presentation;
    if (state.error) panel.textContent = state.error;
    if (!presentation) return;
    panel.dataset.presentationStatus = presentation.status;
    // A single optional clarification follows the suggestion; no up-front intake.
    const clarification = state.clarification ?? presentation.clarification;
    panel.innerHTML = `<p class="label">編集見本・実際のAI回答ではない</p>
      <p class="suggestion">${escape(presentation.suggestion)}</p>
      ${clarification ? `<p class="clarification">${escape(clarification)}</p>` : ""}
      ${state.geography?.notice ? `<p class="notice">${escape(state.geography.notice)}</p>` : ""}
      ${presentation.limitations?.length ? `<div class="limits">${list(presentation.limitations)}</div>` : ""}
      ${(presentation.evidence ?? []).map(result => `<details class="evidence" data-section="${escape(result.sectionId)}">
        <summary>根拠を見る</summary>
        <h3>${escape(result.sourceTitle ?? result.citation?.title ?? result.title ?? result.sourceId)}</h3>
        <dl><dt>出典ID</dt><dd>${escape(result.sourceId)}</dd>
        <dt>版</dt><dd>${escape(result.version ?? result.citation?.version)} / ${escape(result.versionId)}</dd>
        <dt>原資料URL</dt><dd>${escape(result.originalUrl ?? result.citation?.originalUrl)}</dd>
        <dt>本文箇所（PDFページ／印刷ページ）</dt><dd>${escape(show(result.sourceLocation ?? result.citation?.sourceLocation))}</dd></dl>
        <p>資料本文（編集見本とは別）</p><blockquote>${escape(result.originalText)}</blockquote>
        ${(result.requiredContext ?? []).map(context => `<section class="required-context"><h4>必須文脈</h4>
          <p>${escape(show(context.sourceLocation))}</p><blockquote>${escape(context.originalText)}</blockquote></section>`).join("")}
        <p>公的実践ガイダンス。研究の確実性等級や、個人への効果保証ではありません。</p>
        <details class="contextual-fact"><summary>事実データと照合状態（共通表示器）</summary><p>実測本文に対応付けた quoted-text sidecar です。独立したDB事実テーブルへの登録を意味しません。</p>${factHtml(result.fact)}</details>
      </details>`).join("")}
      ${(presentation.localEvidence ?? []).map(result => `<section class="local-evidence" data-section="${escape(result.sectionId)}">
        <h3>地域資料の情報：${escape(result.title ?? result.citation?.title)}</h3>
        <p>一般ガイダンスとは別の、収集済み自治体資料です。現在の受付・空き・予約成立を保証しません。</p>
        <p>${escape([result.geography?.prefecture, result.geography?.municipality, result.geography?.ward].filter(Boolean).join(" "))}</p>
        <dl>${Object.entries(result.sourceFields).map(([key, field]) => `<dt>${escape(fieldLabels[key] ?? key)}</dt>
          <dd>${escape(field.status === "verified" ? show(field.value) : "未確認")}
          <details><summary>項目の出典・確認時点</summary>
          <p>${escape(field.officialUrl)}<br>本文箇所：${escape(field.sourceSection)}<br>確認日時：${escape(field.checkedAt)}<br>原資料更新日：${escape(field.sourceUpdatedOn ?? "未確認")}</p>
          </details></dd>`).join("")}</dl>
        <details><summary>根拠を見る（自治体資料）</summary><p>出典ID：${escape(result.sourceId)}<br>版ID：${escape(result.versionId)}<br>${escape(result.originalUrl)}</p></details>
      </section>`).join("")}`;
  };
  const controller = createController({ search, resolveRegion, onChange: render });
  const setInput = () => controller.setInput({ question: question.value, region: readRegion() });
  question.addEventListener("input", setInput);
  for (const key of regionFields) doc.getElementById(key).addEventListener("input", setInput);
  doc.querySelector("#search-form").addEventListener("submit", event => {
    event.preventDefault(); setInput(); void controller.submit();
  });
  doc.querySelector("#provenance").textContent = JSON.stringify(provenance, null, 2);
  render(controller.getState());
  return controller;
}