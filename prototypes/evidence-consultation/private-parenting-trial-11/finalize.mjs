import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(".");
const out = path.join(root, "evidence-work/private-parenting-trial-11/offline");
const planDir = path.join(root, "evidence-work/private-parenting-trial-11/plan");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const json = file => JSON.parse(fs.readFileSync(file));
const planNames = [
  "scenes.json", "evaluation-rubric.json", "model-budget.json", "rights-plan.json",
  "history-reconciliation.json",
];
const plans = Object.fromEntries(planNames.map(name => [name, json(path.join(planDir, name))]));
const history = plans["history-reconciliation.json"];
const budget = plans["model-budget.json"];
const rights = plans["rights-plan.json"];
const inspection = json(path.join(out, "input-inspection.json"));
const browser = json(path.join(out, "browser-check.json"));
const connection = json(path.join(out, "connection-status.json"));
const syntheticHistory = json(path.join(out, "synthetic-history-inspection.json"));
if (inspection.status !== "passed_all_five_actual_original_packets"
  || browser.status !== "passed_file_only_offline"
  || syntheticHistory.status !== "passed_synthetic_history_cannot_be_real_candidate"
  || connection.actualProviderRequests !== 0
  || connection.actualModelResponses !== 0
  || history.currentCumulativeProviderTransmissions !== 47) throw Error("FINAL_PRECONDITION");

