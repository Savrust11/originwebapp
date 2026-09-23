// Graceful control for this preview only; no process killing or DB access.
import fs from "node:fs";
const root="evidence-work/parent-reading-evaluation/material-selection-preview-01";
let count=0;
for(const name of fs.readdirSync(root).filter(n=>/^preview-\d{4}-/.test(n))){
  const dir=`${root}/${name}`,ready=`${dir}/ready.json`;
  if(!fs.existsSync(ready)||fs.existsSync(`${dir}/closed.json`))continue;
  const status=JSON.parse(fs.readFileSync(ready,"utf8"));
  if(status.privateVncOnly!==true||status.existingDatabase!==false||status.storesConsultationInputs!==false)throw Error("Unexpected preview marker");
  if(!fs.existsSync(`${dir}/stop-request`))fs.writeFileSync(`${dir}/stop-request`,"stop\n",{flag:"wx"});
  count++;
}
console.log(`Private preview graceful stop requested: ${count}`);