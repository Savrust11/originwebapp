import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const allowedKinds = new Set([
  "population", "eligibility", "exclusion", "limitation",
  "numericMeaning", "researchDetail",
]);
const allowedTiers = new Set(["mandatory", "conditional", "optional"]);

const EXPECTED_SOURCES = Object.freeze({
  E02: {
    title: "健康づくりのための睡眠ガイド2023",
    version: "健康づくりのための睡眠ガイド2023",
    url: "https://www.mhlw.go.jp/content/001305530.pdf",
    contentDigestField: "source_sha256",
    contentDigest: "2ca95cb3c1ca910519893077c6a53ba1bb6dd481225845ffd3d2e8877bed6426",
  },
  E03: {
    title: "Parenting interventions to promote early child development in the first three years of life: A global systematic review and meta-analysis",
    version: "PLOS Medicine 18(5): e1003602",
    url: "https://journals.plos.org/plosmedicine/article?id=10.1371%2Fjournal.pmed.1003602",
    contentDigestField: "fetched_sha256",
    contentDigest: "e7ae8aa178977bf7509f02e2374230eb87b1464cc89e34fcf8617eb3faaa1a1f",
  },
  E04: {
    title: "Effect of parent-focused interventions for screen use on developmental outcomes in young children: a systematic review and meta-analysis",
    version: "International Journal of Behavioral Nutrition and Physical Activity 23:71 (Version of record)",
    url: "https://link.springer.com/article/10.1186/s12966-026-01919-8",
    contentDigestField: "fetched_sha256",
    contentDigest: "232a082d8037e54c1f102f6d2392ffed8d742e863216c0536557daaeddb99a12",
  },
});

const EXPECTED_FRAGMENTS = Object.freeze({
  "E02-F-S01-S02-SHARED": "6707676ee59249ff2b8b884429780869004eb70b7c3a44820eb671e6f9b8e066",
  "E02-F-S03": "fcc7d2b114986e05643742b43a3bde2045e46cdb8a7d73674c0349d88bde9c86",
  "E03-F-S01": "6d6daca22bdb07ef88d049b9100945390f02c96ec091de316204bc885e420284",
  "E03-F-S02": "53369605bbe033eeec68f20996f9241eeb9c6b35e650110bc8ebb4337da8e013",
  "E03-C-ELIGIBILITY": "5061ef2d9713ed61453ac9ec771c6e6a4d8d6cf8bd73fb68225e53b745ac8552",
  "E03-C-STUDY-CHARACTERISTICS": "768cee9dfc47a47972034802cebc3bb29b15b4a6588d4b27a1137dfcfa96bedf",
  "E03-C-RISK-OF-BIAS": "733717ad66f88e382c518a21d9c8cc4d00c3069fbb8902e3c29444844502cdc6",
  "E03-C-LIMITATIONS": "34fc28680eb616ae61e29df99e16970c215d95f32b3399220cc6dfac59088818",
  "E04-F-S01": "efad958cead17ae286eb6ed06f0cb81050b45e8d45f4d4a2c39a7a2544307120",
  "E04-F-S02": "fadcaf2c0f0b879b7c075cdb03baf96f413eca27a06e7a5b61bbb0ed42b28b5f",
  "E04-C-ELIGIBILITY": "f15de7f06c5fe493fe3e74232b51b8240357ae833f0f5c9a9cbaf1df275fc2a3",
  "E04-C-PROTOCOL-DEVIATIONS": "c7a0e83ce74ec910bec9bbdb98b464a789d3f1df983d9202aa0aefd7ca204ec7",
  "E04-C-STUDY-CHARACTERISTICS": "622e6f19aa5b7b89fae468baf08ce057b8f5f67f906206d7372eafd8cee6f6f9",
  "E04-C-METHODOLOGICAL-LIMITATIONS": "455b2823fe8c33b5660cb78f6cdbb0c9807fb8eefbde29f3a7d35eb18f771c76",
  "E04-C-REVIEW-LIMITATIONS": "164b5c156008269919bb05e8c90321310f8ebdf8286b75612b6f10180e9b503e",
});

