export const ROOT = "evidence-work/private-parenting-trial-12";
export const ENDPOINT = "https://api.openai.com/v1/responses";
export const MODEL = "gpt-5.6-luna";
export const SCENES = Object.freeze({
  "sharing-toys": 3,
  "independent-attempt": 2,
  "food-preparation-burden": 3,
});
export const LIMITS = Object.freeze({
  attempts: 8,
  retries: 0,
  concurrency: 1,
  inputTokens: 8_000,
  outputTokens: 1_500,
  requestFramingTokens: 512,
  responseBytes: 24_000,
  timeoutMs: 60_000,
  authorizedCentiMicroUSD: 3_000_000,
});
// USD 0.20 / 1M input and USD 1.20 / 1M output.
export const RATES = Object.freeze({ inputCentiMicroUSD: 20, outputCentiMicroUSD: 120 });
export const RESERVE_PER_ATTEMPT = LIMITS.inputTokens * RATES.inputCentiMicroUSD
  + LIMITS.outputTokens * RATES.outputCentiMicroUSD;
export const AUTHORIZATION_TEXT = "準備できた「貸し借り」「自分でやりたい子への手助け」「食事の負担」の3場面について、非公開の実モデル試験を承認します。承認範囲は、新規最大8通信、今回の費用上限US$0.03、直列実行、再試行0です。失敗した送信も1通信として数えます。閉鎖済み枠は再利用しません。";
export const PLAN_HASHES = Object.freeze({
  scenes: "4cde03801f787f6f05142f04b34eb4194f69c2ded68bba67aa825a9af2b91d7c",
  rubric: "986f51cb337e6a00d5d3c26e85ad018795174ce4e21c2072a9ee0cf82ea0dd6f",
  rights: "84b90a4dcd799834943916de0e13f5eee301dfe453a8e685e3d947e8d2f76e1f",
  budget: "25da8a07b55198629d440be4b05e2e823871c2531727b616c6e01c90cb1495d3",
  history: "8a66b86466c7b5fa121e920988fe4095085e206cdac84a5e3bd62e0384657118",
});
export const PUBLIC_DOC_HASHES = Object.freeze({
  "model.json": "ecba4427ed906d08e4d2173b2527032511fe7a80516e27ccff2c8d77b52e6fb7",
  "pricing.json": "38bb4700849b3186fe34d7a7f7708634b7f5655b1e2d7615876c0c3f1d9b3062",
  "prompt-caching.json": "0e7d11aa9dd23f643abd3fe29249fabb011ffac8b73a57784e617b08f2a0c889",
  "reasoning.json": "f94d117671aeafd5311c194590efa1064b1722c7f34a329168eb8406e9be4758",
  "responses.json": "3f66d0f2ccd774eb176c34caa394dd6f05aec066747beb6ab167ae5cadcad989",
  "verification.json": "1be39e67829c9196f973f905712af8faa306c659141efcddaffdd87ed248b952",
});