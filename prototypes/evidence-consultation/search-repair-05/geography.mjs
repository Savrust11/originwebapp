import { places } from "./geography-data.mjs";
export { places };
export const regionKey = region => ["jp", region.prefecture ?? "", region.municipality ?? "", region.ward ?? ""].map(encodeURIComponent).join("/");
export function resolveRegion({ question, region }) {
  const mentioned = [...new Map(places.filter(p=>p.municipality && question.includes(p.municipality)).map(p=>[`${p.prefecture}/${p.municipality}`,p])).values()];
  const base = { topicQuestion:question, mentioned, clarification:null };
  let selected = region;
  const explicit = Boolean(region?.municipality);
  if (!selected?.municipality) {
    const resident = mentioned.find(p=>question.startsWith(p.municipality) || question.includes(`${p.municipality}に住`) || question.includes(`${p.municipality}中区に住`));
    selected=resident??(mentioned.length===1?mentioned[0]:null);
  }
  if(!selected?.municipality && question.includes("中区")) return {...base,status:"ambiguous",key:null,clarification:"中区はどちらの市ですか？"};
  if(!selected?.municipality) {
    if(region?.prefecture) {
      const known=places.find(p=>p.prefecture===region.prefecture && !p.municipality);
      if(known) return {...base,status:"resolved",key:regionKey(region),region:{...region},officialId:null};
    }
    return {...base,status:/[\p{Script=Han}]+[市町村区]/u.test(question) ? "not_collected":"general",key:null};
  }
  const sameCity=places.filter(p=>p.municipality===selected.municipality);
  const known=sameCity.find(p=>p.prefecture===selected.prefecture);
  if(!known) return {...base,status:sameCity.length?"invalid_region":"not_collected",key:regionKey(selected),region:{...selected},clarification:sameCity.length?"都道府県と市区町村の組み合わせを確認してください。":null};
  let ward=selected.ward??null;
  if(!explicit) ward=question.match(new RegExp(`${known.municipality}\\s*([\\p{Script=Han}]+区)`,"u"))?.[1]??null;
  if(ward && !places.some(p=>p.prefecture===known.prefecture && p.municipality===known.municipality && p.ward===ward)) return {...base,status:"invalid_region",key:regionKey({...selected,ward}),region:{...selected,ward},clarification:"行政区と市の組み合わせを確認してください。"};
  selected={prefecture:known.prefecture,municipality:known.municipality,ward};
  const conflict=explicit && mentioned.some(p=>p.municipality!==selected.municipality);
  return {...base,status:known.collected?"resolved":"not_collected",region:selected,key:regionKey(selected),officialId:known.authorityCode??null,
    regionAuthority:explicit?"structured_selection":"question",conflictingMention:conflict,
    notice:conflict?"質問内に別の自治体名があります。選択された地域の情報だけを対象にしています。":null};
}
export function inRegion(geography,resolved) {
  if(!geography) return true;
  if(resolved.status!=="resolved") return false;
  const selected=resolved.region;
  return geography.prefecture===selected.prefecture && (geography.level==="prefecture" ||
    geography.municipality===selected.municipality && (!geography.ward || geography.ward===selected.ward));
}