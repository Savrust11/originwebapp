// Unit tests for vaccine reminder target-date calculation and stage decisions.
// Pure-function tests: no server needed.
// Run: npx tsx tests/vaccine-reminder.test.mts   (or: npm run test:vaccine)
import { parseISO, format, addDays } from "date-fns";
import {
  getVaccineTargetDate,
  computeVaccineReminders,
  type VaccineReminder,
} from "../client/src/lib/vaccine-reminder";
import {
  VACCINE_DEFINITIONS,
  getNextDoseRecommendation,
  getVaccineById,
  getVaccineStatus,
} from "../client/src/lib/vaccine-schedule";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`ok   - ${name}`);
  else { failures++; console.error(`FAIL - ${name} ${extra}`); }
}

function v(id: string) {
  const def = getVaccineById(id);
  if (!def) throw new Error(`unknown vaccine id: ${id}`);
  return def;
}

const BIRTHDAY = "2026-01-01";

// ---------- vaccine definition integrity ----------

{
  const definitionsById = new Map(VACCINE_DEFINITIONS.map((definition) => [definition.id, definition]));
  const groups = new Map<string, typeof VACCINE_DEFINITIONS>();

  check(
    "definitions: vaccine ids are unique",
    definitionsById.size === VACCINE_DEFINITIONS.length,
  );

  for (const definition of VACCINE_DEFINITIONS) {
    const group = groups.get(definition.group) ?? [];
    group.push(definition);
    groups.set(definition.group, group);

    check(
      `${definition.id}: standardAgeMonths is within its age group`,
      definition.standardAgeMonths >= definition.ageGroupMin
        && definition.standardAgeMonths <= definition.ageGroupMax,
      `(standard=${definition.standardAgeMonths}, range=${definition.ageGroupMin}-${definition.ageGroupMax})`,
    );

    if (definition.minIntervalDays !== null) {
      check(
        `${definition.id}: configured minIntervalDays is positive`,
        definition.minIntervalDays > 0,
        `(minIntervalDays=${definition.minIntervalDays})`,
      );
    }

    if (definition.previousDoseId) {
      const previous = definitionsById.get(definition.previousDoseId);
      check(
        `${definition.id}: previousDoseId exists`,
        previous !== undefined,
        `(${definition.previousDoseId})`,
      );
      check(
        `${definition.id}: previous dose links back`,
        previous?.nextDoseId === definition.id,
        `(previous.nextDoseId=${previous?.nextDoseId ?? "missing"})`,
      );
      check(
        `${definition.id}: previous dose is adjacent in the same group`,
        previous?.group === definition.group
          && previous.doseNumber === definition.doseNumber - 1,
        `(previous=${previous?.group ?? "missing"} #${previous?.doseNumber ?? "missing"})`,
      );
    }

    if (definition.nextDoseId) {
      const next = definitionsById.get(definition.nextDoseId);
      check(
        `${definition.id}: nextDoseId exists`,
        next !== undefined,
        `(${definition.nextDoseId})`,
      );
      check(
        `${definition.id}: next dose links back`,
        next?.previousDoseId === definition.id,
        `(next.previousDoseId=${next?.previousDoseId ?? "missing"})`,
      );
      check(
        `${definition.id}: next dose is adjacent in the same group`,
        next?.group === definition.group
          && next.doseNumber === definition.doseNumber + 1,
        `(next=${next?.group ?? "missing"} #${next?.doseNumber ?? "missing"})`,
      );
    }

    if (definition.intervalBaseDoseId) {
      const intervalBase = definitionsById.get(definition.intervalBaseDoseId);
      check(
        `${definition.id}: intervalBaseDoseId is an earlier dose in the same group`,
        intervalBase?.group === definition.group
          && intervalBase.doseNumber < definition.doseNumber,
        `(intervalBase=${intervalBase?.group ?? "missing"} #${intervalBase?.doseNumber ?? "missing"})`,
      );
    }
  }

  for (const [groupName, definitions] of groups) {
    const sorted = [...definitions].sort((a, b) => a.doseNumber - b.doseNumber);
    const totalDoses = sorted[0].totalDoses;
    check(
      `${groupName}: totalDoses is consistent`,
      sorted.every((definition) => definition.totalDoses === totalDoses),
    );
    check(
      `${groupName}: definition count matches totalDoses`,
      sorted.length === totalDoses,
      `(count=${sorted.length}, totalDoses=${totalDoses})`,
    );
    check(
      `${groupName}: doseNumber is consecutive from 1`,
      sorted.every((definition, index) => definition.doseNumber === index + 1),
      `(doseNumbers=${sorted.map((definition) => definition.doseNumber).join(",")})`,
    );
    check(
      `${groupName}: standardAgeMonths does not decrease by dose order`,
      sorted.every((definition, index) =>
        index === 0 || definition.standardAgeMonths >= sorted[index - 1].standardAgeMonths
      ),
      `(standardAgeMonths=${sorted.map((definition) => definition.standardAgeMonths).join(",")})`,
    );
    check(
      `${groupName}: definitions form one ordered chain`,
      sorted.every((definition, index) => {
        const expectedPreviousId = index === 0 ? null : sorted[index - 1].id;
        const expectedNextId = index === sorted.length - 1 ? null : sorted[index + 1].id;
        return definition.previousDoseId === expectedPreviousId
          && definition.nextDoseId === expectedNextId;
      }),
    );
  }

  check(
    "hepB_3: interval is measured from hepB_1",
    definitionsById.get("hepB_3")?.intervalBaseDoseId === "hepB_1",
  );
}

