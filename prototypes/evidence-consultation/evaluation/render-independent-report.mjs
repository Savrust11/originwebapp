#!/usr/bin/env node

/**
 * Offline renderer for the independently continued Q06-Q11 reading trial.
 * It reads recorded files only; it never sends requests, reads secrets/DBs, or
 * changes the ledger, preparation, results, or source records.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildVerifiedAttributionRelations } from "./attribution-data.mjs";
import {
  assembleAttributionDisplay, q05SavedAnswerAttributionAssessment,
} from "./attribution-display.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const base = path.join(root, "evidence-work/model-evaluation");
const runId = process.argv[2] ?? "independent-cases-20260918";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) throw new Error("invalid_run_id");
const prep = path.join(base, "independent-preparation", runId);
const resultDirectory = path.join(base, "independent-results", runId);
const outputPath = path.join(base, "independent-reading-results.html");
const caseIds = ["Q06", "Q07", "Q08", "Q09", "Q10", "Q11"];

const h = value => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const jsonBlock = value => `<pre class="raw">${h(JSON.stringify(value, null, 2))}</pre>`;
const missing = text => `<p class="missing">${h(text)}</p>`;
const safeUrl = value => {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};
const money = value => Number.isSafeInteger(value) && value >= 0
  ? `$${(value / 1_000_000).toFixed(6)} <small>(${value.toLocaleString("ja-JP")} µUSD)</small>`
  : '<span class="missing">不明（0とは扱いません）</span>';
const readJson = async file => {
  try { return { value: JSON.parse(await readFile(file, "utf8")), error: null }; }
  catch (error) {
    return { value: null, error: error?.code === "ENOENT"
      ? "未作成" : `読込失敗：${error instanceof Error ? error.message : String(error)}` };
  }
};
const parsePayload = preparedCase => {
  const content = preparedCase?.request?.input?.find(item => item?.role === "user")?.content;
  if (typeof content !== "string") return null;
  try { return JSON.parse(content); } catch { return null; }
};
const usage = result => {
  const u = result?.usage;
  if (!object(u)) return missing("利用量は未記録です。");
  return `<dl class="facts">
    <div><dt>input</dt><dd>${h(u.input_tokens)}</dd></div>
    <div><dt>output</dt><dd>${h(u.output_tokens)}</dd></div>
    <div><dt>reasoning（output内数）</dt><dd>${h(u.output_tokens_details?.reasoning_tokens)}</dd></div>
    <div><dt>cached / cache write</dt><dd>${h(u.input_tokens_details?.cached_tokens)} / ${h(u.input_tokens_details?.cache_write_tokens)}</dd></div>
    <div><dt>total</dt><dd>${h(u.total_tokens)}</dd></div>
  </dl>`;
};

const renderOriginals = (payload, catalog, prefix) => {
  const originals = payload?.original_evidence;
  if (!Array.isArray(originals) || !originals.length) return missing("提示原文はまだ準備されていません。");
  return originals.map((source, index) => {
    const meta = catalog?.[source.original_id] ?? {};
    const url = safeUrl(meta.url);
    return `<article class="source" id="${h(prefix)}-original-${h(source.original_id)}">
      <h4>原文 ${index + 1}：<code>${h(source.original_id)}</code></h4>
      <dl class="meta"><div><dt>資料名</dt><dd>${h(meta.title ?? "未記録")}</dd></div>
      <div><dt>版</dt><dd>${h(meta.version ?? "未記録")}</dd></div>
      <div><dt>出典箇所</dt><dd>${h(meta.locator ?? "未記録")}</dd></div>
      <div><dt>URL</dt><dd>${url ? `<a href="${h(url)}">${h(url)}</a>` : "未記録"}</dd></div></dl>
      <pre class="original">${h(source.original_text)}</pre></article>`;
  }).join("");
};

const attributionLabel = attribution => `<aside class="app-attribution" data-provenance="${h(attribution.provenance)}">
  <strong>アプリ側の帰属表示：</strong>${h(attribution.text)}
  <span>掲載資料の発行元：${h(attribution.document_publisher)}</span>
  <span>推奨の主体：${h(attribution.recommendation_origin)}</span>
  <small>支える原文：<code>${h(attribution.supporting_original_id)}</code>。モデル出力ではなく、
  意味上の合格判定も変更しません。</small>
  <small>${h(attribution.qualification)}</small>
</aside>`;

const renderClaims = ({ result, caseId, catalog, attributionDisplay }) => {
  const presentation = result?.contract?.presentation;
  if (!object(presentation)) return missing("アプリ組立済みの説明・引用はまだありません。");
  const displayExplanations =
    attributionDisplay?.app_display?.explanations ?? presentation.explanations;
  const one = (claim, kind, index) => `<li class="claim ${h(kind)}" data-claim-index="${index}">
    <p>${h(claim?.text)}</p>
    ${(claim?.app_attributions ?? []).map(attributionLabel).join("")}
    <p class="claim-link">支える原文：${(claim?.original_ids ?? []).map((id, i) =>
      `<code>${h(id)}</code> [${h(claim?.citation_numbers?.[i] ?? "?")}]`).join("、")
      || "なし（原文外であることの制限・差控え）"}</p></li>`;
  const refs = presentation.references ?? [];
  return `<section class="claim-map" id="${h(caseId.toLowerCase())}-claim-map">
    <h4>説明と原文の対応</h4><ol>${(displayExplanations ?? []).map((x, i) => one(x, "explanation", i)).join("")}</ol>
    <h4>制限・差控え</h4><ul>${(presentation.limitations ?? []).map((x, i) =>
      one(x, "limitation", i)).join("") || "<li>記録なし</li>"}</ul>
    <h4>アプリが照合済みデータから組み立てた引用</h4>
    <ol class="references">${refs.map(ref => {
      const trusted = catalog?.[ref.original_id];
      const url = safeUrl(trusted?.url);
      return `<li><strong>[${h(ref.number)}] ${h(trusted?.title ?? "未照合")}</strong>
        <span>版：${h(trusted?.version ?? "未照合")}</span><span>原文ID：<code>${h(ref.original_id)}</code></span>
        <span>出典箇所：${h(trusted?.locator ?? "未照合")}</span>
        ${url ? `<a href="${h(url)}">${h(url)}</a>` : ""}</li>`;
    }).join("") || "<li>引用なし</li>"}</ol></section>`;
};

const verdict = entry => entry?.review?.verdict ?? entry?.caseVerdict ?? null;
const pass = value => ["acceptable", "pass", "passed"].includes(value);
const failure = value => ["stop", "fail", "failed", "unacceptable"].includes(value);
const statusText = (entry, result) => {
  if (!entry) return "未送信";
  if (pass(verdict(entry))) return "合格";
  if (failure(verdict(entry))) return "不合格";
  if (result) return "意味照合待ち";
  return entry.state === "reserved" ? "送信結果未確定" : "結果未記録";
};
const findings = entry => entry?.review?.findings ?? entry?.findings ?? [];
const documentedSummaries = {
  Q06: {
    problem: "AASM推奨という帰属を省略。「合計」という原文外の語を付加したが、24時間合計とは明示していない。",
    unresolved: "不合格点は未修正。AASM本文の権利確認と、夜間のみか24時間合計かは未解決。完全な再翻訳は未実施。",
    evidence: ["米国睡眠医学会（AASM）", "『睡眠時間の合計の目安』", "24時間合計"],
  },
  Q07: {
    problem: "重大な逸脱なし。養育者と新生児を分け、選定した養育者向け原文の三要点を保持。",
    unresolved: "日本での個別適用はunknown。資料の採用・公開は未承認のまま。",
    evidence: ["原文の三つの要点", "養育者と、文脈上の新生児を混同していない", "モデル単体をpass"],
  },
  Q08: {
    problem: "I²=93%と、病気・障害と診断された子または親の集団除外を省略。",
    unresolved: "省略した異質性数値・対象除外を含む完全な再翻訳は未実施。日本適用はunknown。",
    evidence: ["I²=93%", "病気または障害と診断された子ども又は親", "ケース単位のfail"],
  },
  Q09: {
    problem: "子・親の診断済み病気・障害除外と平均36か月超の境界を省略。非有意を効果ゼロとはしていない。",
    unresolved: "省略した対象境界・除外を含む完全な再翻訳は未実施。CES-D比率の訳に軽微な懸念、日本適用はunknown。",
    evidence: ["効果ゼロの証明へ変えていない", "平均36か月超", "翻訳上の軽微な懸念"],
  },
  Q10: {
    problem: "Cohen's d=−0.92、95% CI −1.66〜−0.18と、診断済み医学的状態の除外を省略。",
    unresolved: "省略した主要数値・医学的除外を含む完全な再翻訳は未実施。日本適用はunknown。",
    evidence: ["Cohen's d=−0.92", "95% CI −1.66〜−0.18", "診断済み医学的状態"],
  },
  Q11: {
    problem: "改善・非改善結果は保持したが、医学的・教育場面の除外と年齢基準のプロトコル例外を省略。",
    unresolved: "省略した除外・プロトコル変更を含む完全な再翻訳は未実施。日本適用はunknown。",
    evidence: ["非改善", "教育場面の介入除外", "E04-C-PROTOCOL-DEVIATIONS"],
  },
};
const verifiedSummary = entry => {
  const summary = documentedSummaries[entry?.caseId];
  if (!summary) return null;
  const review = JSON.stringify(entry.review ?? {});
  if (!summary.evidence.every(text => review.includes(text))) {
    throw new Error(`documented_summary_review_mismatch_${entry.caseId}`);
  }
  return summary;
};

const renderCase = ({
  id, preparedCase, payload, entry, result, catalog, expectation, attributionDisplay,
}) => {
  const status = statusText(entry, result);
  const notices = result?.contract?.presentation?.service_notices
    ?? preparedCase?.service_notices?.map(text => ({ text, provenance: "service_policy_not_source_conclusion" }))
    ?? [];
  return `<article class="card case" id="${h(id)}" data-case-status="${h(status)}">
    <header class="case-head"><div><p class="eyebrow">independent case</p><h2>${h(id)}</h2></div>
      <span class="badge ${pass(verdict(entry)) ? "pass" : failure(verdict(entry)) ? "fail" : "pending"}">${h(status)}</span></header>
    <h3>質問</h3><p>${h(payload?.question ?? "準備データなし")}</p>
    <div class="columns"><section class="panel"><h3>モデル生回答（verbatim JSON）</h3>
      <pre class="answer">${h(result?.outputText ?? "未送信")}</pre>
      ${renderClaims({ result, caseId: id, catalog, attributionDisplay })}</section>
      <section class="panel"><h3>実際に提示した引用可能な原文</h3>
      ${renderOriginals(payload, catalog, id.toLowerCase())}</section></div>
    <section class="separated"><h3>アプリ側の情報（モデル生回答とは別）</h3>
      <h4>サービスとしての回答制限</h4><ul>${notices.map(n =>
        `<li>${h(n.text)} <small>${h(n.provenance)}</small></li>`).join("") || "<li>記録なし</li>"}</ul>
      <h4>対象条件・適用情報</h4>${preparedCase?.evaluation_applicability
        ? jsonBlock(preparedCase.evaluation_applicability) : missing("未記録")}
      <p class="note">これらはアプリ所有の補足であり、原著の結論でもモデル回答の訂正でもありません。</p>
    </section>
    <section class="review"><h3>モデル単体の判定・問題</h3>
      <p><strong>${h(status)}</strong></p>
      <ul>${findings(entry).map(x => `<li>${h(x)}</li>`).join("") || "<li>独立レビュー未実施</li>"}</ul>
      <p class="note">原文IDの一致だけでなく、英語の対象・除外・不確実性・否定・改善しなかった結果を別に意味照合します。</p>
    </section>
    <section class="unresolved"><h3>未解決・原文だけでは確定しない事項</h3>
      <ul>${(expectation?.notEstablishedByCitableOriginal ?? []).map(x =>
        `<li>${h(x)}</li>`).join("") || "<li>送信前記録なし</li>"}</ul>
      <p>${h(expectation?.requiredHandling ?? "")}</p></section>
    <section class="account"><h3>通信・利用量・費用</h3>
      <p>ledger sequence：${h(entry?.sequence ?? "未実行")} ／ state：${h(entry?.state ?? "未実行")} ／
      計算費用：${money(entry?.measuredMicroUSD ?? result?.measuredMicroUSD)}</p>${usage(result)}</section>
    <details><summary>受信結果 raw JSON</summary>${result ? jsonBlock(result) : missing("結果ファイルなし")}</details>
    <details><summary>意味照合レビュー raw JSON</summary>${entry?.review ? jsonBlock(entry.review) : missing("レビューなし")}</details>
    <details><summary>準備入力 raw JSON</summary>${preparedCase ? jsonBlock(preparedCase) : missing("準備入力なし")}</details>
  </article>`;
};

const main = async () => {
  const paths = {
    ledger: path.join(base, "api-call-ledger.json"),
    prepared: path.join(prep, "prepared-package.json"),
    catalog: path.join(prep, "citable-catalog.json"),
    rubric: path.join(prep, "rubric.json"),
    changes: path.join(prep, "expectation-change-record.json"),
    rationale: path.join(prep, "rationale.json"),
    manifest: path.join(prep, "manifest.json"),
    q05Result: path.join(base, "revision-results/source-roles-20260918/Q05.json"),
    q05Review: path.join(base, "revision-results/source-roles-20260918/Q05-review.json"),
    displayVerification: path.join(prep, "Q05-display-verification.json"),
    e02: path.join(root, "evidence-work/v0.2/E02.json"),
  };
  const [ledgerR, preparedR, catalogR, rubricR, changesR, rationaleR, manifestR,
    q05ResultR, q05ReviewR, displayVerificationR, e02R] = await Promise.all([
    readJson(paths.ledger), readJson(paths.prepared), readJson(paths.catalog), readJson(paths.rubric),
    readJson(paths.changes), readJson(paths.rationale), readJson(paths.manifest),
    readJson(paths.q05Result), readJson(paths.q05Review), readJson(paths.displayVerification), readJson(paths.e02),
  ]);
  const ledger = ledgerR.value ?? {};
  const prepared = preparedR.value ?? {};
  const catalog = catalogR.value?.catalog ?? catalogR.value ?? {};
  const requests = new Map((prepared.requests ?? []).map(item => [item.case_id, item]));
  const entriesList = (ledger.entries ?? []).filter(item =>
    item.independentRunId === runId || item.independent_run_id === runId);
  const entries = new Map(entriesList.map(item => [item.caseId, item]));
  const resultPairs = await Promise.all(caseIds.map(async id =>
    [id, (await readJson(path.join(resultDirectory, `${id}.json`))).value]));
  const appDisplayPairs = await Promise.all(caseIds.map(async id =>
    [id, (await readJson(path.join(resultDirectory, `${id}-app-display.json`))).value]));
  const results = new Map(resultPairs);
  const appDisplays = new Map(appDisplayPairs);
  const rows = caseIds.map(id => {
    const preparedCase = requests.get(id);
    const entry = entries.get(id);
    return { id, preparedCase, payload: parsePayload(preparedCase), entry,
      result: results.get(id), catalog,
      expectation: changesR.value?.perCaseSupport?.[id],
      attributionDisplay: appDisplays.get(id),
      documentedSummary: entry ? verifiedSummary(entry) : null };
  });
  let q05Display = null;
  let q05DisplayError = null;
  try {
    const relations = buildVerifiedAttributionRelations(e02R.value);
    q05Display = assembleAttributionDisplay(q05ResultR.value.answer, {
      caseId: "Q05", relations, assessments: q05SavedAnswerAttributionAssessment(),
    });
  } catch (error) { q05DisplayError = error instanceof Error ? error.message : String(error); }
  const q05Relation = q05Display?.app_display?.explanations?.[0]?.app_attributions?.[0];
  const baseline = (ledger.entries ?? []).slice(0, 7);
  const baselineCost = baseline.filter(x => x.kind === "generation")
    .reduce((sum, x) => sum + (Number.isSafeInteger(x.measuredMicroUSD) ? x.measuredMicroUSD : 0), 0);
  const newKnown = entriesList.filter(x => Number.isSafeInteger(x.measuredMicroUSD));
  const newCost = newKnown.reduce((sum, x) => sum + x.measuredMicroUSD, 0);
  const unknownUsage = entriesList.some(x => !Number.isSafeInteger(x.measuredMicroUSD));
  const passed = rows.filter(x => pass(verdict(x.entry))).map(x => x.id);
  const failed = rows.filter(x => failure(verdict(x.entry))).map(x => x.id);
  const pending = rows.filter(x => !x.entry).map(x => x.id);
  const q05Result = q05ResultR.value;
  const q05Review = q05ReviewR.value;
  const summaryRows = [
    {
      id: "Q05",
      status: "不合格（保持）",
      problem: "モデル生回答がAASM推奨という帰属を省略",
      app: q05Relation?.text ?? "帰属表示未検証",
      unresolved: "AASM本文未収録。夜間のみか24時間合計かは断定しない",
    },
    ...rows.map(row => ({
      id: row.id,
      status: statusText(row.entry, row.result),
      problem: !row.entry ? "未実行"
        : row.documentedSummary?.problem ?? findings(row.entry)[0] ?? "記録なし",
      app: [
        ...(row.attributionDisplay?.app_display?.explanations ?? [])
          .flatMap(x => x.app_attributions ?? []).map(x => x.text),
        ...(row.result?.contract?.presentation?.service_notices ?? []).map(x => x.text),
        row.preparedCase?.evaluation_applicability ? "対象条件・適用情報（原著結論ではない）" : null,
      ].filter(Boolean).join("／") || "記録なし",
      unresolved: (row.documentedSummary?.unresolved
        ?? (row.expectation?.notEstablishedByCitableOriginal ?? []).join("／")) || "記録なし",
    })),
  ];
  const document = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>独立ケース隔離読解評価</title><style>
  :root{--ink:#19272e;--muted:#5a6970;--paper:#fff;--wash:#f1f6f4;--line:#c9d7d1;
    --accent:#075d59;--good:#17633e;--warn:#875400;--bad:#982e3d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  *{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);line-height:1.65}
  main{max-width:1500px;margin:auto;padding:clamp(16px,3vw,44px)}h1,h2,h3,h4{line-height:1.3}
  h1{font-size:clamp(2rem,4vw,3.2rem);margin:.15em 0}.eyebrow{font-size:.74rem;letter-spacing:.15em;
    color:var(--accent);font-weight:800;text-transform:uppercase;margin:0}.lede,.note,small{color:var(--muted)}
  .card,.summary,.boundary{background:var(--paper);border:1px solid var(--line);border-radius:13px;
    padding:clamp(16px,2.4vw,28px);margin:20px 0}.boundary{border-left:7px solid var(--warn)}
  .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:10px}
  .stat,.meta div,.facts div{background:var(--wash);padding:10px;border-radius:6px}.stat strong{display:block}
  .case-head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid var(--ink);gap:12px}
  .badge{border:1px solid currentColor;border-radius:999px;padding:5px 12px;font-weight:800}
  .badge.pass{color:var(--good)}.badge.fail,.missing{color:var(--bad)}.badge.pending{color:var(--muted)}
  .columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}.panel{min-width:0;
    border:1px solid var(--line);border-radius:8px;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
  .answer{background:#edf7f4;border-left:4px solid var(--accent);padding:14px}.raw{background:#f7f8f8;padding:13px;
    font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.original{border:1px solid var(--line);padding:14px}
  .source{border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px}.meta,.facts{display:grid;
    grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:7px}dt{font-weight:750}dd{margin:0;overflow-wrap:anywhere}
  .claim{background:#f7faf9;padding:8px 11px;margin:8px 0}.claim-link{font-size:.9rem;color:var(--muted)}
  .app-attribution{border:2px solid var(--accent);border-radius:7px;padding:10px;background:#eaf7f4}
  .app-attribution span,.app-attribution small,.references span,.references a{display:block}.separated{border:2px dashed var(--warn);
    padding:14px;margin-top:18px}.review,.account{border-top:2px solid var(--line);margin-top:20px;padding-top:13px}
  .table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:820px}th,td{border:1px solid var(--line);
    padding:9px;text-align:left;vertical-align:top}th{background:var(--wash)}
  details{margin:14px 0}summary{font-weight:750;cursor:pointer}a{color:#075f82;overflow-wrap:anywhere;
    word-break:break-word}code,li{overflow-wrap:anywhere;word-break:break-word}
  nav ul{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}nav a{border:1px solid var(--line);padding:5px 10px;border-radius:5px}
  @media(max-width:820px){.columns{grid-template-columns:1fr}.case-head{align-items:flex-start;flex-direction:column}}
  @media print{body{background:#fff}main{max-width:none;padding:0}.columns{grid-template-columns:1fr 1fr}
    .card,.summary,.boundary{break-inside:avoid}details>*{display:block!important}a{color:inherit}}
  </style></head><body><main>
  <header><p class="eyebrow">offline evidence report / ${h(runId)}</p>
    <h1>独立ケース隔離読解評価</h1>
    <p class="lede">モデル生回答、原文、ケース単体の判定、アプリ側の帰属・制限・適用情報を分けて比較します。</p></header>
  <section class="boundary" id="report-boundaries"><h2>試験の境界と停止規則</h2><ul>
    <li>Q05は未合格のままです。保存済み回答へAPI送信せず、アプリの帰属表示だけを別に検証します。</li>
    <li>Q06〜Q11は全6ケースの送信・レビューを完了しました。この完了は追加送信、Q05の新規送信、再試行を許可しません。</li>
    <li>ケース固有の回答品質・帰属省略は、そのケースを不合格として記録したうえで次の独立ケースへ進めます。合格基準は緩めません。</li>
    <li>未許可データ送信、通常経路ゲートの解除、予算・回数管理の破綻、利用量不明など試験全体の問題では全体停止します。</li>
    <li>資料の採用・公開承認は変更せず、実利用者情報・既存DB・本番経路は使用しません。</li>
  </ul></section>
  <section class="summary" id="execution-summary"><h2>実行状況</h2><div class="summary-grid">
    <div class="stat"><strong>ケース合格</strong>${h(passed.join("、") || "なし")}</div>
    <div class="stat"><strong>ケース不合格</strong>Q05、${h(failed.join("、") || "なし")}</div>
    <div class="stat"><strong>未送信</strong>${h(pending.join("、") || "なし")}</div>
    <div class="stat"><strong>累計API通信</strong>${h((ledger.entries ?? []).length)} / ${h(ledger.limits?.maxApiTransmissions ?? 20)}</div>
    <div class="stat"><strong>基線7通信の費用</strong>${money(baselineCost)}</div>
    <div class="stat"><strong>Q06〜Q11の判明費用</strong>${money(newCost)}</div>
    <div class="stat"><strong>累計計算費用</strong>${unknownUsage ? "利用量不明のため算出停止" : money(baselineCost + newCost)}</div>
    <div class="stat"><strong>運用予算 / 同時実行</strong>${money(ledger.limits?.operationalModelBudgetMicroUSD ?? 1_000_000)} / ${h(ledger.limits?.maxConcurrency ?? 1)}</div>
  </div><p class="note">usageから呼出し単位で切り上げた運用計算であり、請求確定額ではありません。未知値を0に補いません。</p></section>
  <section class="summary" id="case-outcome-table"><h2>ケース別一覧</h2>
    <p class="note">不合格回答は訂正していません。アプリ側表示は生回答・判定と分離し、不合格を合格へ変更しません。</p>
    <div class="table-wrap"><table>
    <thead><tr><th>ケース</th><th>モデル単体</th><th>モデルの問題</th><th>アプリ側で付けた内容</th><th>未解決事項</th></tr></thead>
    <tbody>${summaryRows.map(row => `<tr><th><a href="#${h(row.id === "Q05" ? "Q05-display" : row.id)}">${h(row.id)}</a></th>
      <td>${h(row.status)}</td><td>${h(row.problem)}</td><td>${h(row.app)}</td><td>${h(row.unresolved)}</td></tr>`).join("")}</tbody>
    </table></div></section>
  <nav><h2>ケース</h2><ul><li><a href="#Q05-display">Q05 表示検証</a></li>
    ${caseIds.map(id => `<li><a href="#${id}">${id}</a></li>`).join("")}<li><a href="#pre-send-record">送信前記録</a></li></ul></nav>
  <article class="card case" id="Q05-display" data-case-status="不合格（保持）">
    <header class="case-head"><div><p class="eyebrow">saved answer / no API</p><h2>Q05：未合格回答への帰属表示</h2></div>
      <span class="badge fail">不合格（変更なし）</span></header>
    <p>モデルはAASM帰属を省略したため、元の意味照合は <strong>${h(q05Review?.verdict ?? "stop")}</strong> のままです。
      次の表示は別のオフライン検証であり、回答修正・再採点・AASM本文の収録ではありません。</p>
    <div class="columns"><section class="panel" id="q05-raw-model-answer"><h3>モデル生回答（verbatim JSON）</h3>
      <pre class="answer">${h(q05Result?.outputText ?? "記録なし")}</pre>
      ${renderClaims({ result: q05Result, caseId: "Q05", catalog, attributionDisplay: q05Display })}</section>
      <section class="panel"><h3>掲載資料と推奨主体の確認済み関係</h3>
      ${q05Relation ? `<dl class="meta"><div><dt>掲載資料の発行元</dt><dd>${h(q05Relation.document_publisher)}</dd></div>
        <div><dt>資料が紹介する推奨主体</dt><dd>${h(q05Relation.recommendation_origin)}</dd></div></dl>
        <p>${h(q05Relation.qualification)}</p>` : missing(q05DisplayError ?? "帰属表示未検証")}
      <h4>独立表示検証記録</h4>${displayVerificationR.value
        ? jsonBlock(displayVerificationR.value) : missing(displayVerificationR.error)}</section></div>
    <section class="review"><h3>未合格判定（保持）</h3>
      <ul>${(q05Review?.findings ?? []).map(x => `<li>${h(x)}</li>`).join("") || "<li>記録なし</li>"}</ul></section>
    <details><summary>Q05結果 raw JSON</summary>${jsonBlock(q05Result)}</details>
    <details><summary>Q05レビュー raw JSON</summary>${jsonBlock(q05Review)}</details>
  </article>
  ${rows.map(renderCase).join("\n")}
  <article class="card" id="pre-send-record"><h2>各問の送信前期待結果・変更履歴</h2>
    <h3>変更履歴</h3>${changesR.value ? jsonBlock(changesR.value) : missing(changesR.error)}
    <h3>事前固定評価基準</h3>${rubricR.value ? jsonBlock(rubricR.value) : missing(rubricR.error)}
    <h3>事前理由</h3>${rationaleR.value ? jsonBlock(rationaleR.value) : missing(rationaleR.error)}
    <h3>完全性manifest</h3>${manifestR.value ? jsonBlock(manifestR.value) : missing(manifestR.error)}</article>
  <footer><p>未解決事項：AASM本文は未収録のため、夜間のみか24時間合計かを断定しません。未実行ケースは結果を推測しません。</p>
    <p>再生成：<code>node prototypes/evidence-consultation/evaluation/render-independent-report.mjs ${h(runId)}</code></p></footer>
  </main></body></html>`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, document, "utf8");
  process.stdout.write(`${path.relative(root, outputPath)}\n`);
};

await main();