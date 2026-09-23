import fs from "node:fs";
import path from "node:path";
import { MODEL_SETTINGS } from "./policy.mjs";
import { loadPlans } from "./plan-adapter.mjs";
import { buildSceneTurn, continuationRecord } from "./conversation-pipeline.mjs";
import { archiveRawResponse, blankReview, persistReviewRevision } from "./response-record.mjs";

const out = path.resolve("evidence-work/private-parenting-trial-11/offline");
const markerPath = path.join(out, "synthetic-pipeline/index.json");
const plans = loadPlans();
const syntheticText = Object.freeze({
  "departure-preparation": "【合成パイプライン試験／実モデル回答ではありません】短い流れを同じ順序で伝える、という資料範囲の文字列を表示・履歴接続の確認にだけ使います。",
  "play-together": "【合成パイプライン試験／実モデル回答ではありません】子どもが今していることに短く応じる、という資料範囲の文字列を表示・履歴接続の確認にだけ使います。",
  "sharing-toys": "【合成パイプライン試験／実モデル回答ではありません】来客前に共有する物を選ぶ、という資料範囲の文字列を表示・履歴接続の確認にだけ使います。",
  "independent-attempt": "【合成パイプライン試験／実モデル回答ではありません】助けられる距離で一部分を見守る、という資料範囲の文字列を表示・履歴接続の確認にだけ使います。",
  "food-preparation-burden": "【合成パイプライン試験／実モデル回答ではありません】少量にして無理強いせず別の機会にする、という資料範囲の文字列を表示・履歴接続の確認にだけ使います。",
});

if (!fs.existsSync(markerPath)) {
  const records = [];
  for (const scene of plans.scenes.scenes) {
    const first = buildSceneTurn({ scene, messageId: "initial" });
    const raw = Buffer.from(JSON.stringify({
      id: `synthetic-pipeline-${scene.id}`,
      model: MODEL_SETTINGS.model,
      status: "completed",
      output: [{
        type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: syntheticText[scene.id], annotations: [] }],
      }],
      usage: { input_tokens: Math.ceil(first.inputMeasurement.utf8Bytes / 4), output_tokens: 48 },
    }));
    const archived = archiveRawResponse({
      directory: path.join(out, "synthetic-pipeline/responses"),
      rawBytes: raw,
      requestSha256: first.sha256,
      sceneId: scene.id,
      turnNumber: 1,
      synthetic: true,
    });
    const followUpId = scene.selectableFollowUps[0].id;
    const decision = continuationRecord({
      scene,
      classification: "continue",
      selectedFollowUpId: followUpId,
      reason: "合成応答による履歴追加と固定事実分岐の技術確認。品質判定ではない。",
    });
    const review = blankReview();
    const reviewRecord = persistReviewRevision({
      directory: path.join(out, "synthetic-pipeline/reviews"),
      responseMetadataPath: archived.metadataPath,
      review,
      continuation: decision,
    });
    const second = buildSceneTurn({
      scene,
      messageId: followUpId,
      previous: [
        {
          role: "user",
          messageId: "initial",
          requestSha256: first.sha256,
        },
        {
          role: "assistant",
          receipt: { rawPath: archived.rawPath, metadataPath: archived.metadataPath },
        },
      ],
    });
    records.push({
      sceneId: scene.id,
      firstRequestSha256: first.sha256,
      rawPath: path.relative(out, archived.rawPath),
      metadataPath: path.relative(out, archived.metadataPath),
      reviewPath: path.relative(out, reviewRecord.path),
      followUpId,
      continuationRequestSha256: second.sha256,
      continuationRequestUtf8Bytes: second.inputMeasurement.utf8Bytes,
      continuationSyntheticOfflineOnly: second.syntheticOfflineOnly,
      continuationExternalStatus: second.externalStatus,
      actualProviderRequest: false,
      actualModelAnswer: false,
    });
  }
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify({
    classification: "synthetic_pipeline_test_not_real_model_answers",
    records,
  }, null, 2)}\n`, { flag: "wx" });
}
console.log("Synthetic response → review → fixed-fact continuation pipeline prepared; no provider call.");