// Local-only materialization of matching packets; deliberately no transport or secrets.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { BASE, ROOT, verifyPreservation } from "./preserve.mjs";
const read = file => JSON.parse(fs.readFileSync(path.join(BASE, file)));
const hash = value => createHash("sha256").update(value).digest("hex");
const write = (name, data) => {
  const file = path.join(BASE, name);
  const bytes = `${JSON.stringify(data, null, 2)}\n`;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") !== bytes) throw new Error(`FROZEN_PACKET_CHANGED:${name}`);
  } else fs.writeFileSync(file, bytes, { flag: "wx" });
};
verifyPreservation();
const cases = read("cases.json");
const sources = read("source-content.json");
const modelPlan = read("models-and-budget.json");
const comparisonPolicy = read("comparison-policy.json");
const schema = read("response-schema.json");
const instructions = fs.readFileSync(path.join(BASE, "generation-rules.txt"), "utf8");
const appCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, cases.appDisplayPlan.catalogPath)));
const requests = cases.cases.map(item => {
  const commonRequest = {
    ...modelPlan.commonControls,
    text: { format: schema },
    input: [
      { role: "developer", content: instructions },
      { role: "user", content: JSON.stringify({
        question: item.question,
        original_evidence: item.originalIds.map(id => ({
          original_id: id, original_text: sources.originals[id].originalText,
        })),
      }) },
    ],
  };
  return { caseId: item.caseId, lane: item.lane,
    commonRequestSha256: hash(JSON.stringify(commonRequest)),
    requests: modelPlan.models.map(model => ({ ...commonRequest, model: model.id })) };
});
const appDisplays = cases.cases.map(item => {
  const available = appCatalog.catalog.cases[item.appCaseId].blocks;
  const ids = item.lane === "author-created-holdout" ? cases.appDisplayPlan.holdoutClassifications[item.caseId].selectedMandatory
    : available.filter(block => block.tier !== "optional").map(block => block.id);
  const blocks = ids.map(id => {
    const block = available.find(candidate => candidate.id === id);
    if (!block) throw new Error(`UNKNOWN_APP_BLOCK:${item.caseId}:${id}`);
    if (block.supports.some(support => !item.originalIds.includes(support.originalId)))
      throw new Error(`APP_SUPPORT_OUTSIDE_SENT_CLOSURE:${item.caseId}:${id}`);
    return block;
  });
  return { caseId: item.caseId, sameForBothModels: true, blocks,
    blocksSha256: hash(JSON.stringify(blocks)),
    placement: "全ての実際の本文要素の直後にmandatoryを表示。conditionalの研究詳細は展開可能にし、原文・版・該当箇所は常時追跡可能にする。",
    attributionVisibility: "紹介資料と推奨主体の関係は確認済みblockの文言どおりに表示する。",
    policyNotSourceConclusion: {
      applicability: "unconfirmed", individualAdviceBlocked: true, userReady: false,
      clinicalOrAdoptionApproval: false,
      collectedOriginalScope: "列挙した原文のみ。AASM原文は未収録。",
    } };
});
write("request-packets.json", { status: "prepared-never-sent", requests });
write("app-display-templates.json", { status: "no-generated-answers", appDisplays });
const lanes = ["known", "author-created-holdout"].map(lane => cases.cases.filter(item => item.lane === lane)
  .sort((left, right) => hash(`${comparisonPolicy.generationOrder.seed}:${left.caseId}`)
    .localeCompare(hash(`${comparisonPolicy.generationOrder.seed}:${right.caseId}`))));
const pairs = [];
if (lanes.some(lane => lane.length !== 6)) throw new Error("EXPECTED_SIX_CASES_PER_LANE");
for (let index = 0; index < 6; index++) {
  for (let laneIndex = 0; laneIndex < 2; laneIndex++) {
    const item = lanes[laneIndex][index];
    const modelOrder = modelPlan.models.map(model => model.id);
    if ((index + laneIndex) % 2) modelOrder.reverse();
    pairs.push({ caseId: item.caseId, lane: item.lane, modelOrder });
  }
}
write("execution-order.json", { status: "planned-only-not-executed",
  modelNamesMustNotReachScorer: true, pairs,
  attempts: pairs.flatMap(pair => pair.modelOrder.map(model => ({ caseId: pair.caseId, model })))
    .map((attempt, index) => ({ proposedNewAuthorizationAttempt: index + 1, ...attempt })) });
for (const item of requests) {
  const stripped = item.requests.map(({ model, ...request }) => JSON.stringify(request));
  if (stripped[0] !== stripped[1]) throw new Error("NON_MODEL_REQUEST_DIFFERENCE");
  const user = JSON.parse(item.requests[0].input[1].content);
  if (Object.keys(user).join(",") !== "question,original_evidence") throw new Error("PAYLOAD_NOT_ALLOWLISTED");
}
console.log(JSON.stringify({ preparedRequests: requests.length * 2,
  onlyModelFieldDiffers: true, appTemplates: appDisplays.length,
  providerTransmissions: 0, executableSenderPresent: false }));