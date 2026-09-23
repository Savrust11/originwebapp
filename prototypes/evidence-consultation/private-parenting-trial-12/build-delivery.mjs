import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = "evidence-work/private-parenting-trial-12";
const out = path.join(root, "delivery");
const run = path.join(root, "run/private");
const plan = JSON.parse(fs.readFileSync("evidence-work/private-parenting-trial-11/plan/scenes.json"));
const evaluationPath = path.join(root, "evaluation/quality-review.md");
if (!fs.existsSync(evaluationPath)) throw Error("QUALITY_REVIEW_NOT_READY");
const evaluationBytes = fs.readFileSync(evaluationPath);
const evaluation = evaluationBytes.toString("utf8").trim().split("\n")
  .filter(line => !line.startsWith("通信記録上は生回答6件、")).join("\n").trim();
const secondLookPath = path.join(root, "evaluation/quality-review-second-look.json");
if (!fs.existsSync(secondLookPath)) throw Error("QUALITY_SECOND_LOOK_NOT_READY");
const secondLookBytes = fs.readFileSync(secondLookPath);
const secondLook = JSON.parse(secondLookBytes);
if (secondLook.status !== "bounded_revision_preserving_first_review") throw Error("QUALITY_SECOND_LOOK_INVALID");
const secondLookMdPath = path.join(root, "evaluation/quality-review-second-look.md");
if (!fs.existsSync(secondLookMdPath)) throw Error("QUALITY_SECOND_LOOK_MD_NOT_READY");
const secondLookMdBytes = fs.readFileSync(secondLookMdPath);
const secondLookMd = secondLookMdBytes.toString("utf8").trim();
const firstReviewJsonBytes = fs.readFileSync(path.join(root, "evaluation/quality-review.json"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const html = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const fontRoot = "node_modules/@fontsource/noto-sans-jp";
const fontCss = fs.readFileSync(path.join(fontRoot, "400.css"), "utf8")
  .replace(/src: url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\), url\(\.\/files\/[^)]+\.woff\) format\('woff'\);/g,
    (_, name) => `src: url(data:font/woff2;base64,${fs.readFileSync(path.join(fontRoot, "files", name)).toString("base64")}) format('woff2');`);
const money = centiMicro => (centiMicro / 100_000_000).toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
const order = [
  ["sharing-toys", "おもちゃの貸し借り", ["initial", "st-favourite-cannot-hide"]],
  ["independent-attempt", "自分でやりたい子への手助け", ["initial", "ia-time-limit"]],
  ["food-preparation-burden", "食事づくり・食べ残しへの負担", ["initial", "fb-wants-human-help"]],
];
const events = fs.readdirSync(path.join(run, "events")).sort().map(name => {
  const bytes = fs.readFileSync(path.join(run, "events", name));
  return { ...JSON.parse(bytes), file: name, sha256: sha(bytes) };
});
if (events.length !== 14 || events.at(-1).type !== "authorization-closed") throw Error("RUN_NOT_CLOSED");
let previous = null;
for (const [index, event] of events.entries()) {
  if (event.sequence !== index + 1 || event.previousSha256 !== previous) throw Error("EVENT_CHAIN_INVALID");
  previous = event.sha256;
}
const attempts = events.filter(event => event.type === "transmission-reserved");
const responseEvents = events.filter(event => event.type === "response-recorded");
if (attempts.length !== 6 || responseEvents.length !== 6) throw Error("ACTUAL_CALL_COUNT_INVALID");

