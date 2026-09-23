import fs from "node:fs";
import {createHash} from "node:crypto";
const hash=s=>createHash("sha256").update(s).digest("hex");
const dir="evidence-work/parent-reading-evaluation/p01-aggregation-addendum-01";
export function checkSupplement(minutes,initialized){
  if(!minutes)return{available:false,reason:"補足出典がありません"};
  const raw=fs.readFileSync(`${dir}/minutes-source.json`,"utf8");
  const seal=JSON.parse(fs.readFileSync(`${dir}/minutes-seal.json`,"utf8"));
  if(hash(raw)!==seal.sourceSha256)throw Error("補足出典の保存済み原文が封印と一致しません");
  const canonical=JSON.parse(raw);
  if(JSON.stringify(minutes)!==JSON.stringify(canonical))return{available:false,reason:"補足出典の原文・帰属・条件が保存済み出典と一致しません"};
  const unit=[...initialized.byUnit.values()].find(u=>u.id==="E02-S01"&&u.sourceId==="E02");
  if(!unit)return{available:false,reason:"関連付け先の元資料が利用できません"};
  const fragment=initialized.byFragment.get(unit.fragmentId);
  if(!fragment||hash(fragment.originalText)!==fragment.textSha256)return{available:false,reason:"元資料の原文を照合できません"};
  if(minutes.sourceId!=="MHLW-MINUTES-20231221"||minutes.linkedUnitId!==unit.id
    ||minutes.scope?.purpose!=="aggregation-includes-naps-only"
    ||minutes.scope?.ageMonths?.minInclusive!==12||minutes.scope?.ageMonths?.maxExclusive!==36
    ||minutes.scope?.includesNaps!==true||!minutes.fragments?.length
    ||!minutes.fragments.every(f=>hash(f.text)===f.textSha256))
    return{available:false,reason:"補足出典の対象条件または原文照合を確認できません"};
  return{available:true,reason:"保存済み出典・原文・1〜2歳の集計条件を照合済み"};
}