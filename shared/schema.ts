import { pgTable, text, serial, integer, boolean, timestamp, date, real, varchar, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  createdAt: timestamp("created_at").defaultNow(),
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
  createdAt: timestamp("created_at").defaultNow(),
});

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
