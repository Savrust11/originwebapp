// This loader never writes historical implementations or source records.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { transform } from "esbuild";
const directory=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(directory,"../../..");
const out=path.join(root,"evidence-work/parent-reading-evaluation/vocabulary-inventory-review-01");
const verify=path.join(directory,"verify.mts"), register=path.join(directory,"register.mjs");
const group="vocabulary-inventory-review";
function once(s,a,b){assert.equal(s.split(a).length,2,`unique adaptation anchor: ${a.slice(0,90)}`);return s.replace(a,b)}
export async function load(url,context,nextLoad){
  if(!url.startsWith("file:"))return nextLoad(url,context);
  const relative=path.relative(root,fileURLToPath(url));
  const targets=["tests/run-ephemeral-tests.mjs","tests/run-managed-tests.mjs",
    "tests/fixtures/real-corpus/setup.mts","prototypes/evidence-consultation/fact-display-pilot/render.mjs",
    "prototypes/evidence-consultation/retrieval-fact-connection/ui.mjs"];
  if(!targets.includes(relative))return nextLoad(url,context);
  const original=fs.readFileSync(fileURLToPath(url),"utf8");let source=original;
  if(relative===targets[0]){
    const start=source.indexOf("    const prototypeOnly = ");
    const marker="    normalRouteCompleted = normalRouteOnly;";
    const end=source.indexOf(marker,start);assert(start>0&&end>start);
    source=once(source,source.slice(start,end+marker.length),
      `    if(selectedGroups.length!==1||selectedGroups[0]!==${JSON.stringify(group)})throw Error("isolated group required");
    await runManagedTests([${JSON.stringify(group)}],config);
    throwIfInterrupted(operation);`);
  }else if(relative===targets[1]){
    source=once(source,"const GROUPS = new Set([",`const GROUPS = new Set([\n ${JSON.stringify(group)},`);
    source=once(source,"const GROUP_FILES = {",`const GROUP_FILES = {\n ${JSON.stringify(group)}: [${JSON.stringify(verify)}],`);
    source=once(source,"  const args = browser",`  const args = file === ${JSON.stringify(verify)} ? ["--import",${JSON.stringify(register)},"--import","tsx",file] : browser`);
  }else if(relative===targets[2]){
    source=once(source,`  await simulateTestOnlyPublication(pool, [...initialized.versionBySource.values()].map((version) => ({
    sourceId: version.sourceDbId, versionId: version.versionDbId,
  })));`,`  assert.equal((await pool.query("SELECT evidence_is_ephemeral_test_context() AS owned")).rows[0].owned,true);`);
  }else if(relative===targets[3]){
    source=once(source,"function factHtml(fact) {","export function factHtml(fact) {");
  }else{
    source=once(source,"'検索状態：'+result.state+",
      "'検索状態：'+({matched:'資料を表示しました',unverified:'未確認の条件があります',no_matching:'該当箇所が見つかりませんでした',no_vocabulary:'該当箇所が見つかりませんでした',incomplete:'入力または検索状態を確認してください'}[result.state]||'検索結果を確認してください')+");
    source=once(source,"g.diagnostics.map(d=>'<p>'+h(d)+'</p>')",
      "g.diagnostics.filter(d=>d!=='no_vocabulary').map(d=>'<p>'+h(({expansion_limit:'検索語を少し絞ってください。',candidate_scan_limit:'検索対象が多いため、すべてを確認できていません。',context_limit:'必要な前後の文脈を確認できないため、表示を控えています。',context_incomplete:'必要な前後の文脈がそろっていないため、表示を控えています。'})[d]||d)+'</p>')");
    source=once(source,"登録語彙に一致しません。検索の取りこぼしの可能性があり、資料不存在とは判断できません。",
      "登録資料から該当箇所を見つけられませんでした");
    source=once(source,"現在の検索語・明示条件で一致する結果はありません。対象条件による除外と資料不足は、この結果だけでは区別できません。",
      "登録資料から該当箇所を見つけられませんでした");
    source=once(source,"検索された原文に対応する事実データがありません。原文と必要な同版の文脈を表示します。",
      "関連資料はありますが、分かりやすい説明は準備中です");
    source=once(source,"検索は保存済み語彙によるものです。検索の取りこぼしと資料不足は別です。一般的な自由文の意味理解、資料の自動追加、回答生成は行いません。",
      "言い方を変えると見つかる場合があります。見つからないことは、科学的根拠がないことを意味しません。相談文から対象者・年齢・診断を判断しません。");
  }
  fs.mkdirSync(out,{recursive:true});
  const hash=s=>createHash("sha256").update(s).digest("hex");
  const record={path:relative,originalSha256:hash(original),adaptedSha256:hash(source),
    allFourSources:true,publicationSimulation:false,originalFileChanged:false};
  let recordPath=path.join(out,`adaptation-${path.basename(relative)}.json`);
  const text=JSON.stringify(record,null,2)+"\n";
  if(fs.existsSync(recordPath)&&fs.readFileSync(recordPath,"utf8")!==text)
    recordPath=path.join(out,`adaptation-${path.basename(relative)}-${hash(source).slice(0,12)}.json`);
  if(fs.existsSync(recordPath))assert.equal(fs.readFileSync(recordPath,"utf8"),text);
  else fs.writeFileSync(recordPath,text,{flag:"wx"});
  return{format:"module",source:(await transform(source,{loader:relative.endsWith(".mts")?"ts":"js",format:"esm",target:"node20",sourcefile:fileURLToPath(url)})).code,shortCircuit:true};
}