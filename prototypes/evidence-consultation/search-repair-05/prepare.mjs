import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
export const directory = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(directory, "../../..");
export const output = path.join(root, "evidence-work/search-repair-05/validation");
export const sha = x => createHash("sha256").update(x).digest("hex");
export function preservation(create = false) {
  const trees = ["prototypes/evidence-consultation/practical-guidance-pilot", "evidence-work/practical-guidance-pilot-01", ...["02","03","04"].flatMap(n => [`prototypes/evidence-consultation/parenting-expansion-${n}`,`evidence-work/parenting-expansion-${n}`]), "server/evidence", "tests/safety"];
  const walk = name => fs.readdirSync(path.join(root,name),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e => {
    assert(!e.isSymbolicLink()); const p = `${name}/${e.name}`;
    return e.isDirectory() ? walk(p) : [{path:p,sha256:sha(fs.readFileSync(path.join(root,p)))}];
  });
  const files = trees.flatMap(walk);
  for (const p of ["tests/run-ephemeral-tests.mjs","tests/run-managed-tests.mjs"]) files.push({path:p,sha256:sha(fs.readFileSync(path.join(root,p)))});
  fs.mkdirSync(output,{recursive:true});
  const manifest = path.join(output,"preservation.json");
  if (!fs.existsSync(manifest)) { assert(create); fs.writeFileSync(manifest,JSON.stringify({currentUnits:51,historical:1,files},null,2)+"\n",{flag:"wx"}); }
  else assert.deepEqual(JSON.parse(fs.readFileSync(manifest)).files,files,"frozen bytes changed");
  return files;
}
export function pinned(relative) {
  const manifest = JSON.parse(fs.readFileSync(path.join(output,"preservation.json")));
  const file = manifest.files.find(f=>f.path===relative); assert(file, relative);
  const text = fs.readFileSync(path.join(root,relative),"utf8"); assert.equal(sha(text),file.sha256);
  return text;
}
export function once(text,anchor,replacement) { assert.equal(text.split(anchor).length,2,`nonunique anchor ${anchor.slice(0,90)}`); return text.replace(anchor,replacement); }
export function prepare() {
  preservation(true);
  const records = ["03","04"].flatMap(n=>JSON.parse(fs.readFileSync(path.join(root,`evidence-work/parenting-expansion-${n}/municipal/validation-input.json`))).records);
  const ledgerPath = "evidence-work/parenting-expansion-03/municipal/coverage-ledger.json";
  const ledger = JSON.parse(fs.readFileSync(path.join(root,ledgerPath)));
  const prefectures = {tokyo:"東京都",kanagawa:"神奈川県",chiba:"千葉県",osaka:"大阪府",nagoya:"愛知県",kyoto:"京都府"};
  assert.equal(ledger.records.filter(r=>r.entityType==="designated_city_ward").length,92);
  const roster = ledger.records.map(r=>({
    level:r.entityType, prefecture:prefectures[r.region], municipality:r.parentMunicipality??r.name,
    ward:r.parentMunicipality?r.name:null, parentCity:r.parentMunicipality, authorityCode:null,
    rosterSourceUrl:r.rosterSourceUrl, coverageStatus:r.coverageStatus,
    collected:records.some(item=>item.geography.prefecture===prefectures[r.region] && item.geography.municipality===(r.parentMunicipality??r.name)),
  }));
  const places = [...roster,...records.filter(r=>!r.geography.municipality).map(r=>({...r.geography,collected:true}))];
  fs.writeFileSync(path.join(directory,"geography-data.mjs"),`// Derived only from frozen existing municipal geography; null official codes stay null.\nexport const places = ${JSON.stringify(places,null,2)};\n`);
  fs.writeFileSync(path.join(output,"geography-provenance.json"),JSON.stringify({sources:[ledgerPath,"evidence-work/parenting-expansion-03/municipal/validation-input.json","evidence-work/parenting-expansion-04/municipal/validation-input.json"],municipalities:219,administrativeWards:92,officialIdsInvented:false,places},null,2));
}
if (process.argv[1]===fileURLToPath(import.meta.url)) prepare();