const Q = Object.freeze({
  aasm: "米国睡眠医学会（American Academy of Sleep Medicine）は、１〜２歳児は11〜14時間、３〜５歳児は10〜13時間、小学生は９〜12時間、中学・高校生は８〜10時間の睡眠時間の確保を推奨しています５）。",
  newborn: "生まれたばかりの赤ちゃんは、数時間おきに寝たり起きたりを繰り返します９）。授乳と夜泣きへの対応で、養育者の睡眠も細切れになります。養育者にとって、睡眠を確保することは心身の健康を守るために重要です。",
  e03inclusion: "Full-text, peer-reviewed articles were included if they met the following criteria: (1) parenting interventions that aimed to improve interactions, behaviors, knowledge, beliefs, attitudes or practices of parents with their children in order to improve ECD; (2) evaluated using a randomized controlled study design; (3) targeted children and their parents during early childhood (pregnancy through the first 3 years of life); and (4) measured at least 1 ECD outcome after the completion of the intervention (or shortly thereafter).",
  e03exclusion: "Studies were excluded if they met any of the following criteria: (1) not a relevant parenting intervention focused on promoting ECD; (2) nonrandomized study design (e.g., quasi-experimental studies); (3) targeted a population of children who were, on average, older than 36 months; (4) targeted a population of children or parents who had a diagnosed illness or disability; and/or (5) did not measure at least 1 ECD outcome.",
  e03countries: "Trials were implemented across a total of 33 countries. The majority of trials were conducted in HICs (61 trials in 14 countries), compared to LMICs (41 trials in 19 countries).",
  e03measurement: "Third, the reporting of the psychometric properties of measures (e.g., reliability and validity evidence, adaptation procedures) was highly variable across studies, with many studies not reporting any such details. Measures of ECD and parenting ranged widely from validated and adapted assessments to unstandardized measures, which may affect comparability across studies and robustness of findings.",
  e03heterogeneity: "First, there was considerable unexplained heterogeneity in the pooled effects across outcomes.",
  e03smallBias: "Egger’s tests suggested evidence of small-sample bias for 2 out of the 10 outcomes: child language development, z = 2.74, P = 0.01; and parent–child interactions, z = 3.78, P < 0.001.",
  e03s01: "Twenty-seven studies provided a total of 27 effect sizes for parent–child interactions. Three in four studies (77%) reported any details regarding reliability or validity of the measure of parent–child interactions. Nearly all studies directly observed and coded quality of mother–child interactions (91%). The pooled result showed a moderate positive impact on improving parent–child interactions (SMD = 0.39, 95% CI: 0.24, 0.53, P < 0.001; I2 = 93%, P < 0.001; Fig 10).",
  e03s02: "Twenty-four studies provided a total of 25 effect sizes for parental depressive symptoms. More than half of studies (59%) reported any details regarding reliability or validity of the measure of depressive symptoms. The Center for Epidemiologic Studies Depression Scale [48] was the most commonly used measure in 2 out of 5 studies (41%). The pooled result did not indicate a significant reduction in caregiver depressive symptoms (SMD = −0.07, 95% CI: −0.16, 0.02, P = 0.08; I2 = 76%, P < 0.001; Fig 11).",
  e04population: "Population: typically developing children with a mean age less than six years at baseline. Studies involving children with a mean age six years or older at baseline or children with medical conditions (diagnosed with a condition which may affect growth, development or behavior such as Autism Spectrum Disorder or Attention Deficit Hyperactivity Disorder) were excluded.",
  e04setting: "Intervention: parent-focused interventions targeting screen use in the home setting, either on its own or as part of a multi-component intervention, were considered (providing intervention effects due to changes in screen use could be isolated). Interventions targeting screen use in the education setting (e.g. childcare, preschool) were excluded because most screen use occurs in the home in this age group [19] and parents do not have control over screen use in education settings.",
  e04protocol: "Fourth, the original protocol specified inclusion of studies involving children aged less than six years at baseline. During screening, this criterion was refined to include studies where the mean age of participants at baseline was less than six years, allowing the inclusion of studies with a broader age range. In one study [34], mean ages were reported separately for the intervention group (mean age = 5.8 years) and control group (mean age = 6.1 years) but not for the total sample. Given the similar group sizes (intervention group = 36; control group = 34), the average of the two group means (5.95 years) was calculated, and used to determine eligibility, and the study was retained.",
  e04methods: "There were substantial methodological limitations across included studies which may affect the reliability of our findings. Most studies lacked adequate blinding, had unclear procedures for group allocation concealment, and either did not conduct or did not adequately report attrition analysis. Awareness of group allocation may have influenced parent-reported outcomes, as parents may over- or under- report improvements in child behaviours, thereby introducing reporting bias [59].",
  e04reviewLimits: "The most important limitations of our review relate to the small evidence base we had to work with. For example, there were insufficient studies in some developmental domains, and considerable heterogeneity in intervention components making it difficult to draw solid conclusions regarding intervention effects.",
  e04s01: "A pooled effect size of Cohen’s d = -0.92 (95%CI: -1.66 to -0.18) was observed across six studies (n = 1,106) evaluating the impact of interventions on screen time duration [32, 33, 44,45,46,47] (Fig. 2), equating to a mean difference of 38 min of screen use per day. However, substantial heterogeneity was present (I2 = 96.56%).",
  e04s02: "Intervention effects on sleep characteristics were reported across five studies but were unable to be included in meta-analyses due to heterogeneity in specific sleep characteristics assessed. Results were mixed: three interventions improved various sleep characteristics, including improved sleep quality [47], increased sleep duration, decreased night awakenings and decreased sleep onset latency [31], and decreased sleep problems [43]. These improvements were accompanied by reductions in total screen time [31, 47] and an increase in content quality [43]. One intervention had no effect on sleep duration, night awakenings, sleep efficiency or sleep onset latency [30] despite achieving reductions in screen time in the hour before bed [30]. One intervention had no effect on either sleep problems or screen time duration [33].",
});

