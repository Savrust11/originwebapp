import assert from "node:assert/strict";
import fs from "node:fs";
export async function endButtonSmoke(rt:any,dir:string,check:any){
  const {page}=rt;
  let requested=false;
  await page.exposeBinding("endPreviewBridge",async()=>{requested=true});
  const button=page.locator("#end-preview");
  await button.scrollIntoViewIfNeeded();
  check("終了ボタンが可視",await button.isVisible());
  await page.screenshot({path:`${dir}/end-button.png`});
  await button.click();
  await page.waitForFunction(()=>document.body.innerText.includes("終了しています"));
  check("終了ボタンが所有者終了ブリッジに到達",requested);
  await page.screenshot({path:`${dir}/ending.png`});
  const temp=rt.temp;
  await rt.close();await rt.close();
  check("終了処理は二重呼出しでも安全",true);
  check("headfulブラウザ終了",!rt.browser.isConnected()&&rt.cleanupStatus.browserClosed);
  check("接続プール終了",rt.cleanupStatus.poolEnded);
  check("一時ブラウザディレクトリ削除",rt.cleanupStatus.browserDirectoryRemoved&&!fs.existsSync(temp));
  assert(rt.cleanupStatus.browserClosed&&rt.cleanupStatus.poolEnded&&rt.cleanupStatus.browserDirectoryRemoved);
}