// ---------- getVaccineStatus ----------

// 5mix_1 has standardAgeMonths=2:
// upcoming starts at 1 month, and overdue starts at 5 months.
check(
  "status: just before standardAgeMonths-1 -> not_yet",
  getVaccineStatus("5mix_1", new Set(), 0) === "not_yet",
);
check(
  "status: exactly standardAgeMonths-1 -> upcoming",
  getVaccineStatus("5mix_1", new Set(), 1) === "upcoming",
);
check(
  "status: just before standardAgeMonths+3 -> upcoming",
  getVaccineStatus("5mix_1", new Set(), 4) === "upcoming",
);
check(
  "status: exactly standardAgeMonths+3 -> overdue",
  getVaccineStatus("5mix_1", new Set(), 5) === "overdue",
);
check(
  "status: completed takes precedence over age-based status",
  getVaccineStatus("5mix_1", new Set(["5mix_1"]), 5) === "completed",
);

// ---------- getNextDoseRecommendation ----------

{
  const recommendation = getNextDoseRecommendation("5mix_1", "2026-03-01");
  check(
    "next dose: interval is added to administered date",
    recommendation?.nextVaccineId === "5mix_2"
      && recommendation.nextVaccineName === "五種混合(2)"
      && recommendation.recommendedDate === "2026-03-21"
      && recommendation.minIntervalDays === 20,
  );
}
check(
  "next dose: final dose -> null",
  getNextDoseRecommendation("5mix_boost", "2026-03-01") === null,
);
{
  const recommendation = getNextDoseRecommendation("mr_1", "2026-03-01");
  check(
    "next dose: vaccine without interval -> empty recommendedDate",
    recommendation?.nextVaccineId === "mr_2"
      && recommendation.recommendedDate === ""
      && recommendation.minIntervalDays === 0,
  );
}

// ---------- getVaccineTargetDate ----------

// No previous dose -> standard schedule date (birthday + standardAgeMonths)
check(
  "5mix_1 (first dose) -> standard date = birthday + 2 months",
  getVaccineTargetDate(v("5mix_1"), BIRTHDAY, new Map()) === "2026-03-01",
);

