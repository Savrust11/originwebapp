import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, sha } from "./prepare.mjs";
import { loadExpansionPrepared } from "../parenting-expansion-02/prepared-loader.mjs";
export const work = path.join(root, "evidence-work/parenting-expansion-03");
export function loadMunicipal() {
  const file = path.join(work, "municipal/validation-input.json");
  assert(fs.existsSync(file), "municipal/validation-input.json pending; no DB may be started");
  const input = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(input.format, "weiku.municipal-validation-input.v1");
  assert(input.records.length > 0 && input.queries.length > 0);
  const prior = loadExpansionPrepared();
  const old = [...prior.prior.sources.flatMap(s => s.documents.flatMap(d => d.units)), ...prior.overseas.documents.flatMap(d => d.units)];
  assert.equal(old.length, 21, "retain 20 current units and one historical excluded unit");
  const ids = new Set(old.map(u => u.id));
  for (const record of input.records) {
    assert(!ids.has(record.id)); ids.add(record.id);
    assert.match(record.id, /^[a-z0-9][a-z0-9-]{0,60}$/);
    for (const key of ["title", "publisher", "officialUrl", "checkedOn", "originalText", "summaryJa", "sourceLocation", "snapshot", "snapshotSha256", "originalSha256"]) assert.equal(typeof record[key], "string", `${record.id}.${key}`);
    assert.equal(new URL(record.officialUrl).protocol, "https:");
    assert.match(record.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(sha(record.originalText), record.originalSha256);
    const snapshot = path.resolve(root, record.snapshot);
    assert(snapshot.startsWith(path.join(work, "municipal") + path.sep));
    const snapshotBytes = fs.readFileSync(snapshot);
    assert.equal(sha(snapshotBytes), record.snapshotSha256);
    let snapshotText = snapshotBytes.toString("utf8");
    try {
      const values = value => typeof value === "string" ? value : Array.isArray(value) ? value.map(values).join("\n") : value && typeof value === "object" ? Object.values(value).map(values).join("\n") : "";
      snapshotText += "\n" + values(JSON.parse(snapshotText));
    } catch {}
    assert(snapshotText.replace(/\s+/gu, " ").includes(record.originalText.replace(/\s+/gu, " ")),
      `${record.id}: original passage must be present in locally saved source snapshot`);
    assert(["prefecture", "municipality", "administrative_ward", "facility"].includes(record.geography.level));
    assert(record.geography.prefecture);
    assert(record.geography.authorityCode === null || typeof record.geography.authorityCode === "string",
      "unknown official authority codes must remain null, never invented");
    if (record.geography.level !== "prefecture") assert(record.geography.municipality);
    if (record.geography.level === "administrative_ward") assert(record.geography.ward && record.geography.parentCity);
    assert(["entry_only", "scheme_detail", "facility_detail"].includes(record.coverage));
    assert.equal(record.permission.databasePreparationEligible, true);
    assert(["held", "prohibited"].includes(record.permission.externalAI));
    assert(["not_approved", "not_requested"].includes(record.permission.adoptionApproval));
    assert(["not_published", "draft"].includes(record.permission.publicationStatus));
    assert(record.permission.basis && record.permission.termsUrl);
    // These axes describe only the limited material explicitly approved in the research
    // basis, not a new license. Keep all original permission values unchanged.
    assert(record.permission.basis.includes("独自") && record.permission.basis.includes("短見出し"));
    record.permission.copyrightPermission ??= "independent_factual_summary_and_identifying_heading_only_body_reproduction_not_authorized";
    record.permission.contentVerification ??= "researcher_snapshot_bound_factual_summary_not_human_adoption_review";
    const vocabularyText = `${record.title} ${record.originalText}`;
    const explicitAliases = ["子育てサポート", "ファミリー・サポート", "一時預かり", "こども元気ランド", "子育て相談", "利用料助成"];
    record.queryTerms = [...new Set([...record.queryTerms, ...record.sourceTerms, ...explicitAliases.filter(term => vocabularyText.includes(term))])];
    // Native keyword table is globally unique by (language, term). Do not move a
    // shared existing keyword to another concept: use this record's actual title
    // (also its staged heading) and retain the shorter expressions as aliases.
    assert(record.title.length <= 160);
    record.sourceTerms = [record.title];
    assert(record.queryTerms.length && record.sourceTerms.length);
    assert(record.sourceTerms.every(term => `${record.title} ${record.originalText}`.includes(term)));
    assert(record.mustNotAssert.includes("空き状況・予約成立は保証しない"));
  }
  for (const query of input.queries) {
    assert(/[\u3040-\u30ff\u3400-\u9fff]/u.test(query.question));
    assert(query.location && Array.isArray(query.expectedIds) && Array.isArray(query.excludedIds));
    assert([...query.expectedIds, ...query.excludedIds].every(id => input.records.some(record => record.id === id)));
  }
  assert(input.queries.some(q => q.kind === "geographical_negative"));
  assert(input.queries.some(q => q.kind === "ward_city_boundary"));
  const naturalConsultations = [
    ["tokyo-koto-family", "江東区に住んでいます。子どもを少し預けたいので、ファミリー・サポートの料金と申し込み方法を知りたいです。"],
    ["kanagawa-yokohama-fee", "横浜市で子育てサポートを使いたいのですが、利用料助成の対象や上限を確認できますか。"],
    ["chiba-temp", "千葉市で育児に疲れたとき、一時預かりを不定期で使えますか。料金や申し込み先も知りたいです。"],
    ["osaka-temp", "大阪市で通院の間だけ子どもを預けたいです。一時預かりの対象と料金、事前の手続きを教えてください。"],
    ["kyoto-facility", "京都市のこども元気ランドに子どもと行きたいです。予約は必要ですか。子どもだけ預ける場所ですか。"],
    ["nagoya-family", "名古屋市ののびのび子育てサポートを使いたいです。登録できる年齢と登録料、申し込み先を確認したいです。"],
  ];
  for (const [id, question] of naturalConsultations) {
    const base = input.queries.find(q => q.id === id);
    assert(base, `missing researcher consultation seed ${id}`);
    input.queries.push({ ...base, id: `${id}-natural-consultation`, kind: "natural_consultation", question });
  }
  return { input, prior };
}