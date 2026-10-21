/**
 * Every paged table's sorts and default order, in one pure module: the server
 * code that queries a table, the page that reads its URL, and the API
 * reference that documents its route all need the same list, and the
 * reference cannot import server code. See `src/lib/paging.ts`.
 */

import type { ListSpec } from "@/lib/paging";

function spec<const S extends string>(sorts: readonly [S, ...S[]], dir: "asc" | "desc" = "asc"): ListSpec<S> {
  return { sorts, sort: sorts[0], dir };
}

export const AUDIT_LIST = spec(["at", "actor", "action", "target", "outcome"], "desc");
export type AuditSort = (typeof AUDIT_LIST.sorts)[number];

export const EMPLOYEE_LIST = spec([
  "fullName",
  "email",
  "title",
  "department",
  "site",
  "reportsToName",
  "startDate",
  "activeEffectiveDate",
]);
export type EmployeeSort = (typeof EMPLOYEE_LIST.sorts)[number];

export const USER_LIST = spec(["user", "eventRole", "trainingRole", "assessmentsRole", "platform"]);
export type UserSort = (typeof USER_LIST.sorts)[number];

export const IRIS_COHORT_LIST = spec(["finishedAt", "person", "track", "completed"], "desc");
export type IrisCohortSort = (typeof IRIS_COHORT_LIST.sorts)[number];

export const TITLE_LIST = spec(["title", "addedBy", "createdAt"]);
export type TitleSort = (typeof TITLE_LIST.sorts)[number];

export const SLACK_CONTACT_LIST = spec(["fullName", "email", "addedBy", "createdAt"]);
export type SlackContactSort = (typeof SLACK_CONTACT_LIST.sorts)[number];

export const MEETING_SELECTION_LIST = spec(["name", "stage", "track", "createdAt"]);
export type MeetingSelectionSort = (typeof MEETING_SELECTION_LIST.sorts)[number];

export const MEETING_SYNC_LIST = spec(["startedAt", "triggeredBy", "status"], "desc");
export type MeetingSyncSort = (typeof MEETING_SYNC_LIST.sorts)[number];

export const MEETING_SYNC_CHANGE_LIST = spec(["at", "meetingName", "action", "email"]);
export type MeetingSyncChangeSort = (typeof MEETING_SYNC_CHANGE_LIST.sorts)[number];

export const CHANNEL_CONTACT_LIST = spec(["fullName", "email", "addedBy", "createdAt"]);
export type ChannelContactSort = (typeof CHANNEL_CONTACT_LIST.sorts)[number];

export const SLACK_SYNC_LIST = spec(["startedAt", "triggeredBy", "status"], "desc");
export type SlackSyncSort = (typeof SLACK_SYNC_LIST.sorts)[number];

export const SLACK_SYNC_CHANGE_LIST = spec(["at", "channelName", "action", "email"]);
export type SlackSyncChangeSort = (typeof SLACK_SYNC_CHANGE_LIST.sorts)[number];

export const BOOTCAMP_HISTORY_LIST =spec(["btcDate", "fullName", "email"], "desc");
export type BootcampHistorySort = (typeof BOOTCAMP_HISTORY_LIST.sorts)[number];

/** Bootcamp history narrowed to people still in the employee list, or to those not. */
export const HISTORY_STATUSES = ["active", "inactive"] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export function isHistoryStatus(value: unknown): value is HistoryStatus {
  return HISTORY_STATUSES.includes(value as HistoryStatus);
}

/** Reporting → Bootcamp: everyone with a BTC or INT record the caller may see, newest first. */
export const BOOTCAMP_RECORD_LIST = spec(["date", "fullName", "email", "level"], "desc");
export type BootcampRecordSort = (typeof BOOTCAMP_RECORD_LIST.sorts)[number];

/** Reporting → Bootcamp's current cohort, above the records; its sort and page are prefixed `cohort`. */
export const BOOTCAMP_COHORT_LIST = spec(["fullName", "email", "stage", "averageScore"]);
export type BootcampCohortSort = (typeof BOOTCAMP_COHORT_LIST.sorts)[number];
export const BOOTCAMP_COHORT_PREFIX = "cohort";

