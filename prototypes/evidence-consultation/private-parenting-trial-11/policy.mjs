export const LIMITS = Object.freeze({
  maximumTransmissions: 15,
  maximumOutputsPerScene: 3,
  retries: 0,
  concurrency: 1,
  inputTokens: 8_000,
  outputTokens: 1_500,
  requestBytes: 8_000,
  responseBytes: 24_000,
});

export const MODEL_SETTINGS = Object.freeze({
  model: "gpt-5.6-luna",
  service_tier: "default",
  reasoning: Object.freeze({ effort: "medium" }),
  max_output_tokens: LIMITS.outputTokens,
  tools: Object.freeze([]),
  store: false,
  background: false,
  truncation: "disabled",
  prompt_cache_options: Object.freeze({ mode: "explicit" }),
  stream: false,
});

export const SYSTEM_POLICY = `あなたはWe育の非公開育児相談試験に応答します。
保護者の相談にまず短く答え、確認済み資料が支える範囲で、その家庭で試せる方法を一度に1〜2個示してください。
資料に沿う別の有用な提案も選べます。特定の言い回しや一つの方法だけを正解にしないでください。
質問は次の提案を選ぶために必要なものを一度に一つだけ聞き、既に話された年齢・困りごと・試したこと・希望を聞き直さないでください。
試した、難しい、別の方法がよいという返答を反映し、同じ案の言い換えを新しい案として出さないでください。
資料の考え方を家庭の場面へ応用して構いませんが、資料にない効果の保証、子どもの内心や原因の断定はしないでください。
診断、治療、受診の要否、病気・症状、服薬、栄養状態を含む医療判断は扱わないでください。
人への相談を希望されたら追加質問を条件にせず、既に話された内容を短く整理してください。未提供の相談員への予約・紹介・情報共有を約束しないでください。
回答本文に内部ID、資料数、管理・承認上の説明を表示しないでください。
自治体制度・施設・相談窓口を検索、推測、表示しないでください。`;

export const REVIEW_DIMENSIONS = Object.freeze([
  "answersQuestion",
  "actionable",
  "usesStatedContext",
  "avoidsBurden",
  "sourceFaithful",
]);

export const SELECTED_UNIT_IDS = Object.freeze([
  "CFA100-S01",
  "cdc-routines-simple",
  "cdc-routines-capability-matched",
  "cdc-routines-predictability",
  "cdc-communication-follow-play-interest",
  "cdc-communication-describe-interest",
  "wales-peer-sharing-rehearsal",
  "CFA100-S05",
  "CFA100-S05-C01",
  "nhs-fussy-eaters-small-portions",
  "nhs-fussy-eaters-no-force-retry",
]);

export const SCENE_UNITS = Object.freeze({
  "departure-preparation": Object.freeze([
    "CFA100-S01", "cdc-routines-simple", "cdc-routines-capability-matched",
    "cdc-routines-predictability",
  ]),
  "play-together": Object.freeze([
    "cdc-communication-follow-play-interest", "cdc-communication-describe-interest",
  ]),
  "sharing-toys": Object.freeze(["wales-peer-sharing-rehearsal"]),
  "independent-attempt": Object.freeze(["CFA100-S05", "CFA100-S05-C01"]),
  "food-preparation-burden": Object.freeze([
    "nhs-fussy-eaters-small-portions", "nhs-fussy-eaters-no-force-retry",
  ]),
});