const block = (id, kind, tier, text, citations) =>
  ({ id, kind, tier, text, citations });
const citation = (sourceId, originalId, quote) => ({ sourceId, originalId, quote });

const e03Shared = () => [
  block("e03-eligible-design", "eligibility", "mandatory",
    "対象は、妊娠期から生後3年間の子どもと保護者を対象に、ECDの改善を目的とした養育介入をRCTで評価し、介入後にECDアウトカムを測定した研究です。",
    [citation("E03", "E03-C-ELIGIBILITY", Q.e03inclusion)]),
  block("e03-mean-age", "population", "mandatory",
    "平均年齢が36か月を超える子どもの集団は除外されました。これは各参加者の年齢上限ではありません。",
    [citation("E03", "E03-C-ELIGIBILITY", Q.e03exclusion)]),
  block("e03-diagnosis-exclusion", "exclusion", "mandatory",
    "病気または障害の診断がある子ども、または保護者を対象とした集団は除外されました。",
    [citation("E03", "E03-C-ELIGIBILITY", Q.e03exclusion)]),
  block("e03-unexplained-heterogeneity", "limitation", "mandatory",
    "アウトカム全体の統合効果には、説明されていない大きなばらつきがありました。",
    [citation("E03", "E03-C-LIMITATIONS", Q.e03heterogeneity)]),
  block("e03-measurement", "limitation", "mandatory",
    "測定尺度の信頼性・妥当性などの報告は研究間で大きく異なり、比較可能性や結果の頑健性に影響し得ます。",
    [citation("E03", "E03-C-LIMITATIONS", Q.e03measurement)]),
  block("e03-study-regions", "researchDetail", "optional",
    "試験は33か国で行われ、高所得国が61試験、低・中所得国が41試験でした。",
    [citation("E03", "E03-C-STUDY-CHARACTERISTICS", Q.e03countries)]),
];

const e04Shared = () => [
  block("e04-mean-age", "population", "mandatory",
    "採択対象はベースライン時の平均年齢が6歳未満の、典型的に発達している子どもの集団です。各参加者が6歳未満という条件ではありません。",
    [citation("E04", "E04-C-ELIGIBILITY", Q.e04population),
      citation("E04", "E04-C-PROTOCOL-DEVIATIONS", Q.e04protocol)]),
  block("e04-medical-exclusion", "exclusion", "mandatory",
    "成長・発達・行動に影響し得る診断済みの医学的状態がある子どもを含む研究は除外されました。",
    [citation("E04", "E04-C-ELIGIBILITY", Q.e04population)]),
  block("e04-home-parent-setting", "eligibility", "mandatory",
    "対象は家庭でのスクリーン使用を扱う保護者向け介入で、保育所・就学前施設など教育場面の介入は除外されました。",
    [citation("E04", "E04-C-ELIGIBILITY", Q.e04setting)]),
  block("e04-age-protocol", "eligibility", "mandatory",
    "年齢条件は個人の6歳未満から集団の平均年齢6歳未満へ変更されました。介入群5.8歳（36人）、対照群6.1歳（34人）の研究は平均5.95歳として残されました。",
    [citation("E04", "E04-C-PROTOCOL-DEVIATIONS", Q.e04protocol)]),
  block("e04-method-limits", "limitation", "mandatory",
    "盲検化、割付の隠蔽、脱落分析に限界があり、保護者報告には報告バイアスが入り得ます。",
    [citation("E04", "E04-C-METHODOLOGICAL-LIMITATIONS", Q.e04methods)]),
  block("e04-small-heterogeneous-base", "limitation", "mandatory",
    "研究数が少なく、介入内容のばらつきも大きいため、介入効果について確かな結論を出しにくいとされています。",
    [citation("E04", "E04-C-REVIEW-LIMITATIONS", Q.e04reviewLimits)]),
];

