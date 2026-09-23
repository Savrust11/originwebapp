import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { assertSafeCallerEnvironment } from "../parenting-expansion-02/safe-caller.mjs";
import { prepare, preservation, output } from "./prepare.mjs";
try {
  assertSafeCallerEnvironment(process.env);
  assert.deepEqual(process.argv.slice(2),["--authorize-repair05-owned-validation"]);
  if(fs.existsSync(path.join(output,"authorization.json"))) {
    const previous=JSON.parse(fs.readFileSync(path.join(output,"authorization.json"))).nonce;
    const archive=path.join(output,"archive",previous);
    fs.mkdirSync(archive,{recursive:true});
    for(const entry of fs.readdirSync(output,{withFileTypes:true})) if(entry.isFile() && entry.name!=="preservation.json") {
      const destination=path.join(archive,entry.name);
      if(!fs.existsSync(destination)) fs.copyFileSync(path.join(output,entry.name),destination,fs.constants.COPYFILE_EXCL);
    }
  }
  prepare();
  const nonce=randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(output,"authorization.json"),JSON.stringify({nonce,scope:"search-repair-05-owned-disposable-only",existingDatabase:false,network:false,publication:false},null,2));
  await import("./register.mjs");
  const {runOwnedExpansionChild}=await import("./runner-child.mjs");
  const cleanup=await runOwnedExpansionChild(nonce);
  assert.equal(cleanup.invocationNonce,nonce);
  assert.equal(cleanup.cleanupComplete,true);
  assert.match(cleanup.ownedRoot,/^\/tmp\/ephemeral-postgres-[A-Za-z0-9_-]+$/u);
  assert(!fs.existsSync(cleanup.ownedRoot));
  assert(Number.isInteger(cleanup.postgresPid)&&cleanup.postgresPid>1);
  try {
    const stat=fs.readFileSync(`/proc/${cleanup.postgresPid}/stat`,"utf8");
    const start=stat.slice(stat.lastIndexOf(")")+2).split(" ")[19];
    assert.notEqual(start,cleanup.postgresStartTime,"owned postgres identity still alive");
  } catch(error) { if(error.code!=="ENOENT") throw error; }
  preservation();
  fs.writeFileSync(path.join(output,"cleanup.json"),JSON.stringify(cleanup,null,2));
  const cases=JSON.parse(fs.readFileSync(path.join(output,"cases.json")));
  fs.writeFileSync(path.join(output,"final-status.json"),JSON.stringify({status:cases.cases.every(c=>c.status==="pass")?"passed":"completed_with_failures",nonce,cleanupComplete:true,counts:cases.counts,allProtectedBytesUnchanged:true},null,2));
  console.log("Repair05 independent cases collected; nonce-bound owned cleanup complete.");
} catch(error) {
  console.error(`REPAIR05_FAILURE:${error.message}`); process.exitCode=1;
}