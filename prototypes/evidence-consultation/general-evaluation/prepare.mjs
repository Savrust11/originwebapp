#!/usr/bin/env node

/**
 * Offline-only preparation for the six new general-audience cases.
 * This module never sends a request, reads credentials, imports the ordinary
 * consultation route, or changes any historical evaluation artifact.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildVerifiedConditionCatalog } from "../condition-display/verified-catalog.mjs";

export const RUN_ID = "general-audience-six-01";
export const MODEL = "gpt-5.6-luna";
export const CASE_IDS = Object.freeze([
  "G-Q05", "G-Q06", "G-Q08", "G-Q09", "G-Q10", "G-Q11",
]);
const BASE_CASES = Object.freeze(["Q05", "Q06", "Q08", "Q09", "Q10", "Q11"]);
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../../..");
export const OUTPUT_DIRECTORY = path.join(
  ROOT, "evidence-work/general-audience-evaluation", RUN_ID, "preparation",
);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const stableJson = value => `${JSON.stringify(value, null, 2)}\n`;
const clone = value => JSON.parse(JSON.stringify(value));

export const CLAIM_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    explanations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          original_ids: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["text", "original_ids"],
      },
    },
    limitations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          original_ids: { type: "array", items: { type: "string" } },
        },
        required: ["text", "original_ids"],
      },
    },
    abstention: {
      type: "object",
      additionalProperties: false,
      properties: {
        applies: { type: "boolean" },
        text: { type: "string" },
        original_ids: { type: "array", items: { type: "string" } },
      },
      required: ["applies", "text", "original_ids"],
    },
  },
  required: ["explanations", "limitations", "abstention"],
});

// These are general reading rules. They contain no case rubric, expected answer,
// corrected answer, app-authored condition prose, or prior model answer.
export const GENERAL_INSTRUCTIONS = [
  "提示された original_evidence の原文だけを使い、一般向けの日本語で質問に答えてください。",
  "原文で支持できない情報を、外部知識、編集メモ、管理情報から補わないでください。原文にないことは不明だと区別してください。",
  "集団の平均年齢や平均値を、参加者全員の年齢範囲、個人の上限、目標、または効果保証に変えないでください。",
  "割合、研究数、参加者数、効果量を区別し、原文にない分母や人数を作らないでください。原文の表記に曖昧さや不整合があれば、推測で直さず限定してください。",
  "統計的な有意差がないことを効果ゼロの証明に変えず、研究間の大きなばらつきや改善しなかった結果を、結論の理解に必要な範囲で保持してください。",
  "提示原文の対象・採択・除外条件と矛盾する個別助言を生成しないでください。個人への適用を原文から判断できない場合は差し控えてください。",
  "AASM本文は original_evidence に含まれていません。AASM本文を読んだ、または昼寝を含む24時間合計を原文から確認したとは答えないでください。",
  "各事実説明を explanations の別要素にし、直接支える original_id だけを original_ids に指定してください。原文にないIDを作らないでください。",
  "出典名、版、該当箇所、対象・除外条件はアプリが別に表示します。これらを網羅するために原文外の文言を作らないでください。",
  "結論を限定する必要があれば limitations を使い、資料だけでは質問に答えられない部分は abstention で明示してください。",
].join("\n");

const CASE_SPECS = Object.freeze({
  "G-Q05": {
    baseCaseId: "Q05",
    question: "架空の1歳8か月の子どもについて、このガイドが紹介する睡眠時間の目安と、その時間が夜間だけなのか、昼寝を含む24時間の合計なのかを説明してください。取得した原文だけで区別できない点も明確にしてください。",
    originalIds: ["E02-F-S01-S02-SHARED"],
    appCaseId: "Q05",
    applicability: { fictional: true, targetRole: "child", age: { years: 1, months: 8 },
      confirmedHealthFacts: [], unverifiedFacts: ["個別の睡眠状況"],
      state: "confirmation-required" },
    bodyMandatory: [
      "1〜2歳児に対応する11〜14時間という目安を保持する。",
      "日本語ガイドがAASMの推奨を紹介している関係を、AASM本文を取得したかのようにせず保持する。",
      "選定原文だけでは夜間のみか、昼寝を含む24時間合計かを確認できないと区別する。",
    ],
    conditional: [],
    forbidden: [
      "昼寝を含む24時間合計だと選定原文の結論として断定する。",
      "夜間だけの時間だと断定する。",
      "AASM本文を取得・引用したと装う。",
      "個別の睡眠障害を診断する。",
    ],
    recurrence: ["AASMへの帰属省略", "収録外の24時間・昼寝情報による補完"],
  },
  "G-Q06": {
    baseCaseId: "Q06",
    question: "架空の4歳2か月の子どもについて、このガイドが紹介する睡眠時間の目安、その推奨の主体と根拠の説明範囲、さらにこの原文から昼寝を禁止してよいと言えるかを説明してください。昼寝や24時間合計について原文で確認できる範囲を区別してください。",
    originalIds: ["E02-F-S01-S02-SHARED"],
    appCaseId: "Q06",
    applicability: { fictional: true, targetRole: "child", age: { years: 4, months: 2 },
      confirmedHealthFacts: [], unverifiedFacts: ["個別の睡眠状況"],
      state: "confirmation-required" },
    bodyMandatory: [
      "3〜5歳児に対応する10〜13時間という目安を保持する。",
      "日本語ガイドがAASMの推奨を紹介していることと、疫学調査・生理研究に基づく見積りという原文の説明範囲を保持する。",
      "選定原文は昼寝の扱いを述べず、昼寝禁止を導けないと差し控える。",
    ],
    conditional: [],
    forbidden: [
      "睡眠時間を、昼寝を含む24時間合計だと選定原文の結論として断定する。",
      "昼寝禁止または個別の昼寝処方を行う。",
      "AASM本文を取得・引用したと装う。",
      "『合計』など、選定原文にない時間単位を支持済みとして加える。",
    ],
    recurrence: ["AASMへの帰属省略", "原文外の『合計』という修飾"],
  },
  "G-Q08": {
    baseCaseId: "Q08",
    question: "架空の2歳0か月の子どもと保護者について、親子相互作用の研究結果を一般向けに説明してください。研究数・効果量数、統合効果と信頼区間、研究間のばらつきも示し、平均年齢に関する採択条件から参加者全員が36か月以下だったと言えるか、また個別の親子への効果を保証できるかを区別してください。",
    originalIds: ["E03-F-S01", "E03-C-ELIGIBILITY", "E03-C-STUDY-CHARACTERISTICS",
      "E03-C-RISK-OF-BIAS", "E03-C-LIMITATIONS"],
    appCaseId: "Q08",
    applicability: { fictional: true, targetRole: "child-and-caregiver",
      persons: [{ role: "child", age: { years: 2, months: 0 },
        diagnosedIllnessOrDisability: "unknown" },
      { role: "caregiver", diagnosedIllnessOrDisability: "unknown" }],
      state: "confirmation-required" },
    bodyMandatory: [
      "親子相互作用に正の統合効果が示されたが、個別効果の保証ではないと限定する。",
      "大きな研究間のばらつきと、親子相互作用に対する小標本バイアスの示唆を結論に保持する。",
      "平均36か月超の集団を除外した条件を、参加者全員の個人年齢上限に変えない。",
    ],
    conditional: [
      "質問が求める27研究・27効果量、SMD 0.39、95% CI 0.24〜0.53、I²=93%を正確に示す。",
    ],
    forbidden: [
      "SMD 0.39を39%改善とする。",
      "参加者全員が36か月以下だったとする。",
      "架空の親子への効果を保証する。",
      "子どもまたは保護者の診断済み疾病・障害という除外条件と矛盾する個別助言をする。",
    ],
    recurrence: ["I²=93%の欠落", "子・保護者の除外条件の欠落", "平均年齢から個人範囲への変換"],
  },
  "G-Q09": {
    baseCaseId: "Q09",
    question: "保護者の抑うつ症状に関する統合結果を一般向けに説明してください。研究数、効果量数、効果量・信頼区間・P値・I²を区別し、CES-Dの利用について原文に書かれた研究数表現と割合を、原文にない分母を補わず説明してください。有意な減少が示されなかったことが効果ゼロの証明かどうかも説明してください。",
    originalIds: ["E03-F-S02", "E03-C-ELIGIBILITY", "E03-C-STUDY-CHARACTERISTICS",
      "E03-C-RISK-OF-BIAS", "E03-C-LIMITATIONS"],
    appCaseId: "Q09",
    applicability: { fictional: true, targetRole: "caregiver-and-child",
      persons: [{ role: "caregiver", diagnosedIllnessOrDisability: "unknown" },
      { role: "child", age: { years: 2, months: 0 },
        diagnosedIllnessOrDisability: "unknown" }],
      state: "confirmation-required" },
    bodyMandatory: [
      "統計的に有意な減少は示されなかったが、効果ゼロの証明ではないと限定する。",
      "CES-Dの原文表記にある研究数表現と割合を区別し、原文にない分母・研究数を作らない。",
      "大きな研究間のばらつきと測定上の限界を結論に必要な範囲で保持する。",
    ],
    conditional: [
      "質問が求める24研究・25効果量、SMD −0.07、95% CI −0.16〜0.02、P=0.08、I²=76%を正確に示す。",
      "原文のCES-D表記『2 out of 5 studies (41%)』を推測で算術修正せず、不整合または解釈限界を明示する。",
    ],
    forbidden: [
      "有意差なしを効果ゼロの証明とする。",
      "割合41%から原文にない総研究数・分母を逆算する。",
      "『5研究中2研究（41%）』を整合した一つの比率として無限定に訳す。",
      "質問者の診断または治療判断に変える。",
    ],
    recurrence: ["『2 out of 5 studies (41%)』の研究数と割合の誤った統合", "採択・除外条件の欠落"],
  },
  "G-Q10": {
    baseCaseId: "Q10",
    question: "架空の4歳0か月の子どもについて、スクリーン使用への介入研究で示された38分/日を毎日の上限にできるか、6研究の統合効果・信頼区間・参加者数・I²とともに説明してください。採択時の平均年齢6歳未満は全参加者が6歳未満という意味か、また介入群5.8歳・36人、対照群6.1歳・34人の研究を5.95歳として残した判断も説明してください。",
    originalIds: ["E04-F-S01", "E04-C-ELIGIBILITY", "E04-C-PROTOCOL-DEVIATIONS",
      "E04-C-STUDY-CHARACTERISTICS", "E04-C-METHODOLOGICAL-LIMITATIONS",
      "E04-C-REVIEW-LIMITATIONS"],
    appCaseId: "Q10",
    applicability: { fictional: true, targetRole: "child", age: { years: 4, months: 0 },
      diagnosedMedicalConditionAffectingGrowthDevelopmentOrBehavior: "unknown",
      setting: "unknown", state: "confirmation-required" },
    bodyMandatory: [
      "38分/日は統合した平均差であり、個人の上限・目標・保証ではないと限定する。",
      "非常に大きな研究間のばらつきを結論に保持する。",
      "平均年齢6歳未満という採択条件を、全参加者の個人年齢上限に変えない。",
      "5.8歳・36人と6.1歳・34人から5.95歳として研究を残した原文上の判断を正確に説明する。",
    ],
    conditional: [
      "質問が求める6研究、n=1,106、Cohen’s d=−0.92、95% CI −1.66〜−0.18、平均差38分/日、I²=96.56%を正確に示す。",
    ],
    forbidden: [
      "38分を個人の毎日の上限または保証された減少量とする。",
      "全参加者が6歳未満だったとする。",
      "4歳であることだけから研究対象の個人年齢範囲内・適合済みとする。",
      "教育場面または除外された医学的状態と矛盾する個別助言をする。",
    ],
    recurrence: ["効果量・信頼区間の欠落", "集団平均から個人年齢範囲への推測", "医学的除外条件の欠落"],
  },
  "G-Q11": {
    baseCaseId: "Q11",
    question: "架空の3歳1か月の子どもについて、スクリーン使用を減らせば必ず睡眠がよくなると言えるか、5研究の混在した結果と、改善しなかった2つの介入の内容を含めて説明してください。なぜ睡眠結果をメタ解析できなかったか、採択時の平均年齢条件からこの子や参加者全員の個人年齢範囲を判断できるかも区別してください。",
    originalIds: ["E04-F-S02", "E04-C-ELIGIBILITY", "E04-C-PROTOCOL-DEVIATIONS",
      "E04-C-STUDY-CHARACTERISTICS", "E04-C-METHODOLOGICAL-LIMITATIONS",
      "E04-C-REVIEW-LIMITATIONS"],
    appCaseId: "Q11",
    applicability: { fictional: true, targetRole: "child", age: { years: 3, months: 1 },
      diagnosedMedicalConditionAffectingGrowthDevelopmentOrBehavior: "unknown",
      setting: "unknown", state: "confirmation-required" },
    bodyMandatory: [
      "5研究の結果は混在し、睡眠特性の異質性のためメタ解析できなかったと保持する。",
      "3介入の一部改善だけでなく、就寝前スクリーン時間が減っても4つの睡眠指標に効果がなかった介入を保持する。",
      "睡眠問題とスクリーン時間の双方に効果がなかった別介入を保持する。",
      "平均年齢条件から、架空の子または全参加者の個人年齢範囲を判断・保証しない。",
    ],
    conditional: [
      "質問が求める5研究、3介入の一部改善、2つの異なる非改善結果を混同せず示す。",
    ],
    forbidden: [
      "スクリーン時間を減らせば必ず睡眠が改善すると保証する。",
      "睡眠結果の統合効果量を作る。",
      "平均年齢6歳未満を全参加者の年齢上限とする。",
      "除外された医学的状態または教育場面に個別助言を流用する。",
    ],
    recurrence: ["非改善結果の欠落", "年齢プロトコル変更の欠落", "医学的・教育場面の除外条件の欠落"],
  },
});

const sourcePaths = Object.freeze({
  E02: "evidence-work/v0.2/E02.json",
  E03: "evidence-work/v0.2/E03.json",
  E04: "evidence-work/v0.2/E04.json",
});
const expectedSourceFileHashes = Object.freeze({
  E02: "97ddaddb95db1d8581c4bfa7aa9f7e79bebf9a20269023832dbb136f63d1b5b5",
  E03: "cf6da398b615a2ac96ca65145b949475bc26f211fcfcd0563854e20541168a76",
  E04: "061bf103c8b1056fbc8d1744fc5ac4e47e3dc67418c2042f3614ba0f3706f352",
});

function readSources() {
  return Object.fromEntries(Object.entries(sourcePaths).map(([id, relative]) => {
    const bytes = fs.readFileSync(path.join(ROOT, relative));
    if (sha256(bytes) !== expectedSourceFileHashes[id])
      throw new Error(`SOURCE_FILE_CHANGED:${id}`);
    return [id, { relative, bytes, packet: JSON.parse(bytes) }];
  }));
}

function fragmentIndex(sources) {
  const index = new Map();
  for (const { packet } of Object.values(sources)) {
    for (const fragment of packet.fragments) {
      if (sha256(fragment.original_text) !== fragment.text_sha256)
        throw new Error(`SOURCE_FRAGMENT_HASH_CHANGED:${fragment.id}`);
      if (index.has(fragment.id)) throw new Error(`DUPLICATE_ORIGINAL_ID:${fragment.id}`);
      const source = packet.sources.find(item => item.id === fragment.source_id);
      if (!source) throw new Error(`SOURCE_METADATA_MISSING:${fragment.id}`);
      index.set(fragment.id, { fragment, source });
    }
  }
  return index;
}

function catalogEntry(fragment, source) {
  const locator = typeof fragment.locator === "string"
    ? fragment.locator : JSON.stringify(fragment.locator);
  return {
    citable: true,
    kind: "original_evidence",
    sourceId: source.id,
    title: source.title,
    version: source.version,
    locator,
    url: fragment.url,
    attribution: fragment.attribution ?? source.license?.attribution ?? null,
    text_sha256: fragment.text_sha256,
  };
}

function requestFor(spec, originals) {
  const request = {
    model: MODEL,
    input: [
      { role: "developer", content: GENERAL_INSTRUCTIONS },
      { role: "user", content: JSON.stringify({
        question: spec.question,
        original_evidence: originals.map(item => ({
          original_id: item.originalId,
          original_text: item.originalText,
        })),
      }) },
    ],
    background: false,
    store: false,
    max_output_tokens: 1500,
    reasoning: { effort: "medium" },
    prompt_cache_options: { mode: "explicit" },
    truncation: "disabled",
    tools: [],
    service_tier: "default",
    text: {
      format: {
        type: "json_schema",
        name: "claim_source_explanation",
        strict: true,
        schema: CLAIM_OUTPUT_SCHEMA,
      },
    },
  };
  return request;
}

function buildRubric() {
  const cases = {};
  for (const caseId of CASE_IDS) {
    const spec = CASE_SPECS[caseId];
    cases[caseId] = {
      baseCaseId: spec.baseCaseId,
      question: spec.question,
      sourceClosure: [...spec.originalIds],
      adoptedClassification: {
        mandatory: {
          body: [...spec.bodyMandatory],
          applicationDisplay: [
            "app-catalogのmandatory blockを、該当説明に隣接して全て表示する。",
            "対象条件の一致を自由記述から推測せず、未確認・不適合なら既存停止・確認処理を維持する。",
            "原文ID、資料名、版、該当箇所、URL、原文hashを追跡可能にする。",
          ],
          wholeScreen: [
            "本文単体が支持され、app表示が完全で、両者に矛盾がない場合だけ画面全体を合格とする。",
            "app表示は本文の未支持説明、誤訳、数値誤り、個別保証を修復しない。",
            "保存済みの過去評価と今回の新規評価を分離する。",
          ],
        },
        conditional: [...spec.conditional],
        optional: [
          "省略しても質問の理解・判断・適用可能性を変えない書誌的・地域的背景。",
          "質問が求める数値、対象・除外条件、重要な限界、出典追跡情報をoptionalへ移さない。",
        ],
      },
      forbiddenContent: [...spec.forbidden],
      recurrenceChecks: [...spec.recurrence],
      scoring: {
        bodyAlone: "全body mandatoryと質問に応じて必須の詳細を満たし、forbiddenContent、未支持、矛盾、過剰な個別化がない場合にpass。",
        appDisplay: "確認済みapp-catalogに基づくmandatory blockの隣接表示と出典追跡が完全で、推測・改変がなければpass。",
        wholeScreen: "bodyAloneとappDisplayがともにpassで、本文と表示が矛盾せず、停止・確認状態を維持した場合だけpass。",
        reviewer: "AIによる原文比較を明記し、人による採用審査・臨床評価と区別する。",
      },
      historicalScoringChanged: false,
    };
  }
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    frozenBeforeSend: true,
    adoptedForThisRun: true,
    prospectiveGeneralAudienceEvaluation: true,
    historicalResultsOrRubricsChanged: false,
    applicationAndBodyScoredSeparately: true,
    globalCriteria: {
      mandatory: [
        "対象・除外条件、結論を左右する限界、数値の意味を保持し、根拠のない断定をしない。",
        "統計値の詳細を省略できる場合でも、大きなばらつき、結果の混在、非改善、不確実性など結論を左右する意味を落とさない。",
        "割合、研究数、参加者数、効果量を区別し、原文にない分母を作らない。",
        "集団平均を個人範囲へ変換せず、有意差なしを効果ゼロの証明へ変換しない。",
      ],
      conditional: "質問が効果量、信頼区間、I²、研究数・参加者数・割合を求める場合は、その詳細を正確に保持する。",
      optional: "省略しても質問の理解・判断を変えない背景だけ。原文追跡情報は常にアプリ表示に保持する。",
      citations: "各事実説明に直接支持する、送信済みoriginal IDが必要。ID一致だけで意味上の支持とはしない。",
      noRetroactiveRelaxation: "過去Q05〜Q11の基準・判定を変更せず、今回の分類で遡及再採点しない。",
    },
    cases,
  };
}

function buildProposal() {
  const source = JSON.parse(fs.readFileSync(path.join(
    ROOT, "prototypes/evidence-consultation/condition-display/evaluation-proposal.json",
  )));
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    status: "adopted-for-this-new-general-audience-evaluation-only",
    sourceProposal: source,
    historicalRubricsChanged: false,
    historicalRegradingAllowed: false,
    adoptionScope: CASE_IDS,
    preSendRule: "質問に応じて必須の詳細は、回答を見る前にrubric.jsonへ固定する。",
  };
}

function buildAppCatalog(sources) {
  const built = buildVerifiedConditionCatalog(Object.fromEntries(
    Object.entries(sources).map(([id, item]) => [id, item.packet]),
  ));
  const reviewPath =
    "prototypes/evidence-consultation/condition-display/verified-display-review.json";
  const reviewBytes = fs.readFileSync(path.join(ROOT, reviewPath));
  const review = JSON.parse(reviewBytes);
  if (review.catalogSha256 !== sha256(JSON.stringify(built)))
    throw new Error("VERIFIED_APP_CATALOG_REVIEW_MISMATCH");
  for (const baseCaseId of BASE_CASES) {
    const checked = review.cases?.[baseCaseId];
    const conditionCase = built.cases?.[baseCaseId];
    if (!checked || checked.verdict !== "pass"
      || checked.blocksSha256 !== sha256(JSON.stringify(conditionCase.blocks))
      || checked.bodySha256 !== sha256(JSON.stringify(conditionCase.sampleBody)))
      throw new Error(`VERIFIED_APP_CASE_REVIEW_MISMATCH:${baseCaseId}`);
  }
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    role: "app-owned-source-verified-adjacent-display-not-model-input",
    catalog: built,
    reviewBinding: {
      path: reviewPath,
      sha256: sha256(reviewBytes),
      checkedBy: review.checkedBy,
      scope: review.scope,
      catalogSha256: review.catalogSha256,
      cases: clone(review.cases),
    },
    evaluationSeparation: {
      appDisplayDoesNotRepairBody: true,
      bodyAndDisplayScoredSeparately: true,
      unknownOrMismatchDoesNotEnableAdvice: true,
      historicalVerdictsChanged: false,
    },
  };
}

export function buildArtifacts() {
  const sources = readSources();
  const fragments = fragmentIndex(sources);
  const catalog = {};
  const originalEvidence = {};
  const requests = [];
  for (const caseId of CASE_IDS) {
    const spec = CASE_SPECS[caseId];
    const originals = spec.originalIds.map(originalId => {
      const item = fragments.get(originalId);
      if (!item || item.fragment.role === "editorial_note")
        throw new Error(`REQUIRED_ORIGINAL_MISSING:${caseId}:${originalId}`);
      catalog[originalId] ??= catalogEntry(item.fragment, item.source);
      originalEvidence[originalId] ??= {
        originalId,
        sourceId: item.fragment.source_id,
        originalText: item.fragment.original_text,
        textSha256: item.fragment.text_sha256,
        locator: catalog[originalId].locator,
        title: catalog[originalId].title,
        version: catalog[originalId].version,
        url: catalog[originalId].url,
      };
      return originalEvidence[originalId];
    });
    requests.push({
      caseId,
      baseCaseId: spec.baseCaseId,
      question: spec.question,
      request: requestFor(spec, originals),
      originalIds: [...spec.originalIds],
      applicability: clone(spec.applicability),
    });
  }
  const preparedPackage = { schemaVersion: 1, runId: RUN_ID, requests };
  const catalogOutput = { schemaVersion: 1, runId: RUN_ID, catalog };
  const originalsOutput = {
    schemaVersion: 1,
    runId: RUN_ID,
    provenance: "verbatim-original-fragments-for-model-input-no-editorial-notes",
    originals: originalEvidence,
  };
  const rubric = buildRubric();
  const proposal = buildProposal();
  const appCatalog = buildAppCatalog(sources);
  const rationale = {
    schemaVersion: 1,
    runId: RUN_ID,
    preparedOffline: true,
    purpose: "一般的な生成規則と確認済みアプリ条件表示を組み合わせ、過去に問題のあった6問を難易度を下げず新規評価する。",
    caseOrder: CASE_IDS,
    questionChanges: Object.fromEntries(CASE_IDS.map(id => [id, {
      baseCaseId: CASE_SPECS[id].baseCaseId,
      notEasier: true,
      retainedChallenge: CASE_SPECS[id].recurrence,
      rationale: "過去の正解文を送らず、割合・平均年齢・非改善・単位の読み違いを一般規則で再評価できる問いにした。",
    }])),
    promptSeparation: {
      sent: ["一般的な生成規則", "架空の質問", "選定した完全なoriginal_evidence closure"],
      notSent: ["rubric", "期待する要点", "禁止事項", "人が編集した模範回答",
        "過去のモデル回答", "app-catalogの日本語条件表示", "編集メモ", "管理情報"],
    },
    controls: {
      model: MODEL,
      baselineTransmissions: 13,
      maximumNewTransmissions: 6,
      maximumFinalTransmissions: 19,
      reservedTransmissionsNotUsed: 1,
      baselineMeasuredMicroUSD: 17093,
      operationalBudgetMicroUSD: 1000000,
      maximumInputProjectionTokensPerCase: 8000,
      outputCapTokensPerCase: 1500,
      maximumProjectedMicroUSDPerCase: 3800,
      maximumProjectedNewMicroUSD: 22800,
      maxConcurrency: 1,
      automaticRetries: 0,
      oneCasePerExplicitSend: true,
    },
    evaluation: {
      bodyAlone: "モデル本文の原文支持・数値・限定・矛盾を評価する。",
      appDisplay: "確認済み条件の隣接表示・出典追跡・停止状態を独立評価する。",
      wholeScreen: "本文と表示の双方が合格し矛盾しない場合だけ合格する。",
      evaluatorLabel: "AIによる原文比較。人による採用審査または臨床評価ではない。",
    },
    historicalArtifactsChanged: false,
  };
  return {
    "prepared-package.json": preparedPackage,
    "catalog.json": catalogOutput,
    "original-evidence.json": originalsOutput,
    "rubric.json": rubric,
    "app-catalog.json": appCatalog,
    "proposal.json": proposal,
    "rationale.json": rationale,
  };
}

function withManifest(artifacts) {
  const sourceFiles = Object.fromEntries(Object.values(readSources()).map(item =>
    [item.relative, { sha256: sha256(item.bytes), bytes: item.bytes.length, role: "frozen-input" }]));
  const outputFiles = Object.fromEntries(Object.entries(artifacts).map(([name, value]) => {
    const bytes = Buffer.from(stableJson(value));
    return [name, { sha256: sha256(bytes), bytes: bytes.length, role: "prepared-output" }];
  }));
  const manifest = {
    schemaVersion: 1,
    runId: RUN_ID,
    offlinePreparation: true,
    cases: CASE_IDS,
    historicalBaseline: {
      providerApiTransmissions: 13,
      maximumProviderApiTransmissionsForThisRun: 19,
      permanentlyUnusedTransmission: 1,
      measuredMicroUSD: 17093,
      operationalBudgetMicroUSD: 1000000,
      maxConcurrency: 1,
      retries: 0,
    },
    files: {
      ...sourceFiles,
      "prototypes/evidence-consultation/condition-display/evaluation-proposal.json": {
        sha256: sha256(fs.readFileSync(path.join(
          ROOT, "prototypes/evidence-consultation/condition-display/evaluation-proposal.json",
        ))),
        bytes: fs.statSync(path.join(
          ROOT, "prototypes/evidence-consultation/condition-display/evaluation-proposal.json",
        )).size,
        role: "frozen-input",
      },
      "prototypes/evidence-consultation/condition-display/verified-display-review.json": {
        sha256: sha256(fs.readFileSync(path.join(
          ROOT, "prototypes/evidence-consultation/condition-display/verified-display-review.json",
        ))),
        bytes: fs.statSync(path.join(
          ROOT, "prototypes/evidence-consultation/condition-display/verified-display-review.json",
        )).size,
        role: "frozen-input",
      },
      ...Object.fromEntries(Object.entries(outputFiles).map(([name, meta]) =>
        [`evidence-work/general-audience-evaluation/${RUN_ID}/preparation/${name}`, meta])),
    },
  };
  return { ...artifacts, "manifest.json": manifest };
}

function compareExisting(all) {
  for (const [name, value] of Object.entries(all)) {
    const file = path.join(OUTPUT_DIRECTORY, name);
    if (!fs.existsSync(file)) throw new Error(`PREPARATION_FILE_MISSING:${name}`);
    if (!fs.readFileSync(file).equals(Buffer.from(stableJson(value))))
      throw new Error(`PREPARATION_FILE_CHANGED:${name}`);
  }
}

export function writePreparation() {
  const all = withManifest(buildArtifacts());
  if (fs.existsSync(OUTPUT_DIRECTORY))
    throw new Error("PREPARATION_DIRECTORY_ALREADY_EXISTS_USE_CHECK");
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  for (const [name, value] of Object.entries(all))
    fs.writeFileSync(path.join(OUTPUT_DIRECTORY, name), stableJson(value), { flag: "wx" });
  return all;
}

export function checkPreparation() {
  const all = withManifest(buildArtifacts());
  compareExisting(all);
  return all;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const all = check ? checkPreparation() : writePreparation();
  process.stdout.write(`${JSON.stringify({
    runId: RUN_ID,
    offlinePreparation: true,
    checked: check,
    caseIds: CASE_IDS,
    model: MODEL,
    additionalApiTransmissions: 0,
    preparedFiles: Object.keys(all),
    outputDirectory: path.relative(ROOT, OUTPUT_DIRECTORY),
  }, null, 2)}\n`);
}