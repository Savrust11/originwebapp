import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {openPreview,out} from "./runtime.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const label="編集した会話見本・実際のAI回答ではない";
const results=[],images=[];
const check=(name,value)=>{results.push({name,pass:!!value});assert(value,name);};
const trace=JSON.parse(fs.readFileSync(path.join(out,"source-grounding.json")));
const sha=x=>createHash("sha256").update(x).digest("hex");
const sourceBefore=fs.readFileSync(path.join(root,trace.sourcePath));
check("保存済み原文ファイルのハッシュ",sha(sourceBefore)===trace.sourceFileSha256);
for(const f of trace.fragments)check(f.originalId+" 原文ハッシュ",sha(f.quote)===f.quoteSha256);
let rt;
try{
 rt=await openPreview({headless:true});
 const {page,context}=rt;
 check("場面は正確に3つ",await page.getByRole("tab").count()===3);
 check("全体の編集見本ラベル",await page.locator("header").innerText().then(t=>t.includes(label)));
 for(const width of [1280,375]){
  await page.setViewportSize({width,height:960});
  for(let i=0;i<3;i++){
   await page.getByRole("tab").nth(i).click();
   check(`${width}場面${i+1} 個別ラベル`,await page.locator(".scene-label").innerText()===label);
   check(`${width}場面${i+1} 最初に回答`,await page.locator(".answer").count()===1);
   check(`${width}場面${i+1} 根拠は閉じている`,!(await page.locator(".evidence").getAttribute("open")));
   check(`${width}場面${i+1} レビューは閉じている`,!(await page.locator(".trace").getAttribute("open")));
   check(`${width}場面${i+1} 質問数`,await page.locator(".question").count()===(i===1?1:0));
   check(`${width}場面${i+1} 年齢設定`,await page.locator(".parent").first().innerText().then(t=>t.includes(["4歳","生後2週","2歳"][i])));
   await page.locator(".draft summary").click();
   await page.locator("#draft").fill("架空の下書き・返信しないで");
   const before=await page.locator(".chat").innerText();
   await page.locator("#draft").press("Enter");
   check(`${width}場面${i+1} 入力に自動返信なし`,before===await page.locator(".chat").innerText());
   await page.locator(".draft summary").click();
   while(await page.locator("#next").isEnabled())await page.locator("#next").click();
   const chat=await page.locator(".chat").innerText();
   check(`${width}場面${i+1} 最終質問数`,(chat.match(/？/g)||[]).length===(i===1?1:0));
   if(i===1)check("対象確認後の次の編集回答",chat.includes("あなた自身の睡眠を確保することも大切"));
   if(i===2)check("育児支援・医療判断・緊急を分離",["育児相談員","医療者","編集上の運用案内","緊急時"].every(t=>chat.includes(t)));
   check(`${width}場面${i+1} 横はみ出しなし`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const name=`scene-${i+1}-${width}.png`;
   await page.screenshot({path:path.join(out,name),fullPage:true});images.push(name);
   await page.locator(".evidence summary").click();
   check("資料名と真正URL",await page.locator(".evidence").innerText().then(t=>t.includes(trace.sourceTitle)) && await page.locator(".evidence a").getAttribute("href")===trace.sourceUrl);
   await page.locator(".evidence a").click();
   check("出典リンクから外部通信しない",await page.locator("#link-note").innerText().then(t=>t.includes("無効")));
   await page.locator(".trace summary").click();
   check("原文・位置・ハッシュ追跡",await page.locator(".trace").innerText().then(t=>["sourceId","quoteSha256","location","sourceFileSha256",trace.fragments[i===1?1:0].quote].every(s=>t.includes(s))));
   if(width===375&&i===2){const name="evidence-review-375.png";await page.screenshot({path:path.join(out,name),fullPage:true});images.push(name);}
  }
 }
 check("予約・送信・共有の動作ボタンなし",!(await page.locator("button").allTextContents()).some(t=>/送信|予約|共有|生成/.test(t)));
 check("フォーム・iframe・外部読込要素なし",await page.locator("form,iframe,img[src^='http'],script[src],link").count()===0);
 check("ローカル保存なし",await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
 await page.reload();await page.locator(".draft summary").click();
 check("再読み込みで下書き消去",await page.locator("#draft").inputValue()==="");
 check("追加ページなし",context.pages().length===1);
 check("画面エラーなし",rt.checks.pageErrors.length===0);
 check("外部通信要求なし",rt.checks.externalRequests===0);
 await page.locator("#end").click();
 for(let i=0;i<80&&JSON.parse(fs.readFileSync(rt.metadata)).state!=="closed";i++)await new Promise(r=>setTimeout(r,100));
 await rt.close("verify");await rt.close("verify-repeat");
 check("終了ボタンで所有ブラウザ終了",!rt.browser.isConnected());
 check("所有ホーム削除",rt.checks.homeRemoved);
 check("closedメタデータ",JSON.parse(fs.readFileSync(rt.metadata)).state==="closed");
 check("元コーパス変更なし",sha(fs.readFileSync(path.join(root,trace.sourcePath)))===sha(sourceBefore));
}catch(e){results.push({name:"検証中断",pass:false,error:e.message});process.exitCode=1;}
finally{
 if(rt)await rt.close("verify-finally");
 fs.writeFileSync(path.join(out,"verification.json"),JSON.stringify({results,images,network:"offline context + route block + CSP + Chromium background-network flags; no packet-level audit",scope:"Engineering only, not clinical approval. Headful VNC and external VNC access boundary require owner confirmation."},null,2));
 const h=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 const font=fs.readFileSync(path.join(root,"prototypes/evidence-consultation/fonts/NotoSansJP-japanese-400.woff2")).toString("base64");
 const report=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><title>オフライン会話見本・検証記録</title><style>@font-face{font-family:Local;src:url(data:font/woff2;base64,${font})}body{font:14px/1.8 Local,sans-serif;max-width:1000px;margin:30px auto;padding:20px;color:#332c3b}img{max-width:100%;border:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>オフライン会話見本・検証記録</h1><p>${label}</p><p>これは静的画面の工学的検証です。臨床レビュー、資料採用、AI回答品質、公開承認ではありません。DB・APIは不要です。ネットワーク禁止はブラウザ設定・経路遮断・CSPで実施し、パケット監査はしていません。VNCのアクセス権と外部公開設定、実際のheadful表示は所有者による確認が必要です。</p><h2>検証項目</h2><ul>${results.map(r=>`<li>${r.pass?"PASS":"FAIL"} — ${h(r.name)} ${h(r.error||"")}</li>`).join("")}</ul><h2>出典照合と編集境界</h2><pre>${h(JSON.stringify(trace,null,2))}</pre><h2>画面記録</h2>${images.map(name=>`<h3>${h(name)}</h3><img alt="${h(name)}" src="data:image/png;base64,${fs.readFileSync(path.join(out,name)).toString("base64")}">`).join("")}</html>`;
 fs.writeFileSync(path.join(out,"verification-report.html"),report);
 console.log(`${results.filter(r=>r.pass).length}/${results.length} checks passed. Report: ${path.join(out,"verification-report.html")}`);
}