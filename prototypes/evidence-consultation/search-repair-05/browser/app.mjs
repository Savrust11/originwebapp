import { createController } from "../controller.mjs";
import { resolveRegion } from "../geography.mjs";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/gu, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const sameRegion = (left, right) => {
  const normalized = value => value ? {
    prefecture: value.prefecture ?? null,
    municipality: value.municipality ?? null,
    ward: value.ward ?? null,
  } : null;
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
};

function preparedReplaySearch(rows, delays = {}) {
  return ({ question, region, signal }) => new Promise((resolve, reject) => {
    const row = rows.find(candidate => candidate.question === question && sameRegion(candidate.location, region));
    const timer = setTimeout(() => {
      if (!row) return reject(Error("この入力の用意済み測定結果はありません。"));
      resolve({ results: row.results ?? [], diagnostics: row.repairedDiagnostics ?? row.diagnostics ?? null });
    }, Number(delays[question] ?? 0));
    signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });
}

export function boot({ search, document: doc = document } = {}) {
  const replay = globalThis.__SEARCH_REPAIR_REPLAY__;
  const measuredSearch = search ?? (Array.isArray(replay)
    ? preparedReplaySearch(replay, globalThis.__SEARCH_REPAIR_DELAYS__ ?? {})
    : async () => { throw Error("用意済み測定結果が接続されていません。"); });
  const question = doc.querySelector("#question");
  const fields = {
    prefecture: doc.querySelector("#prefecture"),
    municipality: doc.querySelector("#municipality"),
    ward: doc.querySelector("#ward"),
  };
  const status = doc.querySelector("#status");
  const clarification = doc.querySelector("#clarification");
  const geographyNotice = doc.querySelector("#geography-notice");
  const results = doc.querySelector("#results");
  const readRegion = () => {
    const region = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value.trim() || null]));
    return Object.values(region).some(Boolean) ? region : null;
  };
  const render = state => {
    doc.querySelector("#panel").dataset.status = state.status;
    doc.querySelector("#panel").dataset.regionKey = state.geography?.key ?? "";
    clarification.innerHTML = state.clarification
      ? `<p class="clarification">${escapeHtml(state.clarification)}</p>` : "";
    geographyNotice.innerHTML = state.geography?.notice
      ? `<p class="clarification">${escapeHtml(state.geography.notice)}</p>` : "";
    const labels = {
      idle: "条件を変更しました。前の検索結果を消しました。",
      searching: "用意済みの測定結果を確認しています…",
      needs_city: "市を確認してから、地域固有の情報を表示します。",
      not_collected: "この地域の情報はまだ収集していません。サービスがないという意味ではありません。",
      invalid_region: "都道府県・市区町村・行政区の組み合わせを確認してください。地域固有の情報は表示していません。",
      incomplete: "検索上限に達したため、検索を完了できませんでした。サービスがないという意味ではありません。",
      ready: state.results.length ? `${state.results.length}件の測定結果があります。` : "一致する用意済み測定結果はありません。",
      error: `確認できません：${state.error}`,
    };
    status.textContent = labels[state.status] ?? "";
    results.replaceChildren();
    for (const result of state.results) {
      const article = doc.createElement("article");
      article.dataset.resultId = result.unitId ?? result.sectionId;
      article.dataset.sourceId = result.sourceId;
      article.dataset.versionId = result.versionId;
      article.dataset.sectionId = result.sectionId;
      article.dataset.originalUrl = result.originalUrl;
      article.dataset.originalSha256 = result.originalSha256;
      article.dataset.ageScope = result.ageScope;
      article.innerHTML = `<h2>${escapeHtml(result.title ?? result.unitId)}</h2>
        <p class="summary">${escapeHtml(result.summaryJa ?? "一般的な案内")}</p>
        <details><summary>出典との結び付きを確認</summary>
          <div class="binding">result: ${escapeHtml(result.unitId ?? result.sectionId)}<br>
          source: ${escapeHtml(result.sourceId)}<br>version: ${escapeHtml(result.versionId)}<br>
          section: ${escapeHtml(result.sectionId)}<br>URL: ${escapeHtml(result.originalUrl)}<br>
          SHA-256: ${escapeHtml(result.originalSha256)}<br>対象年齢・範囲: ${escapeHtml(result.ageScope)}</div>
        </details>`;
      results.append(article);
    }
  };
  const controller = createController({ search: measuredSearch, resolveRegion, onChange: render });
  const update = () => controller.setInput({ question: question.value, region: readRegion() });
  question.addEventListener("input", update);
  for (const field of Object.values(fields)) field.addEventListener("input", update);
  doc.querySelector("#search-form").addEventListener("submit", event => {
    event.preventDefault();
    update();
    controller.submit();
  });
  render(controller.getState());
  globalThis.__SEARCH_REPAIR_CONTROLLER__ = controller;
  return controller;
}

boot();