const rows = responseEvents.map(event => {
  const n = String(event.data.attempt).padStart(2, "0");
  const metadataPath = path.join(run, `responses/${n}.json`);
  const rawPath = path.join(run, `raw/${n}.bin`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath));
  const raw = fs.readFileSync(rawPath);
  if (metadata.classification !== "actual_model_raw_response"
    || metadata.rawSha256 !== sha(raw)
    || event.data.measuredCentiMicroUSD < 0
    || event.data.retainReservation !== false) throw Error("ACTUAL_RESPONSE_INVALID");
  return { attempt: event.data.attempt, event, metadata, rawPath, metadataPath };
});
const parentText = (sceneId, messageId) => {
  const scene = plan.scenes.find(item => item.id === sceneId);
  if (messageId === "initial") return scene.initialUserMessage.text;
  const message = scene.selectableFollowUps.find(item => item.id === messageId);
  if (!message) throw Error("PARENT_MESSAGE_NOT_FIXED");
  return message.text;
};
const sourceNotice = sceneId => {
  const first = rows.find(row => row.metadata.sceneId === sceneId);
  const sidecar = JSON.parse(fs.readFileSync(path.join(run,
    `requests/${String(first.attempt).padStart(2, "0")}.sidecar.json`)));
  if (sceneId === "sharing-toys") {
    return sidecar.sourceAttribution[0].attribution.requiredCredit;
  }
  if (sceneId === "independent-attempt") {
    return "こども家庭庁「『はじめの100か月』みんなの応援アクション 保護者のみなさんへ」をもとにWe育が編集。こども家庭庁の監修・推奨を示すものではありません。";
  }
  return "We育編集。Contains public sector information licensed under the Open Government Licence v3.0. 公式監修・推奨を示すものではありません。";
};
let conversationsMd = "";
let conversationsHtml = "";
for (const [sceneId, title, ids] of order) {
  conversationsMd += `## ${title}\n\n`;
  conversationsHtml += `<section><h2>${html(title)}</h2>`;
  for (const id of ids) {
    const row = rows.find(item => item.metadata.sceneId === sceneId
      && item.metadata.parentMessageId === id);
    if (!row) throw Error("CONVERSATION_TURN_MISSING");
    const parent = parentText(sceneId, id);
    conversationsMd += `**保護者**\n\n${parent}\n\n**モデルの生回答（無修正）**\n\n\`\`\`text\n${row.metadata.extractedVisibleText}\n\`\`\`\n\n`;
    conversationsHtml += `<div class="turn parent"><div class="who">保護者</div><p>${html(parent)}</p></div>`
      + `<div class="turn model"><div class="who">モデルの生回答（無修正）</div><p>${html(row.metadata.extractedVisibleText)}</p></div>`;
  }
  const notice = sourceNotice(sceneId);
  conversationsMd += `<details><summary>根拠を見る</summary>\n\n${notice}\n\n</details>\n\n`;
  conversationsHtml += `<details><summary>根拠を見る</summary><p>${html(notice)}</p></details></section>`;
}
const totalInput = rows.reduce((sum, row) => sum + row.metadata.usage.input_tokens, 0);
const totalOutput = rows.reduce((sum, row) => sum + row.metadata.usage.output_tokens, 0);
const totalReasoning = rows.reduce((sum, row) =>
  sum + row.metadata.usage.output_tokens_details.reasoning_tokens, 0);
