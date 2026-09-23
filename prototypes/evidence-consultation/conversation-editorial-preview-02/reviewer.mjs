import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(here,"../../../evidence-work/parent-reading-evaluation/conversation-editorial-preview-02");
const trace=JSON.parse(fs.readFileSync(path.join(out,"source-grounding.json")));
const escape=x=>String(x).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
fs.writeFileSync(path.join(out,"reviewer.html"),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>編集見本02 レビュー専用</title><style>body{max-width:900px;margin:30px auto;padding:20px;font:14px/1.8 sans-serif}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>レビュー専用：原文・対応・権利の留保</h1><p>利用者画面には原文・ハッシュ・編集メモを埋め込んでいません。これは臨床レビュー、資料採用、公開承認ではありません。AASM全文取り込み・外部AI利用の許諾は未確認のままです。</p><pre>${escape(JSON.stringify(trace,null,2))}</pre></html>`);
console.log(path.join(out,"reviewer.html"));