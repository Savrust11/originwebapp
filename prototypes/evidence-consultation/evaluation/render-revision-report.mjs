#!/usr/bin/env node

/**
 * Offline renderer for the role-separated isolated-reading revision.
 *
 * Reads only local, recorded artifacts. It does not send requests, inspect
 * secrets, use a database, or mutate the ledger/results it reports.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformLegacyCitationDisplay } from "./claim-citations.mjs";
import { buildVerifiedOriginalCatalog } from "./role-separated-request.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const base = path.join(root, "evidence-work/model-evaluation");
const runId = process.argv[2] ?? "source-roles-20260918";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) {
  throw new Error("invalid_revision_run_id");
}
const prep = path.join(base, "revision-preparation", runId);
const resultDirectory = path.join(base, "revision-results", runId);
const outputPath = path.join(base, "revised-reading-results.html");
const cases = ["Q05", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11"];

const html = value => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const safeUrl = value => {
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};
const readJson = async file => {
  try { return { value: JSON.parse(await readFile(file, "utf8")), error: null }; }
  catch (error) {
    return { value: null, error: error?.code === "ENOENT"
      ? "未作成" : `読込失敗: ${error instanceof Error ? error.message : String(error)}` };
  }
};
const readText = async file => {
  try { return { value: await readFile(file, "utf8"), error: null }; }
  catch (error) {
    return { value: null, error: error?.code === "ENOENT"
      ? "未作成" : `読込失敗: ${error instanceof Error ? error.message : String(error)}` };
  }
};
const jsonBlock = value => `<pre class="raw">${html(JSON.stringify(value, null, 2))}</pre>`;
const missing = text => `<p class="missing">${html(text)}</p>`;
const money = value => Number.isSafeInteger(value) && value >= 0
  ? `$${(value / 1_000_000).toFixed(6)} <small>(${value.toLocaleString("ja-JP")} µUSD)</small>`
  : '<span class="missing">不明（0とは扱いません）</span>';
const usage = value => {
  const u = value?.usage;
  if (!object(u)) return missing("利用量は未記録です。");
  return `<dl class="facts">
    <div><dt>input</dt><dd>${html(u.input_tokens)}</dd></div>
    <div><dt>output</dt><dd>${html(u.output_tokens)}</dd></div>
    <div><dt>reasoning（output内数）</dt><dd>${html(u.output_tokens_details?.reasoning_tokens)}</dd></div>
    <div><dt>cached / cache write</dt><dd>${html(u.input_tokens_details?.cached_tokens)}
      / ${html(u.input_tokens_details?.cache_write_tokens)}</dd></div>
    <div><dt>total</dt><dd>${html(u.total_tokens)}</dd></div>
  </dl>`;
};

const parseUserPayload = record => {
  const content = record?.request?.input?.find(item => item?.role === "user")?.content;
  if (typeof content !== "string") return null;
  try { const parsed = JSON.parse(content); return object(parsed) ? parsed : null; }
  catch { return null; }
};

const renderOriginals = (payload, catalog) => {
  const originals = payload?.original_evidence;
  if (!Array.isArray(originals)) return missing("新しい生成入力はまだ準備されていません。");
  if (!originals.length) return missing("送信対象の原文がありません。");
  return originals.map((source, index) => {
    const id = source?.original_id;
    const meta = catalog?.[id];
    const url = safeUrl(meta?.url);
    return `<article class="source" id="original-${html(id)}">
      <h4>原文 ${index + 1}：<code>${html(id)}</code></h4>
      ${object(meta) ? `<dl class="meta">
        <div><dt>資料名</dt><dd>${html(meta.title)}</dd></div>
        <div><dt>版</dt><dd>${html(meta.version)}</dd></div>
        <div><dt>出典箇所</dt><dd>${html(meta.locator)}</dd></div>
        <div><dt>URL</dt><dd>${url ? `<a href="${html(url)}">${html(url)}</a>` : "記録なし"}</dd></div>
      </dl>` : missing("照合済みカタログ情報がありません。")}
      <pre class="original">${html(source?.original_text)}</pre>
    </article>`;
  }).join("");
};

const renderPresentation = (presentation, caseId) => {
  const sectionId = `${String(caseId).toLowerCase()}-after-claim-map`;
  if (!object(presentation)) {
    return `<section id="${html(sectionId)}"><h4>説明と原文の対応</h4>
      ${missing("アプリ組立済みの説明・引用はまだありません。")}</section>`;
  }
  const item = (claim, kind) => `<li class="claim ${kind}">
    <p>${html(claim?.text)}</p>
    <p class="claim-link">支える原文：
      ${(claim?.original_ids ?? []).map((id, index) =>
        `<a href="#original-${html(id)}">[${html(claim?.citation_numbers?.[index] ?? "?")}] <code>${html(id)}</code></a>`
      ).join("、") || "なし（原文外であることの制限・差控え）"}
    </p></li>`;
  const refs = Array.isArray(presentation.references) ? presentation.references : [];
  return `<section id="${html(sectionId)}">
    <h4>説明と原文の対応</h4>
    <ol class="claims">${(presentation.explanations ?? []).map(value => item(value, "explanation")).join("")}</ol>
    <h4>制限</h4>
    <ul class="claims">${(presentation.limitations ?? []).map(value => item(value, "limitation")).join("") || "<li>記録なし</li>"}</ul>
    ${presentation.abstention?.applies
      ? `<h4>回答差控え</h4><ul class="claims">${item(presentation.abstention, "abstention")}</ul>` : ""}
    <h4>アプリが照合済みカタログから組み立てた引用</h4>
    <ol class="references">${refs.map(ref => {
      const url = safeUrl(ref.url);
      return `<li id="reference-${html(ref.original_id)}">
        <strong>[${html(ref.number)}] ${html(ref.title)}</strong>
        <span>版：${html(ref.version)}</span><span>原文ID：<code>${html(ref.original_id)}</code></span>
        <span>出典箇所：${html(ref.locator)}</span>
        ${url ? `<a href="${html(url)}">${html(url)}</a>` : ""}
      </li>`;
    }).join("") || "<li>引用なし</li>"}</ol>
    <h4>サービスとしての回答制限</h4>
    <ul class="service">${(presentation.service_notices ?? []).map(notice =>
      `<li>${html(notice.text)} <small>（${html(notice.provenance)}）</small></li>`).join("") || "<li>記録なし</li>"}</ul>
    <p class="note">上のサービス制限は原著の結論ではなく、アプリ所有の表示です。</p>
  </section>`;
};

const renderReview = review => object(review)
  ? `<section class="review"><h4>原文との意味照合</h4>
      <p><strong>判定：</strong>${html(review.verdict)} /
      <span>${html(review.checkedBy)}</span></p>
      <ul>${(review.findings ?? []).map(finding => `<li>${html(finding)}</li>`).join("")}</ul>
      <p class="note">ID一致だけでは内容の支持を保証しないため、別の意味照合を表示しています。</p></section>`
  : missing("独立した原文比較レビューはまだありません。");

const answerVerbatim = result => typeof result?.outputText === "string"
  ? result.outputText
  : "新しいモデル応答はまだありません。";

const renderRevisionCase = ({ id, request, payload, entry, result, catalog }) => {
  const executed = Boolean(entry);
  const transportStatus = !executed ? "未送信" : result?.status === "completed"
    ? "応答 completed" : entry.state === "reserved" ? "送信結果未確定"
      : `応答 ${result?.status ?? entry.state ?? "不明"}`;
  const semanticStatus = !executed ? "意味照合なし" : entry.review?.verdict === "stop"
    ? "意味照合 stop" : entry.review?.verdict === "acceptable"
      ? "意味照合 acceptable" : "意味照合待ち";
  return `<article class="card case" id="${html(id)}">
    <header class="case-head"><div><p class="eyebrow">revision case</p><h2>${html(id)}</h2></div>
      <div class="status-pair">
        <span class="badge ${executed ? "done" : "pending"}" data-status-kind="transport">${html(transportStatus)}</span>
        <span class="badge ${entry?.review?.verdict === "stop" ? "stop" : executed ? "done" : "pending"}"
          data-status-kind="semantic">${html(semanticStatus)}</span>
      </div></header>
    <h3>質問</h3><p class="question">${html(payload?.question ?? "準備データなし")}</p>
    ${id === "Q05" ? `<div class="columns">
      <section class="panel" id="q05-after-answer"><h3>修正後の応答（verbatim JSON）</h3>
        <pre class="answer">${html(answerVerbatim(result))}</pre>
        ${renderPresentation(result?.contract?.presentation, id)}</section>
      <section class="panel"><h3>実際に提示した引用可能な原文</h3>
        ${renderOriginals(payload, catalog)}</section>
    </div>` : `<details ${executed ? "open" : ""}><summary>回答・原文・判定</summary>
      <div class="columns"><section class="panel"><h3>モデル応答（verbatim JSON）</h3>
      <pre class="answer">${html(answerVerbatim(result))}</pre>${renderPresentation(result?.contract?.presentation, id)}</section>
      <section class="panel"><h3>提示した引用可能な原文</h3>${renderOriginals(payload, catalog)}</section></div>
      ${renderReview(entry?.review)}</details>`}
    <details><summary>対象条件・役割分離</summary>
      <h4>対象条件と適用制限（原文ではありません）</h4>${jsonBlock(payload?.applicability ?? null)}
      <h4>管理用情報（生成入力には未収録）</h4>
      <p>administrative IDs: ${html((request?.administrative_ids ?? []).join("、") || "なし")}</p>
      <p>bibliographic metadata: ${html((request?.reference_metadata ?? []).map(value => value.metadata_id).join("、") || "なし")}</p>
      <p class="note">編集メモと書誌メタデータは、回答事実を支える引用可能原文として扱いません。</p>
    </details>
    ${id === "Q05" ? renderReview(entry?.review) : ""}
    <section class="account"><h3>実行記録・費用</h3>
      <p>ledger sequence: ${html(entry?.sequence ?? "未実行")} /
        state: ${html(entry?.state ?? "未実行")} /
        費用: ${money(entry?.measuredMicroUSD ?? result?.measuredMicroUSD)}</p>
      ${usage(result)}
    </section>
    <details><summary>受信結果 raw JSON</summary>${result ? jsonBlock(result) : missing("結果ファイルはありません。")}</details>
    <details><summary>準備した生成入力 raw JSON</summary>${request ? jsonBlock(request) : missing("準備ファイルはありません。")}</details>
  </article>`;
};

const main = async () => {
  const paths = {
    ledger: path.join(base, "api-call-ledger.json"),
    prepared: path.join(prep, "prepared-package.json"),
    catalog: path.join(prep, "citable-catalog.json"),
    rubric: path.join(prep, "rubric.json"),
    rationale: path.join(prep, "prerun-rationale.md"),
    rights: path.join(prep, "aasm-rights-review.json"),
    q03: path.join(base, "operational-results/Q03.json"),
    q05Before: path.join(base, "operational-results/Q05.json"),
  };
  const [ledgerR, preparedR, catalogR, rubricR, rationaleR, rightsR, q03R, beforeR] =
    await Promise.all([
      readJson(paths.ledger), readJson(paths.prepared), readJson(paths.catalog),
      readJson(paths.rubric), readText(paths.rationale), readJson(paths.rights),
      readJson(paths.q03), readJson(paths.q05Before),
    ]);
  const ledger = ledgerR.value ?? {};
  const prepared = preparedR.value ?? {};
  let catalog = catalogR.value?.catalog ?? catalogR.value ?? {};
  if (!Object.keys(catalog).length) {
    try {
      catalog = buildVerifiedOriginalCatalog({
        casesPath: path.join(base, "cases.json"),
        sourceDirectory: path.join(root, "evidence-work/v0.2"),
      }).catalog;
    } catch { catalog = {}; }
  }
  const requests = new Map((prepared.requests ?? []).map(value => [value.case_id, value]));
  const revisionEntries = (ledger.entries ?? []).filter(value => value.revisionRunId === runId);
  const entries = new Map(revisionEntries.map(value => [value.caseId, value]));
  const resultPairs = await Promise.all(cases.map(async id => [id,
    (await readJson(path.join(resultDirectory, `${id}.json`))).value]));
  const results = new Map(resultPairs);
  const rows = cases.map(id => {
    const request = requests.get(id);
    return { id, request, payload: parseUserPayload(request), entry: entries.get(id),
      result: results.get(id), catalog };
  });
  const historical = (ledger.entries ?? []).slice(0, 6);
  const historicalCost = historical.filter(value => value.kind === "generation")
    .reduce((sum, value) => sum + (Number.isSafeInteger(value.measuredMicroUSD) ? value.measuredMicroUSD : 0), 0);
  const revisedKnown = revisionEntries.filter(value => Number.isSafeInteger(value.measuredMicroUSD));
  const revisedCost = revisedKnown.reduce((sum, value) => sum + value.measuredMicroUSD, 0);
  const allKnown = (ledger.entries ?? []).filter(value => value.kind === "generation")
    .every(value => Number.isSafeInteger(value.measuredMicroUSD));
  let q03Legacy;
  try { q03Legacy = transformLegacyCitationDisplay(q03R.value?.answer, catalog); }
  catch (error) { q03Legacy = { error: error instanceof Error ? error.message : String(error) }; }
  const beforeEntry = historical.find(value => value.caseId === "Q05");
  const beforeAnswer = beforeR.value?.answer?.answer_ja;
  const newQ05 = rows[0];
  const q05OldPayloadRecord = (await readJson(path.join(base, "local-token-payloads.json"))).value
    ?.requests?.find(value => value.case_id === "Q05");
  const q05OldPayload = parseUserPayload(q05OldPayloadRecord);
  const prepErrors = [
    ["prepared package", preparedR.error], ["catalog", catalogR.error],
    ["rubric", rubricR.error], ["rationale", rationaleR.error], ["rights review", rightsR.error],
  ].filter(([, error]) => error);

  const document = `<!doctype html><html lang="ja"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>隔離読解評価・引用構成 修正比較</title>
  <style>
  :root{--ink:#17232c;--muted:#586874;--paper:#fff;--wash:#f3f6f5;--line:#cbd7d2;
    --accent:#125b55;--good:#17653f;--warn:#8a5500;--bad:#942f3d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  *{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--wash);line-height:1.65}
  main{max-width:1480px;margin:auto;padding:clamp(16px,3vw,44px)}h1,h2,h3,h4{line-height:1.3}
  h1{font-size:clamp(1.9rem,4vw,3.1rem);margin:.15em 0}.eyebrow{font-size:.74rem;letter-spacing:.14em;
    text-transform:uppercase;color:var(--accent);font-weight:800;margin:0}.lede,.note,small{color:var(--muted)}
  .card,.notice,.summary{background:var(--paper);border:1px solid var(--line);border-radius:12px;
    padding:clamp(16px,2.4vw,28px);margin:20px 0}.notice{border-left:7px solid var(--warn)}
  .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
  .stat{background:var(--wash);padding:14px;border-radius:7px}.stat strong{display:block}
  .case-head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--ink);gap:12px}
  .badge{border:1px solid currentColor;border-radius:999px;padding:5px 11px;font-weight:750}
  .status-pair{display:flex;flex-wrap:wrap;gap:7px}.badge.done{color:var(--good)}
  .badge.pending{color:var(--muted)}.badge.stop{color:var(--bad);background:#fff2f3}.columns{display:grid;
    grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}.panel{min-width:0;
    border:1px solid var(--line);border-radius:8px;padding:16px}.question{font-size:1.08rem}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.answer{background:#edf6f3;
    border-left:4px solid var(--accent);padding:14px}.original{background:#fff;border:1px solid var(--line);padding:14px}
  .raw{font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f7f8f8;padding:13px}
  code{overflow-wrap:anywhere}.source{border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:16px}
  dl{margin:0}.facts,.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:7px}
  dl div{min-width:0}.meta div,.facts div{padding:7px;background:var(--wash)}dt{font-weight:750}dd{margin:0;overflow-wrap:anywhere}
  .references li{margin-bottom:13px}.references span,.references a{display:block;overflow-wrap:anywhere}
  .claims{padding-left:1.4rem}.claim{padding:7px 10px;margin:8px 0;background:#f7faf9}
  .claim p{margin:.2rem 0}.claim-link{font-size:.88rem;color:var(--muted)}.service{border-left:4px solid var(--warn)}
  .review,.account{border-top:2px solid var(--line);margin-top:22px;padding-top:14px}.missing{color:var(--bad);font-weight:700}
  details{margin:14px 0}summary{cursor:pointer;font-weight:750}a{color:#075f82}.before{border-left:7px solid var(--bad)}
  nav ul{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}nav a{border:1px solid var(--line);padding:5px 10px;border-radius:5px}
  @media(max-width:820px){.columns{grid-template-columns:1fr}.case-head{align-items:flex-start;flex-direction:column}}
  @media print{body{background:#fff}main{max-width:none;padding:0}.card,.notice,.summary{break-inside:avoid;
    box-shadow:none}.columns{grid-template-columns:1fr 1fr}details{display:block}details>*{display:block!important}a{color:inherit}}
  </style></head><body><main>
  <header><p class="eyebrow">offline / revision comparison / ${html(runId)}</p>
    <h1>隔離読解評価：引用構成の修正比較</h1>
    <p class="lede">修正前後の回答、実際に提示した原文、説明ごとの引用対応、判定と費用を同じ画面で確認します。</p></header>
  <section class="notice" id="report-boundaries"><h2>このレポートの境界</h2><ul>
    <li>資料の本番採用・公開承認は変更していません。これは隔離された資料読解評価です。</li>
    <li>回答事実を支える原文、対象条件・適用制限、管理用編集メモ、サービス上の回答制限を分離しています。</li>
    <li>AASM本文の取込条件は確認済みになっていないため本文を収録・送信せず、夜間／24時間の条件は原文不足として評価します。</li>
    <li>モデルの原文ID一致をアプリで検証しますが、意味の支持は独立レビューで別に判定します。</li>
  </ul>${prepErrors.length ? missing(`準備中のファイル: ${prepErrors.map(([name]) => name).join("、")}。生成後に同じコマンドで再作成できます。`) : ""}</section>
  <section class="summary" id="revision-outcome-summary"><h2>今回の結論</h2>
    <ul>
      <li><strong>新Q05は技術的には完結</strong>し、引用可能な原文IDだけを使用しました。旧回答にあった編集メモIDの引用は解消しています。</li>
      <li><strong>夜間のみか24時間合計かは断定せず、limitationsで適切に回答を控えました。</strong>
        <code>abstention.applies=false</code> との表現上のずれはありますが、固定基準は専用フラグのtrueを必須としておらず、停止理由ではありません。</li>
      <li><strong>一方、原文に明記されたAASM推奨という必須帰属を省略したため、意味照合は stop です。</strong>
        技術ステータス <code>completed</code> はこの停止判定を上書きしません。</li>
      <li>新Q05のusageは input ${html(newQ05.result?.usage?.input_tokens ?? "不明")} /
        output ${html(newQ05.result?.usage?.output_tokens ?? "不明")}（reasoning
        ${html(newQ05.result?.usage?.output_tokens_details?.reasoning_tokens ?? "不明")}はoutput内数）、
        費用${money(newQ05.entry?.measuredMicroUSD ?? newQ05.result?.measuredMicroUSD)}。
        累計は${html((ledger.entries ?? []).length)}/${html(ledger.limits?.maxApiTransmissions ?? "不明")}通信、
        ${allKnown ? money(historicalCost + revisedCost) : "費用は一部不明"}です。</li>
      <li>Q06〜Q11は未送信で、自動再試行はありません。Q03は既存回答の引用表示をオフライン確認しただけで、
        Q05解消後に予定していた次段階ゲートは実行していません。</li>
    </ul>
  </section>
  <section class="summary" id="execution-summary"><h2>通信・費用</h2><div class="summary-grid">
    <div class="stat"><strong>累計API通信</strong>${html((ledger.entries ?? []).length)} / ${html(ledger.limits?.maxApiTransmissions ?? "不明")} 回</div>
    <div class="stat"><strong>既存6通信の生成費用</strong>${money(historicalCost)}</div>
    <div class="stat"><strong>新評価の通信</strong>${html(revisionEntries.length)} 回</div>
    <div class="stat"><strong>新評価の判明費用</strong>${money(revisedCost)}${revisedKnown.length !== revisionEntries.length ? "（判明分のみ）" : ""}</div>
    <div class="stat"><strong>累計費用</strong>${allKnown ? money(historicalCost + revisedCost) : "一部不明"}</div>
    <div class="stat"><strong>運用予算</strong>${money(ledger.limits?.operationalModelBudgetMicroUSD)}</div>
    <div class="stat"><strong>同時実行 / 自動再試行</strong>${html(ledger.limits?.maxConcurrency ?? "不明")} / ${html(ledger.limits?.maxRetries ?? "不明")}</div>
    <div class="stat"><strong>現在のrunner状態</strong>${ledger.halted ? "停止" : "継続可能または準備中"}</div>
  </div><p class="note">費用はusageから呼出し単位でµUSDへ切り上げた運用計算で、請求確定額ではありません。不明値を0に補いません。</p></section>
  <nav><h2>目次</h2><ul><li><a href="#Q05-before">Q05 修正前</a></li>
    <li><a href="#Q05">Q05 修正後</a></li><li><a href="#Q03-legacy">Q03 既存表示</a></li>
    ${cases.slice(1).map(id => `<li><a href="#${id}">${id}</a></li>`).join("")}</ul></nav>

  <article class="card before" id="Q05-before"><p class="eyebrow">preserved failure</p><h2>Q05 修正前</h2>
    <div class="columns"><section class="panel" id="q05-before-answer"><h3>失敗回答（verbatim）</h3>
      <pre class="answer">${html(beforeAnswer ?? "記録なし")}</pre>
      <h4>モデルが返した引用</h4>${jsonBlock(beforeR.value?.answer?.citations ?? null)}
      <p class="missing">E02-S01 は編集・管理単位のIDであり、引用可能原文IDではありません。</p></section>
      <section class="panel"><h3>当時送信した原文と注記</h3>
      ${(q05OldPayload?.source_context?.citations ?? []).map((source, i) =>
        `<article class="source"><h4>送信原文 ${i + 1}：${html(source.section_id)}</h4>
        <pre class="original">${html(source.original_text)}</pre></article>`).join("") || missing("旧入力なし")}
      <details><summary>当時の source_notes（原文ではない）</summary>${jsonBlock(q05OldPayload?.source_context?.source_notes ?? null)}</details>
      </section></div>${renderReview(beforeEntry?.review)}
    <p><strong>当時の費用：</strong>${money(beforeEntry?.measuredMicroUSD)}</p>
    <details><summary>旧結果 raw JSON</summary>${jsonBlock(beforeR.value)}</details></article>

  ${renderRevisionCase(newQ05)}

  <article class="card" id="Q03-legacy"><p class="eyebrow">legacy display check</p><h2>既存Q03の引用表示</h2>
    <p class="missing" id="q03-continuation-gate-status">オフライン表示確認のみ。Q05の意味上の問題が未解消のため、
      「問題解消後に既存Q03の引用表示を確認する」という次段階の継続ゲートは完了扱いにしていません。
      Q03への新しいモデル送信はありません。</p>
    <pre class="answer">${html(q03R.value?.answer?.answer_ja ?? "記録なし")}</pre>
    ${q03Legacy.error ? missing(q03Legacy.error) : `<p class="missing">${html(q03Legacy.warning)}</p>
      <p>provenance: <code>${html(q03Legacy.provenance)}</code> / claim_links: ${html(q03Legacy.claim_links)}</p>
      <ol class="references">${q03Legacy.references.map(ref => `<li><strong>[${ref.number}] ${html(ref.title)}</strong>
      <span>版：${html(ref.version)}</span><span>原文ID：<code>${html(ref.original_id)}</code></span>
      <span>出典箇所：${html(ref.locator)}</span>${safeUrl(ref.url) ? `<a href="${html(ref.url)}">${html(ref.url)}</a>` : ""}</li>`).join("")}</ol>`}
    <p class="note">旧回答はそのまま表示し、説明単位の対応を後付けしていません。表示メタデータだけを照合済みカタログから組み立てています。</p>
  </article>

  ${rows.slice(1).map(renderRevisionCase).join("\n")}

  <article class="card" id="pre-send-record"><h2>再送信前に固定した変更理由・評価基準</h2>
    <h3>変更理由</h3>${rationaleR.value ? `<pre>${html(rationaleR.value)}</pre>` : missing(rationaleR.error)}
    <h3>評価基準（raw JSON）</h3>${rubricR.value ? jsonBlock(rubricR.value) : missing(rubricR.error)}
    <h3>AASM本文の利用条件確認</h3>${rightsR.value ? jsonBlock(rightsR.value) : missing(rightsR.error)}
    <p class="note">アクセス可能であることを本文取込・外部AI利用の許諾とは扱っていません。権利判断や禁止の断定ではなく、確認未了による保留です。</p>
  </article>
  <footer><p>生成日時：${html(new Date().toISOString())}。ローカル記録だけから作成した自己完結HTMLです。</p>
    <p>再生成：<code>node prototypes/evidence-consultation/evaluation/render-revision-report.mjs ${html(runId)}</code></p></footer>
  </main></body></html>`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, document, "utf8");
  process.stdout.write(`${path.relative(root, outputPath)}\n`);
};

await main();