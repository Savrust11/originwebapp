import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPlans } from "./plan-adapter.mjs";
import { buildSceneTurn } from "./conversation-pipeline.mjs";
import { sourceBlocksForScene } from "./source-loader.mjs";
import { LIMITS, MODEL_SETTINGS, REVIEW_DIMENSIONS, SYSTEM_POLICY } from "./policy.mjs";

const root = path.resolve(".");
const out = path.join(root, "evidence-work/private-parenting-trial-11/offline");
const planDir = path.join(root, "evidence-work/private-parenting-trial-11/plan");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const esc = text => String(text).replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const stable = (file, bytes) => {
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(Buffer.from(bytes))) throw new Error(`STABLE_OUTPUT_CHANGED:${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: "wx" });
};

const plans = loadPlans();
const rightsBytes = fs.readFileSync(path.join(planDir, "rights-plan.json"));
const rights = JSON.parse(rightsBytes);
if (rights.format !== "weiku.private-parenting-trial.rights-plan.v2"
  || rights.globalExecution?.localUnsentAssemblyAllowedScenes !== 5
  || rights.globalExecution?.authorizedNewTransmissions !== 0) throw Error("RIGHTS_PLAN_SCHEMA");
const pending = [];
for (const scene of plans.scenes.scenes) {
  const built = buildSceneTurn({ scene, messageId: "initial" });
  const sceneDir = path.join(out, "pending-unsent", scene.id);
  stable(path.join(sceneDir, "request.json"), Buffer.from(built.serialized));
  stable(path.join(sceneDir, "sidecar-v3.json"), Buffer.from(`${JSON.stringify({
    classification: "locally_assembled_unsent_request",
    externalTransmissionAuthorized: false,
    syntheticOfflineOnly: built.syntheticOfflineOnly,
    externalStatus: built.externalStatus,
    ...built.sidecar,
    inputMeasurement: built.inputMeasurement,
  }, null, 2)}\n`));
  const serialized = built.serialized;
  pending.push({
    sceneId: scene.id,
    requestSha256: built.sha256,
    utf8Bytes: built.inputMeasurement.utf8Bytes,
    conservativeMaximumTokens: built.inputMeasurement.conservativeMaximumTokens,
    sourceOriginalUnitCount: built.sidecar.sourceAttribution.length,
    actualOriginalTextPresent: built.sidecar.sourceAttribution.every(source => {
      const original = sourceBlocksForScene(scene.id).packetBlocks
        .find((_, index) => built.sidecar.sourceAttribution[index].unitId === source.unitId)?.originalText;
      return typeof original === "string" && built.packet.input[1].content.includes(original);
    }),
    authoredExamplesPresent: /authoredAnswer|編集済み会話見本|期待回答/.test(serialized),
    rubricPresent: plans.rubric.dimensions.some(dimension => serialized.includes(dimension.pass)),
    planPurposePresent: /selectWhen|acceptableProposalExamplesNotGoldAnswers/.test(serialized),
    municipalInformationPresent: /https?:\/\/[^"]*(city|lg\.jp)|地域子育て支援センター/.test(serialized),
    unadoptedVideoPresent: /動画終了|screen transition/.test(serialized),
    sourceMetadataPresent: built.sidecar.sourceAttribution.some(source =>
      serialized.includes(source.unitId) || serialized.includes(source.sourceId)
      || serialized.includes(source.versionId)),
  });
}

const frozenPagePath = path.join(root, "prototypes/evidence-consultation/conversation-handoff-preview/page.html");
const frozenRuntimePath = path.join(root, "prototypes/evidence-consultation/conversation-handoff-preview/runtime.mjs");
const frozenPage = fs.readFileSync(frozenPagePath);
const frozenRuntime = fs.readFileSync(frozenRuntimePath);
if (sha(frozenPage) !== "32c37bb01cc32296bfbcf1c815c9afb02401973bb0fde9e17f52426307029215"
  || sha(frozenRuntime) !== "ca19697c0f7360afd11eee57d36d024e7e6f85df19abef257677d99c0c5bb310") {
  throw Error("FROZEN_CONVERSATION_SURFACE_CHANGED");
}
const baseStyle = frozenPage.toString().match(/<style>([\s\S]*?)<\/style>/)?.[1]
  ?.replace(/@font-face\{[^}]+\}/, "");
if (!baseStyle) throw Error("FROZEN_STYLE_MISSING");
const font = fs.readFileSync(path.join(root, "prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
const syntheticIndex = JSON.parse(fs.readFileSync(path.join(out, "synthetic-pipeline/index.json")));
const display = plans.scenes.scenes.map(scene => {
  const record = syntheticIndex.records.find(item => item.sceneId === scene.id);
  const metadata = JSON.parse(fs.readFileSync(path.join(out, record.metadataPath)));
  const review = JSON.parse(fs.readFileSync(path.join(out, record.reviewPath)));
  const rightsScene = rights.sceneReadiness.find(item => item.sceneId === scene.id);
  return {
    id: scene.id,
    title: scene.title,
    parent: scene.initialUserMessage.text,
    syntheticAnswer: metadata.parsedDisplay.text,
    followUp: scene.selectableFollowUps.find(item => item.id === record.followUpId).text,
    review: review.review,
    readiness: rightsScene,
    bytes: pending.find(item => item.sceneId === scene.id).utf8Bytes,
  };
});
const syntheticHistoryInspection = display.map(item => {
  const scene = plans.scenes.scenes.find(candidate => candidate.id === item.id);
  const record = syntheticIndex.records.find(candidate => candidate.sceneId === item.id);
  const chained = buildSceneTurn({
    scene,
    messageId: record.followUpId,
    previous: [
      { role: "user", messageId: "initial", requestSha256: record.firstRequestSha256 },
      {
        role: "assistant",
        receipt: {
          rawPath: path.join(out, record.rawPath),
          metadataPath: path.join(out, record.metadataPath),
        },
      },
    ],
  });
  return {
    sceneId: item.id,
    syntheticOfflineOnly: chained.syntheticOfflineOnly,
    externalStatus: chained.externalStatus,
    providerPayloadContainsSyntheticFlag: Object.hasOwn(chained.packet, "syntheticOfflineOnly"),
    requestSha256: chained.sha256,
  };
});
const attribution = {
  "departure-preparation": "Source: CDC（原文はCDC.govで無償入手可能。CDC/HHS/米国政府はWe育を推奨していません）／こども家庭庁原資料をもとにWe育編集（推奨・監修を示しません）",
  "play-together": "Source: CDC（原文はCDC.govで無償入手可能。CDC/HHS/米国政府はWe育を推奨していません）",
  "sharing-toys": "Welsh Government原資料。Contains public sector information licensed under the Open Government Licence v3.0. We育編集・非推奨。",
  "independent-attempt": "こども家庭庁原資料をもとにWe育編集。推奨・監修を示すものではありません。",
  "food-preparation-burden": "We育編集。Contains public sector information licensed under the Open Government Licence v3.0. 公式監修・推奨を示すものではありません。",
};
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>We育 育児相談試験・通信なし接続確認</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}${baseStyle}
.notice{border-left:4px solid #6f4a8e;background:#eee8f5;padding:12px}.synthetic{border:2px dashed #b48b2c}.boundary{background:#fff;border:1px solid #e6e0ec;border-radius:12px;padding:14px}select{width:100%;padding:10px;margin:8px 0 14px}dt{font-weight:bold}dd{margin:0 0 8px}.good{color:#235b46}.held{color:#8b5610}</style></head><body><main>
<header><h1>We育 <span style="font-weight:normal">育児相談試験</span></h1><span class="label">非公開・通信0件</span></header>
<p class="notice">表示中の回答は、接続経路を確認する合成テストです。実モデル回答ではなく、品質評価にも使いません。</p>
<label for="scene">5場面から選ぶ</label><select id="scene"></select><section id="conversation"></section>
<details open><summary>根拠を見る</summary><p id="attribution"></p></details>
<section class="boundary"><h2>ローカル接続状態</h2><ul id="status"></ul></section>
<section class="boundary"><h2>回答ごとの評価</h2><p>生回答とは別の追記専用記録です。合成応答は全項目未評価です。</p><dl id="review"></dl></section>
</main><script>"use strict";const scenes=${JSON.stringify(display).replace(/</g, "\\u003c")};const attribution=${JSON.stringify(attribution).replace(/</g, "\\u003c")};
const n=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
function render(){const s=scenes[Number(document.getElementById("scene").value)||0],c=document.getElementById("conversation");c.replaceChildren(n("h2",s.title));
const p=n("article",undefined,"parent"),pb=n("div",undefined,"bubble");pb.append(n("p",s.parent));p.append(n("p","保護者の相談","who"),pb);
const a=n("article",undefined,"answer"),ab=n("div",undefined,"bubble synthetic");ab.append(n("p",s.syntheticAnswer));a.append(n("p","合成接続テスト","who"),ab);
const f=n("article",undefined,"parent"),fb=n("div",undefined,"bubble");fb.append(n("p",s.followUp));f.append(n("p","固定事実から選んだ次の発言","who"),fb);c.append(p,a,f);
document.getElementById("attribution").textContent=attribution[s.id];const st=document.getElementById("status");st.replaceChildren();
for(const t of ["原文を含む未送信要求：組立済み","入力："+s.bytes+" UTF-8 bytes（無切捨て）","モデルAPI送信：0","外部送信："+(s.readiness.externalSendRights.startsWith("ready")?"権利条件は実装可能／新規許可0":"CDCの具体的判断待ち／新規許可0")])st.append(n("li",t,t.includes("判断待ち")?"held":"good"));
const dl=document.getElementById("review");dl.replaceChildren();for(const [k,v] of Object.entries(s.review)){dl.append(n("dt",k),n("dd","rating: "+v.rating+" ／ evidence: 空欄 ／ notes: 空欄"));}}
const pick=document.getElementById("scene");scenes.forEach((s,i)=>{const o=n("option",(i+1)+"．"+s.title);o.value=i;pick.append(o)});pick.onchange=render;render();</script></body></html>`;
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(path.join(out, "input-inspection.json"), `${JSON.stringify({
  status: pending.every(item => item.actualOriginalTextPresent && !item.authoredExamplesPresent
    && !item.rubricPresent && !item.planPurposePresent && !item.municipalInformationPresent
    && !item.unadoptedVideoPresent && !item.sourceMetadataPresent)
    ? "passed_all_five_actual_original_packets" : "failed",
  packets: pending,
  systemPolicySha256: sha(Buffer.from(SYSTEM_POLICY)),
  rubricSha256: plans.hashes["evaluation-rubric.json"],
  factRegistryPlanSha256: plans.hashes["scenes.json"],
  noSilentTruncation: true,
  conservativeInputRule: `request UTF-8 bytes must be <= ${LIMITS.requestBytes}; recorded bytes are an intentionally conservative token upper bound`,
}, null, 2)}\n`);
fs.writeFileSync(path.join(out, "connection-status.json"), `${JSON.stringify({
  status: "locally_connected_external_send_disabled",
  pendingUnsentRequests: 5,
  actualOriginalSourcePackets: 5,
  actualProviderRequests: 0,
  actualModelResponses: 0,
  syntheticPipelineResponses: 5,
  newAuthorizedTransmissions: 0,
  historicalCumulativeTransmissions: plans.history.currentCumulativeProviderTransmissions,
  modelSettings: MODEL_SETTINGS,
  futureMaximum: plans.budget.futureRunMaximums.maximumNewApiTransmissions,
  rightsReadySubjectToNewAuthorization: rights.sceneReadiness.filter(x => x.externalSendRights === "ready_with_fixed_conditions").map(x => x.sceneId),
  rightsHeldForConcreteCDCQuestion: rights.sceneReadiness.filter(x => x.externalSendRights.includes("held")).map(x => x.sceneId),
}, null, 2)}\n`);
fs.writeFileSync(path.join(out, "synthetic-history-inspection.json"), `${JSON.stringify({
  status: syntheticHistoryInspection.every(item => item.syntheticOfflineOnly
    && item.externalStatus === "permanently_not_sendable_synthetic_history"
    && !item.providerPayloadContainsSyntheticFlag)
    ? "passed_synthetic_history_cannot_be_real_candidate" : "failed",
  records: syntheticHistoryInspection,
}, null, 2)}\n`);
fs.writeFileSync(path.join(out, "adapter-receipt.json"), `${JSON.stringify({
  status: "frozen_conversation_surface_reused_read_only",
  frozenPageSha256: sha(frozenPage),
  frozenRuntimeSha256: sha(frozenRuntime),
  use: "typography, parent/answer bubbles, evidence disclosure and scene picker only",
  excludedFromReuse: "authored assistant answers, expected answers, handoff data, normal routes",
  planSha256: { ...plans.hashes, "rights-plan.json": sha(rightsBytes) },
}, null, 2)}\n`);
console.log("Built five locally assembled unsent requests and connected offline conversation display.");