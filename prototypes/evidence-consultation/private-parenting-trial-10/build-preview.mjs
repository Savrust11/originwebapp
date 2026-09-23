import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { LIMITS, MODEL_SETTINGS, MODEL_SETTING_VERIFICATION, REVIEW_DIMENSIONS } from "./policy.mjs";
import { validatePlanBundle, validateProviderFacts } from "./plan-adapter.mjs";

const root = path.resolve(".");
const out = path.join(root, "evidence-work/private-parenting-trial-10/offline");
const planDir = path.join(root, "evidence-work/private-parenting-trial-10");
const planPaths = {
  scenes: path.join(planDir, "plan/scenes.json"),
  sources: path.join(planDir, "plan/source-plan.json"),
  budget: path.join(planDir, "plan/model-budget.json"),
  providerFacts: path.join(planDir, "plan/provider-facts.json"),
};
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const esc = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const loaded = {};
for (const [key, file] of Object.entries(planPaths)) {
  if (fs.existsSync(file)) loaded[key] = JSON.parse(fs.readFileSync(file, "utf8"));
}
fs.mkdirSync(out, { recursive: true });
const adaptedPlan = validatePlanBundle(loaded);
const adaptedProviderFacts = validateProviderFacts(loaded.providerFacts);

const oldManifestPath = path.join(root, "evidence-work/comparison-closeout/reading-comparison-02/evidence-manifest.json");
const oldManifestHash = sha(fs.readFileSync(oldManifestPath));
if (oldManifestHash !== "3d2d55621d3ebab1f87a8c2951b3364e1084684c22804331b1cf21327418393d") throw Error("CLOSED_ARCHIVE_CHANGED");
const frozenPagePath = path.join(root, "prototypes/evidence-consultation/conversation-handoff-preview/page.html");
const frozenRuntimePath = path.join(root, "prototypes/evidence-consultation/conversation-handoff-preview/runtime.mjs");
const frozenPage = fs.readFileSync(frozenPagePath);
const frozenRuntime = fs.readFileSync(frozenRuntimePath);
if (sha(frozenPage) !== "32c37bb01cc32296bfbcf1c815c9afb02401973bb0fde9e17f52426307029215"
  || sha(frozenRuntime) !== "ca19697c0f7360afd11eee57d36d024e7e6f85df19abef257677d99c0c5bb310") {
  throw Error("FROZEN_CONVERSATION_SURFACE_CHANGED");
}
const baseStyle = frozenPage.toString("utf8").match(/<style>([\s\S]*?)<\/style>/)?.[1]
  ?.replace(/@font-face\{[^}]+\}/, "");
