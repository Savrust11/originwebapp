import assert from "node:assert/strict";

const text = (value, label, maximum = 2_000) => {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.trim() && value.length <= maximum, `${label} must be nonblank and bounded`);
  return value;
};
const escape = value => String(value).replace(/[&<>"']/gu, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

export function sourceDisplayPayload({
  answer,
  suggestionClass,
  original,
  derivative,
  rights,
}) {
  assert(["scientific_evidence", "practical_guidance", "professional_practice", "service_information"].includes(suggestionClass));
  assert(original && derivative && rights);
  assert.equal(derivative.isOriginal, false, "Japanese derivative must not be represented as original text");
  assert.equal(rights.adoptionApproval.status, "not_approved");
  assert.equal(rights.publicationStatus.status, "not_published");
  assert(["held", "not_authorized"].includes(rights.externalAI.status));
  text(rights.displayNotice, "rights.displayNotice", 1_000);
  text(rights.termsUrl, "rights.termsUrl", 2_048);
  return Object.freeze({
    answer: text(answer, "answer", 800),
    suggestionClass,
    detailsLabel: "根拠を見る",
    details: {
      original: {
        label: "原資料",
        title: text(original.title, "original.title", 500),
        publisher: text(original.publisher, "original.publisher", 300),
        url: text(original.url, "original.url", 2_048),
        passage: text(original.passage, "original.passage"),
        country: text(original.country, "original.country", 100),
        language: text(original.language, "original.language", 30),
        ageDescription: text(original.ageDescription, "original.ageDescription", 500),
        updatedOn: original.updatedOn,
        checkedOn: text(original.checkedOn, "original.checkedOn", 10),
      },
      derivative: {
        label: "We育編集",
        text: text(derivative.text, "derivative.text"),
        publisherAuthored: false,
      },
      rights,
    },
  });
}

export function renderSourceCard(payload) {
  assert.equal(payload.detailsLabel, "根拠を見る");
  const original = payload.details.original;
  const derivative = payload.details.derivative;
  const derivativeOnly = payload.parentDisplay?.mode === "derivative_only_no_publisher_attribution";
  if (!derivativeOnly) assert(original, "original source detail is required outside derivative-only display");
  const originalPanel = derivativeOnly ? "" : `<section data-original-source>
      <h3>${escape(original.label)}</h3>
      <p>${escape(original.title)} — ${escape(original.publisher)}</p>
      <p>${escape(original.country)}／${escape(original.language)}／対象: ${escape(original.ageDescription)}</p>
      <blockquote>${escape(original.passage)}</blockquote>
      <a href="${escape(original.url)}" rel="noopener noreferrer">公式ページ</a>
    </section>`;
  const conditions = (payload.parentDisplay?.conditions ?? [])
    .map(condition => `<li>${escape(condition)}</li>`).join("");
  return `<article data-source-card data-information-class="${escape(payload.suggestionClass)}">
  <p data-short-answer>${escape(payload.answer)}</p>
  <details data-evidence-details>
    <summary>${escape(payload.detailsLabel)}</summary>
    ${originalPanel}
    <section data-editorial-derivative>
      <h3>${escape(derivative.label)}</h3>
      <p>${escape(derivative.text)}</p>
      <p>原資料の発行元が作成・承認した日本語文ではありません。</p>
    </section>
    ${conditions ? `<section data-display-conditions><h3>使うときの条件</h3><ul>${conditions}</ul></section>` : ""}
    <section data-use-status>
      <p>採用: ${escape(payload.details.rights.adoptionApproval.status)}／公開: ${escape(payload.details.rights.publicationStatus.status)}／外部AI: ${escape(payload.details.rights.externalAI.status)}</p>
      <p data-license-notice>${escape(payload.details.rights.displayNotice)}</p>
      <a href="${escape(payload.details.rights.termsUrl)}" rel="noopener noreferrer">利用条件</a>
    </section>
  </details>
</article>`;
}