const CASE_SPECS = Object.freeze({
  Q05: {
    blocks: [
      block("q05-age-duration", "population", "mandatory",
        "1〜2歳児について11〜14時間の睡眠時間確保が推奨されています。",
        [citation("E02", "E02-F-S01-S02-SHARED", Q.aasm)]),
      block("q05-recommendation-origin", "eligibility", "mandatory",
        "厚生労働省発行のガイドが、米国睡眠医学会（AASM）の推奨として紹介している記述です。",
        [citation("E02", "E02-F-S01-S02-SHARED", Q.aasm)]),
    ],
    sampleBody: [
      { id: "q05-body-1", text: "1〜2歳児には11〜14時間の睡眠時間確保が推奨されています。", originalIds: ["E02-F-S01-S02-SHARED"] },
    ],
  },
  Q06: {
    blocks: [
      block("q06-age-duration", "population", "mandatory",
        "3〜5歳児について10〜13時間の睡眠時間確保が推奨されています。",
        [citation("E02", "E02-F-S01-S02-SHARED", Q.aasm)]),
      block("q06-recommendation-origin", "eligibility", "mandatory",
        "厚生労働省発行のガイドが、米国睡眠医学会（AASM）の推奨として紹介している記述です。",
        [citation("E02", "E02-F-S01-S02-SHARED", Q.aasm)]),
    ],
    sampleBody: [
      { id: "q06-body-1", text: "4歳2か月は3〜5歳の区分で、示された目安は10〜13時間です。", originalIds: ["E02-F-S01-S02-SHARED"] },
    ],
  },
  Q07: {
    blocks: [
      block("q07-newborn-pattern", "population", "mandatory",
        "生まれたばかりの赤ちゃんは数時間おきに寝起きを繰り返します。",
        [citation("E02", "E02-F-S03", Q.newborn)]),
      block("q07-caregiver-impact", "limitation", "mandatory",
        "授乳や夜泣きへの対応で養育者の睡眠も細切れになり、養育者の睡眠確保が心身の健康を守るために重要です。赤ちゃんと養育者は別の対象です。",
        [citation("E02", "E02-F-S03", Q.newborn)]),
    ],
    sampleBody: [
      { id: "q07-body-1", text: "新生児への対応で養育者の睡眠は細切れになり得るため、養育者の睡眠確保も重要です。", originalIds: ["E02-F-S03"] },
    ],
  },
  Q08: {
    blocks: [
      ...e03Shared(),
      block("q08-result-meaning", "numericMeaning", "mandatory",
        "親子相互作用では正の統合効果が示されましたが、研究間のばらつきは大きく、個人への効果保証ではありません。",
        [citation("E03", "E03-F-S01", Q.e03s01)]),
      block("q08-effect-details", "researchDetail", "conditional",
        "27研究・27効果量で、SMD 0.39、95%信頼区間0.24〜0.53、P<0.001、I²=93%でした。",
        [citation("E03", "E03-F-S01", Q.e03s01)]),
      block("q08-small-sample-bias", "limitation", "mandatory",
        "親子相互作用ではEgger検定が小標本バイアスを示唆しました。",
        [citation("E03", "E03-C-RISK-OF-BIAS", Q.e03smallBias)]),
    ],
    sampleBody: [
      { id: "q08-body-1", text: "親子相互作用には正の統合効果がみられましたが、研究間のばらつきが大きく、個人への効果は保証できません。", originalIds: ["E03-F-S01", "E03-C-LIMITATIONS"] },
    ],
  },
  Q09: {
    blocks: [
      ...e03Shared(),
      block("q09-result-meaning", "numericMeaning", "mandatory",
        "保護者の抑うつ症状に統計的に有意な減少は示されませんでした。これは効果がゼロだと証明したものではありません。",
        [citation("E03", "E03-F-S02", Q.e03s02)]),
      block("q09-effect-details", "researchDetail", "conditional",
        "24研究・25効果量で、SMD −0.07、95%信頼区間−0.16〜0.02、P=0.08、I²=76%でした。",
        [citation("E03", "E03-F-S02", Q.e03s02)]),
    ],
    sampleBody: [
      { id: "q09-body-1", text: "保護者の抑うつ症状の有意な減少は示されませんでしたが、効果ゼロの証明ではありません。", originalIds: ["E03-F-S02"] },
    ],
  },
  Q10: {
    blocks: [
      ...e04Shared(),
      block("q10-result-meaning", "numericMeaning", "mandatory",
        "38分/日は6研究を統合したスクリーン使用時間の平均差であり、個人の上限や各人に保証される減少量ではありません。",
        [citation("E04", "E04-F-S01", Q.e04s01)]),
      block("q10-high-heterogeneity", "limitation", "mandatory",
        "統合結果には非常に大きな研究間のばらつき（I²=96.56%）がありました。",
        [citation("E04", "E04-F-S01", Q.e04s01)]),
      block("q10-effect-details", "researchDetail", "conditional",
        "6研究（n=1,106）の統合効果はCohen’s d=-0.92、95%信頼区間−1.66〜−0.18、平均差38分/日、I²=96.56%でした。",
        [citation("E04", "E04-F-S01", Q.e04s01)]),
    ],
    sampleBody: [
      { id: "q10-body-1", text: "介入群ではスクリーン使用時間が平均38分/日少ない統合結果でしたが、これは個人の上限や保証ではなく、研究間のばらつきも非常に大きい結果です。", originalIds: ["E04-F-S01"] },
    ],
  },
  Q11: {
    blocks: [
      ...e04Shared(),
      block("q11-no-meta-mixed", "numericMeaning", "mandatory",
        "睡眠特性を報告した5研究は、測定した特性が異なるためメタ解析できず、結果は混在していました。3介入では一部の睡眠特性が改善しました。",
        [citation("E04", "E04-F-S02", Q.e04s02)]),
      block("q11-bedtime-negative", "limitation", "mandatory",
        "1介入では就寝前1時間のスクリーン時間が減っても、睡眠時間、夜間覚醒、睡眠効率、入眠潜時への効果はありませんでした。",
        [citation("E04", "E04-F-S02", Q.e04s02)]),
      block("q11-both-negative", "limitation", "mandatory",
        "別の1介入では、睡眠問題にもスクリーン時間にも効果がありませんでした。",
        [citation("E04", "E04-F-S02", Q.e04s02)]),
    ],
    sampleBody: [
      { id: "q11-body-1", text: "5研究の睡眠結果は混在し、特性が異なるためメタ解析できませんでした。改善しなかった介入もあり、睡眠改善は保証できません。", originalIds: ["E04-F-S02"] },
    ],
  },
});

