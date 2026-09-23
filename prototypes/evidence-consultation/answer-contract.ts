import type { ConsultationInput } from "./contract";
import type { EvidenceSearchResult } from "../../shared/evidence";

export type UrgentConcern = "yes" | "no" | "unknown";
export interface AnswerRequest {
  requestId: string;
  consultation: ConsultationInput;
  urgentConcern: UrgentConcern;
}
export interface EvidenceReference {
  sourceId: string;
  versionId: string;
  sectionId: string;
}
export interface AnswerClaim {
  kind: "explanation" | "suggestion" | "uncertainty";
  text: string;
  evidenceKind: "research" | "guidance" | "mixed";
  references: EvidenceReference[];
}
/** Untrusted provider output: validation is mandatory before display. */
export interface CandidateAnswer {
  groupId: string;
  claims: AnswerClaim[];
}
export type AnswerGroupStatus =
  | "needs_confirmation" | "insufficient" | "incomplete"
  | "connection_unconfigured" | "answer" | "rejected";
export interface AnswerGroup {
  id: string;
  label: string;
  status: AnswerGroupStatus;
  message: string;
  questions: string[];
  claims: AnswerClaim[];
  sources: EvidenceSearchResult[];
}
export interface AnswerResponse {
  requestId: string;
  mode: "offline";
  modelUsed: false;
  status: "checked" | "emergency_stop" | "cancelled" | "rejected";
  groups: AnswerGroup[];
  notices: string[];
}