if (!baseStyle) throw Error("FROZEN_CONVERSATION_STYLE_MISSING");
const font = fs.readFileSync(path.join(root, "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");

const sceneRows = Array.isArray(loaded.scenes?.scenes) ? loaded.scenes.scenes : [];
const label = "非公開・実モデル未接続／通信なし";
const displayScenes = sceneRows.map(scene => ({
  title: scene.title,
  turns: scene.plannedUserTurns?.map(turn => ({ text: turn.text, condition: turn.sendOnlyIf ?? null })) ?? [],
}));
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>We育 実モデル育児相談試験・接続準備</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}${baseStyle}
#scene-picker{width:100%;margin:8px 0 16px}.notice{border-left:4px solid #6f4a8e;background:#eee8f5;padding:12px}.waiting{color:#66518b}
.boundary{background:white;border:1px solid #e6e0ec;border-radius:12px;padding:12px}.footer span{max-width:260px}
</style></head><body><main><header><h1>We育 <span style="font-weight:normal">育児相談試験</span></h1><span class="label">${label}</span></header>
<p class="notice">モデル回答はまだありません。合成通信テストは接続部の確認だけで、育児回答の品質を示しません。</p>
<label for="scene-picker">5場面から選ぶ</label><select id="scene-picker"></select><section id="panel" role="region" aria-live="polite"></section>
<details><summary>根拠を見る</summary><p>5場面とも、資料本文の外部AI送信が保留または未承認です。実行時には送信可能性を確認済みの原文と必須文脈だけを生成入力に含めます。現在は送信しません。</p></details>
<section class="boundary"><h2>接続状態</h2><ul><li>実モデル送信：0</li><li>新しい送信許可：0</li><li>最大計画：${LIMITS.attempts}回答、再試行${LIMITS.retries}</li>
<li>モデル候補：${MODEL_SETTINGS.model}</li><li>1回答の出力上限：${MODEL_SETTINGS.max_output_tokens}トークン</li></ul></section></main>
<footer class="footer"><span>${label}<br>保存・送信なし</span><button id="end">見本を終了</button></footer><script>"use strict";
const scenes=${JSON.stringify(displayScenes).replace(/</g, "\\u003c")};let selected=0;
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el};
function render(){const scene=scenes[selected],panel=document.getElementById("panel");panel.replaceChildren(node("h2",scene.title));
 const pair=node("div",undefined,"pair"),parent=node("article",undefined,"parent"),parentBubble=node("div",undefined,"bubble");
 parentBubble.append(node("p",scene.turns[0]?.text||"計画未入力"));parent.append(node("p","保護者の相談","who"),parentBubble);
 const answer=node("article",undefined,"answer"),answerBubble=node("div",undefined,"bubble waiting");
 answerBubble.append(node("p","実モデル未接続：回答を待っていません（通信なし）"));answer.append(node("p","We育の回答","who"),answerBubble);pair.append(parent,answer);panel.append(pair);
 if(scene.turns[1]){panel.append(node("p","次の保護者発言は、実際の回答と条件が合うと検証者が確認した場合だけ送ります。","muted"));
  const details=node("details"),summary=node("summary","条件付きで準備した保護者発言を見る"),bubble=node("div",undefined,"bubble parent");bubble.append(node("p",scene.turns[1].text));
  details.append(summary,bubble,node("p",scene.turns[1].condition||"検証者が適合を確認","muted"));panel.append(details)}
 panel.append(node("p","回答が想定と違う場合は停止し、事前の発言を自動で続けません。","muted"))}
