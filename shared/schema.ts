import { pgTable, text, serial, integer, boolean, timestamp, date, real, varchar, numeric, jsonb, uniqueIndex, check, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Kept in a dedicated module because the evidence catalog is independent from
// family records; re-exporting it lets the ephemeral Drizzle schema generator
// include the additive tables.
export * from "./evidence-schema";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  lineUserId: text("line_user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  pictureUrl: text("picture_url"),
  familyId: text("family_id").notNull(),
  role: text("role").notNull().default("papa"),
  invitationVerified: boolean("invitation_verified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Private consultations deliberately belong to the persisted numeric account,
// never to a family ID or client-supplied role. These tables are additive and
// are only queried when the separately gated feature is enabled.
export const consultations = pgTable("consultations", {
  id: uuid("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: varchar("title", { length: 120 }).notNull(),
  requestId: uuid("request_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("consultations_owner_request_unique").on(table.ownerUserId, table.requestId),
]);

export const consultationMessages = pgTable("consultation_messages", {
  id: uuid("id").primaryKey(),
  consultationId: uuid("consultation_id").notNull()
    .references(() => consultations.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  authorType: text("author_type").notNull().default("user"),
  requestId: uuid("request_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("consultation_messages_consultation_request_unique")
    .on(table.consultationId, table.requestId),
  check("consultation_messages_author_type_check", sql`${table.authorType} = 'user'`),
]);

export const invitationCodes = pgTable("invitation_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  isUsed: boolean("is_used").notNull().default(false),
  usedBy: text("used_by"),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type AppUser = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export const children = pgTable("children", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  name: text("name").notNull(),
  birthday: date("birthday"),
  gender: text("gender"),
  bloodType: text("blood_type"),
  color: text("color").notNull().default("#805AAA"),
  sleepTrainingEnabled: boolean("sleep_training_enabled").notNull().default(true),
  rotavirusVaccineType: text("rotavirus_vaccine_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  childId: integer("child_id"),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  points: integer("points").notNull().default(10),
  message: text("message"),
  subType: text("sub_type"),
  foodItems: text("food_items"),
  foodAmount: text("food_amount"),
  foodNote: text("food_note"),
  isNewFood: boolean("is_new_food").default(false),
  imageUrl: text("image_url"),
  poopColor: text("poop_color"),
  poopConsistency: text("poop_consistency"),
  bodyTemperature: real("body_temperature"),
  symptoms: text("symptoms"),
  symptomNote: text("symptom_note"),
  breastLeftMin: integer("breast_left_min"),
  breastRightMin: integer("breast_right_min"),
  isExpressed: boolean("is_expressed").default(false),
  expressedMl: integer("expressed_ml"),
  formulaMl: integer("formula_ml"),
  stoolType: text("stool_type"),
  stoolAmount: text("stool_amount"),
  stoolColor: text("stool_color"),
  medicineName: text("medicine_name"),
  medicineDose: text("medicine_dose"),
  performedBy: text("performed_by"),
  sleepSessionId: integer("sleep_session_id"),
  settlingMethod: text("settling_method"),
  settlingMinutes: integer("settling_minutes"),
  sleepLocation: text("sleep_location"),
  sleepNote: text("sleep_note"),
  spitUp: boolean("spit_up").default(false),
  spitUpAmount: text("spit_up_amount"),
  spitUpTiming: text("spit_up_timing"),
  spitUpNote: text("spit_up_note"),
  excludeFromInterval: boolean("exclude_from_interval").default(false),
  holdEndAt: timestamp("hold_end_at"),
  walkEndAt: timestamp("walk_end_at"),
  // Supporter attribution is deliberately separate from userId/performedBy.
  // userId remains populated for legacy compatibility; these columns are the
  // authoritative attribution for supporter-created care records.
  actorAccountId: integer("actor_account_id"),
  supporterAccountId: integer("supporter_account_id"),
  supporterGrantId: integer("supporter_grant_id"),
  careSource: text("care_source"),
  recorderDisplayName: text("recorder_display_name"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// A provider-neutral account. inviteAddress/publicCode are routing identifiers,
// not credentials or bearer tokens. An account can exist before an external
// identity is bound, hence userId is intentionally nullable.
export const supporterAccounts = pgTable("supporter_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").unique().references(() => users.id, { onDelete: "restrict" }),
  inviteAddress: text("invite_address").notNull().unique(),
  publicCode: varchar("public_code", { length: 80 }).notNull().unique(),
  displayName: text("display_name").notNull().default("ぶどうの木"),
  kind: text("kind").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  check("supporter_accounts_kind_check", sql`${table.kind} IN ('facility', 'relative', 'sitter')`),
]);

// This is the only authority used for a parent role when supporter access is
// enabled. users.familyId and client-held role/family values are not authority.
export const parentAccess = pgTable("parent_access", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  familyId: text("family_id").notNull(),
  role: text("role").notNull(),
  verifiedAt: timestamp("verified_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("parent_access_user_family_unique").on(table.userId, table.familyId),
  check("parent_access_role_check", sql`${table.role} IN ('papa', 'mama')`),
]);

export const supporterGrants = pgTable("supporter_grants", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  childId: integer("child_id").notNull().references(() => children.id, { onDelete: "restrict" }),
  supporterAccountId: integer("supporter_account_id").notNull().references(() => supporterAccounts.id, { onDelete: "restrict" }),
  invitedByUserId: integer("invited_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  check("supporter_grants_valid_period", sql`${table.startsAt} < ${table.endsAt}`),
]);

// Request records make retries durable. Fingerprint mismatches on a repeated
// requestId are rejected rather than silently applying a different operation.
export const supporterIdempotency = pgTable("supporter_idempotency", {
  id: serial("id").primaryKey(),
  supporterAccountId: integer("supporter_account_id").notNull().references(() => supporterAccounts.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  requestId: varchar("request_id", { length: 128 }).notNull(),
  payloadFingerprint: varchar("payload_fingerprint", { length: 128 }).notNull(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supporter_idempotency_account_action_request_unique")
    .on(table.supporterAccountId, table.action, table.requestId),
]);

export const supporterAuditLogs = pgTable("supporter_audit_logs", {
  id: serial("id").primaryKey(),
  actorAccountId: integer("actor_account_id").references(() => users.id, { onDelete: "restrict" }),
  supporterAccountId: integer("supporter_account_id").references(() => supporterAccounts.id, { onDelete: "restrict" }),
  supporterGrantId: integer("supporter_grant_id").references(() => supporterGrants.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  requestId: varchar("request_id", { length: 128 }),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().unique(),
  babyName: text("baby_name").notNull().default("赤ちゃんのなまえ"),
  babyBirthday: date("baby_birthday"),
  specialTrick: text("special_trick").default("ビニール袋の音"),
  currentCaregiver: text("current_caregiver").notNull().default("パパ"),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  title: text("title").notNull(),
  date: date("date").notNull(),
  time: text("time"),
  assignee: text("assignee").notNull().default("未定"),
  completed: boolean("completed").notNull().default(false),
  completedBy: text("completed_by"),
  points: integer("points").notNull().default(10),
  memo: text("memo"),
  icon: text("icon"),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  title: text("title").notNull(),
  cost: integer("cost").notNull(),
  isCustom: boolean("is_custom").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userCoupons = pgTable("user_coupons", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  couponId: integer("coupon_id").notNull(),
  couponTitle: text("coupon_title").notNull(),
  cost: integer("cost").notNull(),
  ownerId: text("owner_id").notNull(),
  status: text("status").notNull().default("owned"),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  targetUser: text("target_user").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("coupon"),
  read: boolean("read").notNull().default(false),
  childId: integer("child_id"),
  // Dedupe key for system-generated notifications (e.g. vaccine reminders):
  // "vaccine:<childId>:<vaccineId>:<stage>". Null for partner-to-partner notifications.
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // システム生成通知の重複防止(dedupe_keyがNULLのパートナー間通知は対象外)
  uniqueIndex("notifications_dedupe_unique")
    .on(table.familyId, table.targetUser, table.dedupeKey)
    .where(sql`dedupe_key IS NOT NULL`),
]);

export const growthRecords = pgTable("growth_records", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  childId: integer("child_id"),
  userId: text("user_id").notNull(),
  weightGrams: integer("weight_grams"),
  heightCm: real("height_cm"),
  headCircumferenceCm: real("head_circumference_cm"),
  measuredAt: date("measured_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChildSchema = createInsertSchema(children).omit({ id: true, createdAt: true });
export const insertLogSchema = createInsertSchema(logs).omit({ id: true, createdAt: true });
export const insertSettingSchema = createInsertSchema(settings).omit({ id: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, createdAt: true });
export const insertCouponSchema = createInsertSchema(coupons).omit({ id: true, createdAt: true });
export const insertUserCouponSchema = createInsertSchema(userCoupons).omit({ id: true, createdAt: true, usedAt: true });
export const insertGrowthRecordSchema = createInsertSchema(growthRecords).omit({ id: true, createdAt: true });

export const sleepChecklist = pgTable("sleep_checklist", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  date: date("date").notNull(),
  darkness: boolean("darkness").notNull().default(false),
  temperature: boolean("temperature").notNull().default(false),
  safety: boolean("safety").notNull().default(false),
  whiteNoise: boolean("white_noise").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sleepRoutines = pgTable("sleep_routines", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  title: text("title").notNull(),
  assignee: text("assignee").notNull().default("未定"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sleepRoutineLogs = pgTable("sleep_routine_logs", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  routineId: integer("routine_id").notNull(),
  date: date("date").notNull(),
  completedBy: text("completed_by").notNull(),
  completedAt: timestamp("completed_at").defaultNow(),
});

export const sleepSessions = pgTable("sleep_sessions", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  childId: integer("child_id"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  durationMin: integer("duration_min"),
  createdBy: text("created_by").notNull(),
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const skillCompletions = pgTable("skill_completions", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  userId: text("user_id").notNull(),
  skillId: text("skill_id").notNull(),
  completedAt: timestamp("completed_at").defaultNow(),
});

export const feedbacks = pgTable("feedbacks", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  userId: text("user_id").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const weBoard = pgTable("we_board", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  userId: text("user_id").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWeBoardSchema = createInsertSchema(weBoard).omit({ id: true, createdAt: true });

export const diaryEntries = pgTable("diary_entries", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  childId: integer("child_id"),
  userId: text("user_id").notNull(),
  date: date("date").notNull(),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  mood: text("mood"),
  weather: text("weather"),
  tags: text("tags").array().notNull().default([]),
  images: text("images").array().notNull().default([]),
  visibility: text("visibility").notNull().default("shared"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDiaryEntrySchema = createInsertSchema(diaryEntries).omit({ id: true, createdAt: true, updatedAt: true });
export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type InsertDiaryEntry = z.infer<typeof insertDiaryEntrySchema>;

export const insertSkillCompletionSchema = createInsertSchema(skillCompletions).omit({ id: true, completedAt: true });
export const insertFeedbackSchema = createInsertSchema(feedbacks).omit({ id: true, createdAt: true });

export const insertSleepSessionSchema = createInsertSchema(sleepSessions).omit({ id: true, createdAt: true });

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export const insertSleepChecklistSchema = createInsertSchema(sleepChecklist).omit({ id: true, createdAt: true });
export const insertSleepRoutineSchema = createInsertSchema(sleepRoutines).omit({ id: true, createdAt: true });
export const insertSleepRoutineLogSchema = createInsertSchema(sleepRoutineLogs).omit({ id: true, completedAt: true });

export type Child = typeof children.$inferSelect;
export type InsertChild = z.infer<typeof insertChildSchema>;
export type Log = typeof logs.$inferSelect;
export type InsertLog = z.infer<typeof insertLogSchema>;
export type SupporterAccount = typeof supporterAccounts.$inferSelect;
export type ParentAccess = typeof parentAccess.$inferSelect;
export type SupporterGrant = typeof supporterGrants.$inferSelect;
export type SupporterAuditLog = typeof supporterAuditLogs.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Coupon = typeof coupons.$inferSelect;
export type InsertCoupon = z.infer<typeof insertCouponSchema>;
export type UserCoupon = typeof userCoupons.$inferSelect;
export type InsertUserCoupon = z.infer<typeof insertUserCouponSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type GrowthRecord = typeof growthRecords.$inferSelect;
export type InsertGrowthRecord = z.infer<typeof insertGrowthRecordSchema>;
export type SleepChecklist = typeof sleepChecklist.$inferSelect;
export type InsertSleepChecklist = z.infer<typeof insertSleepChecklistSchema>;
export type SleepRoutine = typeof sleepRoutines.$inferSelect;
export type InsertSleepRoutine = z.infer<typeof insertSleepRoutineSchema>;
export type SleepRoutineLog = typeof sleepRoutineLogs.$inferSelect;
export type InsertSleepRoutineLog = z.infer<typeof insertSleepRoutineLogSchema>;
export type SleepSession = typeof sleepSessions.$inferSelect;
export type InsertSleepSession = z.infer<typeof insertSleepSessionSchema>;
export type SkillCompletion = typeof skillCompletions.$inferSelect;
export type InsertSkillCompletion = z.infer<typeof insertSkillCompletionSchema>;
export type Feedback = typeof feedbacks.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type WeBoard = typeof weBoard.$inferSelect;
export type InsertWeBoard = z.infer<typeof insertWeBoardSchema>;

export const healthRecords = pgTable("health_records", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  childId: integer("child_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  recordedAt: date("recorded_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHealthRecordSchema = createInsertSchema(healthRecords).omit({ id: true, createdAt: true });
export type HealthRecord = typeof healthRecords.$inferSelect;
export type InsertHealthRecord = z.infer<typeof insertHealthRecordSchema>;

export const vaccinationRecords = pgTable("vaccination_records", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull().default("default"),
  childId: integer("child_id"),
  vaccineId: text("vaccine_id").notNull(),
  administeredDate: date("administered_date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertVaccinationRecordSchema = createInsertSchema(vaccinationRecords).omit({ id: true, createdAt: true });
export type VaccinationRecord = typeof vaccinationRecords.$inferSelect;
export type InsertVaccinationRecord = z.infer<typeof insertVaccinationRecordSchema>;

export const customVaccines = pgTable("custom_vaccines", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  childId: integer("child_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCustomVaccineSchema = createInsertSchema(customVaccines).omit({ id: true, createdAt: true });
export type CustomVaccine = typeof customVaccines.$inferSelect;
export type InsertCustomVaccine = z.infer<typeof insertCustomVaccineSchema>;

export const foodIngredients = pgTable("food_ingredients", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  childId: integer("child_id"),
  ingredientName: text("ingredient_name").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("not_tried"),
  firstTriedDate: date("first_tried_date"),
  notes: text("notes"),
  isCustom: boolean("is_custom").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFoodIngredientSchema = createInsertSchema(foodIngredients).omit({ id: true, createdAt: true, updatedAt: true });
export type FoodIngredient = typeof foodIngredients.$inferSelect;
export type InsertFoodIngredient = z.infer<typeof insertFoodIngredientSchema>;

export const customChildcareItems = pgTable("custom_childcare_items", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  itemName: text("item_name").notNull(),
  icon: text("icon").notNull().default("Star"),
  createdBy: text("created_by"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCustomChildcareItemSchema = createInsertSchema(customChildcareItems).omit({ id: true, createdAt: true });
export type CustomChildcareItem = typeof customChildcareItems.$inferSelect;
export type InsertCustomChildcareItem = z.infer<typeof insertCustomChildcareItemSchema>;

export const customQuickActions = pgTable("custom_quick_actions", {
  id: serial("id").primaryKey(),
  familyId: text("family_id").notNull(),
  label: text("label").notNull(),
  iconName: text("icon_name").notNull().default("Star"),
  colorScheme: text("color_scheme").notNull().default("purple"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCustomQuickActionSchema = createInsertSchema(customQuickActions).omit({ id: true, createdAt: true });
export type CustomQuickAction = typeof customQuickActions.$inferSelect;
export type InsertCustomQuickAction = z.infer<typeof insertCustomQuickActionSchema>;

export const familyIdMigrations = pgTable("family_id_migrations", {
  id: serial("id").primaryKey(),
  oldFamilyId: text("old_family_id").notNull().unique(),
  newFamilyId: text("new_family_id").notNull(),
  migratedAt: timestamp("migrated_at").defaultNow().notNull(),
});
export const mamaHealthLogs = pgTable("mama_health_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  loggedAt: timestamp("logged_at").defaultNow().notNull(),
  bowel: boolean("bowel"),
  bowelNote: text("bowel_note"),
  lochia: text("lochia"),
  perinealPain: integer("perineal_pain"),
  mood: integer("mood"),
  sleepHours: real("sleep_hours"),
  nursingIssues: text("nursing_issues").array(),
  nursingNote: text("nursing_note"),
  weightKg: real("weight_kg"),
  swelling: boolean("swelling"),
});

export const insertMamaHealthLogSchema = createInsertSchema(mamaHealthLogs).omit({ id: true, loggedAt: true });
export type MamaHealthLog = typeof mamaHealthLogs.$inferSelect;
export type InsertMamaHealthLog = z.infer<typeof insertMamaHealthLogSchema>;

export type FamilyIdMigration = typeof familyIdMigrations.$inferSelect;