export const ORGANIZATION_LIST = spec([
  "depth",
  "fullName",
  "email",
  "title",
  "department",
  "reportsToName",
  "track",
  "btcDate",
  "btcScore",
  "intDate",
  "intScore",
]);
export type OrganizationSort = (typeof ORGANIZATION_LIST.sorts)[number];

export const CURRENT_COHORT_LIST = spec(["fullName", "email", "title", "track", "btcDate", "averageScore"]);
export type CurrentCohortSort = (typeof CURRENT_COHORT_LIST.sorts)[number];

export const PREVIOUS_SESSION_LIST = spec(["date", "bootcamp", "intermediate"], "desc");
export type PreviousSessionSort = (typeof PREVIOUS_SESSION_LIST.sorts)[number];

/** One side of a past session, by name; each side pages on its own, as `bootcamp.page` and `intermediate.page`. */
export const SESSION_ATTENDEE_LIST = spec(["fullName"]);

export const BOOTCAMP_LIST = spec(["startDate", "status", "createdBy"], "desc");
export type BootcampSort = (typeof BOOTCAMP_LIST.sorts)[number];

export const JUDGE_LIST = spec(["fullName", "email", "addedBy", "addedAt"]);
export type JudgeSort = (typeof JUDGE_LIST.sorts)[number];

export const FACILITY_LIST = spec(["name", "rooms", "capacity", "updatedAt"]);
export type FacilitySort = (typeof FACILITY_LIST.sorts)[number];

/** `position` is the order the session dialog offers them in. */
/** Each person's latest answers to one logistics intake form, the most recently saved first. */
export const INTAKE_RESPONSE_LIST = spec(["submittedAt", "name", "email"], "desc");
export type IntakeResponseSort = (typeof INTAKE_RESPONSE_LIST.sorts)[number];

/**
 * Who wrote in "Other" on the dietary checklist, by name: one list for those who
 * marked it Critical and one for those who did not, each paged under its own prefix.
 */
export const WRITE_IN_LIST = spec(["name", "email", "stage"]);
export const CRITICAL_WRITE_IN_PREFIX = "criticalOther";
export const WRITE_IN_PREFIX = "other";
export type WriteInSort = (typeof WRITE_IN_LIST.sorts)[number];

/** Which attendees the Dietary needs page counts: everyone, or just the Bootcamp or Intermediate group. */
export const DIETARY_STAGES = ["all", "bootcamp", "intermediate"] as const;
export type DietaryStage = (typeof DIETARY_STAGES)[number];

/** The stage a Dietary needs URL asks for, from `stage`; everyone for one that asks none or anything else. */
export function dietaryStageOf(value: unknown): DietaryStage {
  const one = Array.isArray(value) ? value[0] : value;
  return DIETARY_STAGES.includes(one as DietaryStage) ? (one as DietaryStage) : "all";
}

/** Who in the current cohort has yet to send either registration form, by name. */
export const UNREGISTERED_LIST = spec(["name", "email", "stage"]);
/** The URL prefix that list sorts and pages under, beside the Dietary needs list on the same page. */
export const UNREGISTERED_PREFIX = "unregistered";
export type UnregisteredSort = (typeof UNREGISTERED_LIST.sorts)[number];

/** Food orders, the soonest to arrive first. */
export const FOOD_ORDER_LIST = spec(["arrivesAt", "vendor", "updatedAt"]);
export type FoodOrderSort = (typeof FOOD_ORDER_LIST.sorts)[number];

/** Async recordings, a row per take, the newest first. */
export const RECORDING_LIST = spec(["startedAt", "contributor"], "desc");
export type RecordingSort = (typeof RECORDING_LIST.sorts)[number];

/** Thumbs up and down on videos, with their comments, the newest first. */
export const VIDEO_FEEDBACK_LIST = spec(["createdAt", "video", "user", "rating"], "desc");
export type VideoFeedbackSort = (typeof VIDEO_FEEDBACK_LIST.sorts)[number];

