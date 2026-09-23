import "./safety/require-managed.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pool } from "../server/db.ts";
import { getManagedTestContext } from "./safety/require-managed.mjs";
import {
  executeFreshCandidate,
  validateAnswerRequest,
} from "../prototypes/evidence-consultation/answer-service.mts";

const CASES_PATH = path.resolve("evidence-work/model-evaluation/cases.json");
const REPORT_PATH = path.resolve("evidence-work/model-evaluation/normal-route-results.json");
const SOURCE_FILES = ["E01.json", "E02.json", "E03.json", "E04.json"]
  .map((name) => path.resolve("evidence-work/v0.2", name));

type SourceState = {
  publication_status: string;
  manual_reviewed: boolean;
  reviewer_name: string | null;
  reviewed_at: string | null;
};

function sha256(file: string) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sourceHashes() {
  return Object.fromEntries(SOURCE_FILES.map((file) => [path.basename(file), sha256(file)]));
}

function originalPreparedFlags() {
  return SOURCE_FILES.flatMap((file) => {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed.units
      .filter((unit: Record<string, unknown>) => unit.prepared === true || unit.status === "prepared" || unit.ingest_ready === true)
      .map((unit: Record<string, unknown>) => ({
        file: path.basename(file),
        id: unit.id,
        prepared: unit.prepared ?? unit.status ?? unit.ingest_ready,
        humanApproval: unit.human_approval,
      }));
  });
}

function canonicalGroupHealth(item: any) {
  const caregivers = item.persons.filter((person: any) => person.role === "caregiver");
  const groups: Record<string, Record<string, "present" | "absent" | "unknown">> = {};
  for (const child of item.persons.filter((person: any) => person.role === "child")) {
    const illnessFacts = [
      child.health.diagnosed_illness_or_disability,
      ...caregivers.map((person: any) => person.health.diagnosed_illness_or_disability),
    ].filter((value) => value === "present" || value === "absent" || value === "unknown");
    const combinedIllness = illnessFacts.includes("present")
      ? "present"
      : illnessFacts.length >= 2 && illnessFacts.every((value) => value === "absent")
        ? "absent"
        : "unknown";
    groups[`child:${child.id}`] = {
      diagnosed_illness_or_disability: combinedIllness,
      diagnosed_medical_condition_affecting_growth_development_or_behavior:
        child.health.diagnosed_medical_condition_affecting_growth_development_or_behavior ?? "unknown",
    };
  }
  return groups;
}

function canonicalPersonHealth(item: any) {
  return Object.fromEntries(item.persons.map((person: any) => [
    person.id,
    Object.fromEntries(Object.entries(person.health).filter(([key, value]) =>
      [
        "diagnosed_illness_or_disability",
        "diagnosed_medical_condition_affecting_growth_development_or_behavior",
      ].includes(key) && ["present", "absent", "unknown"].includes(value as string),
    )),
  ]));
}

function asRequest(item: any) {
  const children = item.persons
    .filter((person: any) => person.role === "child")
    .map((person: any) => ({
      id: person.id,
      years: person.age.years,
      months: person.age.months,
    }));
  return {
    requestId: `00000000-0000-4000-8000-${String(Number(item.id.slice(1))).padStart(12, "0")}`,
    consultation: {
      question: item.question_ja,
      target: item.target,
      children,
      // The normal two-pass flow requests health facts only after a published
      // matching root exposes an exclusion. Draft roots expose no prompt, so
      // canonical facts are retained separately and deliberately not injected
      // as if the runtime had requested/confirmed them.
      health: {},
      confirmed: item.confirmed ?? true,
      ageConflictAcknowledged: item.ageConflictAcknowledged ?? true,
    },
    urgentConcern: item.urgentConcern ?? "no",
  };
}