// Previous dose not recorded -> falls back to standard date
check(
  "5mix_2 with no recorded previous dose -> standard date",
  getVaccineTargetDate(v("5mix_2"), BIRTHDAY, new Map()) === "2026-04-01",
);

// Previous dose recorded, min-interval date EARLIER than standard -> standard wins
{
  const admin = new Map([["5mix_1", "2026-03-01"]]); // +20d = 2026-03-21 < 2026-04-01
  check(
    "5mix_2: interval date earlier than standard -> standard date",
    getVaccineTargetDate(v("5mix_2"), BIRTHDAY, admin) === "2026-04-01",
  );
}

// Previous dose recorded LATE, min-interval date later than standard -> interval wins
{
  const admin = new Map([["5mix_1", "2026-05-10"]]); // +20d = 2026-05-30 > 2026-04-01
  check(
    "5mix_2: previous dose late -> interval date wins",
    getVaccineTargetDate(v("5mix_2"), BIRTHDAY, admin) === "2026-05-30",
  );
}

// hepB_3: interval origin is hepB_1 (NOT the immediately preceding hepB_2)
{
  // standard hepB_3 = birthday + 7 months = 2026-08-01
  // hepB_1 on 2026-04-05 -> +139d = 2026-08-22 (later than standard)
  // hepB_2 deliberately very late; must be ignored as origin
  const admin = new Map([
    ["hepB_1", "2026-04-05"],
    ["hepB_2", "2026-07-30"],
  ]);
  check(
    "hepB_3: origin is hepB_1 (139d), not hepB_2",
    getVaccineTargetDate(v("hepB_3"), BIRTHDAY, admin) === "2026-08-22",
  );
}
{
  // hepB_1 early enough that standard wins
  const admin = new Map([["hepB_1", "2026-03-01"]]); // +139d = 2026-07-18 < 2026-08-01
  check(
    "hepB_3: hepB_1 early -> standard date wins",
    getVaccineTargetDate(v("hepB_3"), BIRTHDAY, admin) === "2026-08-01",
  );
}

// ---------- computeVaccineReminders: stage boundaries ----------

// Helper: compute reminders for a family where only 5mix_1 is pending,
// with "today" set at a chosen offset relative to 5mix_1's target date (2026-03-01).
function stageOf(daysUntilTarget: number, leadDays: number): VaccineReminder | undefined {
  const target = parseISO("2026-03-01");
  const today = addDays(target, -daysUntilTarget);
  const reminders = computeVaccineReminders({
    birthday: BIRTHDAY,
    rotaType: null,
    administeredVaccineIds: new Set(),
    administeredDates: new Map(),
    leadDays,
    today,
  });
  return reminders.find((r) => r.vaccineId === "5mix_1");
}

for (const leadDays of [3, 7, 14, 30]) {
  check(
    `leadDays=${leadDays}: exactly leadDays before -> pre`,
    stageOf(leadDays, leadDays)?.stage === "pre",
  );
  check(
    `leadDays=${leadDays}: leadDays+1 before -> no reminder`,
    stageOf(leadDays + 1, leadDays) === undefined,
  );
  check(
    `leadDays=${leadDays}: 1 day before -> pre`,
    stageOf(1, leadDays)?.stage === "pre",
  );
}

check("target day itself -> due", stageOf(0, 7)?.stage === "due");
check("90 days past target -> still due", stageOf(-90, 7)?.stage === "due");
check("91 days past target -> overdue", stageOf(-91, 7)?.stage === "overdue");
check(
  "overdue message mentions consulting a doctor",
  stageOf(-91, 7)?.message.includes("かかりつけ医") === true,
);

// targetDate is reported in the reminder
check("reminder carries targetDate", stageOf(0, 7)?.targetDate === "2026-03-01");

// ---------- computeVaccineReminders: filtering rules ----------