const picker=document.getElementById("scene-picker");scenes.forEach((scene,index)=>{const option=node("option",(index+1)+"．"+scene.title);option.value=String(index);picker.append(option)});
picker.onchange=()=>{selected=Number(picker.value);render()};document.getElementById("end").onclick=()=>{document.querySelector("main").replaceChildren(node("h1","見本を終了しました"),node("p","保存・送信はしていません。"));document.querySelector("footer").remove()};render();
</script></body></html>`;
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(path.join(out, "review-template.json"), `${JSON.stringify({
  status: "future_empty_unrated",
  actualRawResponse: null,
  rawResponsePolicy: "provider bytes immutable; parsed display and review separate",
  scenes: sceneRows.map(scene => ({
    sceneId: scene.id,
    responses: [],
    futureReviewTemplate: Object.fromEntries(REVIEW_DIMENSIONS.map(key => [key, { status: "unrated", note: "" }])),
  })),
}, null, 2)}\n`);
fs.writeFileSync(path.join(out, "connection-status.json"), `${JSON.stringify({
  status: "offline_prepared_not_connected",
  externalTransmissions: 0,
  authorization: { oldArchiveRemaining: 0, oldUnusedSlotClosed: true, newAuthorizedNow: 0 },
  realTransport: "unconditionally_disabled",
  syntheticDryRun: "technical_only_not_parenting_quality",
  limits: LIMITS,
  modelSettings: MODEL_SETTINGS,
  modelSettingVerification: MODEL_SETTING_VERIFICATION,
  oldClosedArchive: { path: "evidence-work/comparison-closeout/reading-comparison-02/evidence-manifest.json", sha256: oldManifestHash },
  planFilesPresent: Object.fromEntries(Object.entries(planPaths).map(([key, file]) => [key, fs.existsSync(file)])),
  planSha256: Object.fromEntries(Object.entries(planPaths).map(([key, file]) => [key, sha(fs.readFileSync(file))])),
}, null, 2)}\n`);
fs.writeFileSync(path.join(out, "offline-verification.json"), `${JSON.stringify({
  status: "verified_offline_live_execution_blocked",
  sceneProgressionPrepared: adaptedPlan.sceneCount,
  sourceExternalAIEligibility: adaptedPlan.eligibility,
  actualCopyrightedSourceBodiesIncludedInRequests: 0,
  actualProviderRequestsPrepared: adaptedPlan.actualRequestCandidates.length,
  actualProviderRequestsSent: 0,
  actualRawProviderResponses: 0,
  syntheticFixture: {
    classification: "technical_synthetic_only",
    containsParentingAnswer: false,
    changesSourceRights: false,
  },
  blockers: [
    "All five scenes have required source bodies whose external-AI processing is held or unauthorized.",
    "New provider transmission authorization is zero.",
    "Credential entitlement, current model availability, current response shape, and current price were not checked.",
  ],
  proposedFutureLimits: {
    model: loaded.budget.model.id,
    maximumAttempts: loaded.budget.futureRunMaximums.maximumNewApiTransmissions,
    retries: loaded.budget.proposedControls.retries,
    concurrency: loaded.budget.proposedControls.parallelism,
    inputTokensPerAttempt: loaded.budget.futureRunMaximums.maximumInputTokensPerTransmission,
    outputTokensPerAttempt: loaded.budget.futureRunMaximums.maximumOutputTokensPerTransmissionIncludingReasoning,
    estimatedMaximumUSD: loaded.budget.costEstimateAtMaximum.maximum15TransmissionsUSD,
    proposedReservationCeilingUSD: loaded.budget.costEstimateAtMaximum.proposedReservationCeilingUSD,
    status: loaded.budget.status,
    promptCacheOptions: MODEL_SETTINGS.prompt_cache_options,
    explicitPromptCacheBreakpoints: MODEL_SETTING_VERIFICATION.explicitBreakpoints,
    currentApiAcceptanceTested: MODEL_SETTING_VERIFICATION.currentApiAcceptanceTested,
  },
  providerFacts: adaptedProviderFacts,
  dependenciesRemaining: [
    "Resolve and record each source-specific external-processing delta.",
    "Obtain a new explicit authorization for up to 15 transmissions and the proposed reservation.",
    "Implement and separately review a real transport; the current real adapter unconditionally throws.",
    "Perform a separately authorized live handshake because none was attempted here.",
  ],
}, null, 2)}\n`);
const reviewer = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>育児相談試験・将来評価欄</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}${baseStyle}dl{background:white;border:1px solid #e6e0ec;border-radius:12px;padding:14px}dt{font-weight:bold}dd{margin:0 0 9px}.empty{color:#66518b}</style></head>
<body><main><header><h1>検証者用・将来評価欄</h1><span class="label">実回答0件／全項目未評価</span></header>
<p>実モデル回答と生応答はありません。次の5項目は、将来の回答ごとに独立して記録する空欄です。</p>
${sceneRows.map((scene, index) => `<section><h2>${index + 1}．${esc(scene.title)}</h2><p class="empty">回答記録：0件</p><dl>${REVIEW_DIMENSIONS.map(key => `<dt>${esc(key)}</dt><dd>status: unrated ／ note: 空欄</dd>`).join("")}</dl></section>`).join("")}
</main></body></html>`;
fs.writeFileSync(path.join(out, "reviewer.html"), reviewer);
fs.writeFileSync(path.join(out, "adapter-receipt.json"), `${JSON.stringify({
  status: "checked_read_only_conversation_surface_adapter",
  frozenInputs: {
    "prototypes/evidence-consultation/conversation-handoff-preview/page.html": sha(frozenPage),
    "prototypes/evidence-consultation/conversation-handoff-preview/runtime.mjs": sha(frozenRuntime),
  },
  use: "Frozen conversation typography, bubbles, scene navigation pattern, evidence disclosure, and end control only.",
  excluded: "No authored assistant turns, handoff drafts, expected answers, hidden review data, sending, or persistence.",
  normalRouteChanged: false,
  planSha256: Object.fromEntries(Object.entries(planPaths).map(([key, file]) => [key, sha(fs.readFileSync(file))])),
}, null, 2)}\n`);
console.log(`Built offline private parenting trial preview (${sceneRows.length} planned scenes, no model connection).`);
