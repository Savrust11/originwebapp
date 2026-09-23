import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {assertSafeCallerEnvironment} from "../parenting-expansion-02/safe-caller.mjs";
import {preservation,output} from "./prepare.mjs";
import {loadCandidate} from "./mapper.mjs";
import {buildCommonDisplay} from "./build-display.mjs";
try {
  assertSafeCallerEnvironment(process.env);
  assert.deepEqual(process.argv.slice(2),["--authorize-cfa100-owned-validation"]);
  loadCandidate(); // No database lifecycle before verified source audit.
  preservation(true);
  buildCommonDisplay();
  const nonce=randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(output,"authorization.json"),JSON.stringify({nonce,scope:"cfa100-06-owned-disposable-only",existingDatabase:false,network:false,publication:false}));
  await import("./register.mjs");
  const {runOwnedExpansionChild}=await import("./runner-child.mjs");
  const cleanup=await runOwnedExpansionChild(nonce);
  assert.equal(cleanup.invocationNonce,nonce);assert.equal(cleanup.cleanupComplete,true);
  assert.match(cleanup.ownedRoot,/^\/tmp\/ephemeral-postgres-[A-Za-z0-9_-]+$/u);assert(!fs.existsSync(cleanup.ownedRoot));
  try {const stat=fs.readFileSync(`/proc/${cleanup.postgresPid}/stat`,"utf8");assert.notEqual(stat.slice(stat.lastIndexOf(")")+2).split(" ")[19],cleanup.postgresStartTime);} catch(e){if(e.code!=="ENOENT")throw e;}
  preservation();
  fs.writeFileSync(path.join(output,"cleanup.json"),JSON.stringify(cleanup,null,2));
  const cases=JSON.parse(fs.readFileSync(path.join(output,"cfa-cases.json")));
  const prior=JSON.parse(fs.readFileSync(path.join(output,"cases.json")));
  fs.writeFileSync(path.join(output,"final-status.json"),JSON.stringify({status:[...cases.cases,...prior.cases].every(c=>c.status==="pass")?"passed":"completed_with_failures",nonce,cleanupComplete:true,baseline:prior.counts,candidate:cases.counts,allProtectedBytesUnchanged:true},null,2));
  console.log("CFA100 isolated verification complete; owned cluster removed.");
} catch(error){console.error(`CFA100_FAILURE:${error.message}`);process.exitCode=1;}