function remindersAt(todayStr: string, opts: {
  rotaType?: "rotarix" | "rotateq" | null;
  administered?: Array<[string, string]>; // [vaccineId, date]
  leadDays?: number;
  birthday?: string;
} = {}): VaccineReminder[] {
  const administered = opts.administered ?? [];
  return computeVaccineReminders({
    birthday: opts.birthday ?? BIRTHDAY,
    rotaType: opts.rotaType ?? null,
    administeredVaccineIds: new Set(administered.map(([id]) => id)),
    administeredDates: new Map(administered),
    leadDays: opts.leadDays ?? 7,
    today: parseISO(todayStr),
  });
}

// Empty birthday -> no reminders
check(
  "empty birthday -> no reminders",
  computeVaccineReminders({
    birthday: "",
    rotaType: "rotateq",
    administeredVaccineIds: new Set(),
    administeredDates: new Map(),
    leadDays: 30,
    today: parseISO("2026-03-01"),
  }).length === 0,
);

// Rota type not selected -> no rota reminders even when due
{
  const r = remindersAt("2026-03-01", { rotaType: null });
  check("rotaType=null -> rota excluded", !r.some((x) => x.vaccineId.startsWith("rota_")));
}
// Rota selected -> rota_1 due on standard date
{
  const r = remindersAt("2026-03-01", { rotaType: "rotarix" });
  check("rotaType=rotarix -> rota_1 due", r.some((x) => x.vaccineId === "rota_1" && x.stage === "due"));
}
// rotarix: rota_3 never reminded even when rota_2 administered and time passed
{
  const r = remindersAt("2026-12-01", {
    rotaType: "rotarix",
    administered: [["rota_1", "2026-03-01"], ["rota_2", "2026-04-01"]],
  });
  check("rotarix -> rota_3 excluded", !r.some((x) => x.vaccineId === "rota_3"));
}
// rotateq: rota_3 IS reminded once rota_2 administered
{
  const r = remindersAt("2026-05-01", {
    rotaType: "rotateq",
    administered: [["rota_1", "2026-03-01"], ["rota_2", "2026-04-01"]],
  });
  check("rotateq -> rota_3 reminded", r.some((x) => x.vaccineId === "rota_3"));
}

// Administered vaccine is excluded
{
  const r = remindersAt("2026-03-01", { administered: [["5mix_1", "2026-03-01"]] });
  check("administered 5mix_1 excluded", !r.some((x) => x.vaccineId === "5mix_1"));
}

// Previous dose unadministered -> later dose skipped (only next-to-take dose notifies)
{
  const r = remindersAt("2026-06-01", {}); // 5mix_2/3 standard dates passed, but 5mix_1 not given
  check("5mix_2 skipped while 5mix_1 unadministered", !r.some((x) => x.vaccineId === "5mix_2"));
  check("5mix_3 skipped while chain incomplete", !r.some((x) => x.vaccineId === "5mix_3"));
  check("5mix_1 itself is reminded (overdue chain head)", r.some((x) => x.vaccineId === "5mix_1"));
}

// Once 5mix_1 administered, 5mix_2 becomes eligible with interval-aware target
{
  const r = remindersAt("2026-05-30", { administered: [["5mix_1", "2026-05-10"]] });
  const m2 = r.find((x) => x.vaccineId === "5mix_2");
  check("5mix_2 due on interval-shifted target date", m2?.stage === "due" && m2?.targetDate === "2026-05-30");
}

// Only one reminder per vaccine (most advanced stage only)
{
  const r = remindersAt("2026-03-01", {});
  const ids = r.map((x) => x.vaccineId);
  check("no duplicate vaccine ids in reminders", new Set(ids).size === ids.length);
}

// Optional vaccine label appears in message (mumps is isOptional)
{
  const r = remindersAt("2027-01-01", {});
  const mumps = r.find((x) => x.vaccineId === "mumps_1");
  check("optional vaccine message labeled 任意接種", mumps?.message.includes("任意接種") === true);
}

console.log("");
if (failures > 0) { console.error(`${failures} test(s) failed`); process.exit(1); }
console.log("All vaccine reminder tests passed");