/** Each guest judge on each bootcamp they judged, the latest bootcamp first. */
export const GUEST_JUDGE_LIST = spec(["cohort", "name", "sessions"], "desc");
export type GuestJudgeSort = (typeof GUEST_JUDGE_LIST.sorts)[number];

/** Sales and sales engineering leaders in HiBob who have never been a guest judge. */
export const JUDGE_PROSPECT_LIST = spec(["name", "department", "location", "tenure"]);
export type JudgeProspectSort = (typeof JUDGE_PROSPECT_LIST.sorts)[number];

export const SESSION_TYPE_LIST = spec(["position", "name", "kind", "minutes"]);
export type SessionTypeSort = (typeof SESSION_TYPE_LIST.sorts)[number];

export const SESSION_COMMENT_LIST = spec(["createdAt", "author"], "desc");
export type SessionCommentSort = (typeof SESSION_COMMENT_LIST.sorts)[number];

/** The checklist items a person owns, by the date of the day they are for. */
export const MY_CHECKLIST_LIST = spec(["date", "name", "createdBy"]);
export type MyChecklistSort = (typeof MY_CHECKLIST_LIST.sorts)[number];

/** Checklist items narrowed to those still to do, those done, or neither. */
export const CHECKLIST_STATUSES = ["open", "done", "all"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export function isChecklistStatus(value: unknown): value is ChecklistStatus {
  return CHECKLIST_STATUSES.includes(value as ChecklistStatus);
}

/** The comments that tag a person, newest first. */
export const MY_MENTION_LIST = spec(["createdAt", "author"], "desc");
export type MyMentionSort = (typeof MY_MENTION_LIST.sorts)[number];

export const ASSESSMENT_LIST = spec(["name", "stage", "audience", "active", "updatedAt"]);
export type AssessmentSort = (typeof ASSESSMENT_LIST.sorts)[number];

export const ASSESSMENT_ATTENDEE_LIST = spec(["fullName", "email", "title", "track", "averageScore"]);
export type AssessmentAttendeeSort = (typeof ASSESSMENT_ATTENDEE_LIST.sorts)[number];

export const HIBOB_SYNC_LIST =spec(["startedAt", "triggeredBy", "status"], "desc");
export type HibobSyncSort = (typeof HIBOB_SYNC_LIST.sorts)[number];

export const DOMAIN_LIST = spec(["domain", "note", "addedBy"]);
export type DomainSort = (typeof DOMAIN_LIST.sorts)[number];

export const REPO_LIST = spec(["identifier", "providerRepo", "scope", "addedBy"]);
export type RepoSort = (typeof REPO_LIST.sorts)[number];

export const ORG_SECRET_LIST = spec(["identifier", "kind", "updatedAt", "updatedBy"]);
export type OrgSecretSort = (typeof ORG_SECRET_LIST.sorts)[number];

/** Mimir's content; `position` is the order the library shows it in. */
export const MIMIR_ITEM_LIST = spec(["position", "title", "kind", "updatedAt"]);
export type MimirItemSort = (typeof MIMIR_ITEM_LIST.sorts)[number];

/** One person's Mimir progress, most recently opened first. */
export const MIMIR_PROGRESS_LIST = spec(["lastVisit", "title", "kind", "tier"], "desc");
export type MimirProgressSort = (typeof MIMIR_PROGRESS_LIST.sorts)[number];

/** Survey Results: each daily survey with a response, newest bootcamp first. */
export const SURVEY_RESULT_LIST = spec(["date", "average", "responses"], "desc");
export type SurveyResultSort = (typeof SURVEY_RESULT_LIST.sorts)[number];

/** One daily survey's responses, most recently answered first. */
export const SURVEY_RESPONSE_LIST = spec(["submittedAt", "fullName", "dayRating"], "desc");
export type SurveyResponseSort = (typeof SURVEY_RESPONSE_LIST.sorts)[number];
