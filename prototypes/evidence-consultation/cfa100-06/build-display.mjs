import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {root,directory,output,sha} from "./prepare.mjs";
export function buildCommonDisplay(){
  const relative="prototypes/evidence-consultation/fact-display-pilot/render.mjs";
  const source=fs.readFileSync(path.join(root,relative),"utf8");
  const start=source.indexOf("const escape ="),end=source.indexOf("\nexport function renderPilot");
  assert(start>0&&end>start);assert.equal(source.split("function factHtml(fact)").length,2);
  const body=source.slice(start,end);
  const generated=`// Checked extraction of the existing generic contextual fact renderer; no case routing.\nconst assert = condition => { if (!condition) throw Error("incomplete contextual fact"); };\n${body}\nexport {factHtml};\n`;
  fs.writeFileSync(path.join(directory,"common-fact-display.mjs"),generated);
  fs.writeFileSync(path.join(output,"common-renderer-reuse.json"),JSON.stringify({source:relative,sourceSha256:sha(source),extractedBodySha256:sha(body),generatedSha256:sha(generated),functionBodyUnchanged:true,numericQuantitiesInvented:false},null,2));
}