function assertCanonicalHealthMappings(cases: any[]) {
  const byId = new Map(cases.map((item) => [item.id, canonicalGroupHealth(item)]));
  for (const id of ["Q08", "Q09"]) {
    assert.equal(byId.get(id)![`child:${id}-child`].diagnosed_illness_or_disability, "absent");
  }
  for (const id of ["Q10", "Q11"]) {
    assert.equal(byId.get(id)![`child:${id}-child`].diagnosed_medical_condition_affecting_growth_development_or_behavior, "absent");
  }
  assert.equal(byId.get("Q15")!["child:Q15-child"].diagnosed_illness_or_disability, "present");
  assert.deepEqual(byId.get("Q16")!["child:Q16-child"], {
    diagnosed_illness_or_disability: "unknown",
    diagnosed_medical_condition_affecting_growth_development_or_behavior: "absent",
  });
  assert.deepEqual(byId.get("Q17")!["child:Q17-child"], {
    diagnosed_illness_or_disability: "unknown",
    diagnosed_medical_condition_affecting_growth_development_or_behavior: "unknown",
  });
  assert.deepEqual(byId.get("Q18")!["child:Q18-child"], {
    diagnosed_illness_or_disability: "unknown",
    diagnosed_medical_condition_affecting_growth_development_or_behavior: "unknown",
  });
  assert.deepEqual(byId.get("Q19"), {
    "child:Q19-child-A": {
      diagnosed_illness_or_disability: "unknown",
      diagnosed_medical_condition_affecting_growth_development_or_behavior: "absent",
    },
    "child:Q19-child-B": {
      diagnosed_illness_or_disability: "present",
      diagnosed_medical_condition_affecting_growth_development_or_behavior: "present",
    },
  });
  const q19People = canonicalPersonHealth(cases.find((item) => item.id === "Q19"));
  assert.notDeepEqual(q19People["Q19-child-A"], q19People["Q19-child-B"]);
  assert.deepEqual(q19People["Q19-caregiver"], {
    diagnosed_illness_or_disability: "unknown",
  });
}

async function versionStates(ids: string[]) {
  const result = await pool.query<SourceState>(
    `SELECT publication_status, manual_reviewed, reviewer_name, reviewed_at
       FROM evidence_versions
      WHERE id = ANY($1::uuid[])
      ORDER BY id`,
    [ids],
  );
  return result.rows;
}

function assertDraftUnapproved(states: SourceState[]) {
  assert.equal(states.length, 4);
  for (const state of states) {
    assert.equal(state.publication_status, "draft");
    assert.equal(state.manual_reviewed, false);
    assert.equal(state.reviewer_name, null);
    assert.equal(state.reviewed_at, null);
  }
}

function writeReport(report: unknown) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const temporary = `${REPORT_PATH}.next`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, REPORT_PATH);
}

const hashesBefore = sourceHashes();
const flagsBefore = originalPreparedFlags();
assert.equal(flagsBefore.length, 11);
for (const unit of flagsBefore) assert.equal(unit.humanApproval, null);

