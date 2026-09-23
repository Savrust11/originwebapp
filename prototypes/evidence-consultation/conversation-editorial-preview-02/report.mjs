import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(here,"../../../evidence-work/parent-reading-evaluation/conversation-editorial-preview-02");
const escape=x=>String(x).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
export function writeReport(){
 const data=JSON.parse(fs.readFileSync(path.join(out,"verification.json")));
 fs.writeFileSync(path.join(out,"verification-report.html"),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>編集見本02 検証</title><style>body{max-width:1000px;margin:30px auto;padding:20px;font:15px/1.8 sans-serif}img{max-width:100%}</style><h1>編集見本02 — 工学的検証</h1><p>${escape(data.scope)}</p><p>VNC権限・実際のheadful表示は所有者による確認が必要です。パケット監査ではありません。</p><ul>${data.results.map(r=>`<li>${r.pass?"PASS":"FAIL"} ${escape(r.name)} ${escape(r.error||"")}</li>`).join("")}</ul>${data.images.map(name=>`<h2>${escape(name)}</h2><img alt="${escape(name)}" src="data:image/png;base64,${fs.readFileSync(path.join(out,name)).toString("base64")}">`).join("")}</html>`);
}
if(process.argv[1]===fileURLToPath(import.meta.url))writeReport();