import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { searchConsultation } from "../service.mts";
import { groupConsultation, ageMonthsForChild } from "../flow.ts";
import { searchEvidence } from "../../../server/evidence/search.ts";
import { loadValidatedCatalog } from "../fact-display-pilot/projection.mjs";
import { factHtml } from "../fact-display-pilot/render.mjs";
import { evaluateSleep } from "../p01-aggregation-addendum/model.mjs";
import { renderP01 } from "../p01-aggregation-addendum/render.mjs";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const esc = (s: unknown) => String(s??"未確認").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");

export async function createConnection(pool: any, initialized: any) {
  const owned = await pool.query("SELECT evidence_is_ephemeral_test_context() AS owned");
  assert.equal(owned.rows[0].owned, true);
  const sourceIds = [...initialized.versionBySource.values()].map((v:any)=>v.sourceDbId);
  const catalog = loadValidatedCatalog();
  const factDir="evidence-work/parent-reading-evaluation/fact-display-pilot-01";
  const factSeal=JSON.parse(fs.readFileSync(`${factDir}/catalog-seal.json`,"utf8"));
  assert.equal(sha(fs.readFileSync(`${factDir}/fact-catalog.json`,"utf8")),factSeal.catalogSha256);
  assert.equal(factSeal.adoptionApproved,false);
  assert.equal(factSeal.publicationApproved,false);
  renderP01(); // Existing sealed addendum validator; no serving or browser side effects.
  const minutes = JSON.parse(fs.readFileSync("evidence-work/parent-reading-evaluation/p01-aggregation-addendum-01/minutes-source.json","utf8"));
  const proof = { sourceId:minutes.sourceId, linkedUnitId:minutes.linkedUnitId,
    ageMinMonths:12, ageMaxMonthsExclusive:36, includesNaps:true, verified:true };
  let sqlCalls = 0;
  const quarantine = {
    async query(sql: string, values: unknown[] = []) {
      sqlCalls++;
      if (sql.includes("version.id = source.current_published_version_id")) {
        assert.equal(sql.split("version.id = source.current_published_version_id").length,2);
        assert.equal(sql.split("version.publication_status = 'published'").length,2);
        assert.equal(sql.split("source.status = 'active'").length,2);
        sql = sql.replace("version.id = source.current_published_version_id",
          "version.source_id = source.id AND source.id = ANY($4::uuid[])")
          .replace("version.publication_status = 'published'",
            "version.publication_status = 'draft' AND version.manual_reviewed = false AND version.test_only = true")
          .replace("source.status = 'active'", "source.status = 'draft' AND source.test_only = true");
        return pool.query(sql, [...values, sourceIds]);
      }
      return pool.query(sql, values);
    }
  };
  async function search(payload:any) {
    const input = payload.input;
    const response = await searchConsultation(quarantine, input);
    const plans = groupConsultation(input);
    const groups = response.groups.map(group => {
      const plan = plans.find(p=>p.id===group.id);
      const age = ageMonthsForChild(plan?.child);
      const items:any[]=[];
      for (const hit of group.results) {
        const candidates=[...initialized.byUnit.values()].filter((u:any)=>
          u.sourceDbId===hit.sourceId && u.versionDbId===hit.versionId && u.sectionDbId===hit.sectionId);
        for (const unit of candidates as any[]) {
          if(unit.logicalAgeRange && age!==undefined &&
            (age<unit.logicalAgeRange.minMonths || age>unit.logicalAgeRange.maxMonths)) continue;
          const fragment=initialized.byFragment.get(unit.fragmentId);
          assert.equal(sha(hit.originalText),fragment.textSha256);
          for(const required of unit.requiredContext) {
            const f=initialized.byFragment.get(required.fragmentId);
            const actual=hit.requiredContext.find(c=>c.sectionId===f.sectionDbId);
            assert(actual && sha(actual.originalText)===f.textSha256,"required context binding changed");
          }
          const facts=catalog.facts.filter(f=>f.sourceId===unit.sourceId && f.unitId===unit.id);
          for(const fact of facts) {
            assert.equal(fact.provenance.fragmentId,unit.fragmentId);
            for(const support of fact.supports) {
              const f=initialized.byFragment.get(support.originalId);
              assert(f && sha(f.originalText)===support.originalTextSha256);
            }
          }
          items.push({unitId:unit.id,sourceId:unit.sourceId,factIds:facts.map(f=>f.id),
            html:facts.map(factHtml).join(""), originalText:hit.originalText,
            sourceUrl:hit.originalUrl, title:hit.title,
            sourceLocation:hit.sourceLocation, citation:hit.citation,
            requiredContext:hit.requiredContext,
            missingFact:facts.length===0, applicability:hit.applicability});
        }
      }
      const hasSleep=items.some(i=>i.factIds.includes("sleep-guidance"));
      const sleep=payload.sleep?.[group.id];
      const record=(value:any)=>typeof value==="number" && Number.isFinite(value) ? {
        value,unit:"hours",kind:sleep?.actual===true?"actual-sleep":"unconfirmed",
        dayId:sleep?.sameDay===true?"confirmed-day":"unknown",
        complete:sleep?.complete===true && sleep?.napIncluded===true,approximate:true
      }:null;
      const night=record(sleep?.night), nap=record(sleep?.nap);
      if(nap && sleep?.sameDay!==true)nap.dayId="unconfirmed-other-day";
      const sleepResult=hasSleep ? evaluateSleep({ageMonths:age??null,night,nap},
        sleep?.link===true?proof:null):null;
      return {...group,results:undefined,items,hasSleep,sleepResult,ageMonths:age??null,
        minutes:hasSleep && sleep?.link===true ? {
          title:minutes.title,url:minutes.url,attribution:minutes.attribution,
          processingNotice:minutes.processingNotice,limitations:minutes.limitations
        }:null};
    });
    return {...response, groups, normalPath:false, candidateApproval:false, sqlCalls};
  }
  return { search, quarantine, getSqlCalls:()=>sqlCalls,
    async normalControl(question="睡眠時間") {
      return searchEvidence(pool,{question,ageMonths:20,context:{target:"child"}});
    }};
}
export { esc };