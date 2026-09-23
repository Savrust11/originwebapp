import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, output, sha, preservation } from "./prepare.mjs";
import { loadMunicipal } from "../parenting-expansion-03/municipal-input.mjs";

export const work = path.dirname(output);
const textValues = value => typeof value === "string" ? value : Array.isArray(value)
  ? value.map(textValues).join("\n") : value && typeof value === "object"
    ? Object.values(value).map(textValues).join("\n") : "";
export function loadInputs() {
  preservation();
  const prior = loadMunicipal();
  assert.equal(prior.input.records.length, 15, "35 retained current units require 15 prior municipal units");
  const priorUnits = [
    ...prior.prior.prior.sources.flatMap(s => s.documents.flatMap(d => d.units)),
    ...prior.prior.overseas.documents.flatMap(d => d.units),
  ];
  const ids = new Set([...priorUnits.map(u => u.id), ...prior.input.records.map(r => r.id)]);
  assert.equal(ids.size, 36);
  const keywords = new Set([...priorUnits.filter(u => u.id !== "cfa-regional-parenting-support-historical-detail")
    .flatMap(u => u.retrievalTerms.sourceTerms), ...prior.input.records.flatMap(r => r.sourceTerms)]);
  const contract = JSON.parse(fs.readFileSync(path.join(output, "input-contract.json"), "utf8"));
  const additions = [], queries = [], hashes = {};
  for (const kind of ["practical", "municipal"]) {
    const file = path.join(work, kind, "validation-input.json");
    assert(fs.existsSync(file), `${kind} input pending; no storage permitted`);
    assert(!fs.lstatSync(file).isSymbolicLink());
    const bytes = fs.readFileSync(file), input = JSON.parse(bytes);
    hashes[kind] = sha(bytes);
    assert.equal(input.format, contract.inputFormat);
    assert.equal(input.status, "ready");
    assert.equal(input.kind, kind);
    assert(Array.isArray(input.heldSources));
    assert(input.records.length > 0 && input.queries.length > 0);
    for (const record of input.records) {
      for (const field of contract.recordFields) assert(Object.hasOwn(record, field), `${record.id}: missing ${field}`);
      assert.match(record.id, /^[a-z0-9][a-z0-9-]{0,60}$/u);
      assert(!ids.has(record.id), `duplicate id ${record.id}`); ids.add(record.id);
      assert.equal(new URL(record.officialUrl).protocol, "https:");
      assert.match(record.checkedOn, /^\d{4}-\d{2}-\d{2}$/u);
      assert.equal(sha(record.originalText), record.originalSha256);
      const snapshot = path.resolve(root, record.snapshot);
      const owned = fs.realpathSync(path.join(work, kind)) + path.sep;
      assert(snapshot.startsWith(path.join(work, kind) + path.sep));
      assert(fs.realpathSync(snapshot).startsWith(owned));
      assert(!fs.lstatSync(snapshot).isSymbolicLink());
      const saved = fs.readFileSync(snapshot);
      assert.equal(sha(saved), record.snapshotSha256);
      let savedText = saved.toString("utf8");
      try { savedText += "\n" + textValues(JSON.parse(savedText)); } catch {}
      assert(savedText.replace(/\s+/gu, " ").includes(record.originalText.replace(/\s+/gu, " ")));
      for (const field of contract.permissionFields) assert(record.permission[field] !== undefined);
      assert.equal(record.permission.databasePreparationEligible, true);
      assert(["held", "prohibited"].includes(record.permission.externalAI));
      assert(["not_approved", "not_requested"].includes(record.permission.adoptionApproval));
      assert(["draft", "not_published"].includes(record.permission.publicationStatus));
      assert(record.permission.basis && record.permission.termsUrl);
      for (const key of ["population", "supports", "doesNotSupport"]) assert(Array.isArray(record.scope[key]) && record.scope[key].length);
      for (const field of contract.attributionFields) assert(typeof record.attribution[field] === "string");
      assert(record.sourceTerms.length && record.queryTerms.length);
      for (const term of record.sourceTerms) {
        assert(`${record.title} ${record.originalText}`.includes(term));
        assert(!keywords.has(term), `${record.id}: existing keyword ownership collision ${term}`);
        keywords.add(term);
      }
      if (kind === "municipal") {
        assert(contract.geographyLevels.includes(record.geography?.level));
        assert(record.geography.prefecture);
        assert(record.geography.authorityCode === null || typeof record.geography.authorityCode === "string");
        assert(contract.coverageValues.includes(record.coverage));
        assert(record.mustNotAssert.includes(contract.municipalRequiredNonAssertion));
      }
      additions.push({ ...record, inputKind: kind });
    }
    for (const query of input.queries) {
      assert(/[\u3040-\u30ff\u3400-\u9fff]/u.test(query.question));
      assert(Array.isArray(query.expectedIds) && Array.isArray(query.excludedIds));
      assert([...query.expectedIds, ...query.excludedIds].every(id => input.records.some(r => r.id === id)));
      if (kind === "municipal") assert(query.location?.prefecture);
      // Independent, explicit test scope; never gate results using expectedIds.
      assert(query.scope && typeof query.scope.support === "string" && typeof query.scope.population === "string",
        `${query.id}: explicit query.scope.support/population required for independent scope gate`);
      if (query.kind.endsWith("_negative")) {
        assert.equal(query.expectedIds.length, 0); assert(query.excludedIds.length);
      }
      queries.push({ ...query, inputKind: kind });
    }
    for (const required of [...contract.requiredKindsPerWorker, ...(kind === "municipal" ? contract.municipalRequiredKinds : [])]) {
      assert(input.queries.some(q => q.kind === required), `${kind}: missing ${required}`);
    }
    for (const record of input.records) for (const kind of ["natural_consultation", "paraphrase"]) {
      assert(input.queries.some(q => q.kind === kind && q.expectedIds.includes(record.id)), `${record.id}: missing ${kind}`);
    }
  }
  if (process.env.PARENTING_EXPANSION_NONCE) {
    const authorization = JSON.parse(fs.readFileSync(path.join(output, "authorization.json"), "utf8"));
    assert.equal(authorization.invocationNonce, process.env.PARENTING_EXPANSION_NONCE);
    assert.equal(authorization.scope, "expansion04-owned-disposable-validation-only");
    assert.deepEqual(authorization.inputHashes, hashes);
    assert.equal(authorization.contractSha256, sha(fs.readFileSync(path.join(output, "input-contract.json"))));
    assert.equal(authorization.preservationSha256, sha(fs.readFileSync(path.join(output, "preservation-manifest.json"))));
  }
  return { prior: prior.input, additions, queries, hashes };
}