const totalCost = responseEvents.reduce((sum, event) => sum + event.data.measuredCentiMicroUSD, 0);
if (totalCost !== 332_180) throw Error("COST_TOTAL_INVALID");
const technicalRows = rows.map(row => {
  const usage = row.metadata.usage;
  return `| ${row.attempt} | ${row.metadata.sceneId} / ${row.metadata.parentMessageId} | ${usage.input_tokens} | ${usage.output_tokens} | ${usage.output_tokens_details.reasoning_tokens} | $${money(row.event.data.measuredCentiMicroUSD)} | \`${row.metadata.rawSha256}\` |`;
}).join("\n");
const report = `# 非公開・実モデル育児相談試験 結果

## 会話全文

${conversationsMd}## 5項目の品質評価・役立った点・困った点

${evaluation}

${secondLookMd}

## 接続・表示の技術検証

- 実モデル通信：6件。比較まで42件＋過去の保護者向け5件＋今回6件＝累計53件。
- 新規枠は閉鎖済み。上限8件のうち未使用2件は再利用しません。
- 直列実行、再試行0、自動モデル切替0。全6件HTTP 200、usage既知、cache read/writeとも0、未解決予約0。
- 入力 ${totalInput} tokens、出力 ${totalOutput} tokens（うちreasoning ${totalReasoning} tokens）。
- 計算費用 **$${money(totalCost)}**。上限$0.03、8件最大予約$0.0272、実行6件の予約$0.0204。請求書額の保証ではありません。
- 生回答はraw bytesを無修正・追記専用で保存。品質評価と分離しました。
- CDC依存2場面、自治体情報、未採用資料、実利用者情報は使用していません。
- 既存DB、通常相談経路、採用・公開状態、本番公開は変更していません。

| # | 場面 / 発言 | 入力 | 出力 | reasoning | 計算費用 | raw SHA-256 |
|---:|---|---:|---:|---:|---:|---|
${technicalRows}

### 終了理由

- 貸し借り：2回答で登録済みの事情に応答し、自然に完了。
- 自分でやりたい子：場面上限2回答で終了。最後の「靴と着替えのどちらか」は未登録事実を必要とするため、架空の返答を追加しませんでした。
- 食事の負担：2回答目で、人への相談希望に対して既出内容を整理。条件付き3発言目は不要でした。

会話品質の判断は上の評価、接続・保存・表示の確認は本節に分離しています。
`;
const style = `${fontCss}body{font-family:"Noto Sans JP",sans-serif;color:#2d2532;background:#faf8fc;margin:0}.wrap{max-width:820px;margin:auto;padding:32px 20px 80px}h1{font-size:28px}h2{margin-top:42px}.turn{padding:16px 18px;border-radius:16px;margin:12px 0;white-space:pre-wrap}.parent{background:#eee8f3;margin-left:10%}.model{background:white;border-left:4px solid #714692;box-shadow:0 1px 5px #ddd}.who{font-size:12px;font-weight:700;color:#765784;margin-bottom:8px}details{margin:12px 0 28px}summary{cursor:pointer;font-weight:700}.notice{padding:14px;background:#fff8db}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ddd;padding:7px;text-align:left}.eval{white-space:pre-wrap;background:white;padding:18px;border-radius:12px}.status{background:#e7f4ed;padding:12px;border-radius:10px}`;
const page = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>育児相談実モデル試験 結果</title><style>${style}</style><body><main class="wrap"><h1>育児相談実モデル試験 結果</h1><p class="status">非公開試験・6通信で閉鎖済み。以下は保存済みの実モデル生回答です。</p><h2>会話全文</h2>${conversationsHtml}<h2>5項目の品質評価・役立った点・困った点</h2><div class="eval">${html(`${evaluation}\n\n${secondLookMd}`)}</div><h2>接続・表示の技術検証</h2><ul><li>6通信・累計53通信・未使用2件は閉鎖</li><li>入力 ${totalInput} / 出力 ${totalOutput} tokens（reasoning ${totalReasoning}）</li><li>計算費用 $${money(totalCost)}、未解決予約0</li><li>再試行・fallback・追加照会なし</li></ul><table><thead><tr><th>#</th><th>場面</th><th>入力</th><th>出力</th><th>費用</th><th>raw hash</th></tr></thead><tbody>${rows.map(row => `<tr><td>${row.attempt}</td><td>${html(`${row.metadata.sceneId}/${row.metadata.parentMessageId}`)}</td><td>${row.metadata.usage.input_tokens}</td><td>${row.metadata.usage.output_tokens}</td><td>$${money(row.event.data.measuredCentiMicroUSD)}</td><td>${html(row.metadata.rawSha256)}</td></tr>`).join("")}</tbody></table><p class="notice">品質評価と技術検証は分離しています。既存DB・通常相談経路・公開状態は変更していません。</p></main></body></html>`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "report.md"), report);
fs.writeFileSync(path.join(out, "index.html"), page);
const publicVerification = fs.readFileSync(path.join(root, "public-docs/verification.json"));
const oldHistory = fs.readFileSync("evidence-work/private-parenting-trial-11/plan/history-reconciliation.json");
const historyObject = JSON.parse(oldHistory);
const historicalEvidenceBindings = historyObject.trials.flatMap(trial =>
  trial.evidence.map(item => {
    const actualSha256 = sha(fs.readFileSync(item.path));
    if (actualSha256 !== item.sha256) throw Error("OLD_LEDGER_HASH_CHANGED");
    return { path: item.path, sha256: actualSha256 };
  }));
const publicDocumentBindings = fs.readdirSync(path.join(root, "public-docs")).sort()
  .map(name => ({ name, sha256: sha(fs.readFileSync(path.join(root, "public-docs", name))) }));
const manifest = {
  format: "weiku.private-parenting-trial-12.delivery-manifest.v1",
  status: "closed-six-actual-responses-delivered",
  actualCalls: 6,
  cumulativeCalls: 53,
  unusedCallsClosed: 2,
  totals: {
    inputTokens: totalInput, outputTokens: totalOutput, reasoningTokens: totalReasoning,
    reservedCentiMicroUSD: 2_040_000, reservedUSD: 0.0204,
    centiMicroUSD: totalCost, usd: totalCost / 100_000_000, unresolvedCentiMicroUSD: 0,
  },
  eventTip: { file: events.at(-1).file, sha256: events.at(-1).sha256 },
  bindings: {
    publicVerificationSha256: sha(publicVerification),
    oldHistoryReconciliationSha256: sha(oldHistory),
    qualityReviewSha256: sha(evaluationBytes),
    qualityReviewJsonSha256: sha(firstReviewJsonBytes),
    qualityReviewSecondLookSha256: sha(secondLookBytes),
    qualityReviewSecondLookMarkdownSha256: sha(secondLookMdBytes),
    reportSha256: sha(Buffer.from(report)),
    htmlSha256: sha(Buffer.from(page)),
  },
  historicalEvidenceBindings,
  publicDocumentBindings,
  responses: rows.map(row => ({
    attempt: row.attempt, sceneId: row.metadata.sceneId,
    parentMessageId: row.metadata.parentMessageId,
    rawSha256: row.metadata.rawSha256,
    metadataSha256: sha(fs.readFileSync(row.metadataPath)),
    measuredCentiMicroUSD: row.event.data.measuredCentiMicroUSD,
  })),
};
fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ out, calls: 6, totalCostUSD: manifest.totals.usd }));