const historicalEvidence = history.trials.flatMap(trial => trial.evidence);
for (const evidence of historicalEvidence) {
  if (sha(path.join(root, evidence.path)) !== evidence.sha256) throw Error(`HISTORICAL_LEDGER_CHANGED:${evidence.path}`);
}
const synthetic = json(path.join(out, "synthetic-pipeline/index.json"));
const syntheticEvidence = synthetic.records.map(record => ({
  sceneId: record.sceneId,
  rawSha256: sha(path.join(out, record.rawPath)),
  metadataSha256: sha(path.join(out, record.metadataPath)),
  reviewSha256: sha(path.join(out, record.reviewPath)),
  continuationRequestSha256: record.continuationRequestSha256,
}));
const report = `# 非公開・実モデル育児相談試験：通信前の最終準備

確認日：2026-09-20  
状態：**モデルAPI送信0件。新規送信許可0件。**

## 過去の通信履歴

- 比較試験を開いた時点の累計：21通信。
- 比較試験 reading-comparison-02：21通信。終了時の累計は**42通信**。
- この「42通信」は比較試験までの累計で、その後の保護者向け試験を含まない。
- 保護者向け試験 parent-reading-evaluation-execution-01：5通信。終了後の現在累計は**47通信**。
- 両方の枠は閉鎖済みで残り0。未使用枠を今回へ移していない。保存済み台帳のhash一致を再確認し、上書きしていない。

## 会話・評価の修正

5場面の年齢、困りごと、試したこと、希望を実行前に固定した。生回答ごとに、固定事実だけを使う登録済み発言から、実際の回答へ自然に応答するものを評価者が選ぶ。未登録の事実や、試験中に試したという結果は作らない。

口頭の日課、行動を言葉にする等は許容例で、唯一の正解ではない。根拠に沿う別の有用な提案も、相談への直接性、具体性、本人の事情への対応、負担の少なさ、根拠への忠実さの5項目で同じように合格にできる。評価基準・許容例は生成入力に含めない。

同じ案の言い換えは品質上の問題として記録するが、それだけで全試験を停止しない。次を分離して記録する。

- completed：相談へ十分に答え、正常に早期完了
- answer_quality_failure：回答品質の問題
- protocol_cannot_continue：固定事実だけでは自然な次の発言を選べない設計上の限界
- safety_stop：医療判断、危険な指示、効果保証等
- transport_stop：入力・許可・予算・認証等の実行上の停止

送信前検査で止まった場合は外部通信0件のまま。将来、予約後に実ネットワーク試行を開始した場合だけ、成功・失敗を問わず新しい上限の1件に数える。

## 資料別の実行準備

| 場面 | ローカル未送信要求 | 外部送信の権利条件 | 今回の実行 |
|---|---|---|---|
| 出かける前の支度 | 準備済み | CDCの米国外保護注意を日本での製品開発・外部処理へどう適用するか判断待ち | 許可0のため停止 |
| 子どもとの遊び方 | 準備済み | 同上 | 許可0のため停止 |
| おもちゃの貸し借り | 準備済み | OGL条件を固定実装でき、権利上は新規許可待ち | 許可0のため停止 |
| 自分でやりたい子への手助け | 準備済み | PDL1.0条件・必須文脈・除外境界を固定実装でき、権利上は新規許可待ち | 許可0のため停止 |
| 食事づくり・食べ残しへの負担 | 準備済み | NHS/OGLの原文と翻案で異なる表示を分離実装でき、権利上は新規許可待ち | 許可0のため停止 |

CDCについて確認が必要なのはAI一般禁止の有無ではなく、日本から製品開発目的で狭い原文を外部処理へ複製する際、保存済み4条件の実装で足りるかという限定した問題である。その他3場面は権利条件を入力allowlist、監査sidecar、「根拠を見る」の固定表示で実装した。帰属の長文をモデルに生成させていない。

## 通信なしで接続した範囲

- 5場面すべてで、hash確認した実際の選定原文と必須文脈を含む要求をローカル組み立てし、未送信ファイルとして保存。
- 公開request APIでも、場面ごとの固定済みmessage IDから本文を引く。任意の保護者本文、偽造したfixed ID、別場面の発言、未登録発言を拒否する。会話履歴は同じ場面の登録済み発言と、直前の改変されていない生回答receiptの組だけを追加可能。
- 入力は無切捨て。各要求を8,000 UTF-8 bytes以下という保守的上限でも検査。
- 編集見本、期待回答、評価基準、場面の評価目的、自治体支援情報、未採用動画、内部source IDが5要求へ入っていないことを組立済み内容で確認。
- 合成応答5件を「実モデル回答ではない」と明示し、生bytesの追記専用保存、解析表示、別ファイルの5項目評価、固定事実による次の発言、次要求の履歴追加まで接続。合成履歴を含む要求にはprovider payload外で syntheticOfflineOnly を伝播し、実送信候補へ昇格できない。合成flag自体はprovider payloadへ入れない。
- 既存会話画面の保存済みstyle・会話表示をhash確認して読み取り利用。file://、通信遮断、所有HOMEで5場面を画面確認。

## 実試験へ進む場合の上限案

現在は0通信。実行可能性を先に整理できた3場面だけなら、推奨上限は**8通信**、保存済み単価による最大見積**$0.0272**、予約案**$0.03**。CDCの限定判断を解決して5場面全体へ広げる場合は最大**14通信**、最大見積**$0.0476**、予約案**$0.05**。

いずれも失敗試行を含み、再試行0、並列1、自動切替なし。現在価格・現在のモデル利用権限は今回通信して確認していない。新しい明示承認と別台帳の初期化前には送信しない。

既存DB、通常相談経路、資料の採用・公開状態、本番公開は変更していない。
`;
fs.writeFileSync(path.join(out, "report.md"), report);
const outputNames = [
  "index.html", "input-inspection.json", "connection-status.json", "adapter-receipt.json",
  "browser-check.json", "browser-check.png", "synthetic-history-inspection.json", "report.md",
];
const receipt = {
  status: "offline_execution_preparation_complete_external_transmission_zero",
  planSha256: Object.fromEntries(planNames.map(name => [name, sha(path.join(planDir, name))])),
  history: {
    comparisonCumulativeThroughClose: 42,
    laterParentTrialTransmissions: 5,
    currentCumulativeProviderTransmissions: 47,
    currentTrialTransmissions: 0,
    currentAuthorizedAdditional: 0,
    historicalEvidenceHashMatched: true,
    historicalLedgersModified: false,
  },
  prepared: {
    locallyAssembledUnsentScenes: rights.globalExecution.localUnsentAssemblyAllowedScenes,
    externallyRightsReadySubjectToNewAuthorization: rights.globalExecution.externalRightsReadyScenes,
    externallyHeldForConcreteCdcDecision: rights.globalExecution.externalRightsHeldScenes,
    actualOriginalTextPackets: inspection.packets.filter(item => item.actualOriginalTextPresent).length,
    requestContentInspectionPassed: inspection.status,
    frozenMessageBoundaryEnforced: true,
    syntheticHistorySendEligibility: syntheticHistory.status,
    syntheticResponses: synthetic.records.length,
    actualProviderRequests: 0,
    actualModelResponses: 0,
  },
  futureProposalOnly: {
    recommendedRightsReadySubset: budget.rightsReadySubsetProposal,
    allFiveAfterCdcResolution: {
      maximumNewApiTransmissions: budget.futureRunMaximums.maximumNewApiTransmissions,
      maximumCostUSDAtSavedRates: budget.costEstimateAtCeiling.maximum14TransmissionsUSD,
      proposedReservationCeilingUSD: budget.costEstimateAtCeiling.proposedReservationCeilingUSD,
    },
  },
  browser,
  syntheticEvidence,
  outputSha256: Object.fromEntries(outputNames.map(name => [name, sha(path.join(out, name))])),
};
fs.writeFileSync(path.join(out, "final-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log("Finalized offline preparation: cumulative 47 preserved, five local packets, zero provider calls.");