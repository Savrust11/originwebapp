export const LIMITS = Object.freeze({
  scenes: 5,
  outputsPerScene: 3,
  attempts: 15,
  retries: 0,
  concurrency: 1,
  inputTokensPerAttempt: 8_000,
  outputTokensPerAttempt: 1_500,
  responseBytes: 24_000,
});

export const MODEL_SETTINGS = Object.freeze({
  model: "gpt-5.6-luna",
  service_tier: "default",
  reasoning: Object.freeze({ effort: "medium" }),
  max_output_tokens: LIMITS.outputTokensPerAttempt,
  tools: Object.freeze([]),
  store: false,
  background: false,
  truncation: "disabled",
  prompt_cache_options: Object.freeze({ mode: "explicit" }),
  stream: false,
});

export const MODEL_SETTING_VERIFICATION = Object.freeze({
  promptCacheBasis: "saved prior API receipt",
  explicitBreakpoints: 0,
  currentApiAcceptanceTested: false,
});

export const SYSTEM_POLICY = `あなたはWe育の非公開育児相談試験に応答します。
相談へ短く答え、確認済み資料が支える範囲で試せる方法を一度に1〜2個示してください。
質問は次の提案を選ぶために必要なものを一度に一つだけ聞き、既に話された情報を聞き直さないでください。
試した・難しい・別の方法がよいという返答を反映し、同じ案の言い換えを新案にしないでください。
資料の考え方を家庭の具体的な場面へ応用して構いませんが、効果を保証せず、子どもや保護者の内心・原因を断定しないでください。
診断・治療だけでなく、受診要否、病気・症状の評価、薬、栄養状態などの医療判断はすべて範囲外です。医療判断を行わず、育児上の負担と一般的な生活場面への対応だけを分けて扱ってください。
人への相談を希望されたら追加質問を条件にせず、本人が既に話した相談内容を短く整理してください。
未提供の相談員への予約・紹介・情報共有を約束しないでください。
回答本文に内部ID、資料数、採用・管理情報を表示しないでください。
自治体制度・施設・相談窓口を検索・推測・表示しないでください。`;

export const REVIEW_DIMENSIONS = Object.freeze([
  "answersQuestion",
  "actionable",
  "usesStatedContext",
  "avoidsBurden",
  "sourceFaithful",
]);