try {
  const plan = JSON.parse(fs.readFileSync(CASES_PATH, "utf8"));
  assert.equal(plan.cases.length, 20);
  assert.deepEqual(plan.cases.map((item: any) => item.id), Array.from({ length: 20 }, (_, index) => `Q${String(index + 1).padStart(2, "0")}`));
  assertCanonicalHealthMappings(plan.cases);
  const context = getManagedTestContext();
  assert.equal(typeof context.baseURL, "string");
  const versions = await pool.query<{ id: string }>("SELECT id FROM evidence_versions ORDER BY id");
  const versionIds = versions.rows.map((item) => item.id);
  const dbBefore = await versionStates(versionIds);
  assertDraftUnapproved(dbBefore);

  let providerCalls = 0;
  const provider = {
    async execute() {
      providerCalls += 1;
      throw new Error("provider spy must never execute");
    },
  };
  const outcomes = [];
  for (const item of plan.cases) {
    const request = asRequest(item);
    const retainedCanonicalHealth = canonicalGroupHealth(item);
    const retainedPersonHealth = canonicalPersonHealth(item);
    assert.equal(Object.keys(retainedPersonHealth).length, item.persons.length);
    assert.deepEqual(request.consultation.health, {});
    const validation = validateAnswerRequest(request);
    assert.equal(validation.ok, true, `${item.id} must be a real valid answer request`);
    const httpResponse = await fetch(`${context.baseURL}/api/prototype/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: context.baseURL!,
      },
      body: JSON.stringify(request),
    });
    assert.equal(httpResponse.status, 200);
    const response = await httpResponse.json() as any;
    assert.equal(response.modelUsed, false);
    const candidate = await executeFreshCandidate(pool, request, provider as any);
    assert.equal(candidate.status, "rejected");
    assert.equal(providerCalls, 0, `${item.id} must stop before provider execution`);

    const classification = response.status === "emergency_stop"
      ? "emergency_stop_before_retrieval"
      : response.status === "rejected"
        ? "input_validation_or_search_failure"
        : response.groups.every((group) => group.status === "insufficient")
          ? "retrieval_insufficient"
          : "other_blocked";
    if (item.id === "Q20") {
      assert.equal(response.status, "emergency_stop");
      assert.equal(response.groups.length, 0);
      assert.equal(classification, "emergency_stop_before_retrieval");
    } else {
      assert.equal(response.status, "checked");
      assert(response.groups.length > 0);
      assert(response.groups.every((group) => group.status === "insufficient"));
      assert.equal(classification, "retrieval_insufficient");
    }
    outcomes.push({
      id: item.id,
      routeStatus: response.status,
      classification,
      groupIds: response.groups.map((group) => group.id),
      groupStatuses: response.groups.map((group) => group.status),
      modelUsed: response.modelUsed,
      providerSpy: "not_called",
      conditionConfirmationBranch: item.id === "Q20"
        ? "not_run_emergency_gate_preempted_retrieval"
        : "not_run_draft_gate_prevented_retrieval",
      canonicalHealthFactsRetained: retainedCanonicalHealth,
      canonicalPersonHealthFactsRetained: retainedPersonHealth,
      healthSentToRoute: {},
    });
  }

  const dbAfter = await versionStates(versionIds);
  assertDraftUnapproved(dbAfter);
  const hashesAfter = sourceHashes();
  const flagsAfter = originalPreparedFlags();
  assert.deepEqual(hashesAfter, hashesBefore);
  assert.deepEqual(flagsAfter, flagsBefore);
  assert.equal(providerCalls, 0);

  writeReport({
    schemaVersion: "normal-route-verification-v1",
    scope: "Actual owned-loopback private prototype HTTP answer handler, checkOfflineAnswer, and retrieval path; not deployed application integration.",
    commands: [
      "env -i PATH=\"$PATH\" LANG=C LC_ALL=C TZ=UTC node --import tsx tests/run-ephemeral-tests.mjs normal-route-verification",
    ],
    summary: {
      cases: outcomes.length,
      passed: outcomes.length,
      emergencyStops: outcomes.filter((item) => item.classification === "emergency_stop_before_retrieval").length,
      retrievalInsufficient: outcomes.filter((item) => item.classification === "retrieval_insufficient").length,
      inputValidationFailures: outcomes.filter((item) => item.classification === "input_validation_or_search_failure").length,
      providerCalls,
      externalNetworkCalls: 0,
      modelCostUsd: 0,
    },
    boundaries: {
      originalsImported: 4,
      importedPreparedUnits: flagsBefore.length,
      publicationSimulationUsed: false,
      humanReviewFabricated: false,
      ordinaryApplicationStarted: false,
      privatePrototypeHttpStarted: true,
      httpRequests: outcomes.length,
      canonicalDefaults: {
        source: "cases.json current_preflight_contract.defaults",
        confirmed: true,
        ageConflictAcknowledged: true,
      },
      originalFlagsUnchanged: true,
      databaseFlagsBefore: dbBefore,
      databaseFlagsAfter: dbAfter,
    },
    sourceHashesBefore: hashesBefore,
    sourceHashesAfter: hashesAfter,
    outcomes,
    limitations: [
      "All imported versions remained draft and unapproved, so Q01–Q19 reached real retrieval but returned insufficient without published candidates.",
      "The health/applicability confirmation branches did not run because the draft publication gate exposed no matching root; this run does not claim those branches passed.",
      "Canonical fictional health facts were retained and mapped by person/group, but were not sent as runtime confirmations because the normal two-pass service had exposed no relevant prompt.",
      "Q20 was stopped by the existing emergency gate before retrieval. The heuristic is not a diagnosis or exhaustive emergency detector.",
      "The existing private prototype HTTP handler was exercised; its same-origin check, request parser, and answer service were covered. Deployed authentication/router integration was not tested.",
      "No source-content answer, semantic fidelity judgment, human review, model behavior, ordinary app bootstrap, or external provider was tested.",
    ],
    isolatedStorage: {
      status: "pending_launcher_cleanup",
      destroyed: false,
      retainedPath: null,
    },
  });
} finally {
  await pool.end();
}