function validateAndIndex(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("VERIFIED_CONDITION_SOURCES_REQUIRED");
  const indexed = new Map();
  for (const [sourceId, expected] of Object.entries(EXPECTED_SOURCES)) {
    const packet = input[sourceId];
    const source = packet?.sources?.find(item => item.id === sourceId);
    if (!source || source.title !== expected.title || source.version !== expected.version
      || source.url !== expected.url
      || source[expected.contentDigestField] !== expected.contentDigest) {
      throw new Error(`VERIFIED_CONDITION_SOURCE_MISMATCH:${sourceId}`);
    }
    for (const [fragmentId, expectedHash] of Object.entries(EXPECTED_FRAGMENTS)
      .filter(([id]) => id.startsWith(`${sourceId}-`))) {
      const fragment = packet.fragments?.find(item => item.id === fragmentId);
      if (!fragment || fragment.source_id !== sourceId || fragment.role === "editorial_note"
        || fragment.text_sha256 !== expectedHash
        || sha256(fragment.original_text) !== expectedHash
        || typeof fragment.url !== "string" || !fragment.url) {
        throw new Error(`VERIFIED_CONDITION_FRAGMENT_MISMATCH:${fragmentId}`);
      }
      indexed.set(fragmentId, { source, fragment });
    }
  }
  if (Object.keys(input).sort().join(",") !== "E02,E03,E04")
    throw new Error("VERIFIED_CONDITION_SOURCE_SET_MISMATCH");
  return indexed;
}

