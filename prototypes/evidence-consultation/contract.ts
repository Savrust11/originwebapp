import type { EvidenceSearchResult } from "../../shared/evidence";

export type TargetChoice = "child" | "caregiver" | "both" | "unknown";
export type HealthAnswer = "unknown" | "present" | "absent";
export type ResultState = "matched" | "unverified" | "no_matching" | "no_vocabulary" | "incomplete";
export interface ChildInput {
  id: string;
  years: number | null;
  months: number | null;
}
export interface ConsultationInput {
  question: string;
  target: TargetChoice;
  children: ChildInput[];
  health: Record<string, Record<string, HealthAnswer>>;
  confirmed: boolean;
  ageConflictAcknowledged: boolean;
}
export interface AgeNotice {
  mentions: string[];
  conflict: boolean;
  message: string | null;
}
export interface HealthPrompt {
  key: string;
  label: string;
  explanation: string;
}
export interface EvidenceGroup {
  id: string;
  label: string;
  state: ResultState;
  results: EvidenceSearchResult[];
  healthPrompts: HealthPrompt[];
  diagnostics: string[];
}
export interface ConsultationResponse {
  state: ResultState;
  groups: EvidenceGroup[];
  expansionNotice: string | null;
  ageNotice: AgeNotice;
  disclaimer: string;
}