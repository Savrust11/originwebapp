// Editorial retrieval aliases, NOT evidence or eligibility assertions. Categories
// and bindings come from the preserved municipal service datasets, not test IDs.
export const topicAliases = {
  home_help:["家事","掃除","洗濯","ヘルパー","ヘルプ","訪問援助","訪問支援","お世話","授乳"],
  family_support:["学童","送迎","預かり","預け","育児援助","ファミリー","サポート"],
  parenting_consultation:["相談","心配","悩み","話を聞","発達","面接","育ち"],
  temporary_care:["一時","預け","通院","休息","保育所"],
};
export function serviceTopic(service) {
  if(/ファミリー|のびのび|横浜子育てサポートシステム/u.test(service.title)) return "family_support";
  if(["temporary_childcare","temporary_care"].includes(service.purpose??service.category)) return "temporary_care";
  if((service.purpose??service.category)==="parenting_consultation") return "parenting_consultation";
  if(service.purpose==="housework_childcare_help") return "home_help";
  return null;
}