function materializeSupport(indexed, request) {
  const record = indexed.get(request.originalId);
  if (!record || record.fragment.source_id !== request.sourceId)
    throw new Error(`VERIFIED_CONDITION_BINDING_MISMATCH:${request.originalId}`);
  const { source, fragment } = record;
  const quoteStart = fragment.original_text.indexOf(request.quote);
  if (quoteStart < 0 || fragment.original_text.indexOf(request.quote, quoteStart + 1) >= 0)
    throw new Error(`VERIFIED_CONDITION_QUOTE_MISMATCH:${request.originalId}`);
  const locator = typeof fragment.locator === "string"
    ? fragment.locator
    : [
      fragment.locator?.heading,
      fragment.locator?.paragraph,
      fragment.locator?.publisher_html_anchor
        ? `anchor: ${fragment.locator.publisher_html_anchor}` : null,
      fragment.locator?.page ? `page: ${fragment.locator.page}` : null,
      fragment.locator?.footnote ? `note: ${fragment.locator.footnote}` : null,
    ].filter(Boolean).join(" / ");
  if (!locator) throw new Error(`VERIFIED_CONDITION_LOCATOR_MISSING:${request.originalId}`);
  return {
    originalId: fragment.id,
    sourceId: source.id,
    title: source.title,
    version: source.version,
    locator,
    url: fragment.url,
    originalTextSha256: fragment.text_sha256,
    quote: request.quote,
    quoteStart,
    quoteEnd: quoteStart + request.quote.length,
  };
}

export function buildVerifiedConditionCatalog(sources) {
  const indexed = validateAndIndex(sources);
  const cases = {};
  for (const [caseId, spec] of Object.entries(CASE_SPECS)) {
    const ids = new Set();
    const blocks = spec.blocks.map(item => {
      if (ids.has(item.id) || !allowedKinds.has(item.kind) || !allowedTiers.has(item.tier)
        || typeof item.text !== "string" || !item.text || !item.citations.length) {
        throw new Error(`VERIFIED_CONDITION_BLOCK_INVALID:${caseId}`);
      }
      ids.add(item.id);
      return {
        id: item.id,
        kind: item.kind,
        tier: item.tier,
        text: item.text,
        supports: item.citations.map(entry => materializeSupport(indexed, entry)),
      };
    });
    const supportIds = new Set(blocks.flatMap(item => item.supports.map(x => x.originalId)));
    for (const body of spec.sampleBody) {
      if (!body.originalIds.length || body.originalIds.some(id => !supportIds.has(id)))
        throw new Error(`VERIFIED_CONDITION_SAMPLE_BINDING_INVALID:${caseId}`);
    }
    cases[caseId] = {
      caseId,
      blocks,
      sampleBody: structuredClone(spec.sampleBody),
    };
  }
  return {
    schemaVersion: 1,
    cases,
    provenance: {
      status: "offline_agent_source_text_comparison",
      modelOutput: false,
      approvedUserContent: false,
      clinicalReview: false,
      adoptionApproval: false,
      inferenceFromFreeText: false,
      historicalEvaluationChanged: false,
      sourceSet: Object.entries(EXPECTED_SOURCES).map(([sourceId, source]) => ({
        sourceId,
        title: source.title,
        version: source.version,
        contentDigestField: source.contentDigestField,
        contentDigest: source.contentDigest,
      })),
      e02Relationship: {
        documentPublisher: "厚生労働省",
        recommendationBodyNamedByDocument: "米国睡眠医学会（AASM）",
        aasmOriginalTextIngested: false,
        supportsNapOr24HourMeaning: false,
      },
      applicationNotices: [
        "日本への適用は確認済み原文の結論ではなく、別の適用確認で扱う。",
        "E02の収録原文は昼寝または24時間合計を述べていない。出典表示で未支持の説明を補修しない。",
        "対象条件が不明または不適合なら、このカタログだけを根拠に個別助言を表示しない。",
      ],
    },
  };
}