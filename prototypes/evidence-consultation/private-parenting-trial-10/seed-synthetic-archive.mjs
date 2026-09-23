import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildGenerationRequest } from "./request-builder.mjs";
import { createOfflineInjectedTransport } from "./disabled-adapter.mjs";
import { archiveRawResponse } from "./response-record.mjs";
import { MODEL_SETTINGS } from "./policy.mjs";

const root = path.resolve("evidence-work/private-parenting-trial-10/offline/synthetic-connection");
const indexPath = path.join(root, "index.json");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
if (fs.existsSync(indexPath)) {
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const raw = fs.readFileSync(path.join(root, index.rawFile));
  const metadata = fs.readFileSync(path.join(root, index.metadataFile));
  if (hash(raw) !== index.rawSha256 || hash(metadata) !== index.metadataSha256) {
    throw new Error("SYNTHETIC_ARCHIVE_CHANGED");
  }
  console.log("Verified existing immutable technical synthetic archive.");
  process.exit(0);
}

const request = buildGenerationRequest({
  scene: { key: "technical-synthetic-v1", title: "合成接続確認" },
  sources: [{
    title: "合成技術資料",
    location: "ローカルのみ",
    originalText: "technical synthetic transport check; no external source body",
    applicability: "接続部の技術確認だけに用いる。",
    requiredContext: [],
    requiredContextRequired: false,
    externalAI: "send_eligible",
    externalAIStatus: "synthetic_local_only",
  }],
  conversation: [{ role: "user", content: "technical synthetic ping; not a parenting question" }],
});
const raw = Buffer.from(`${JSON.stringify({
  id: "synthetic-technical-v1",
  model: MODEL_SETTINGS.model,
  status: "completed",
  output: [{
    type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "SYNTHETIC_TRANSPORT_OK; NOT_A_REAL_MODEL_ANSWER", annotations: [] }],
  }],
  usage: { input_tokens: 32, output_tokens: 12 },
})}\n`);
const transport = createOfflineInjectedTransport(async serialized => {
  if (serialized !== request.serialized) throw new Error("SYNTHETIC_REQUEST_MISMATCH");
  return raw;
});
const received = await transport.attempt(request.serialized);
const record = archiveRawResponse({
  directory: root,
  rawBytes: received,
  requestSha256: request.sha256,
  synthetic: true,
});
const metadata = fs.readFileSync(record.metaPath);
const index = {
  status: "immutable_technical_synthetic_not_real_model_answer",
  actualProviderCalls: 0,
  parentingAnswer: false,
  rawFile: path.basename(record.rawPath),
  metadataFile: path.basename(record.metaPath),
  rawSha256: hash(received),
  metadataSha256: hash(metadata),
};
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log("Created immutable technical synthetic archive; no provider call.");
