import { FOOD_ORDER_LIST, RECORDING_LIST, GUEST_JUDGE_LIST, INTAKE_RESPONSE_LIST, JUDGE_PROSPECT_LIST, ASSESSMENT_ATTENDEE_LIST, ASSESSMENT_LIST, AUDIT_LIST, BOOTCAMP_COHORT_LIST, BOOTCAMP_LIST, BOOTCAMP_RECORD_LIST, CURRENT_COHORT_LIST, DOMAIN_LIST, EMPLOYEE_LIST, FRAME_DOMAIN_LIST, HIBOB_SYNC_LIST, HISTORY_STATUSES, JUDGE_LIST, ORGANIZATION_LIST, PREVIOUS_SESSION_LIST, SESSION_COMMENT_LIST, SESSION_TYPE_LIST, MEETING_SELECTION_LIST, MEETING_SYNC_CHANGE_LIST, MEETING_SYNC_LIST, SLACK_CONTACT_LIST, SLACK_SYNC_CHANGE_LIST, SLACK_SYNC_LIST, CHANNEL_CONTACT_LIST, SURVEY_RESPONSE_LIST, SURVEY_RESULT_LIST, TITLE_LIST, USER_LIST, FACILITY_LIST, VIDEO_FEEDBACK_LIST, VIDEO_FEEDBACK_SUMMARY_LIST } from "@/lib/list-specs";
import { BOOTCAMP_LIMITS, BOOTCAMP_SCORE, CHECKLIST_LIMITS, EVALS_ASSESSMENT_LIMITS, FACILITY_LIMITS, FOOD_ORDER_LIMITS, INTAKE_LIMITS, MEETING_SELECTION_LIMITS, RECORDING_LIMITS, SCHEDULE_LIMITS, SURVEY_LIMITS, VIDEO_FEEDBACK_LIMITS } from "@/db/schema";
import { PAGE_SIZE } from "@/lib/paging";
import { RECORDING_RETENTION_DAYS, UPLOAD_STALLED_MS, UPLOAD_URL_BATCH } from "@/lib/recording/video";
import { CHECKLIST_ITEM_ROW } from "./account";
import { GUEST_JUDGE_DEPARTMENTS, GUEST_SPEAKER_LIMITS } from "@/lib/logistics/guest-judge-values";
import { PAGE_FIELDS, listQuery } from "./paging";
import { ACCESS_LABELS, type Endpoint, type EndpointGroup, type Field } from "./types";

type EndpointError = NonNullable<Endpoint["errors"]>[number];

const JUDGES_FIELD: Field = {
  name: "judges",
  type: "string[]",
  note: `every guest judge's email, up to ${BOOTCAMP_LIMITS.judges}, each in the employee list; replaces the set, and left out keeps it`,
};

const COMPLETE_ACTIVE_FIELD: Field = {
  name: "completeActive",
  type: "string",
  note: "with status active, the id of the bootcamp active now, to mark complete in the same write",
};

const FACILITY_FIELD: Field = {
  name: "facilityId",
  type: "string | null",
  note: "the facility it is held at, or null for none yet; changing it takes every room off its sessions",
};

const UNKNOWN_FACILITY_ERROR: EndpointError = {
  status: 400,
  error: "unknown_facility",
  when: "facilityId names no facility",
};

const BOOTCAMP_ID: Field = { name: "id", type: "string", required: true, note: "the bootcamp's id" };
const SESSION_ID: Field = { name: "sessionId", type: "string", required: true, note: "the session's id" };
const CHECKLIST_ITEM_ID: Field = { name: "itemId", type: "string", required: true, note: "the checklist item's id" };
const CHECKLIST_DAY_PARAMS: Field[] = [
  BOOTCAMP_ID,
  { name: "track", type: `"btc" | "int" | "btc_se" | "int_se"`, required: true, note: "the track; each keeps its own checklist" },
  { name: "day", type: "number", required: true, note: "1-based, as a session's; 0 is Prep Day, before the bootcamp starts, on btc only" },
];

const COMMENT_SHAPE = "{ id, body, authorId: string | null, authorName, authorEmail, createdAt, mentions: { email, fullName }[] }";

const TRACK_TYPE = `"btc" | "int" | "btc_se" | "int_se"`;
const KIND_TYPE = `"main" | "breakout" | "unstructured"`;
const AUDIENCE_TYPE = `"both" | "sales" | "engineers"`;
const COLOR_TYPE = `"slate" | "red" | "orange" | "amber" | "green" | "teal" | "blue" | "violet" | "pink"`;
const RECORDING_TAKE_SHAPE = `{ takeId, contributor, startedAt, durationMs: number | null, bytes: number, kinds: ("camera" | "screen")[], status: "uploading" | "assembling" | "ready" | "failed", stalled: boolean }`;
const VIDEO_FEEDBACK_SHAPE = `{ id, rating: "up" | "down", video: { kind: "mimir_concept" | "recording", id, label }, positionSeconds: number, comment: string | null, status: "pending" | "accepted" | "ignored" | "applied", user: { id, name, email } | null, createdAt }`;
const RECORDING_TRACK_SHAPE =`{ id, takeId, kind: "camera" | "screen", mimeType, startedAt, offsetMs: number, contributor, status: "uploading" | "assembling" | "ready" | "failed", chunks: number | null, durationMs: number | null, fileBytes: number | null, error: string | null, lastChunkAt: string | null, stalled: boolean }`;

const MINUTES_NOTE = `a multiple of ${SCHEDULE_LIMITS.slot} from ${SCHEDULE_LIMITS.slot} to ${SCHEDULE_LIMITS.maxMinutes}`;

const SESSION_SHAPE = `{ id, track: ${TRACK_TYPE}, day: number, start: number, minutes: number, kind, audience: ${AUDIENCE_TYPE}, typeId: string | null, name, description, emoji, color, roomId: string | null, assessmentId: string | null, staff: { email, fullName, leader: boolean, roomId: string | null }[], comments: number, largestGroup: number, assigned: string[], updatedAt }`;

const CLASH_SHAPE = `{ sessionId, name, track, day, start: number, end: number, what: { kind: "person", email, fullName } | { kind: "room", roomId } | { kind: "audience", group: "sales" | "engineers" } }`;

const GROUP_ATTENDEE_SHAPE = `{ email, fullName, title, track: "sales" | "engineer" }`;

const GROUP_SHAPE = "{ email, fullName, instructorEmail, track: string | null }";

const SESSION_TYPE_SHAPE = `{ id, name, kind: ${KIND_TYPE}, emoji, color, minutes: number, description, position: number }`;

const SESSION_LOOK_FIELDS: Field[] = [
  { name: "kind", type: KIND_TYPE, required: true, note: "main: one room; breakout: a room per instructor; unstructured: no one and no room" },
  { name: "name", type: "string", required: true, note: `up to ${SCHEDULE_LIMITS.name} characters` },
  { name: "minutes", type: "number", required: true, note: MINUTES_NOTE },
  { name: "emoji", type: "string", note: `up to ${SCHEDULE_LIMITS.emoji} characters; default none` },
  { name: "color", type: COLOR_TYPE, note: "default slate" },
  { name: "description", type: "string", note: `up to ${SCHEDULE_LIMITS.description} characters` },
];

const SESSION_STAFF_FIELDS: Field[] = [
  {
    name: "audience",
    type: AUDIENCE_TYPE,
    note: "who it is taught to; left out of a new session, engineers on an SE track and both on a class. Ignored for an unstructured session",
  },
  { name: "typeId", type: "string | null", note: "the session type it was started from" },
  { name: "roomId", type: "string | null", note: "a main session's room, from the bootcamp's facility" },
  {
    name: "assessmentId",
    type: "string | null",
    note: "a breakout's eVals assessment, of the stage its track is taught to: its instructors score their groups on it, and each finds theirs under mine on GET /api/evals/scoring/{assessmentId}. Ignored for any other kind",
  },
  {
    name: "staff",
    type: "{ email, leader?: boolean, roomId?: string | null }[]",
    note: `up to ${SCHEDULE_LIMITS.staff}, exactly one the leader; each a Training administrator or a guest judge of the bootcamp; roomId is a breakout instructor's room`,
  },
];

const SESSION_ERRORS: EndpointError[] = [
  { status: 400, error: "invalid", when: "the body is not that shape" },
  { status: 400, error: "no_leader", when: "staff is not empty and does not mark exactly one leader" },
  { status: 400, error: "not_instructor", when: "someone added is neither a Training administrator nor a guest judge of the bootcamp; email names them" },
  { status: 400, error: "unknown_room", when: "a room is not one of the bootcamp's facility's" },
  { status: 400, error: "shared_room", when: "two breakout instructors are given the same room" },
  { status: 400, error: "unknown_type", when: "typeId names no session type" },
  { status: 400, error: "unknown_assessment", when: "assessmentId names no assessment, or one of the other stage" },
  { status: 404, error: "not_found", when: "no such bootcamp or session" },
  { status: 409, error: "clash", when: "someone or a room added is in another session at the same time; clashes says which" },
];

const FILL_ERRORS: EndpointError[] = [
  { status: 404, error: "not_found", when: "no such bootcamp" },
  { status: 409, error: "has_sessions", when: "it has a schedule already and replace is not true" },
];

const NOT_EMPLOYEE_ERROR: EndpointError = {
  status: 400,
  error: "not_employee",
  when: "a judge is not at Harness, in the employee list; email names them",
};

const ACTIVE_EXISTS_ERROR: EndpointError = {
  status: 409,
  error: "active_exists",
  when: "status is active, another bootcamp already is, and completeActive does not name it; active names it",
};

const SURVEY_DAY_SHAPE = `{ stage: "bootcamp" | "intermediate", day: number, audiences: ("sales" | "engineer")[], assigned: number, answered: number }`;
const SURVEY_SESSION_SHAPE = `{ id, track: ${TRACK_TYPE}, name, emoji, start: number, minutes: number }`;
const MY_SURVEY_SHAPE = `{ id, stage: "bootcamp" | "intermediate", audience: "sales" | "engineer", day: number, date, sessions: ${SURVEY_SESSION_SHAPE}[], answers: { sessions: Record<string, { rating: number, feedback }>, dayRating: number, dayChange } | null, submittedAt: string | null }`;
const SURVEY_CARD_SHAPE = `{ id, bootcampId, startDate, stage: "bootcamp" | "intermediate", audience: "sales" | "engineer", day: number, date, sessions: number, assigned: number, responses: number, average: number }`;
const SURVEY_RESULT_SHAPE = `{ id, bootcampId, startDate, stage, audience, day: number, date, assigned: number, responses: number, average: number | null, sessions: (${SURVEY_SESSION_SHAPE} & { average: number | null, ratings: number, comments: number })[] }`;

const INTAKE_QUESTION_SHAPE = `{ id, kind: "short" | "paragraph" | "choice" | "checkboxes" | "dropdown", title, description, required: boolean, options: string[], other: boolean }`;

const INTAKE_FORM_FIELDS: Field[] = [
  {
    name: "introduction",
    type: "string",
    note: `up to ${INTAKE_LIMITS.introduction} characters, shown above the first question with its line breaks kept; left out, none`,
  },
  {
    name: "questions",
    type: `${INTAKE_QUESTION_SHAPE}[]`,
    required: true,
    note: `0 to ${INTAKE_LIMITS.questions}, in the order asked, each id distinct; with none, nobody is asked the form or reminded of it. A question's title is up to ${INTAKE_LIMITS.title} characters and its description up to ${INTAKE_LIMITS.description}. A choice, checkboxes or dropdown question needs 1 to ${INTAKE_LIMITS.options} distinct options of up to ${INTAKE_LIMITS.option} characters; other adds a free-text "Other" to choice and checkboxes, and is ignored on the rest`,
  },
];

const INTAKE_FORM_PARAM: Field = {
  name: "form",
  type: '"bootcamp" | "intermediate"',
  required: true,
  note: "Pre-Bootcamp or Pre-Intermediate",
};


const FOOD_ORDER_SHAPE = "{ id, vendor, arrivesAt, needs, fileName: string | null, fileBytes: number | null, arrived: boolean, updatedAt }";

const FOOD_ORDER_FIELDS: Field[] = [
  { name: "vendor", type: "string", required: true, note: `who it is from, up to ${FOOD_ORDER_LIMITS.vendor} characters` },
  { name: "arrivesAt", type: "string", required: true, note: "when it arrives, an ISO 8601 date and time with an offset" },
  { name: "needs", type: "string", note: `what the training team needs from it, up to ${FOOD_ORDER_LIMITS.needs} characters; one thing a line prints as a checklist` },
  { name: "file", type: "File", note: `the vendor's PDF, under ${FOOD_ORDER_LIMITS.bytes / (1024 * 1024)} MB` },
];

const FOOD_ORDER_FORM_ERRORS: EndpointError[] = [
  { status: 400, error: "invalid", when: "vendor or arrivesAt is missing or malformed" },
  { status: 413, error: "too_large", when: `the file is ${FOOD_ORDER_LIMITS.bytes / (1024 * 1024)} MB or more` },
  { status: 415, error: "not_pdf", when: "the file is not a PDF" },
];

export const ADMIN_GROUPS: EndpointGroup[] = [
  {
    id: "users",
    title: "Users and invites",
    endpoints: [
      {
        method: "GET",
        path: "/api/users",
        summary: "Lists accounts a page at a time, as the Users page shows them.",
        access: "userAdmin",
        token: true,
        notes:
          "Test accounts come first, then everyone else, each in the order asked for. pendingAdmins lists the SITE_ADMIN_EMAILS addresses that have not signed in yet, whichever page is asked for.",
        query: listQuery(USER_LIST.sorts, "the name or email"),
        returns: `{ users: { id, name, email, eventRole, trainingRole, assessmentsRole, isPlatformAdmin, isBootstrapAdmin, isTestAccount, eventCount }[], ${PAGE_FIELDS}, pendingAdmins: string[] }`,
      },
      {
        method: "PATCH",
        path: "/api/users/{id}",
        summary: "Sets one of a user's roles, or their platform administrator flag.",
        access: "userAdmin",
        token: false,
        notes:
          "Any area's administrator passes the gate, but may set only that area's role; setting `platform` needs a platform administrator. Nobody changes their own roles. Only a platform administrator may change anything on another platform administrator. Platform administration cannot be removed from someone listed in SITE_ADMIN_EMAILS, since sign-in would grant it back.",
        params: [{ name: "id", type: "string", required: true, note: "the user's id" }],
        body: {
          kind: "json",
          fields: [
            {
              name: "area",
              type: `"event" | "training" | "assessments" | "platform"`,
              required: true,
              note: "picks which of the fields below applies",
            },
            {
              name: "role",
              type: `"none" | "contributor" | "operator" | "manager" | "administrator"`,
              note: "required when area is event",
            },
            {
              name: "role",
              type: `"viewer" | "administrator" | null`,
              note: "required when area is training or assessments; null removes access. The assessments role covers Diagnostic too: a viewer takes it, an administrator runs it.",
            },
            { name: "value", type: "boolean", note: "required when area is platform" },
          ],
        },
        returns: "{ ok: true, area, role } or { ok: true, area: \"platform\", value }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body does not match one of the four shapes" },
          { status: 403, error: "forbidden", when: "you do not administer that area" },
          { status: 403, error: "platform_target", when: "the target is a platform administrator and you are not" },
          { status: 404, error: "not_found", when: "no such user" },
          { status: 409, error: "self", when: "the target is you" },
          { status: 409, error: "bootstrap", when: "removing platform administration from a SITE_ADMIN_EMAILS address" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/users/{id}",
        summary: "Deletes an account.",
        access: "platform",
        token: false,
        notes:
          "Removes the account, its sessions and its own settings. What they authored stays, unattributed. Irreversible. Refused while the user owns any event, because events are torn down through the event, not by deleting a person.",
        params: [{ name: "id", type: "string", required: true, note: "the user's id" }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "no such user" },
          { status: 409, error: "self", when: "the target is you" },
          { status: 409, error: "bootstrap", when: "the user is in SITE_ADMIN_EMAILS, so sign-in would recreate them" },
          { status: 409, error: "owns_events", when: "the user owns one or more events" },
        ],
      },
      {
        method: "POST",
        path: "/api/users/invites",
        summary: "Creates an invite link that grants roles to whoever follows it.",
        access: "userAdmin",
        token: false,
        notes:
          "You may grant only roles in areas you administer. The link works for anyone, any number of times, for 15 minutes. It never grants platform administration. It is checked again on use, so it stops working if you lose the role.",
        body: {
          kind: "json",
          fields: [
            {
              name: "eventRole",
              type: `"none" | "contributor" | "operator" | "manager" | "administrator" | null`,
              required: true,
              note: `null or "none" grants no event access`,
            },
            {
              name: "trainingRole",
              type: `"viewer" | "administrator" | null`,
              required: true,
            },
            {
              name: "assessmentsRole",
              type: `"viewer" | "administrator" | null`,
              note: "defaults to null",
            },
          ],
        },
        returns: "201 { path: \"/invite/{token}\", expiresAt: ISO 8601 string }",
        errors: [
          { status: 400, error: "invalid_body", when: "the body does not parse" },
          { status: 400, error: "empty", when: "the link would grant nothing" },
          { status: 403, error: "forbidden", when: "it grants a role in an area you do not administer" },
        ],
      },
      {
        method: "POST",
        path: "/api/invites/accept",
        summary: "Takes up an invite link as the signed-in user.",
        access: "signedIn",
        token: false,
        notes:
          "The roles apply only if you have no access in any area; anyone who already has access is left as they are and gets applied: false.",
        body: {
          kind: "json",
          fields: [
            { name: "token", type: "string", required: true, note: "the token from the invite path; 1–200 characters" },
          ],
        },
        returns: "{ applied: boolean, home: string }",
        errors: [
          { status: 400, error: "invalid_body", when: "token is missing or too long" },
          { status: 404, error: "not_found", when: "no such link" },
          { status: 410, error: "expired", when: "the link is past its 15 minutes" },
          { status: 410, error: "revoked", when: "its creator no longer administers an area it grants" },
        ],
      },
      {
        method: "GET",
        path: "/api/users/test-accounts",
        summary: "Finds test accounts to view the app as, by name or address.",
        access: "platform",
        token: true,
        notes:
          "A test account is an account made to test the app as, outside production. Viewing as one (POST /api/me/impersonation with its email), changes go through, except on session-only routes. suggestedName is a famous film or television character's name that no account has yet, for a new one to start with; it is null once all 100 are taken, and on production. On production enabled is false and testAccounts is always empty. At most 8 are returned.",
        query: [
          { name: "q", type: "string", note: "matched against the name and the address; empty matches every one" },
          { name: "skip", type: "string", note: "a name suggestedName must not be, to ask for a different one" },
        ],
        returns: "{ enabled: boolean, testAccounts: { id, name, email }[], suggestedName: string | null }",
      },
      {
        method: "POST",
        path: "/api/users/test-accounts",
        summary: "Makes a test account, with no roles or as a copy of an employee's account.",
        access: "platform",
        token: false,
        notes:
          "Its address is generated on test-account.invalid, which no Google account can have, so nobody can sign in as it. With copyFrom it starts with the roles in each area, theme and calendar settings, and Diagnostic track of the account with that address, copied once; an employee who has never signed in has no account, so it starts with no roles, as they would. Their Diagnostic sittings, Mimir progress and Harness credentials are not copied, nor being a manager or a guest judge, which follow from their own address. Change its roles afterwards with PATCH /api/users/{id}, and delete it with DELETE /api/users/{id}.",
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: "1–80 characters" },
            { name: "copyFrom", type: "string", note: "the email of an employee, from GET /api/evals/employees, or of any account; not a platform administrator" },
          ],
        },
        returns: "201 { testAccount: { id, name, email } }",
        errors: [
          { status: 400, error: "invalid_body", when: "name is missing or longer than 80 characters, or copyFrom is blank" },
          { status: 400, error: "invalid", when: "name is blank" },
          { status: 404, error: "source_not_found", when: "neither an employee nor an account has the copyFrom address" },
          { status: 409, error: "platform_source", when: "the copyFrom account is a platform administrator" },
          { status: 409, error: "production", when: "this deployment is production" },
        ],
      },
      {
        method: "POST",
        path: "/api/users/test-accounts/{id}/reset",
        summary: "Gives a test account a fresh start.",
        access: "platform",
        token: false,
        notes:
          "Everything that is the account's own goes, as if it were deleted, Diagnostic sittings and track included, and it comes back with the same id, name, address and roles. What it authored elsewhere stays, unattributed.",
        params: [{ name: "id", type: "string", required: true, note: "the test account's id" }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "no test account has that id; a real account is never reset" },
          { status: 409, error: "owns_events", when: "the account owns one or more events" },
          { status: 409, error: "production", when: "this deployment is production" },
        ],
      },
    ],
  },
  {
    id: "cohorts",
    title: "Cohorts",
    endpoints: [
      {
        method: "GET",
        path: "/api/cohorts/current",
        summary: "Lists the org members still to train — bootcamp and intermediate candidates — narrowed to a stage and a track, a page at a time. The deferred are left out; GET /api/cohorts/deferred lists them.",
        access: "trainingViewer",
        token: true,
        notes:
          "A bootcamp candidate is anyone under the Organization Leader, on the sales, engineer or deferred track or on none, who has attended no BTC; an intermediate candidate has attended a BTC and no INT. Someone attended a class when they were assessed in it at a bootcamp whose class has since been released (POST /api/reporting/bootcamp/release). Either must also pass the date cutoffs in GET /api/evals/candidate-cutoffs, which cutoffs echoes. The ignored and exempt tracks are left out. A track is, first, one an administrator set by hand with PUT /api/cohorts/current/track, which overridden marks, exempt among them; then ignored for a title on the Ignored list; then deferred when their HiBob start date is fewer than deferral.days before deferral.bootcampStart, or after it; then the Sales or Engineer list their title is on. undecided is a title on no list. members never includes anyone deferred, and track cannot ask for them; they are on GET /api/cohorts/deferred. deferral echoes GET /api/evals/deferral-days. counts gives each stage on each track, deferred included; each stage's counts ignore the track filter, each track's ignore the stage filter, and neither depends on the search. activeBootcamp is the one active bootcamp, or null. No scores are returned, to anyone; GET /api/reporting/bootcamp/people/{key} and the eVals routes have them. meetings lists where each member stands with each Google meeting picked for their stage and track (GET /api/evals/google-meetings): attended, by Zoom or an administrator's mark; accepted or pending on the invite they hold, startsAt and endsAt being when it runs; uninvited until the next sync invites them, startsAt and endsAt then being the occurrence it would pick, as the sync picks it, with predicted true (null on a meeting with nothing to offer yet); or none_left with no occurrence left in their window: before the active bootcamp, or, for an Intermediate meeting they will take after it, from the day after its last day to the next intermediate class. marked is an administrator's mark, or null when Zoom decides. timezone is the member's own, or null when the app has none. outOfHours is true when that occurrence is still to come and, in their time zone, starts before 9:00, ends after 17:00 or ends on a later day; it is false for anyone with no time zone. instances is null unless the meeting invites to every occurrence; then it lists, soonest first, each occurrence they hold an invite to, attended or missed once Zoom has been read and accepted or pending before, and each the next sync would add them to, uninvited, and outOfHours is true when any of them is. recordKey is the key of their page on GET /api/reporting/bootcamp/people/{key} once they have attended a BTC, and null before. btcDate is the day of the latest BTC they attended.",
        query: [
          { name: "stage", type: `"bootcamp" | "intermediate"`, note: "only that stage; both if omitted" },
          { name: "track", type: `"sales" | "engineer" | "undecided"`, note: "only that track; all three if omitted" },
          ...listQuery(CURRENT_COHORT_LIST.sorts, "the name, email, title or track"),
        ],
        returns: `{ stage: string | null, track: string | null, members: { email, fullName, title, department, site, reportsToEmail, reportsToName, startDate: "YYYY-MM-DD" | null, activeEffectiveDate: "YYYY-MM-DD" | null, track: "sales" | "engineer" | "undecided", overridden: boolean, stage: "bootcamp" | "intermediate", recordKey: string | null, btcDate: "YYYY-MM-DD" | null, meetings: { meetingId, name, mark: "attended" | "accepted" | "pending" | "uninvited" | "none_left", marked: boolean | null, startsAt: ISO 8601 string | null, endsAt: ISO 8601 string | null, predicted: boolean, timezone: string | null, outOfHours: boolean, instances: { startsAt: ISO 8601 string, endsAt: ISO 8601 string, mark: "attended" | "missed" | "accepted" | "pending" | "uninvited", outOfHours: boolean }[] | null }[] }[], ${PAGE_FIELDS}, counts: Record<"bootcamp" | "intermediate", { sales: number, engineer: number, undecided: number, deferred: number }>, syncedAt: ISO 8601 string | null, cutoffs: { startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }, deferral: { days: number, bootcampStart: "YYYY-MM-DD" | null }, activeBootcamp: { id, startDate, btcDays, intDays } | null }`,
        errors: [
          { status: 400, error: "invalid_stage", when: "stage is neither bootcamp nor intermediate" },
          { status: 400, error: "invalid_track", when: "track is not sales, engineer or undecided" },
        ],
      },
      {
        method: "GET",
        path: "/api/cohorts/deferred",
        summary: "Lists the bootcamp and intermediate candidates on the deferred track, narrowed to a stage, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "A candidate is drawn as for GET /api/cohorts/current, which says who is deferred: their HiBob start date is fewer than deferral.days before deferral.bootcampStart, or after it, or an administrator deferred them with PUT /api/cohorts/current/track, which overridden marks. Any other track takes them off this list and onto GET /api/cohorts/current. counts gives how many are deferred in each stage, whatever the stage filter or the search. deferral echoes GET /api/evals/deferral-days; bootcampStart is the active bootcamp's start, or else the next scheduled one's, or null when there is neither, when no one is deferred by the rule. activeBootcamp is the one active bootcamp, or null. No scores are returned, to anyone.",
        query: [
          { name: "stage", type: `"bootcamp" | "intermediate"`, note: "only that stage; both if omitted" },
          ...listQuery(CURRENT_COHORT_LIST.sorts, "the name, email, title or track"),
        ],
        returns: `{ stage: string | null, members: { email, fullName, title, department, site, reportsToEmail, reportsToName, startDate: "YYYY-MM-DD" | null, activeEffectiveDate: "YYYY-MM-DD" | null, track: "deferred", overridden: boolean, stage: "bootcamp" | "intermediate", recordKey: string | null, btcDate: "YYYY-MM-DD" | null }[], ${PAGE_FIELDS}, counts: { bootcamp: number, intermediate: number }, syncedAt: ISO 8601 string | null, cutoffs: { startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }, deferral: { days: number, bootcampStart: "YYYY-MM-DD" | null }, activeBootcamp: { id, startDate, btcDays, intDays } | null }`,
        errors: [{ status: 400, error: "invalid_stage", when: "stage is neither bootcamp nor intermediate" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/previous",
        summary: "Lists each day BTC or INT was held, with how many people attended each, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "A day is a session when it is the start of a bootcamp whose BTC or INT class has been released and someone was assessed in it. bootcamp and intermediate count the people assessed in each class. total and first count every session, whatever page is asked for; first is null when there are none.",
        query: listQuery(PREVIOUS_SESSION_LIST.sorts, "nothing", "desc").filter((f) => f.name !== "q"),
        returns: `{ sessions: { date: "YYYY-MM-DD", bootcamp: number, intermediate: number }[], ${PAGE_FIELDS}, total: number, first: "YYYY-MM-DD" | null }`,
      },
      {
        method: "GET",
        path: "/api/cohorts/previous/{date}",
        summary: "Lists who attended BTC and who attended INT on one day, each side a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "Each side is ordered by name, from the employee list, with anyone it has no name for last by email; fullName is null for them. active is false for anyone the last HiBob sync did not send: someone who has left, or whom HiBob never sent. key addresses their page, for GET /api/reporting/bootcamp/people/{key}.",
        params: [{ name: "date", type: "string", required: true, note: "YYYY-MM-DD" }],
        query: [
          { name: "bootcamp.page", type: "integer", note: `The bootcamp side's page, from 1. Default 1. A page holds at most ${PAGE_SIZE}.` },
          { name: "intermediate.page", type: "integer", note: `The intermediate side's page, the same way.` },
        ],
        returns: `{ date: "YYYY-MM-DD", bootcamp: { rows: { key, email, fullName: string | null, active: boolean }[], ${PAGE_FIELDS} }, intermediate: the same }`,
        errors: [
          { status: 400, error: "invalid_date", when: "date is not a real YYYY-MM-DD day" },
          { status: 404, error: "not_found", when: "no released class was held that day" },
        ],
      },
      {
        method: "PUT",
        path: "/api/cohorts/current/track",
        summary: "Sets one org member's track by hand; sales, engineer and ignored put their title on that list.",
        access: "trainingAdmin",
        token: true,
        notes:
          "sales, engineer and ignored put the person's title on that list, moving it off another list if it is on one, and re-track everyone in the org who holds it, compared as the lists compare titles; title says where it went, and is null when it was on that list already or the person has no title. Anyone else with the title whose track was set by hand keeps it. The person is also pinned to the choice where the rules still give them something else, such as a late start, and always when they have no title. undecided, deferred and exempt pin just this person; deferred moves them from the Current tab to the Deferred tab. A pin holds through every later sync, title-list change and bootcamp change, until automatic hands the person back to the rules. ignored and exempt take people off the Current tab. track in the response is the one the person has now, overridden whether they are pinned, and retracked how many people's tracks changed, the person included.",
        body: {
          kind: "json",
          fields: [
            { name: "email", type: "string", required: true, note: "anyone under the Organization Leader" },
            {
              name: "track",
              type: `"sales" | "engineer" | "undecided" | "deferred" | "ignored" | "exempt" | "automatic"`,
              required: true,
            },
          ],
        },
        returns: `{ email, track: "sales" | "engineer" | "deferred" | "ignored" | "exempt" | null, overridden: boolean, title: { title: string, list: "sales" | "engineer" | "ignored", from: "sales" | "engineer" | "ignored" | null } | null, retracked: number }`,
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 404, error: "not_found", when: "no one under the Organization Leader has that email" },
        ],
      },
      {
        method: "POST",
        path: "/api/cohorts/current/track",
        summary: "Decides an undecided candidate's track by putting their title on the Sales, Engineer or Ignored list.",
        access: "trainingAdmin",
        token: true,
        notes:
          "The Current tab uses PUT instead, which also moves a title that is already on another list. Everyone in the org who holds the same title, compared as the lists compare titles, has their track reset at once rather than at the next sync; on the ignored list, they leave the Current tab. A title already on a list stays where it is, and that list decides.",
        body: {
          kind: "json",
          fields: [
            { name: "email", type: "string", required: true, note: "the candidate's" },
            { name: "list", type: `"sales" | "engineer" | "ignored"`, required: true },
          ],
        },
        returns: `{ title: string, list: "sales" | "engineer" | "ignored", added: boolean, retracked: number }`,
        errors: [
          { status: 400, error: "invalid", when: "the body is not one of those shapes" },
          { status: 400, error: "no_title", when: "HiBob gives the person no title to put on a list" },
          { status: 404, error: "not_found", when: "no one under the Organization Leader has that email" },
          { status: 409, error: "not_undecided", when: "the person already has a track" },
        ],
      },
      {
        method: "GET",
        path: "/api/cohorts/channel-contacts",
        summary: "Lists one kind of Additional Channel Contact, a page at a time.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Bootcamp Contacts (kind sales) are added to the active bootcamp's sales- Slack channels and Engineer Contacts (kind se) to its se- ones, beside the cohort. fullName is their name in the employee list now, and empty only if it has none. total counts every contact of that kind, whatever the search.",
        query: [
          { name: "kind", type: `"sales" | "se"`, required: true, note: "which list" },
          ...listQuery(CHANNEL_CONTACT_LIST.sorts, "the name, the email or who added them"),
        ],
        returns: `{ contacts: { id, kind: "sales" | "se", email, fullName, createdAt, addedBy: string | null }[], ${PAGE_FIELDS}, total: number }`,
        errors: [{ status: 400, error: "invalid", when: "kind is missing or not sales or se" }],
      },
      {
        method: "POST",
        path: "/api/cohorts/channel-contacts",
        summary: "Adds one Additional Channel Contact.",
        access: "trainingAdmin",
        token: true,
        notes:
          "The email is lowercased and must belong to someone at Harness, in the employee list from the last HiBob sync: anyone the app reaches in Slack is in HiBob. fullName is their name there. The next Slack sync invites them.",
        body: {
          kind: "json",
          fields: [
            { name: "kind", type: `"sales" | "se"`, required: true, note: "sales for a Bootcamp Contact, se for an Engineer Contact" },
            { name: "email", type: "string", required: true, note: "up to 320 characters" },
          ],
        },
        returns: `{ id, kind: "sales" | "se", email, fullName }`,
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or email is not an email address" },
          { status: 400, error: "not_employee", when: "nobody at Harness in the employee list has that email" },
          { status: 409, error: "duplicate", when: "that email is already a contact of that kind" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/cohorts/channel-contacts/{id}",
        summary: "Removes one Additional Channel Contact.",
        access: "trainingAdmin",
        token: true,
        notes: "If the Slack sync invited them as a contact, its next run removes them from those channels unless they still belong there.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such contact" }],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings",
        summary: "Lists the meetings picked from the Revenue Enablement calendar, a page at a time, with the connected accounts and the sync's state.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "A picked meeting is a name on the calendar, matched to its events whatever their case or spacing, and whom in the Cohorts page's Current tab it is for: a stage (bootcamp or intermediate) and a track (sales, engineer or both), and optionally a range of UTC offsets, timezoneFrom to timezoneTo in whole hours (both null for every time zone), and minDaysAfterStart, how many days after a person's start date the meeting suits them: the sync invites each person to the first occurrence in their window on or after their start date plus that many days, or to the last one in it when none is. A person's window is before the active bootcamp starts. An intermediate meeting is also for bootcamp candidates who have RSVP'd to the active bootcamp (saved its intake form), and for intermediate candidates whose latest BTC is the active bootcamp's; their window runs from the day after the bootcamp's last day (its start plus the longer of its BTC and INT days) until the next scheduled bootcamp with an intermediate class starts, with no end when none is scheduled. allOccurrences false invites each person to one occurrence, and to the next one only after they miss it; true invites them to that first occurrence and every one after it in their window, until they attend. syncedAt is when a live sync last read its events, or null before one has; nextStartsAt, upcoming, invited and attended are as of that sync: when the next occurrence starts, how many are still to start, how many of the cohort are on one still to start, and how many attended one, by Zoom or by an administrator's mark. connection and zoom.connection are null until each is connected, and never include a token. administrators are the Assessments Administrators, added to every occurrence a cohort member is on. live says whether a sync changes the calendar (PUT /api/evals/google-meetings/settings). testGroup is the Cohorts page's test group (GET /api/cohorts/test-group). cutoff is the active bootcamp's start date, before which each person is invited, or null with none active. legacyMeetings counts the old create-a-meeting invites the next live sync cancels. meetingCount is every picked meeting, whatever the search.",
        query: listQuery(MEETING_SELECTION_LIST.sorts, "the name"),
        returns: `{ meetings: { id, name, stage: "bootcamp" | "intermediate", track: "sales" | "engineer" | "both", timezoneFrom: number | null, timezoneTo: number | null, minDaysAfterStart: number, allOccurrences: boolean, syncedAt: string | null, nextStartsAt: string | null, upcoming: number, invited: number, attended: number, addedBy: string | null, createdAt }[], ${PAGE_FIELDS}, connection: { email, connectedAt, connectedBy: string | null } | null, zoom: { configured: boolean, connection: { email, connectedAt, connectedBy: string | null } | null }, administrators: string[], live: boolean, running: boolean, testGroup: { on: boolean, suffix: string, members: number }, cutoff: "YYYY-MM-DD" | null, lastLiveSync: { finishedAt, status: "running" | "succeeded" | "skipped" | "failed", error: string | null } | null, legacyMeetings: number, meetingCount: number }`,
      },
      {
        method: "POST",
        path: "/api/evals/google-meetings",
        summary: "Picks a meeting from the Revenue Enablement calendar, for a stage and a track. Nothing is sent until a sync.",
        access: "assessmentsAdmin",
        token: true,
        notes: "name need not be on the calendar now; GET /api/evals/google-meetings/calendar lists the names that are. A name already picked, in any case or spacing, is refused. With a time zone range, only people whose time zone on record has a UTC offset inside it today (half hours round toward the east) are invited; anyone with no time zone on record is left out.",
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: `1 to ${MEETING_SELECTION_LIMITS.name} characters; trimmed, with runs of spaces made one` },
            { name: "stage", type: `"bootcamp" | "intermediate"`, required: true },
            { name: "track", type: `"sales" | "engineer" | "both"`, required: true },
            { name: "timezoneFrom", type: "integer | null", note: "-12 to 14: the first UTC offset, in whole hours, the meeting covers; give it with timezoneTo, or both null (the default) for every time zone" },
            { name: "timezoneTo", type: "integer | null", note: "-12 to 14; before timezoneFrom it runs the long way round, so 9 to -6 covers +9 east through the date line to -6" },
            { name: "minDaysAfterStart", type: "integer", note: "0 to 365, 0 by default: the days after a person's start date before an occurrence suits them; when none left in their window does, they are invited to the last one" },
            { name: "allOccurrences", type: "boolean", note: "false by default: one occurrence at a time; true for every occurrence in their window from the first that suits them" },
          ],
        },
        returns: "{ id, name }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or a field is out of range" },
          { status: 409, error: "duplicate", when: "that name is picked already" },
        ],
      },
      {
        method: "PATCH",
        path: "/api/evals/google-meetings/{id}",
        summary: "Changes a picked meeting's name, stage or track.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        notes:
          "Any field left out is kept. A new name first takes everyone the sync invited to the old name's upcoming occurrences off them, without emailing them, and forgets its occurrences; the next sync reads the new name's. A new stage, track or time zone range changes nothing until the next sync, which takes off anyone the meeting is no longer for. Allows 60 seconds.",
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", note: `1 to ${MEETING_SELECTION_LIMITS.name} characters; trimmed, with runs of spaces made one` },
            { name: "stage", type: `"bootcamp" | "intermediate"` },
            { name: "track", type: `"sales" | "engineer" | "both"` },
            { name: "timezoneFrom", type: "integer | null", note: "-12 to 14; send it with timezoneTo, and null for both to cover every time zone again" },
            { name: "timezoneTo", type: "integer | null", note: "-12 to 14; before timezoneFrom it runs the long way round, so 9 to -6 covers +9 east through the date line to -6" },
            { name: "minDaysAfterStart", type: "integer", note: "0 to 365: the days after a person's start date before an occurrence suits them" },
            { name: "allOccurrences", type: "boolean", note: "true for every occurrence in their window, false for one at a time" },
          ],
        },
        returns: "{ id, name }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or a field is out of range" },
          { status: 404, error: "not_found", when: "id is not a UUID, or no such meeting" },
          { status: 409, error: "duplicate", when: "the new name is picked already" },
          { status: 409, error: "running", when: "the name changes while a sync is under way" },
          { status: 409, error: "not_connected", when: "the name changes, there are invites to take back, and no working Google account is connected; detail says why" },
          { status: 502, error: "remote_failed", when: "Google refused to take an invite back; detail has its answer" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/evals/google-meetings/{id}",
        summary: "Deletes a picked meeting, first taking everyone the sync invited off its upcoming occurrences.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        notes:
          "Only guests the sync added are taken off, and no one is emailed; the calendar's events themselves stay, as do guests put there by hand. events counts the occurrences changed. Its attendance and marks go with it. Allows 60 seconds.",
        returns: "{ ok: true, events: number }",
        errors: [
          { status: 404, error: "not_found", when: "id is not a UUID, or no such meeting" },
          { status: 409, error: "running", when: "a sync is under way" },
          { status: 409, error: "not_connected", when: "there are invites to take back and no working Google account is connected; detail says why" },
          { status: 502, error: "remote_failed", when: "Google refused to take an invite back; detail has its answer" },
        ],
      },
      {
        method: "PUT",
        path: "/api/evals/google-meetings/{id}/attendance",
        summary: "Marks one person attended or missed for a picked meeting, over what Zoom said, or clears the mark.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        notes:
          "attended true counts them as done with the meeting: the next sync takes them off any upcoming occurrence of it. false counts every occurrence of it they were on that has begun as missed, so the next sync invites them to the next one in their window. null goes back to what Zoom says. The Current tab shows the result beside their name.",
        body: {
          kind: "json",
          fields: [
            { name: "email", type: "string", required: true, note: "lowercased" },
            { name: "attended", type: "boolean | null", required: true },
          ],
        },
        returns: "{ ok: true, email, attended: boolean | null }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse" },
          { status: 404, error: "not_found", when: "id is not a UUID, or no such meeting" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/timezones",
        summary: "The people a stage and track cover, by UTC offset, for choosing a meeting's time zone range.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Counts the Current tab's Sales and Engineer candidates in that stage and on that track, by the whole-hour UTC offset their time zone on record has at `at` (default now); half hours round toward the east. people has their names under the same offsets, sorted by name. unknown is those with no time zone on record, who a time zone range leaves out.",
        query: [
          { name: "stage", type: `"bootcamp" | "intermediate"`, required: true },
          { name: "track", type: `"sales" | "engineer" | "both"`, required: true },
          { name: "at", type: "ISO 8601 timestamp", note: "when to read each time zone's UTC offset, which daylight saving moves; the picked meeting's start. Default: now" },
        ],
        returns: "{ byHour: { [offset: string]: number }, people: { [offset: string]: string[] }, unknown: number, total: number }",
        errors: [{ status: 400, error: "invalid", when: "stage or track is missing or not one of the values" }],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/calendar",
        summary: "The names of the meetings on the Revenue Enablement calendar in the next 60 days, each once, to pick from.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Read as the connected Google account. Names that differ only in case or spacing are one. next is when the first of them starts; occurrences counts them in the 60 days. Sorted by name.",
        returns: "{ names: { name, next, occurrences: number }[] }",
        errors: [
          { status: 409, error: "not_connected", when: "no Google account is connected" },
          { status: 409, error: "not_configured", when: "AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET is unset" },
          { status: 409, error: "revoked", when: "Google no longer accepts the account's token; connect it again" },
          { status: 502, error: "google_error", when: "Google refused, such as an account that cannot see the calendar; detail has its answer" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/settings",
        summary: "Whether the Google Meetings sync is live or a dry run.",
        access: "assessmentsAdmin",
        token: true,
        returns: "{ live: boolean }",
      },
      {
        method: "PUT",
        path: "/api/evals/google-meetings/settings",
        summary: "Turns the Google Meetings sync live, or back to a dry run.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Off until an administrator turns it on. A dry run reads the calendar and Zoom and logs whom it would invite and take off, but changes nothing. QA shares production's Google Workspace, so it stays off there.",
        body: { kind: "json", fields: [{ name: "live", type: "boolean", required: true }] },
        returns: "{ live: boolean }",
        errors: [{ status: 400, error: "invalid", when: "the body does not parse" }],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/sync",
        summary: "Lists the Google Meetings sync's log a page at a time, newest first.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "A run is skipped when it had nothing to do, with error saying why. dryRun marks a run that changed nothing, testGroup one that invited the test group in place of the cohort. unfinished marks a run that stopped at its deadline before every meeting was done; the next picks up the rest. running says whether a run is under way now, live whether a run started now would change the calendar.",
        query: listQuery(MEETING_SYNC_LIST.sorts, "who started it, the status or the error"),
        returns: `{ runs: { id, trigger: "schedule" | "manual", triggeredBy: string | null, status: "running" | "succeeded" | "skipped" | "failed", dryRun: boolean, testGroup: boolean, startedAt, finishedAt: string | null, invited, removed, attended, missed, noneLeft, failures: number, unfinished: boolean, error: string | null, notes: string[] }[], ${PAGE_FIELDS}, running: boolean, live: boolean }`,
      },
      {
        method: "POST",
        path: "/api/evals/google-meetings/sync",
        summary: "Syncs every picked meeting with the Revenue Enablement calendar: reads who attended, and invites the cohort.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Runs as the connected Google account, in one logged run. It reads the calendar's next 60 days and stores each event of each picked meeting's name as an occurrence, with its guests' replies and the Zoom meeting in its link. For each occurrence over for half an hour whose attendance is not known, it asks the connected Zoom user's past-meeting report who joined, matching by email and then by full name; one with no Zoom link, or no Zoom user connected, waits for an administrator's mark (PUT /api/evals/google-meetings/{id}/attendance). Then each person on the Current tab a meeting is for is invited to its next occurrence in their window (as GET /api/evals/google-meetings describes: before the active bootcamp, or after it for an intermediate meeting's RSVP'd bootcamp candidates and the bootcamp's own graduates); anyone who missed theirs is invited to the next one after it, and anyone with none left is logged as none_left and not invited. A meeting with allOccurrences invites them to every occurrence in their window from the first that suits them. Anyone holding more invites than the meeting's setting allows is taken off the extra ones. Someone who attended is taken off any later occurrence, as is anyone the meeting is no longer for. Every Assessments Administrator is added to each occurrence a cohort member is on. The sync takes off only guests it added; an invite already right is left alone. Every change is sent to Google with sendUpdates=none, so no guest is emailed about an invite, a removal or a cancellation. With the test group on, its members stand in for the cohort and no administrators are added. The first live run also cancels, once, the upcoming invites and Zoom meetings the old create-a-meeting flow made. With preview, or while the sync is not live, it is a dry run that logs what it would do. The run's changes are on GET /api/evals/google-meetings/sync/{id}. Allows 300 seconds.",
        body: { kind: "json", fields: [{ name: "preview", type: "boolean", note: "a dry run whether or not the sync is live; an empty body is a sync" }] },
        returns:
          '{ ok: true, runId, status: "succeeded" | "skipped", dryRun: boolean, testGroup: boolean, unfinished: boolean, notes: string[], invited, removed, attended, missed, noneLeft, failures: number }',
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse" },
          { status: 409, error: "already_running", when: "another sync is under way" },
          { status: 409, error: "not_connected", when: "no Google account is connected; runId names the failed run" },
          { status: 409, error: "not_configured", when: "AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET is unset" },
          { status: 409, error: "revoked", when: "Google no longer accepts the account's token; connect it again" },
          { status: 502, error: "google_error", when: "Google refused before any meeting was synced; detail has its answer" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/sync/{id}",
        summary: "One Google Meetings sync run, how many of its changes are of each kind, and a page of them.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "One change per person invited to or taken off an occurrence (invited, removed), per attendance read (attended, missed), per person with no occurrence left in their window (none_left), per old invite cancelled (cancelled), and per call Google or Zoom refused (failed, with their answer in detail). occurrenceStartsAt is the occurrence it was about, or null. In a dry run each says what would have happened. fullName is the employee list's name for the email now, or null. counts is by kind, whatever the search.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        query: [
          { name: "kind", type: '"invites" | "attendance" | "problems"', note: "only invites sent, taken back or cancelled; only attendance read; or only refusals and people with none left. Every change if left out" },
          ...listQuery(MEETING_SYNC_CHANGE_LIST.sorts, "the meeting, the action, the email, the name or the detail"),
        ],
        returns: `{ run: <as in GET /api/evals/google-meetings/sync>, counts: { all, invites, attendance, problems: number }, changes: { id, meetingName, occurrenceStartsAt: string | null, action: "invited" | "removed" | "attended" | "missed" | "none_left" | "cancelled" | "failed", email, fullName: string | null, detail: string | null, at }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such run" }],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/connect",
        summary: "Sends the browser to Google to connect the account Google Meetings reads the Revenue Enablement calendar and invites the cohort as.",
        access: "platform",
        token: false,
        notes:
          "A browser link, not an API call: it redirects to Google's consent screen, asking for calendar access and a refresh token, with GOOGLE_USER as the sign-in hint when it is set. Google then sends the browser to the shared OAuth callback, GET /api/auth/callback/google, the URI already registered for sign-in. It checks the state cookie, trades the code for a refresh token, seals it, and stores it with the account's email. Reconnecting the same account replaces its token; a different one is refused while the old create-a-meeting flow still has an invite on the first account's calendar, which only that account could cancel. The account needs permission to make changes to events on the Revenue Enablement calendar. It then redirects to Admin Settings → External Connectors with ?google= connected, denied, expired, failed, scope or different_account (with ?current= naming the account already connected), and writes an audit record either way.",
        returns: "a redirect to accounts.google.com",
        errors: [{ status: 503, error: "not_configured", when: "AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET is unset" }],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/zoom/connect",
        summary: "Sends the browser to Zoom to connect the user whose past-meeting reports Google Meetings reads attendance from.",
        access: "platform",
        token: false,
        notes:
          "A browser link, not an API call: it redirects to Zoom's consent screen for the user-managed Zoom app (ZOOM_CLIENT_ID), which can reach only the signing-in user's own meetings, so it reads attendance only for the calendar's meetings that user hosts. Zoom then sends the browser to the shared OAuth callback, GET /api/auth/callback/google. It checks the state cookie, trades the code for tokens, reads the user's email, seals the tokens, and stores them; Zoom rotates the refresh token on every use, so each sync saves the new one. Reconnecting replaces the user. It then redirects to Admin Settings → External Connectors with ?zoom= connected, denied, expired, failed or scope (scope also when Zoom answers that the token lacks a scope, such as user:read:user), and writes an audit record either way.",
        returns: "a redirect to zoom.us",
        errors: [{ status: 503, error: "not_configured", when: "ZOOM_CLIENT_ID or ZOOM_CLIENT_SECRET is unset" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/sync",
        summary: "Lists the cohort Slack sync's log a page at a time, newest first, with the active bootcamp's channels.",
        access: "trainingAdmin",
        token: true,
        notes:
          "A run that has said running for over 10 minutes is shown as failed. scope says what a run set out to do: channels, the intake form reminders, or all of it. notes says why a part of it did nothing, such as no active bootcamp or reminders turned off. running says whether a sync is under way, whichever page is asked for; live whether syncs change Slack or are dry runs; configured whether there is a bot token to sync with, from the Slack app's install or the deployment's SLACK_BOT_TOKEN, which is never returned. active is null when no bootcamp is active; a channel's slackChannelId is null until a live sync has found or created it. reminders says whether the intake form's daily reminder is on, whether today's have gone out, and for each form how many in the current cohort are in its stage (asked), how many of them have answered, and how many questions it has; a form with none sends no reminders.",
        query: listQuery(SLACK_SYNC_LIST.sorts, "who started it, the trigger, the status or the error", "desc"),
        returns: `{ runs: { id, trigger: "schedule" | "manual", scope: "all" | "channels" | "reminders", triggeredBy: string | null, status: "running" | "succeeded" | "skipped" | "failed", dryRun: boolean, startedAt, finishedAt, invited, removed, messaged, notInSlack, failures: number, unfinished: boolean, error: string | null, notes: string[] }[], ${PAGE_FIELDS}, running: boolean, live: boolean, configured: boolean, active: { bootcampId, startDate: "YYYY-MM-DD", channels: { kind: "sales_bootcamp" | "se_bootcamp" | "sales_intermediate" | "se_intermediate", name, slackChannelId: string | null, created: boolean }[] } | null, reminders: { on: boolean, sentToday: boolean, counts: Record<"bootcamp" | "intermediate", { asked: number, answered: number, questions: number }> } }`,
      },
      {
        method: "POST",
        path: "/api/cohorts/slack/sync",
        summary: "Syncs the active bootcamp's Slack channels with the Current tab now, and sends the intake form reminders that are due.",
        access: "trainingAdmin",
        token: true,
        body: {
          kind: "json",
          fields: [{ name: "preview", type: "boolean", note: "true for a dry run whether or not the sync is live, to see what it would change and send, and to whom; the body may be left out" }],
        },
        notes:
          "Its channels also run after each scheduled HiBob sync, and its reminders once a day on their own. Channels: with no bootcamp active, none are synced. Otherwise it finds or creates the public channels sales-bootcamp-{mon}-{yyyy} and se-bootcamp-{mon}-{yyyy}, and the -intermediate- pair when the bootcamp holds an intermediate class, from its start date; joins each; invites the Current tab's Sales and Engineers at that stage, and the Bootcamp Contacts, to the sales- channel, and its Engineers and the Engineer Contacts to the se- one; and removes anyone it invited earlier who no longer belongs. Undecided people are left out, and no one it did not invite is ever removed. Reminders: while the daily reminder is on (PUT /api/cohorts/slack/settings) and today's have not gone out, a direct message, with a link to /intake, to everyone in the current cohort who has not answered their stage's intake form; a form with no questions sends nothing, and an app missing chat:write or im:write sends nothing and says so in notes. A run with nothing to do in any part is skipped. In dry run (see PUT /api/cohorts/slack/settings), or with preview, it changes and sends nothing, and the counts and GET /api/cohorts/slack/sync/{id} say what it would do and send, and to whom. A dry run works with Slack not connected too: unable to see who is already anywhere, it lists every channel not yet created as one to create, everyone each should hold as one to add, and a message to everyone due a reminder, and says so in notes. Slack's rate limits can stop a run part-way, when unfinished is true and the next run carries on. Allows 300 seconds; every attempt is logged.",
        returns: `{ ok: true, runId, status: "succeeded" | "skipped", dryRun: boolean, invited, removed, messaged, notInSlack, failures: number, unfinished: boolean, notes: string[] }`,
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 409, error: "already_running", when: "another sync is running" },
          { status: 409, error: "not_configured", when: "a live run, with the Slack app not installed and no SLACK_BOT_TOKEN on the deployment" },
          { status: 502, error: "slack_error", when: "Slack refused the token or a call every member would need, such as a missing scope; detail says which" },
        ],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/sync/{id}",
        summary: "One Slack sync run, how many of its changes are of each kind, and a page of what it did and sent, and to whom.",
        access: "trainingAdmin",
        token: true,
        notes:
          "One change per channel created or joined, per person invited, removed or refused, per direct message sent, and per email with no Slack account. A change to a channel names it in channelName; one to a person alone has an empty channelName: a message (messaged, its text in detail, as Slack mrkdwn), a message Slack refused (failed), or no Slack account (not_in_slack). In a dry run each says what would have happened. fullName is the employee list's name for the email now, or null. counts is by kind, whatever the search.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        query: [
          { name: "kind", type: '"channels" | "messages" | "problems"', note: "only changes to a channel; only messages, sent or refused; or only refusals and emails with no Slack account. Every change if left out" },
          ...listQuery(SLACK_SYNC_CHANGE_LIST.sorts, "the channel, the action, the email, the name or the detail"),
        ],
        returns: `{ run: <as in GET /api/cohorts/slack/sync>, counts: { all, channels, messages, problems: number }, changes: { id, channelName, action: "created" | "joined" | "invited" | "removed" | "messaged" | "not_in_slack" | "failed", email, fullName: string | null, detail: string | null, at }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such run" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/settings",
        summary: "Whether the cohort Slack sync is live or a dry run, and whether it sends the intake form's daily reminder.",
        access: "trainingAdmin",
        token: true,
        returns: "{ live: boolean, reminders: boolean }",
      },
      {
        method: "PUT",
        path: "/api/cohorts/slack/settings",
        summary: "Turns the cohort Slack sync live or back to a dry run, or its daily intake form reminder on or off.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Either or both. The sync starts as a dry run and the daily reminder off. While the reminder is off, no run sends any; while it is on, the scheduled run and POST /api/cohorts/slack/sync send the reminders that are due, or log them in a dry run. QA shares production's Slack workspace, so leave QA in dry run with the reminder off.",
        body: {
          kind: "json",
          fields: [
            { name: "live", type: "boolean", note: "true to change Slack, false for a dry run" },
            { name: "reminders", type: "boolean", note: "true to send the intake form's daily reminder" },
          ],
        },
        returns: "{ live: boolean, reminders: boolean }",
        errors: [{ status: 400, error: "invalid", when: "the body is not that shape, or names neither" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/test-group",
        summary: "The cohort test group: whether it is on, its suffix and its people.",
        access: "trainingViewer",
        token: true,
        returns: '{ on: boolean, suffix: string, members: { email, fullName, stage: "bootcamp" | "intermediate" | "both" }[] }',
      },
      {
        method: "PUT",
        path: "/api/cohorts/test-group",
        summary: "Turns the cohort test group on or off, sets its suffix, or replaces its people.",
        access: "platform",
        token: true,
        notes:
          "While on, everything the app sends outside itself for the cohort goes to the test group instead: the cohort Slack sync makes its own public channels, named like the real ones with -{suffix} on the end, and invites the group to them; the intake form reminders are sent to the group; and the Google Meetings sync invites the group to the picked meetings in place of the cohort, with no administrators. The real cohort's channels and invites are left untouched, and the Bootcamp and Engineer Contacts are not added. It cannot be on without a suffix and at least one person, and the suffix (lowercased, letters, digits and hyphens) cannot change while it is on. Each person has a stage (bootcamp, intermediate or both): they are invited to that stage's channels and meetings, reminded about its intake form, and may fill it in at /intake, their answers kept apart and deleted when the group is turned off. Turning it off first archives the Slack channels it made (Slack's API archives; it cannot delete) and takes the group off the meeting invites it was given, without emailing them; if any of that fails it stays on and returns 502 with the failures, to try again. At most 100 people.",
        body: {
          kind: "json",
          fields: [
            { name: "on", type: "boolean" },
            { name: "suffix", type: "string", note: "slugified, at most 40 characters" },
            { name: "members", type: '{ email: string, fullName: string, stage?: "bootcamp" | "intermediate" | "both" }[]', note: "replaces the whole list; stage is both unless given, and says which stage's channels, meetings, reminders and intake form the person gets" },
          ],
        },
        returns: "{ on, suffix, members: as in GET, archived?: string[], cancelled?: number } (archived and cancelled only when turning it off)",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or changes nothing" },
          { status: 400, error: "suffix_required", when: "it would be on with no suffix" },
          { status: 400, error: "members_required", when: "it would be on with no one in it" },
          { status: 409, error: "suffix_locked", when: "the suffix is changed while the group is on" },
          { status: 502, error: "teardown_failed", when: "a channel or invite could not be removed; failures lists them and the group stays on" },
        ],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/installation",
        summary: "The Slack app's install in the workspace, which the cohort sync acts as.",
        access: "trainingAdmin",
        token: true,
        notes:
          "The bot token is never returned. app.configured says whether the deployment has the app's Client ID and secret, and so can offer Add to Slack. installation is null until someone adds the app; missingScopes lists any it was not granted of those the channel sync needs (users:read, users:read.email, channels:read, channels:manage, channels:join) and those the intake reminders' direct messages need (chat:write, im:write); readable is false when the saved token was sealed by another deployment, as after an import, and the app must be added again. envToken says whether the deployment also sets SLACK_BOT_TOKEN, which the sync uses only while nothing is installed.",
        returns:
          "{ app: { configured: boolean, appId: string | null }, installation: { teamId, teamName: string | null, appId, botUserId, scopes: string[], missingScopes: string[], readable: boolean, installedBy: string | null, installedAt } | null, envToken: boolean }",
      },
      {
        method: "DELETE",
        path: "/api/cohorts/slack/installation",
        summary: "Forgets the Slack app's bot token, which stops the sync until the app is added again.",
        access: "platform",
        token: true,
        notes:
          "The app stays installed in Slack, where a workspace admin removes it; the token is not revoked, as another deployment may hold the same one. The sync falls back to SLACK_BOT_TOKEN if the deployment sets it.",
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "the app is not installed" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/install",
        summary: "Starts Add to Slack: redirects the browser to Slack to install the app.",
        access: "platform",
        token: false,
        notes:
          "For a browser, from the button on Admin Settings → External Connectors. It sets a state cookie for ten minutes and redirects (307) to slack.com, asking for the scopes the sync needs. Slack then returns to the shared OAuth callback, GET /api/auth/callback/google, which must be one of the app's Redirect URLs on api.slack.com, as {AUTH_URL}/api/auth/callback/google. It checks the state cookie, trades the code for the bot token, which is sealed and replaces any earlier install (a SLACK_APP_ID that is set must match the app Slack names), and redirects to /admin-settings/connectors?slack=installed, cancelled, bad_state or slack_error (with detail, Slack's error such as invalid_code, or wrong_app). An install or a refused one is audited.",
        returns: "307 redirect to slack.com",
        errors: [{ status: 503, error: "not_configured", when: "SLACK_APP_CLIENT_ID or SLACK_APP_CLIENT_SECRET is unset" }],
      },
    ],
  },
  {
    id: "scheduler",
    title: "Scheduler",
    endpoints: [
      {
        method: "GET",
        path: "/api/scheduler/bootcamps",
        summary: "Lists the bootcamps the Scheduler has planned, a page at a time, latest first.",
        access: "trainingViewer",
        token: true,
        notes: "intDays is null for a bootcamp with no intermediate class. At most one bootcamp is active; complete is one that has run.",
        query: listQuery(BOOTCAMP_LIST.sorts, "the status, the facility, or who created it"),
        returns: `{ bootcamps: { id, startDate: "YYYY-MM-DD", btcDays: number, intDays: number | null, status: "scheduled" | "active" | "complete", facilityId: string | null, facilityName: string | null, createdBy: string | null, createdAt: ISO 8601 string }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps",
        summary: "Schedules a bootcamp, with its guest judges.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Only one bootcamp may be active; releasing its BTC or INT scores on Reporting → Live Sessions is what marks everyone assessed in that class as having attended it. To make a new one active while another is, name that other in completeActive: it is marked complete in the same write.",
        body: {
          kind: "json",
          fields: [
            { name: "startDate", type: `"YYYY-MM-DD"`, required: true },
            { name: "btcDays", type: "number", required: true, note: "a whole number from 1 to 30" },
            { name: "intDays", type: "number | null", required: true, note: "1 to 30, or null for no intermediate class" },
            { name: "status", type: `"scheduled" | "active" | "complete"`, required: true },
            FACILITY_FIELD,
            JUDGES_FIELD,
            COMPLETE_ACTIVE_FIELD,
          ],
        },
        returns: "201 { id }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or a judge's email is not an email address" },
          NOT_EMPLOYEE_ERROR,
          UNKNOWN_FACILITY_ERROR,
          ACTIVE_EXISTS_ERROR,
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}",
        summary: "Reads one bootcamp and its guest judges.",
        access: "trainingViewer",
        token: true,
        notes: `judges is every guest judge by name, up to ${BOOTCAMP_LIMITS.judges}; fullName is their name in the employee list, as of when they were added or the last HiBob sync since.`,
        params: [{ name: "id", type: "string", required: true, note: "the bootcamp's id" }],
        returns: `{ id, startDate: "YYYY-MM-DD", btcDays: number, intDays: number | null, status: "scheduled" | "active" | "complete", facilityId: string | null, facilityName: string | null, createdBy: string | null, createdAt: ISO 8601 string, judges: { email, fullName }[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp" }],
      },
      {
        method: "PATCH",
        path: "/api/scheduler/bootcamps/{id}",
        summary: "Changes a bootcamp's dates, length, status, facility or guest judges.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Takes any of POST's fields and changes only those. judges replaces the whole set: anyone left out is removed, and anyone kept keeps when and by whom they were added.",
        params: [{ name: "id", type: "string", required: true, note: "the bootcamp's id" }],
        body: {
          kind: "json",
          fields: [
            { name: "startDate", type: `"YYYY-MM-DD"` },
            { name: "btcDays", type: "number" },
            { name: "intDays", type: "number | null" },
            { name: "status", type: `"scheduled" | "active" | "complete"` },
            FACILITY_FIELD,
            JUDGES_FIELD,
            COMPLETE_ACTIVE_FIELD,
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or a judge's email is not an email address" },
          NOT_EMPLOYEE_ERROR,
          UNKNOWN_FACILITY_ERROR,
          { status: 404, error: "not_found", when: "no such bootcamp" },
          ACTIVE_EXISTS_ERROR,
        ],
      },
      {
        method: "DELETE",
        path: "/api/scheduler/bootcamps/{id}",
        summary: "Removes a bootcamp.",
        access: "trainingAdmin",
        token: true,
        notes: "Its guest judges and its schedule go with it. A bootcamp anyone has been scored at is kept.",
        params: [{ name: "id", type: "string", required: true, note: "the bootcamp's id" }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "no such bootcamp" },
          { status: 409, error: "has_scores", when: "an assessment has been scored or recorded at it" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/judges",
        summary: "Lists one bootcamp's guest judges, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "While the bootcamp is active, each judge can see and submit assessments on the eVals page, whatever other access they have. fullName is their name in the employee list, as of when they were added or the last HiBob sync since. total counts every judge, whatever the search.",
        params: [{ name: "id", type: "string", required: true, note: "the bootcamp's id" }],
        query: listQuery(JUDGE_LIST.sorts, "the name, the email or who added them"),
        returns: `{ judges: { id, email, fullName, addedAt, addedBy: string | null }[], ${PAGE_FIELDS}, total: number }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp" }],
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps/{id}/judges",
        summary: "Adds an employee as a guest judge on one bootcamp.",
        access: "trainingAdmin",
        token: true,
        notes: "The email is lowercased and must belong to someone in the employee list from the last HiBob sync.",
        params: [{ name: "id", type: "string", required: true, note: "the bootcamp's id" }],
        body: {
          kind: "json",
          fields: [{ name: "email", type: "string", required: true, note: "up to 320 characters" }],
        },
        returns: "{ id, email, fullName }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or email is not an email address" },
          { status: 400, error: "not_employee", when: "nobody at Harness in the employee list has that email" },
          { status: 404, error: "not_found", when: "no such bootcamp" },
          { status: 409, error: "duplicate", when: "they are already a judge on it" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/scheduler/bootcamps/{id}/judges/{judgeId}",
        summary: "Removes one guest judge from a bootcamp.",
        access: "trainingAdmin",
        token: true,
        notes: "Scores they have already submitted are kept.",
        params: [
          { name: "id", type: "string", required: true, note: "the bootcamp's id" },
          { name: "judgeId", type: "string", required: true, note: "UUID" },
        ],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "either id is not a UUID, or no such judge on that bootcamp" }],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/schedule",
        summary: "Reads one bootcamp's whole schedule: every day of its four tracks, its rooms, who can run a session, and the assessments a breakout can be scored on.",
        access: "trainingViewer",
        token: true,
        notes: `days.btc[0] is day 1 of Bootcamp; each day's sessions are in start order, at most ${SCHEDULE_LIMITS.sessionsPerDay}. start is minutes after midnight, on the quarter hour, from 480 (8:00 AM); a session ends by midnight, and no two on one track-day overlap. Time between them is unscheduled. The SE tracks run as many days as the class they break out of, and a track the bootcamp does not hold has no days. Day N of every track is the same calendar day. instructors is every Training administrator and every guest judge of the bootcamp. assessments is every active assessment, and any inactive one a session here still names, at most 100. classes lists, by email, who each class is now on each track (at most ${SCHEDULE_LIMITS.groupPeople} each), and a session's assigned is everyone in its breakout groups, so a breakout can be checked for anyone it leaves out.`,
        params: [BOOTCAMP_ID],
        returns: `{ bootcamp: { id, startDate, btcDays, intDays, status, facilityId, facilityName }, rooms: { id, name, capacity }[], instructors: { email, fullName, role: "administrator" | "judge" }[], assessments: { id, name, stage: "bootcamp" | "intermediate", active: boolean }[], days: { btc, int, btc_se, int_se: ${SESSION_SHAPE}[][] }, classes: { bootcamp, intermediate: { sales: string[], engineer: string[] } } }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp" }],
      },
      {
        method: "PUT",
        path: "/api/scheduler/bootcamps/{id}/schedule/layout",
        summary: "Saves when the sessions on the track-days that changed start, and how long they run.",
        access: "trainingAdmin",
        token: true,
        notes:
          "List each changed track-day with every session it now holds. A session moved to another track or day is listed in its new one, and the one it left must be listed too. Clashes this creates are saved and shown in red; only adding someone or a room is refused for a clash.",
        params: [BOOTCAMP_ID],
        body: {
          kind: "json",
          fields: [
            {
              name: "days",
              type: `{ track: ${TRACK_TYPE}, day: number, sessions: { id, start: number, minutes: number }[] }[]`,
              required: true,
              note: `start is minutes after midnight, on the quarter hour; minutes is ${MINUTES_NOTE}; at most ${SCHEDULE_LIMITS.sessionsPerDay} sessions a day`,
            },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or names a track-day or a session twice" },
          { status: 400, error: "no_day", when: "a day is past the end of its track, or the bootcamp does not hold the track" },
          { status: 400, error: "overlap", when: "two sessions of a day overlap, or one starts before 8:00 AM, off the quarter hour, or runs past midnight" },
          { status: 404, error: "not_found", when: "no such bootcamp" },
          { status: 409, error: "stale", when: "the sessions named are not exactly the ones those days hold now; reload and try again" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/schedule/copy",
        summary: "Lists the bootcamps whose schedule this one can be started from, latest first.",
        access: "trainingViewer",
        token: true,
        notes: "Only bootcamps that have at least one session, up to 20.",
        params: [BOOTCAMP_ID],
        returns: `{ sources: { id, startDate: "YYYY-MM-DD", sessions: number }[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp" }],
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps/{id}/schedule/copy",
        summary: "Makes a bootcamp's schedule a copy of another's.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Copies every session, who runs it and the assessment a breakout is scored on, but not comments or breakout groups. Rooms come too only when both bootcamps are at the same facility. Days past the end of a track here are left out; notes says what was. The checklists of the days it copies, and Prep Day's, are added to this bootcamp's, every item to do; replace leaves its own items alone, and an item whose half-day (AM or PM) here already has one of the same name is not added again. An owner or a tag who is not an administrator or guest judge of this bootcamp is left off, and notes names them.",
        params: [BOOTCAMP_ID],
        body: {
          kind: "json",
          fields: [
            { name: "from", type: "string", required: true, note: "the bootcamp to copy" },
            { name: "replace", type: "boolean", note: "true to replace the sessions it has" },
          ],
        },
        returns: "{ sessions: number, checklistItems: number, notes: string[] }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 400, error: "same_bootcamp", when: "from is this bootcamp" },
          ...FILL_ERRORS,
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/availability",
        summary: "Says who and which rooms are busy during a stretch of one day, across the bootcamp's four tracks.",
        access: "trainingViewer",
        token: true,
        notes: "Each person, by email, and each room, by id, that is in a session overlapping the stretch, with the sessions. Unstructured sessions take no one and no room.",
        params: [BOOTCAMP_ID],
        query: [
          { name: "day", type: "number", required: true },
          { name: "start", type: "number", required: true, note: "minutes after midnight; 480 is 8:00 AM" },
          { name: "minutes", type: "number", required: true },
          { name: "exclude", type: "string", note: "a session to leave out, such as the one being edited" },
        ],
        returns: `{ day, start, end, people: Record<email, ${CLASH_SHAPE}[]>, rooms: Record<roomId, Clash[]> }`,
        errors: [
          { status: 400, error: "invalid", when: "a query field is missing or out of range" },
          { status: 404, error: "not_found", when: "no such bootcamp" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/attendees",
        summary: "Lists the attendees a session on one track is taught to, for one audience.",
        access: "trainingViewer",
        token: true,
        notes: `The class's current candidates, as eVals scores them: bootcamp candidates for btc and btc_se, intermediate ones for int and int_se, on the sales track, the engineer track or both. Undecided and deferred people are left out. Attendees are not kept per bootcamp, so this is the same for every bootcamp. Sorted by name; at most ${SCHEDULE_LIMITS.groupPeople}, with hasMore when there are more.`,
        params: [BOOTCAMP_ID],
        query: [
          { name: "track", type: TRACK_TYPE, required: true },
          { name: "audience", type: AUDIENCE_TYPE, note: "left out, both" },
        ],
        returns: `{ track, audience, stage: "bootcamp" | "intermediate", attendees: ${GROUP_ATTENDEE_SHAPE}[], hasMore: boolean }`,
        errors: [
          { status: 400, error: "invalid", when: "track is missing, or track or audience is not one of the values" },
          { status: 404, error: "not_found", when: "no such bootcamp" },
        ],
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps/{id}/sessions",
        summary: "Adds a session to one day of one of a bootcamp's tracks.",
        access: "trainingAdmin",
        token: true,
        notes:
          "If it runs into a session after it, that one and any it then runs into are pushed later; unscheduled time between them takes up the push first. An unstructured session keeps no staff or room; a main one keeps no rooms on its staff; a breakout keeps no room of its own.",
        params: [BOOTCAMP_ID],
        body: {
          kind: "json",
          fields: [
            { name: "track", type: TRACK_TYPE, required: true },
            { name: "day", type: "number", required: true, note: "from 1" },
            {
              name: "start",
              type: "number",
              note: "minutes after midnight, rounded to the quarter hour; left out, straight after the day's last session. In the top half of another session it takes that one's place; in the bottom half, it goes after it",
            },
            ...SESSION_LOOK_FIELDS,
            ...SESSION_STAFF_FIELDS,
          ],
        },
        returns: `201 ${SESSION_SHAPE}`,
        errors: [
          ...SESSION_ERRORS,
          { status: 400, error: "no_day", when: "the day is past the end of the track, or the bootcamp does not hold it" },
          { status: 409, error: "day_full", when: `the day has ${SCHEDULE_LIMITS.sessionsPerDay} sessions already` },
          { status: 409, error: "past_midnight", when: "the push would run the day past midnight" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}",
        summary: "Reads one session, with what it clashes with.",
        access: "trainingViewer",
        token: true,
        notes:
          "A clash is a person or room it shares with an overlapping session on any track that day, or the attendees it shares with an overlapping session beside it: Bootcamp and SE Bootcamp are the same people, as are Intermediate and SE Intermediate. A session for both shares sales and engineers with anything taught beside it; an unstructured one teaches no one.",
        params: [BOOTCAMP_ID, SESSION_ID],
        returns: `${SESSION_SHAPE} & { clashes: ${CLASH_SHAPE}[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp or session" }],
      },
      {
        method: "PATCH",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}",
        summary: "Changes a session's details, length, staff or rooms.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Takes any of POST's fields but track, day and start; moving a session is the layout's job. Made longer, it pushes the sessions it runs into later, as POST does. staff replaces the whole set. Someone already on it stays even if no longer an instructor; only people and rooms new to it are checked for clashes. Anyone taken off the staff takes their breakout group with them, an audience narrowed to one track drops the attendees on the other, and a session that stops being a breakout loses all its groups; the attendees are then unassigned.",
        params: [BOOTCAMP_ID, SESSION_ID],
        body: {
          kind: "json",
          fields: [...SESSION_LOOK_FIELDS.map((f) => ({ ...f, required: false })), ...SESSION_STAFF_FIELDS],
        },
        returns: SESSION_SHAPE,
        errors: [...SESSION_ERRORS, { status: 409, error: "past_midnight", when: "the push would run the day past midnight" }],
      },
      {
        method: "DELETE",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}",
        summary: "Removes a session; its time becomes unscheduled, and nothing else moves.",
        access: "trainingAdmin",
        token: true,
        notes: "Its comments and breakout groups go with it.",
        params: [BOOTCAMP_ID, SESSION_ID],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp or session" }],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}/comments",
        summary: "Lists a session's comments, a page at a time, newest first.",
        access: "trainingViewer",
        token: true,
        notes: "authorName and authorEmail are as they were when it was written. mentions are the people it tags; the body spells each as \"@\" and their fullName.",
        params: [BOOTCAMP_ID, SESSION_ID],
        query: listQuery(SESSION_COMMENT_LIST.sorts, "the text or the author"),
        returns: `{ comments: ${COMMENT_SHAPE}[], ${PAGE_FIELDS} }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp or session" }],
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}/comments",
        summary: "Comments on a session, tagging anyone named in mentions.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Each person tagged sees the comment in their inbox (GET /api/me/mentions). Write \"@\" and their name in the body where they are tagged, as the schedule page does; the body is not checked for it.",
        params: [BOOTCAMP_ID, SESSION_ID],
        body: {
          kind: "json",
          fields: [
            { name: "body", type: "string", required: true, note: `up to ${SCHEDULE_LIMITS.comment} characters` },
            {
              name: "mentions",
              type: "string[]",
              note: `emails of the bootcamp's Training administrators or guest judges to tag; up to ${SCHEDULE_LIMITS.mentions}, each once`,
            },
          ],
        },
        returns: `201 ${COMMENT_SHAPE}`,
        errors: [
          { status: 400, error: "invalid", when: `body is empty or too long, or more than ${SCHEDULE_LIMITS.mentions} mentions` },
          { status: 400, error: "not_instructor", when: "a mention is not an administrator or guest judge of the bootcamp; email names it" },
          { status: 404, error: "not_found", when: "no such bootcamp or session" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}/comments/{commentId}",
        summary: "Removes a comment you wrote.",
        access: "trainingAdmin",
        token: true,
        params: [BOOTCAMP_ID, SESSION_ID, { name: "commentId", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [
          { status: 403, error: "not_author", when: "someone else wrote it" },
          { status: 404, error: "not_found", when: "no such bootcamp, session or comment" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}/groups",
        summary: "Reads a breakout's groups: which instructor each attendee goes with.",
        access: "trainingViewer",
        token: true,
        notes: `Each instructor's people in the order they were put there; anyone not listed is not assigned. track is their HiBob track now, null when HiBob no longer lists them. Only a breakout has any. At most ${SCHEDULE_LIMITS.groupPeople}.`,
        params: [BOOTCAMP_ID, SESSION_ID],
        returns: `{ groups: ${GROUP_SHAPE}[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp or session" }],
      },
      {
        method: "PUT",
        path: "/api/scheduler/bootcamps/{id}/sessions/{sessionId}/groups",
        summary: "Replaces a breakout's groups.",
        access: "trainingAdmin",
        token: true,
        notes:
          "groups is every attendee assigned, in order; anyone left out is not assigned. Each instructorEmail must be on the session's staff, and each email an attendee it is taught to (GET /api/scheduler/bootcamps/{id}/attendees with its track and audience) or already in one of its groups.",
        params: [BOOTCAMP_ID, SESSION_ID],
        body: {
          kind: "json",
          fields: [
            {
              name: "groups",
              type: "{ email, instructorEmail }[]",
              required: true,
              note: `up to ${SCHEDULE_LIMITS.groupPeople}, each attendee once`,
            },
          ],
        },
        returns: `{ groups: ${GROUP_SHAPE}[] }`,
        errors: [
          { status: 400, error: "invalid", when: "groups is missing or too long, an email is not one, or an attendee is named twice" },
          { status: 400, error: "not_staff", when: "an instructorEmail is not on the session's staff; email names it" },
          { status: 400, error: "not_attendee", when: "an attendee is not taught this session and was not in its groups; email names them" },
          { status: 404, error: "not_found", when: "no such bootcamp or session" },
          { status: 409, error: "not_breakout", when: "the session is not a breakout" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/checklist",
        summary: "Counts the checklist items of each half of each track-day, and how many are done.",
        access: "trainingViewer",
        token: true,
        notes: "One entry per track, day and period (AM or PM); a half-day with no items is left out.",
        params: [BOOTCAMP_ID],
        returns: "{ days: { track: \"btc\" | \"int\" | \"btc_se\" | \"int_se\", day: number, period: \"am\" | \"pm\", total: number, done: number }[] }",
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp" }],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/checklist/{track}/{day}",
        summary: "Lists what is to be done before one day of one track, AM and PM together, each half in its order on the board.",
        access: "trainingViewer",
        token: true,
        notes: `Whole: a track-day holds at most ${CHECKLIST_LIMITS.itemsPerDay} items, both halves together. Each item's period says which half it is in.`,
        params: CHECKLIST_DAY_PARAMS,
        returns: `{ items: ${CHECKLIST_ITEM_ROW}[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp, or track or day is not one" }],
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps/{id}/checklist/{track}/{day}",
        summary: "Adds an item to the AM or PM half of one track-day's checklist, recording you as who wrote it.",
        access: "trainingAdmin",
        token: true,
        notes: "It goes last in its half; PATCH it with position to move it up.",
        params: CHECKLIST_DAY_PARAMS,
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: `up to ${CHECKLIST_LIMITS.name} characters` },
            { name: "period", type: `"am" | "pm"`, note: "which half of the day; am when omitted" },
            { name: "ownerEmail", type: "string | null", note: "a Training administrator or guest judge of the bootcamp; omit for nobody" },
            {
              name: "mentions",
              type: "string[]",
              note: `the emails of the people name tags with "@", up to ${SCHEDULE_LIMITS.mentions}; each an administrator or guest judge of the bootcamp`,
            },
          ],
        },
        returns: `201 ${CHECKLIST_ITEM_ROW}`,
        errors: [
          { status: 400, error: "invalid", when: "name is empty or too long, or period is neither am nor pm" },
          { status: 400, error: "no_day", when: "the track does not run that many days at this bootcamp, or day is 0 on a track other than btc" },
          { status: 400, error: "not_instructor", when: "ownerEmail or a mention is not an administrator or guest judge of the bootcamp; email names it" },
          { status: 404, error: "not_found", when: "no such bootcamp, or track or day is not one" },
          { status: 409, error: "full", when: `the day already has ${CHECKLIST_LIMITS.itemsPerDay} items` },
        ],
      },
      {
        method: "PATCH",
        path: "/api/scheduler/bootcamps/{id}/checklist/items/{itemId}",
        summary: "Ticks a checklist item done or back to do, changes its name or owner, or moves it to another half-day or another place in its own.",
        access: "signedIn",
        token: true,
        notes:
          "A Training Administrator can tick any item; anyone else only one they own, matched by their account's email. Ticking one already done keeps when it was first ticked. Only a Training Administrator can change the name or owner, or move it; a field left out stays as it is. A new name replaces whom the item tags with mentions: anyone no longer named drops out, and anyone newly named finds it in their inbox. A move keeps who wrote it, whom it tags and whether it is done. position puts it at that place among the other items of the half-day it ends up in, renumbering that half from 0, as dropping a card on the board does; past the end is the end. Without position, an item moved to another half goes last there, and one that stays keeps its place. Given together, the name and owner are changed first, then the item moved, then ticked; the first step that fails stops the rest, and steps before it stay saved.",
        params: [BOOTCAMP_ID, CHECKLIST_ITEM_ID],
        body: {
          kind: "json",
          fields: [
            { name: "done", type: "boolean" },
            { name: "track", type: TRACK_TYPE, note: "to move it to another track" },
            { name: "day", type: "number", note: "to move it to another day: 1-based; 0 is Prep Day, on btc only" },
            { name: "period", type: `"am" | "pm"`, note: "to move it to the other half of the day" },
            { name: "position", type: "number", note: `its place in the half-day, first at 0, counting the other items there; 0 to ${CHECKLIST_LIMITS.itemsPerDay}` },
            { name: "name", type: "string", note: `up to ${CHECKLIST_LIMITS.name} characters` },
            { name: "ownerEmail", type: "string | null", note: "a Training administrator or guest judge of the bootcamp; null or blank for nobody" },
            {
              name: "mentions",
              type: "string[]",
              note: `with name: the emails of the people it tags with "@", up to ${SCHEDULE_LIMITS.mentions}; omitted, it tags nobody. Ignored without name`,
            },
          ],
        },
        returns: CHECKLIST_ITEM_ROW,
        errors: [
          { status: 400, error: "invalid", when: "none of done, name, ownerEmail, track, day, period or position is given, or one is the wrong type, or name is empty or too long" },
          { status: 400, error: "no_day", when: "the track does not run that day at this bootcamp, or day is 0 on a track other than btc" },
          { status: 400, error: "not_instructor", when: "ownerEmail or a mention is not an administrator or guest judge of the bootcamp; email names it" },
          { status: 403, error: "forbidden", when: "you are not a Training Administrator and name, ownerEmail, track, day, period or position is given" },
          { status: 403, error: "not_owner", when: "you are not a Training Administrator and it is not yours" },
          { status: 404, error: "not_found", when: "no such bootcamp or item" },
          { status: 409, error: "full", when: `the day it is moved to already has ${CHECKLIST_LIMITS.itemsPerDay} items` },
        ],
      },
      {
        method: "DELETE",
        path: "/api/scheduler/bootcamps/{id}/checklist/items/{itemId}",
        summary: "Removes a checklist item.",
        access: "trainingAdmin",
        token: true,
        params: [BOOTCAMP_ID, CHECKLIST_ITEM_ID],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp or item" }],
      },
      {
        method: "GET",
        path: "/api/scheduler/facilities",
        summary: "Lists the facilities bootcamps are held at, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes: "capacity is everyone its rooms hold together; bootcamps counts those held there.",
        query: listQuery(FACILITY_LIST.sorts, "the name or a room's name"),
        returns: `{ facilities: { id, name, rooms: number, capacity: number, bootcamps: number, updatedAt }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/scheduler/facilities",
        summary: "Adds a facility, with its rooms.",
        access: "trainingAdmin",
        token: true,
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: `up to ${FACILITY_LIMITS.name} characters, unique ignoring case` },
            {
              name: "rooms",
              type: "{ name, capacity: number }[]",
              required: true,
              note: `up to ${FACILITY_LIMITS.rooms}, in order; capacity is how many people it holds, 1 to ${FACILITY_LIMITS.capacity}`,
            },
          ],
        },
        returns: "201 { id }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 400, error: "duplicate_room", when: "two rooms share a name, ignoring case and spacing; room names it" },
          { status: 400, error: "unknown_room", when: "a room has an id" },
          { status: 409, error: "duplicate", when: "a facility has that name already" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/facilities/{id}",
        summary: "Reads one facility and its rooms.",
        access: "trainingViewer",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "the facility's id" }],
        returns: "{ id, name, rooms: { id, name, capacity: number }[] }",
        errors: [{ status: 404, error: "not_found", when: "no such facility" }],
      },
      {
        method: "PATCH",
        path: "/api/scheduler/facilities/{id}",
        summary: "Renames a facility or changes its rooms.",
        access: "trainingAdmin",
        token: true,
        notes:
          "rooms replaces the whole set, in order: give a room's id to keep it, and the sessions that use it, under a new name or capacity. A room left out is removed and taken off every session that used it.",
        params: [{ name: "id", type: "string", required: true, note: "the facility's id" }],
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string" },
            { name: "rooms", type: "{ id?: string, name, capacity: number }[]" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 400, error: "duplicate_room", when: "two rooms share a name, ignoring case and spacing; room names it" },
          { status: 400, error: "unknown_room", when: "a room id is not one of this facility's" },
          { status: 404, error: "not_found", when: "no such facility" },
          { status: 409, error: "duplicate", when: "another facility has that name" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/scheduler/facilities/{id}",
        summary: "Removes a facility and its rooms.",
        access: "trainingAdmin",
        token: true,
        notes: "Bootcamps held there keep their schedule, with no facility and no rooms.",
        params: [{ name: "id", type: "string", required: true, note: "the facility's id" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such facility" }],
      },
      {
        method: "GET",
        path: "/api/scheduler/session-types",
        summary: "Lists the session types that start a new session, a page at a time, in the order the session dialog offers them.",
        access: "trainingViewer",
        token: true,
        notes: "A type is a quick start: picking one fills in a new session's kind, name, icon, color, length and description, which are then the session's own.",
        query: listQuery(SESSION_TYPE_LIST.sorts, "the name or the description"),
        returns: `{ sessionTypes: ${SESSION_TYPE_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/scheduler/session-types",
        summary: "Adds a session type.",
        access: "trainingAdmin",
        token: true,
        body: {
          kind: "json",
          fields: [
            ...SESSION_LOOK_FIELDS,
            { name: "position", type: "number", note: "where the session dialog lists it, lower first; left out, last" },
          ],
        },
        returns: `201 ${SESSION_TYPE_SHAPE}`,
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 409, error: "duplicate", when: "a type has that name already, ignoring case" },
          { status: 409, error: "too_many", when: `there are ${SCHEDULE_LIMITS.types} already` },
        ],
      },
      {
        method: "PATCH",
        path: "/api/scheduler/session-types/{id}",
        summary: "Changes a session type.",
        access: "trainingAdmin",
        token: true,
        notes: "Takes any of POST's fields. Sessions already started from it are not changed.",
        params: [{ name: "id", type: "string", required: true, note: "the type's id" }],
        body: {
          kind: "json",
          fields: [...SESSION_LOOK_FIELDS.map((f) => ({ ...f, required: false })), { name: "position", type: "number" }],
        },
        returns: SESSION_TYPE_SHAPE,
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 404, error: "not_found", when: "no such type" },
          { status: 409, error: "duplicate", when: "another type has that name" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/scheduler/session-types/{id}",
        summary: "Removes a session type.",
        access: "trainingAdmin",
        token: true,
        notes: "Sessions started from it keep everything they took from it.",
        params: [{ name: "id", type: "string", required: true, note: "the type's id" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such type" }],
      },
    ],
  },
  {
    id: "recordings",
    title: "Recordings",
    intro:
      `Async recordings. Anyone in the org signs in with Google at /record — the Harness Training Recorder — and, needing no role, types their name, and records their camera (with the microphone) and, if they choose, their screen, each as its own file. The browser keeps every stream locally and uploads it a chunk at a time while it records, retrying until each lands: on a deployment, straight to Cloud Storage on signed URLs, so no video passes through the app. The /api/record routes are what that page calls, as the signed-in account: a take is its recorder's, and nobody else may add to it. Everything else here is for Training Viewers to read and play, and for Training Administrators to delete. A recording is deleted ${RECORDING_RETENTION_DAYS} days after it is made, and is not listed meanwhile.`,
    endpoints: [
      {
        method: "GET",
        path: "/api/recordings",
        summary: "Lists recorded takes, a page at a time, the newest first.",
        access: "trainingViewer",
        token: true,
        notes: `A row per take, its streams rolled up: durationMs is the longest stream's, bytes the finished files', and status failed if any stream failed, else uploading or assembling while any is, else ready. stalled is a stream still uploading with no chunk for ${UPLOAD_STALLED_MS / 60_000} minutes: most likely the page was closed, and opening /record again on the same computer and browser, signed in as the same person, resumes it.`,
        query: listQuery(RECORDING_LIST.sorts, "who recorded it"),
        returns: `{ takes: ${RECORDING_TAKE_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "GET",
        path: "/api/recordings/{takeId}",
        summary: "Reads one take with each of its streams.",
        access: "trainingViewer",
        token: true,
        notes: "offsetMs is when a stream started after the take's first, to line the files up.",
        params: [{ name: "takeId", type: "string", required: true, note: "the take's id" }],
        returns: `{ takeId, contributor, startedAt, tracks: ${RECORDING_TRACK_SHAPE}[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such take" }],
      },
      {
        method: "DELETE",
        path: "/api/recordings/{takeId}",
        summary: "Deletes a take and every file of it.",
        access: "trainingAdmin",
        token: true,
        params: [{ name: "takeId", type: "string", required: true, note: "the take's id" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such take" }],
      },
      {
        method: "GET",
        path: "/api/recordings/{takeId}/{kind}/file",
        summary: "Serves one finished stream of a take — the camera or the screen — as MP4 or WebM, or redirects to it.",
        access: "trainingViewer",
        token: true,
        notes:
          "Where recordings are kept in Cloud Storage, as on every deployment, it answers 302 to a signed URL good for 15 minutes, and the bucket honours Range; kept on disk, it serves the bytes itself and honours Range. Either way a video element plays and seeks it. download=1 serves it as an attachment named after who recorded it, when, and the stream.",
        params: [
          { name: "takeId", type: "string", required: true, note: "the take's id" },
          { name: "kind", type: `"camera" | "screen"`, required: true },
        ],
        query: [{ name: "download", type: `"1"`, note: "as an attachment rather than inline" }],
        returns: "302 to the file in the bucket; or the video as video/mp4 or video/webm, 206 for a range",
        errors: [
          { status: 404, error: "not_found", when: "no such stream, or it is not ready yet" },
          { status: 503, error: "signing_failed", when: "the download URL could not be signed; the reason is in the app's log" },
        ],
      },
      {
        method: "POST",
        path: "/api/record/tracks",
        summary: "Files one stream of a take before its chunks are uploaded.",
        access: "signedIn",
        token: true,
        notes:
          "Filed as the caller's. Idempotent: the browser sends it again after every reload, and a stream already filed is returned unchanged. upload says how its chunks go: direct to Cloud Storage on URLs from upload-urls, or app through the chunks route. Also deletes, after answering, any recordings past their retention.",
        body: {
          kind: "json",
          fields: [
            { name: "takeId", type: "string", required: true, note: "a UUID the browser makes for the take" },
            { name: "kind", type: `"camera" | "screen"`, required: true },
            { name: "mimeType", type: "string", required: true, note: "what MediaRecorder records: video/mp4 or video/webm, with codecs" },
            { name: "startedAt", type: "string", required: true, note: "ISO 8601" },
            { name: "offsetMs", type: "number", required: true, note: "when this stream started after the take's first; 0 to 60000" },
            { name: "contributor", type: "string", note: `the name the person recording gave; trimmed, at most ${RECORDING_LIMITS.contributor} characters` },
          ],
        },
        returns: `${RECORDING_TRACK_SHAPE} & { upload: "direct" | "app" }`,
        errors: [
          { status: 400, error: "invalid", when: "a field is missing or malformed" },
          { status: 403, error: "not_yours", when: "the take is another account's" },
        ],
      },
      {
        method: "PUT",
        path: "/api/record/tracks/{takeId}/{kind}/chunks/{seq}",
        summary: "Uploads one chunk of a stream, as raw bytes, where recordings are kept on disk.",
        access: "signedIn",
        token: true,
        notes: `seq counts from 0 with no gaps. Sending a chunk again replaces it, so a retry after a lost response is safe. At most ${RECORDING_LIMITS.chunkBytes / (1024 * 1024)} MB.`,
        params: [
          { name: "takeId", type: "string", required: true },
          { name: "kind", type: `"camera" | "screen"`, required: true },
          { name: "seq", type: "number", required: true, note: `0 to ${RECORDING_LIMITS.chunks - 1}` },
        ],
        returns: "204 No Content",
        errors: [
          { status: 400, error: "invalid", when: "seq is not a whole number in range" },
          { status: 400, error: "empty", when: "the body is empty" },
          { status: 400, error: "truncated", when: "fewer bytes arrived than Content-Length declared; nothing is kept, so send it again" },
          { status: 404, error: "not_found", when: "no such stream of the caller's" },
          { status: 409, error: "finished", when: "the stream's file is already joined" },
          { status: 409, error: "direct_upload", when: "recordings are kept in Cloud Storage: chunks go to it on URLs from upload-urls" },
          { status: 413, error: "too_large", when: "the chunk is too big" },
        ],
      },
      {
        method: "POST",
        path: "/api/record/tracks/{takeId}/{kind}/upload-urls",
        summary: "Hands out signed URLs to upload chunks of a stream straight to Cloud Storage.",
        access: "signedIn",
        token: true,
        notes: `Each URL takes a PUT of the chunk's bytes, Content-Type application/octet-stream, for an hour. The browser asks for ${UPLOAD_URL_BATCH} at a time, ahead of the chunks, so one request covers about 50 seconds of a stream; it also marks the stream as still arriving, which is what keeps it from reading as stalled.`,
        params: [
          { name: "takeId", type: "string", required: true },
          { name: "kind", type: `"camera" | "screen"`, required: true },
        ],
        body: {
          kind: "json",
          fields: [{ name: "seqs", type: "number[]", required: true, note: `1 to ${UPLOAD_URL_BATCH} chunk sequence numbers` }],
        },
        returns: "{ urls: Record<seq, url> }",
        errors: [
          { status: 400, error: "invalid", when: "seqs is missing, empty, too long, or out of range" },
          { status: 404, error: "not_found", when: "no such stream of the caller's" },
          { status: 409, error: "finished", when: "the stream's file is already joined: every chunk is in" },
          { status: 409, error: "app_upload", when: "recordings are kept on disk: chunks go through the chunks route" },
          { status: 503, error: "signing_failed", when: "the URLs could not be signed; the reason is in the app's log and the audit row" },
        ],
      },
      {
        method: "GET",
        path: "/api/record/tracks/{takeId}/{kind}/file",
        summary: "Downloads one finished stream of the caller's own take.",
        access: "signedIn",
        token: true,
        notes:
          "What the recorder page offers once an upload is complete, so whoever recorded it keeps a copy. Served as an attachment named after who recorded it, when, and the stream: a 302 to a signed URL where recordings are kept in Cloud Storage, or the bytes from disk.",
        params: [
          { name: "takeId", type: "string", required: true },
          { name: "kind", type: `"camera" | "screen"`, required: true },
        ],
        returns: "302 to the file in the bucket; or the video as video/mp4 or video/webm",
        errors: [
          { status: 404, error: "not_found", when: "no such stream of the caller's, or it is not ready yet" },
          { status: 503, error: "signing_failed", when: "the download URL could not be signed; the reason is in the app's log" },
        ],
      },
      {
        method: "POST",
        path: "/api/record/tracks/{takeId}/{kind}/finish",
        summary: "Says a stream has ended, and starts joining its file once every chunk is in.",
        access: "signedIn",
        token: true,
        notes:
          "Answers missing with the chunks still to send (at most 1,000 at a time). Otherwise joins the file: in Cloud Storage by composing the chunks before answering, ready; on disk in the background, assembling until it is done. The browser keeps its own copy, and calls this again, until it hears ready.",
        params: [
          { name: "takeId", type: "string", required: true },
          { name: "kind", type: `"camera" | "screen"`, required: true },
        ],
        body: {
          kind: "json",
          fields: [
            { name: "chunks", type: "number", required: true, note: "how many chunks the stream has; 0 marks it failed, nothing having been saved" },
            { name: "durationMs", type: "number", required: true },
          ],
        },
        returns: `{ status: "missing", missing: number[] } | { status: "assembling" | "ready" | "failed" }`,
        errors: [
          { status: 400, error: "invalid", when: "a field is missing or malformed" },
          { status: 404, error: "not_found", when: "no such stream of the caller's" },
        ],
      },
    ],
  },
  {
    id: "video-feedback",
    title: "Video feedback",
    intro:
      "Smiley and confused faces on videos (rating up is the green smiley, down the orange confused face). Every player in the app — a Mimir concept's video, and each stream of a recorded take — has both faces over it, each with a comment button beside it. A rating is saved as it is pressed; the comment button pauses the video, and saving the comment saves the rating with it and plays on. Every press is its own row, so the same person can rate the same video more than once.",
    endpoints: [
      {
        method: "POST",
        path: "/api/video-feedback",
        summary: "Saves a smiley (up) or confused (down) rating on a video, where it was, and an optional comment.",
        access: "signedIn",
        token: true,
        notes:
          `A Mimir concept's video may be rated by anyone signed in; a recording's stream only by a ${ACCESS_LABELS.trainingAdmin}, who are the ones who can watch it. The video's name is saved with the feedback as it is now. A comment is trimmed, and a blank one is saved as none. A recording's feedback is deleted with the take.`,
        body: {
          kind: "json",
          fields: [
            { name: "video", type: `{ kind: "mimir_concept" | "recording", id: string }`, required: true, note: "the concept's id, or the recording stream's id" },
            { name: "rating", type: `"up" | "down"`, required: true },
            { name: "position", type: "number", required: true, note: "where the video was, in seconds from the start" },
            { name: "comment", type: "string", note: `up to ${VIDEO_FEEDBACK_LIMITS.comment} characters` },
          ],
        },
        returns: `{ feedback: ${VIDEO_FEEDBACK_SHAPE} }, with 201`,
        errors: [
          { status: 400, error: "invalid", when: "a field is missing or out of range" },
          { status: 403, error: "forbidden", when: "the video is a recording and the caller may not watch recordings" },
          { status: 404, error: "not_found", when: "no concept has that id or it has no video, or no recording stream has that id" },
        ],
      },
      {
        method: "GET",
        path: "/api/video-feedback",
        summary: "Lists feedback on videos, a page at a time, the newest first.",
        access: "trainingAdmin",
        token: true,
        notes: "user is null once the account that gave it is deleted.",
        query: [
          ...listQuery(VIDEO_FEEDBACK_LIST.sorts, "the video's name, the comment, or the name or email of who gave it", "desc"),
          { name: "kind", type: `"mimir_concept" | "recording"`, note: "only feedback on that kind of video" },
          { name: "rating", type: `"up" | "down"`, note: "only smiley (up), or only confused (down)" },
          { name: "video", type: "string", note: "only feedback on the video with this id; read only alongside kind" },
        ],
        returns: `{ feedback: ${VIDEO_FEEDBACK_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "GET",
        path: "/api/video-feedback/summary",
        summary: "Lists each concept on the Mimir map, and each video no longer on it that has feedback, with its counts of smiley and confused ratings, and of each that came with a comment, a page at a time, by name.",
        access: "trainingAdmin",
        token: true,
        notes: "Only Mimir concept videos are counted. A comment is a rating saved with words; the counts of ratings include them. accepted is how many comments an administrator has accepted and no regeneration has applied yet. label is the concept's name on the map, or the video's name when it was last rated for one no longer on it. inMap is whether the concept is on the map, and hasVideo whether it has a video there. job is the concept's latest Mimir Studio video job, or null.",
        query: listQuery(VIDEO_FEEDBACK_SUMMARY_LIST.sorts, "the concept's name"),
        returns: `{ videos: { conceptId, label, inMap: boolean, hasVideo: boolean, up: number, upComments: number, down: number, downComments: number, accepted: number, job: { id, status, progress, error, createdAt, finishedAt } | null }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "PATCH",
        path: "/api/video-feedback/{id}",
        summary: "Edits a comment's words, or accepts or ignores it.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "the feedback's id" }],
        notes: "Only a rating that came with a comment can be changed. Send comment, status, or both; the audit trail keeps the words before and after. A video with accepted comments is the one Mimir Feedback offers to regenerate. applied is set only by a regeneration that took the comment in, and cannot be sent.",
        body: {
          kind: "json",
          fields: [
            { name: "comment", type: "string", note: `1 to ${VIDEO_FEEDBACK_LIMITS.comment} characters, trimmed` },
            { name: "status", type: `"pending" | "accepted" | "ignored"` },
          ],
        },
        returns: `{ feedback: ${VIDEO_FEEDBACK_SHAPE} }`,
        errors: [
          { status: 400, error: "invalid", when: "neither field is sent, or one is blank or out of range" },
          { status: 404, error: "not_found", when: "no feedback has that id" },
          { status: 409, error: "no_comment", when: "the feedback is a rating with no comment" },
        ],
      },
    ],
  },
  {
    id: "logistics",
    title: "Logistics",
    endpoints: [
      {
        method: "GET",
        path: "/api/logistics/intake-forms/{form}",
        summary: "Reads one intake form, Pre-Bootcamp or Pre-Intermediate, as Logistics settings edits it.",
        access: "trainingAdmin",
        token: true,
        params: [INTAKE_FORM_PARAM],
        notes: "Until it is first saved this is the default form, with updatedAt null: each as the Google Form it replaces asked it: Pre-Bootcamp's introduction and six questions, Pre-Intermediate's introduction and five. Pre-Bootcamp's preferred-name and time zone questions are automatic: /intake asks everyone them first, so they are never in this form. A form has no title of its own; /intake heads it Bootcamp Registration or Intermediate Registration.",
        returns: `{ introduction: string, questions: ${INTAKE_QUESTION_SHAPE}[], updatedAt: string | null }`,
        errors: [{ status: 404, error: "not_found", when: "form is neither bootcamp nor intermediate" }],
      },
      {
        method: "PUT",
        path: "/api/logistics/intake-forms/{form}",
        summary: "Replaces one intake form's introduction and questions.",
        access: "trainingAdmin",
        token: true,
        params: [INTAKE_FORM_PARAM],
        notes:
          "Answers already saved keep the question ids they were given under; a question removed stops being asked. Pre-Bootcamp's preferred-name and time zone questions (ids preferred-name and timezone) are automatic: /intake always asks them first, and they cannot be edited or removed, so on Pre-Bootcamp any sent with those ids are dropped rather than saved.",
        body: { kind: "json", fields: INTAKE_FORM_FIELDS },
        returns: `{ introduction: string, questions: ${INTAKE_QUESTION_SHAPE}[], updatedAt: string }`,
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 404, error: "not_found", when: "form is neither bootcamp nor intermediate" },
        ],
      },
      {
        method: "GET",
        path: "/api/logistics/intake-responses",
        summary: "Lists each person's latest answers to one intake form, or to both, a page at a time, the most recently saved first.",
        access: "trainingAdmin",
        token: true,
        notes: "Someone who changed their answers is listed once, as they are now; with form all, once for each form they answered, form saying which. name is from HiBob, and null for an email no employee has.",
        query: [
          { name: "form", type: '"bootcamp" | "intermediate" | "all"', note: "the form, or all for both together; bootcamp, Pre-Bootcamp, if left out or anything else" },
          ...listQuery(INTAKE_RESPONSE_LIST.sorts, "the name, email or any answer"),
          { name: "question", type: "string", note: "with answer, only responses whose answer to this question id is, or for checkboxes includes, answer" },
          { name: "answer", type: "string", note: "with question; either alone is ignored" },
        ],
        returns: `{ form: "bootcamp" | "intermediate" | "all", responses: { id, form: "bootcamp" | "intermediate", email, name: string | null, answers: Record<string, string | string[]>, submittedAt }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/logistics/intake-responses/import",
        summary: "Brings a Google Form's responses sheet into one intake form, or with commit left out only says how it lines up.",
        access: "trainingAdmin",
        token: true,
        notes:
          "The sheet's first row is its headers, as Google writes them: an Email Address column is needed, a Timestamp column dates each response, and every other column answers the question whose title it is, or ends with. Columns that answer no question are left out. Each row is stored as that person's answers, dated by its timestamp, so an answer they give at /intake afterwards is newer; a row with the same email and timestamp as one already stored is skipped, so the same sheet twice adds nothing. inCohort is how many of its people are in the current cohort, the ones Dietary needs lists.",
        query: [
          { name: "form", type: '"bootcamp" | "intermediate"', required: true, note: "the form to bring the responses into" },
          { name: "commit", type: '"1"', note: "store them; left out, nothing is written" },
        ],
        body: { kind: "multipart", fields: [{ name: "file", type: "File", required: true, note: "the responses sheet as .csv or .xlsx, up to 2 MB and 2,000 rows" }] },
        returns:
          "{ imported: boolean, columns: { header, questionId: string | null }[], added: number, alreadyThere: number, inCohort: number, people: number, problems: { row: number, problem: \"no_email\" | \"not_an_email\" }[] }",
        errors: [
          { status: 400, error: "no_file", when: "no file was sent" },
          { status: 400, error: "unreadable", when: "the file is neither a .csv nor an .xlsx" },
          { status: 400, error: "empty", when: "it has no rows under its headers" },
          { status: 400, error: "no_email_column", when: "no column is headed Email or Email Address" },
          { status: 404, error: "not_found", when: "form is not bootcamp or intermediate" },
          { status: 413, error: "too_large", when: "the file is over 2 MB" },
          { status: 413, error: "too_many_rows", when: "it has more than 2,000 rows" },
        ],
      },
      {
        method: "GET",
        path: "/api/logistics/dietary",
        summary: "Counts the current cohort's dietary needs by item, critical and not, and lists who wrote in Other and who has yet to register.",
        access: "trainingViewer",
        token: true,
        notes:
          "Reads both forms, Pre-Bootcamp and Pre-Intermediate, as one list, since both groups are there at once, for the current cohort only (the Cohorts page's Current tab, Sales and Engineer tracks), and the test group's members while it is on: each person's latest response to either, and the stage they are in now, so a returning intermediate who has only answered bootcamp still counts. stage narrows everything to one group; anything but bootcamp or intermediate is everyone. counts.critical lists each checklist item someone marked Critical with how many did, the most first; counts.notCritical the same for items checked without Critical. Both are short, the checklist's own length, and not paged. criticalWriteIns lists who checked Other, marked it Critical and wrote in what it is; otherWriteIns who did so without Critical. Each is a page at a time under its own prefix. unregistered lists everyone in the current cohort who has sent neither form, and counts.notRegistered how many. Answers given before the checklist existed are not counted.",
        query: [
          { name: "stage", type: `"all" | "bootcamp" | "intermediate"`, note: "who to count; left out, everyone" },
          { name: "criticalOther.sort", type: `"name" | "email" | "stage"`, note: "the critical write-ins' sort, by name if left out; criticalOther.dir and criticalOther.page beside it" },
          { name: "other.sort", type: `"name" | "email" | "stage"`, note: "the other write-ins' sort, by name if left out; other.dir and other.page beside it" },
          { name: "q", type: "string", note: "narrows the not-registered list by name or email" },
          { name: "unregistered.sort", type: `"name" | "email" | "stage"`, note: "the not-registered list's sort; unregistered.dir and unregistered.page beside it" },
        ],
        returns: `{ stage: "all" | "bootcamp" | "intermediate", counts: { responded: number, withNeeds: number, withCritical: number, cohortSize: number, notRegistered: number, critical: { item: string, count: number }[], notCritical: { item: string, count: number }[] }, criticalWriteIns: { people: { email, name: string | null, stage: "bootcamp" | "intermediate", text: string }[], page: number, hasMore: boolean }, otherWriteIns: { people: { email, name: string | null, stage: "bootcamp" | "intermediate", text: string }[], page: number, hasMore: boolean }, unregistered: { people: { email, name: string | null, stage: "bootcamp" | "intermediate" }[], page: number, hasMore: boolean } }`,
      },
      {
        method: "GET",
        path: "/api/logistics/food-orders",
        summary: "Lists food orders, a page at a time, the soonest to arrive first.",
        access: "trainingViewer",
        token: true,
        query: listQuery(FOOD_ORDER_LIST.sorts, "the vendor, what is needed or the file name"),
        returns: `{ orders: ${FOOD_ORDER_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/logistics/food-orders",
        summary: "Adds a food order, with the vendor's PDF if one is sent.",
        access: "trainingAdmin",
        token: true,
        body: { kind: "multipart", fields: FOOD_ORDER_FIELDS },
        returns: `201 ${FOOD_ORDER_SHAPE}`,
        errors: FOOD_ORDER_FORM_ERRORS,
      },
      {
        method: "PATCH",
        path: "/api/logistics/food-orders/{id}",
        summary: "Changes a food order, and replaces or removes its PDF.",
        access: "trainingAdmin",
        token: true,
        notes: "Takes every field POST does, vendor and arrivesAt required. With no file the PDF is kept, unless removeFile is 1.",
        params: [{ name: "id", type: "string", required: true, note: "the order's id" }],
        body: {
          kind: "multipart",
          fields: [...FOOD_ORDER_FIELDS, { name: "removeFile", type: `"1"`, note: "with no file, removes the PDF the order has" }],
        },
        returns: FOOD_ORDER_SHAPE,
        errors: [...FOOD_ORDER_FORM_ERRORS, { status: 404, error: "not_found", when: "no such order" }],
      },
      {
        method: "DELETE",
        path: "/api/logistics/food-orders/{id}",
        summary: "Removes a food order and its PDF.",
        access: "trainingAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "the order's id" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such order" }],
      },
      {
        method: "GET",
        path: "/api/logistics/food-orders/{id}/pdf",
        summary: "Serves a food order's PDF, to open in the browser.",
        access: "trainingViewer",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "the order's id" }],
        returns: "the PDF, as application/pdf",
        errors: [{ status: 404, error: "not_found", when: "no such order, or it has no PDF" }],
      },
      {
        method: "GET",
        path: "/api/logistics/guest-judges",
        summary: "Lists everyone who has been a guest judge, a row per cohort they judged, with the sessions they ran on it.",
        access: "trainingViewer",
        token: true,
        notes:
          "Two sources, side by side. source scheduler is a Scheduler bootcamp's guest judges, with person null: cohort is its first day, and sessions are the bootcamp's sessions with the judge on their staff, in schedule order, role lead on the one they led. source history is the guest speaker history, the cohorts kept outside the Scheduler, as POST /api/logistics/guest-speakers adds them: cohort is the first of the month, person is what DELETE /api/logistics/guest-speakers takes, bootcampId and status are null, sessions have no day or start, and role is teach, commentator, judge or speaker; email is null for someone no longer in HiBob. title is the employee list's now. Rows are always in month order, month being the first of cohort's month: sort cohort orders the months, newest first by default, and name or sessions orders people within each month. emptyCohorts lists the months set aside with POST /api/logistics/guest-speakers/cohorts that have no one in them yet, newest first. counts covers everyone, whatever the search.",
        query: listQuery(GUEST_JUDGE_LIST.sorts, "the name, email, title or a session's name"),
        returns: `{ judges: { id, email: string | null, fullName, title: string | null, cohort: string, month: string, source: "scheduler" | "history", person: string | null, bootcampId: string | null, status: "scheduled" | "active" | "complete" | null, sessions: { name, role: "lead" | "teach" | "commentator" | "judge" | "speaker" | null, track: ${TRACK_TYPE}, day: number | null, start: number | null }[] }[], ${PAGE_FIELDS}, counts: { judges: number, cohorts: number, prospects: number, prospectGroups: { sales: number, se: number } }, emptyCohorts: string[] }`,
      },
      {
        method: "GET",
        path: "/api/logistics/guest-judges/prospects",
        summary: "Lists the sales and sales engineering leaders who have never been a guest judge, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes: `Read from the employee list as the last HiBob sync left it: anyone in ${GUEST_JUDGE_DEPARTMENTS.join(", ")} with at least one direct report, on no bootcamp's guest judges and not in the guest speaker history, by email. location is HiBob's work location and site its country. tenureMonths is the whole months since HiBob's start date, the first day of their current time at Harness, so a rehire counts from their return; sort tenure ascending is the newest first. syncedAt is when that sync ran.`,
        query: [
          ...listQuery(JUDGE_PROSPECT_LIST.sorts, "the name, email, title or location"),
          { name: "group", type: `"sales" | "se"`, note: "only Enterprise Sales and Corporate Sales, or only Sales Engineering, by HiBob department; anything else is every leader" },
        ],
        returns: `{ leaders: { email, fullName, title, department, reportsToName, location: string | null, site, startDate: string | null, tenureMonths: number | null }[], ${PAGE_FIELDS}, syncedAt: string | null }`,
      },
      {
        method: "POST",
        path: "/api/logistics/guest-judges/thank-you",
        summary: "Makes a one-slide Google Slides deck saying Thank You! over the guest judges' Slack photos, saves it as BootCamp Thank You in the shared Drive folder, and shares it with the caller.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Takes no body. The judges are each person once, at their latest cohort, latest cohort first: a Scheduler bootcamp counts only once it is complete, a history cohort always, and at most 100 are looked up. Photos come from Slack by each judge's email; someone with no email or no custom Slack photo is left off the slide, and the photos shrink to fit everyone else. Each photo is a circle with a light blue ring, orange for someone who helped in two or more months, who also gets a 🔥2X badge. Google fetches the circles from the public, signed, 15-minute photo link on this app, so AUTH_URL must be its public origin. The deck is owned by the Google account connected for Google Meetings; a deck of the same name already in the folder is trashed first. That account needs the Slides and Drive scopes, so an account connected before they were asked for must be connected again.",
        returns: "201 { url: string, judges: number, withPhotos: number }, both counts being the people on the slide",
        errors: [
          { status: 404, error: "no_judges", when: "no guest judges are listed, or Slack has a photo for none of them" },
          { status: 409, error: "google_not_configured | google_not_connected | google_reconnect | slack_not_connected | no_email", when: "Google or Slack is not set up for it, or the Google account needs connecting again; message says which" },
          { status: 502, error: "failed", when: "Google or Slack refused or could not be reached; message has their answer" },
        ],
      },
      {
        method: "GET",
        path: "/api/logistics/guest-judges/thank-you/photo",
        summary: "A guest judge's Slack photo as a PNG circle with a coloured ring, for the thank-you slide.",
        access: "public",
        token: true,
        notes: "Made for Google Slides to fetch: the link comes from the thank-you slide's POST and is signed, good for 15 minutes, and only for a Slack or Gravatar image.",
        query: [
          { name: "src", type: "string", required: true, note: "the Slack image URL" },
          { name: "ring", type: `"blue" | "orange"`, required: true },
          { name: "exp", type: "number", required: true, note: "when the link expires, in milliseconds since 1970" },
          { name: "sig", type: "string", required: true, note: "the signature over the other three" },
        ],
        returns: "image/png",
        errors: [
          { status: 404, error: "not_found", when: "the signature is wrong, the link has expired or the image is gone" },
          { status: 502, error: "unavailable", when: "Slack could not be reached" },
        ],
      },
      {
        method: "POST",
        path: "/api/logistics/guest-speakers",
        summary: "Adds someone to the guest speaker history: a session they taught, commentated or judged at a month's cohort.",
        access: "trainingAdmin",
        token: true,
        notes: "For cohorts kept outside the Scheduler; a Scheduler bootcamp's judges are set in its bootcamp dialog. An entry already there is left as it is, and added is false. With an email the person drops off the leaders list.",
        body: {
          kind: "json",
          fields: [
            { name: "cohort", type: "string", required: true, note: "the cohort's month, YYYY-MM" },
            { name: "program", type: `"bootcamp" | "intermediate"`, required: true },
            { name: "session", type: "string", note: `up to ${GUEST_SPEAKER_LIMITS.session} characters; empty for someone on no particular session` },
            { name: "role", type: `"teach" | "commentator" | "judge" | "speaker"`, required: true },
            { name: "fullName", type: "string", required: true, note: `up to ${GUEST_SPEAKER_LIMITS.name} characters` },
            { name: "email", type: "string | null", note: "their email, from the employee list; null or left out for someone not in it" },
          ],
        },
        returns: "201 { added: true }, or 200 { added: false }",
        errors: [{ status: 400, error: "invalid", when: "the body is not that shape" }],
      },
      {
        method: "POST",
        path: "/api/logistics/guest-speakers/cohorts",
        summary: "Sets a month aside for a cohort, so it lists as a space to fill in before anyone is down for it.",
        access: "trainingAdmin",
        token: true,
        notes: "A month already set aside is left as it is, and added is false. A month with guest speakers or a Scheduler bootcamp lists whether or not it is set aside.",
        body: { kind: "json", fields: [{ name: "cohort", type: "string", required: true, note: "the cohort's month, YYYY-MM" }] },
        returns: "201 { added: true }, or 200 { added: false }",
        errors: [{ status: 400, error: "invalid", when: "the body is not that shape" }],
      },
      {
        method: "DELETE",
        path: "/api/logistics/guest-speakers/cohorts",
        summary: "Takes a month off the cohorts set aside.",
        access: "trainingAdmin",
        token: true,
        notes: "Removes only the space: guest speakers already down for that month, and a Scheduler bootcamp in it, keep it listed.",
        query: [{ name: "cohort", type: "string", required: true, note: "the first of the month, YYYY-MM-DD, as emptyCohorts gives it" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "that month is not set aside" }],
      },
      {
        method: "DELETE",
        path: "/api/logistics/guest-speakers",
        summary: "Removes everything the guest speaker history holds for one person at one cohort.",
        access: "trainingAdmin",
        token: true,
        query: [
          { name: "cohort", type: "string", required: true, note: "a history row's cohort, YYYY-MM-DD, the first of its month" },
          { name: "person", type: "string", required: true, note: "a history row's person: their email, or their lowercased name for someone with none" },
        ],
        returns: "{ removed: number }",
        errors: [{ status: 404, error: "not_found", when: "the history holds nothing for them at that cohort" }],
      },
      {
        method: "GET",
        path: "/api/intake",
        summary: "Reads the caller's own intake form, as /intake/registration shows it, with the answers they last saved.",
        access: "signedIn",
        token: true,
        notes:
          "The form is the one for the caller's stage of the current cohort (the Cohorts page's Current tab, Sales and Engineer tracks): bootcamp, headed Bootcamp Registration, for a bootcamp candidate, and intermediate, Intermediate Registration, for an intermediate one. answers is empty and savedAt null until they have saved any, except on intermediate for someone who answered bootcamp before: answers then starts from their bootcamp dietary answers, and carriedFrom says when those were saved. name is the first name of the preferred name they have chosen, which the preferred-name question starts from until they answer it; null if they have none, and the question then starts blank. On both forms, questions open with the automatic preferred-name and timezone questions, then the form's own, and an earlier answer saved as a full name starts from its first name. introduction opens with the line \"Bootcamp takes place from **8:00AM {first day}** to **12:00PM {last day}**.\" from the next bootcamp's dates (the active one, else the soonest scheduled) for bootcamp, or \"Intermediate takes place from ...\" from the next intermediate class's dates (the active bootcamp's if it holds one, else the soonest scheduled that does; it runs for its own number of days from the bootcamp's first day) for intermediate, then the introduction saved in Logistics settings; the times and days are wrapped in ** to show in bold. canDefer is true on both, and the page asks them to sign up or defer (POST /api/intake/defer) before it shows the questions. While the cohort test group is on (PUT /api/cohorts/test-group), a person in it gets the form for the stage they were given there; one given both picks with ?form=bootcamp or ?form=intermediate (bootcamp by default), and testForms lists the two. Their answers are marked as test answers and deleted when the group is turned off, and never change their name.",
        query: [{ name: "form", type: "bootcamp | intermediate", note: "which form, for a test group member in both stages; ignored for anyone else" }],
        returns: `{ form: "bootcamp" | "intermediate", heading, introduction: string, canDefer: boolean, questions: ${INTAKE_QUESTION_SHAPE}[], answers: Record<string, string | string[]>, savedAt: string | null, carriedFrom?: { form: "bootcamp", savedAt }, name: string | null, testForms?: ("bootcamp" | "intermediate")[] }`,
        errors: [{ status: 404, error: "not_in_cohort", when: "the caller is not in the current cohort" }],
      },
      {
        method: "PUT",
        path: "/api/intake",
        summary: "Saves the caller's answers to their own intake form.",
        access: "signedIn",
        token: true,
        notes:
          "Saved under the caller's own email, to the form for their stage, as GET /api/intake reads it. Answers are checked against the form as it stands now: trimmed, blanks dropped, and any for a question not on it ignored. A test group member in both stages saves to the form named by ?form=. Saving again replaces their answers; the ones before are kept, but only the latest is listed or counted. The preferred-name question is optional: left blank, it changes nothing. The answer to it (while it is a short or paragraph answer), when given, must be a single first name with no spaces (letters, apostrophes, hyphens or dots). It is saved as the preferred name on their employee record, separate from their official first and last name, which is not changed; the app shows the preferred first name with their official last name, so Sam given by Samuel Rivera is saved as Sam and shown as Sam Rivera. That is their name wherever the app shows one: their employee record, as their reports' manager, judges, contacts, breakout groups, name cards, their account (which signing in with Google then keeps), and the names kept with comments, checklist items, transcripts, mentions they made and the guest speaker history. A mention of them keeps the name its text spells, and the audit trail keeps the name it recorded. Giving the first name their email gives clears a preferred name chosen before. The HiBob sync keeps the preferred name.",
        body: {
          kind: "json",
          fields: [
            {
              name: "answers",
              type: "Record<string, string | string[]>",
              required: true,
              note: `keyed by question id: an array for checkboxes, a string for the rest, each up to ${INTAKE_LIMITS.answer} characters. A choice, checkboxes or dropdown answer must be one of the options, except for one free-text answer where the question offers "Other"`,
            },
          ],
        },
        returns: '{ form: "bootcamp" | "intermediate", savedAt }',
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 404, error: "not_in_cohort", when: "the caller is not in the current cohort" },
          { status: 409, error: "no_questions", when: "their form has no questions yet, so there is nothing to answer" },
          { status: 400, error: "required", when: "a required question has no answer; questionId names it" },
          { status: 400, error: "not_an_option", when: "an answer is not one the question offers, or a single-answer question was given several; questionId names it" },
          { status: 400, error: "not_a_name", when: "the preferred-name answer is not a single first name, with no spaces; questionId names it" },
        ],
      },
      {
        method: "POST",
        path: "/api/intake/defer",
        summary: "Defers the caller from Pre-Bootcamp or Pre-Intermediate to the next class of their stage.",
        access: "signedIn",
        token: true,
        notes:
          "It is the Defer button on /intake/registration, after the caller confirms. Their track becomes Deferred, the same change as choosing it on the Employees page, which takes them off the Current tab and out of the form; it stays until an administrator sets the track back to automatic. The page then tells them to look out for a message about the next session. A test group member (see PUT /api/cohorts/test-group) is not deferred: nothing changes, and deferred is false. A test group member in both stages names the form with ?form=bootcamp. Audited as the track change, or, for a test group member, as a test defer.",
        query: [{ name: "form", type: "bootcamp | intermediate", note: "which form, for a test group member in both stages; ignored for anyone else" }],
        returns: "{ deferred: boolean }",
        errors: [{ status: 404, error: "not_in_cohort", when: "the caller is not in the current cohort" }],
      },
    ],
  },
  {
    id: "daily-surveys",
    title: "Daily surveys",
    intro:
      "The survey each attendee fills in about one day of the bootcamp: a 1 to 5 rating and optional feedback for each session they were in, then a 1 to 5 rating of the day overall and one thing they would change. A survey is one stage's class on one employee track for one day, its SE track included, since they are the same people: Bootcamp Sales, Bootcamp Engineers, Intermediate Sales, Intermediate Engineers. Each person has at most one survey a day.",
    endpoints: [
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/surveys",
        summary: "Lists the days of a bootcamp that have been sent a survey, as the scheduler's Assign Surveys buttons read them.",
        access: "trainingViewer",
        token: true,
        notes:
          "One row per stage and day with a survey, at most two stages of thirty days: audiences says which surveys that day has (a class's button sends sales and engineer, an SE track's engineer alone, so a track-day reads as sent once every audience it teaches has one), assigned how many people were sent one, and answered how many have answered.",
        params: [BOOTCAMP_ID],
        returns: `{ days: ${SURVEY_DAY_SHAPE}[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp" }],
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps/{id}/surveys",
        summary: "Sends one track-day's surveys to everyone that track teaches.",
        access: "trainingAdmin",
        token: true,
        notes: `On a class (btc, int) it sends the sales and the engineer survey; on an SE track (btc_se, int_se), the engineer survey. Each asks about every session that day on the class and its SE track that is taught to its audience, in start order, leaving out unstructured ones; the sessions are copied in when the survey is first made, and a later change to the schedule does not reach it. A survey already made for that day is reused, and anyone already sent it is not sent it again, so repeating the call sends only to people who have joined the class since. A survey with no sessions to ask about is made but sent to no one. Each goes to at most ${SURVEY_LIMITS.people} people; hasMore says there were more. Attendees are the class's current candidates, as the scheduler's class lists count them. When the call makes a survey and sends it to someone, it announces the day in the class's cohort channel with a link to /intake: sales-<stage>-<mon>-<yyyy> for a class, which holds its Engineers too, se-<stage>-<mon>-<yyyy> for an SE track, with the test group's suffix while it is on. slack is null when nothing was announced; otherwise its status is posted, dry_run (the Slack sync is not live, and nothing is posted), no_channel (the sync has not made the channel), not_connected (no Slack token) or failed (with Slack's error). The surveys are sent whatever happens in Slack.`,
        params: [BOOTCAMP_ID],
        body: {
          kind: "json",
          fields: [
            { name: "track", type: TRACK_TYPE, required: true, note: "the track whose button was pressed" },
            { name: "day", type: "integer", required: true, note: "from 1, a day the track runs at this bootcamp" },
          ],
        },
        returns: `{ surveys: { id, audience: "sales" | "engineer", sessions: number, created: boolean, sent: number, hasMore: boolean }[], slack: { channel, status: "posted" | "dry_run" | "no_channel" | "not_connected" | "failed", error? } | null, days: ${SURVEY_DAY_SHAPE}[] }`,
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape" },
          { status: 404, error: "not_found", when: "no such bootcamp" },
          { status: 404, error: "no_such_day", when: "the track does not run that many days at this bootcamp" },
        ],
      },
      {
        method: "GET",
        path: "/api/me/forms",
        summary: "Lists everything the caller has been asked to fill in, as /intake shows it: their registration form and their daily surveys.",
        access: "signedIn",
        token: true,
        notes: `The ones still to answer come first: the registration form, then surveys by day. Those answered follow, most recently answered first. The registration form is listed only for someone in the current cohort (see GET /api/intake) whose form has questions; a test group member in both stages has both. At most ${PAGE_SIZE} surveys are listed.`,
        returns: '{ forms: { kind: "registration" | "survey", id, title, detail, href, completedAt: string | null }[] }',
      },
      {
        method: "GET",
        path: "/api/surveys/{id}",
        summary: "Reads one of the caller's own daily surveys, with the answers they last saved.",
        access: "signedIn",
        token: true,
        notes: "id is the caller's copy of the survey, as GET /api/me/forms lists it. answers is null until they have answered.",
        params: [{ name: "id", type: "string", required: true, note: "the caller's survey" }],
        returns: `${MY_SURVEY_SHAPE}`,
        errors: [{ status: 404, error: "not_found", when: "no such survey, or it was not sent to the caller" }],
      },
      {
        method: "PUT",
        path: "/api/surveys/{id}",
        summary: "Saves the caller's answers to one of their own daily surveys.",
        access: "signedIn",
        token: true,
        notes: "Every session the survey asks about needs a rating; feedback and dayChange are trimmed and may be empty. Saving again replaces the answers given before.",
        params: [{ name: "id", type: "string", required: true, note: "the caller's survey" }],
        body: {
          kind: "json",
          fields: [
            {
              name: "sessions",
              type: "Record<string, { rating: number, feedback?: string }>",
              required: true,
              note: `keyed by session id, one for each session the survey asks about: rating a whole number from 1 (poor) to 5 (excellent), feedback up to ${SURVEY_LIMITS.answer} characters`,
            },
            { name: "dayRating", type: "integer", required: true, note: "the day overall, from 1 to 5" },
            { name: "dayChange", type: "string", note: `one thing they would change about the day, up to ${SURVEY_LIMITS.answer} characters` },
          ],
        },
        returns: `${MY_SURVEY_SHAPE}`,
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or a rating is not 1 to 5" },
          { status: 400, error: "required", when: "a session the survey asks about has no rating; sessionId names it" },
          { status: 400, error: "unknown_session", when: "an answer is for a session the survey does not ask about; sessionId names it" },
          { status: 404, error: "not_found", when: "no such survey, or it was not sent to the caller" },
        ],
      },
      {
        method: "GET",
        path: "/api/survey-results",
        summary: "Lists the daily surveys anyone has answered, as Survey Results shows them, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes: "A survey is listed once it has at least one response. average is the mean of the day-overall ratings; Survey Results shows it to one decimal place. date is the day the survey is about. Sorting by date puts the latest day first by default.",
        query: listQuery(SURVEY_RESULT_LIST.sorts, 'the bootcamp\'s month and the group, as in "November 2026 Bootcamp Sales"', "desc"),
        returns: `{ surveys: ${SURVEY_CARD_SHAPE}[], ${PAGE_FIELDS} }`,
      },
      {
        method: "GET",
        path: "/api/survey-results/{id}",
        summary: "Reads one daily survey's results: how each session was rated, and its responses a page at a time.",
        access: "trainingViewer",
        token: true,
        notes: "survey.sessions are the sessions it asks about, each with its mean rating, how many rated it, and how many left feedback on it. responses are the people who have answered, with every answer they gave.",
        params: [{ name: "id", type: "string", required: true, note: "the survey's id, as GET /api/survey-results lists it" }],
        query: listQuery(SURVEY_RESPONSE_LIST.sorts, "the name or email", "desc"),
        returns: `{ survey: ${SURVEY_RESULT_SHAPE}, responses: { id, email, fullName, submittedAt, dayRating: number, dayChange, sessions: Record<string, { rating: number, feedback }> }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 404, error: "not_found", when: "no such survey" }],
      },
    ],
  },
  {
    id: "evals-scoring",
    title: "eVals scoring",
    intro:
      "Scoring attendees on the active assessments during the active bootcamp. Each attendee has one submission per assessment per bootcamp: anyone who can score may revise it, and whoever saves it last owns it. Undecided and deferred people are not in the training and never appear.",
    endpoints: [
      {
        method: "GET",
        path: "/api/evals/scoring",
        summary: "Lists one stage's active assessments, a page at a time, and the bootcamp they would be scored at.",
        access: "scorer",
        token: true,
        notes:
          "bootcamp is the active one, or null when none is, or, for intermediate, when the active one holds no intermediate class; nothing can be scored then.",
        query: [
          { name: "stage", type: `"bootcamp" | "intermediate"`, required: true },
          ...listQuery(ASSESSMENT_LIST.sorts, "the name"),
        ],
        returns: `{ stage, bootcamp: { id, startDate, btcDays, intDays } | null, assessments: { id, name, stage, audience, active: true, updatedAt, criteria: number, submissions: number }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 400, error: "invalid", when: "stage is missing or not one of those" }],
      },
      {
        method: "GET",
        path: "/api/evals/scoring/{assessmentId}",
        summary: "Lists the attendees one active assessment applies to, a page at a time, with their scores at the active bootcamp.",
        access: "scorer",
        token: true,
        notes:
          "An attendee is a current candidate (see GET /api/evals/current-cohort) in the assessment's stage on the sales or engineer track, as its audience takes in. averageScore is to one decimal place, and null if they are not scored at the active bootcamp. needsRescoring is true for one scored before a criterion was added. attendees and scored count everyone it applies to, whatever the search or mine. mine counts those in the caller's own groups in the active bootcamp's breakouts whose assessmentId is this assessment, as the schedule's Breakout Assignments tab sets it. rooms are the rooms the caller is given in those same breakouts, in the order they happen; one without a room for them is left out. start is minutes after midnight.",
        params: [{ name: "assessmentId", type: "string", required: true, note: "UUID" }],
        query: [
          ...listQuery(ASSESSMENT_ATTENDEE_LIST.sorts, "the name, email or title"),
          { name: "mine", type: `"1"`, note: "only the attendees the caller is assigned in a breakout, as mine counts them" },
        ],
        returns: `{ assessment: { id, name, stage, audience }, bootcamp: { id, startDate, btcDays, intDays } | null, attendees: number, scored: number, mine: number, rooms: { roomName, sessionName, track, day, start }[], people: { id, email, fullName, title, track: "sales" | "engineer", averageScore: number | null, needsRescoring: boolean }[], ${PAGE_FIELDS} }`,
        errors: [
          { status: 400, error: "invalid", when: "mine is anything but 1" },
          { status: 404, error: "not_found", when: "assessmentId is not a UUID, or no such active assessment" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/scoring/{assessmentId}/{employeeId}",
        summary: "Reads one attendee's scoring form: the criteria still asked, and their submission at the active bootcamp.",
        access: "scorer",
        token: true,
        notes:
          "submission is null until someone scores them. Its scores are keyed by criterion id; a criterion added since has none. ownerName is whoever saved it last. Send its updatedAt as revises when saving. people is whom a comment can tag: anyone who can use eVals, and the active bootcamp's guest judges; it is empty with no bootcamp. transcripts holds every recording anyone filed of this attendee on this assessment at the active bootcamp, oldest first, whether or not the submission has been saved; it is empty with no bootcamp.",
        params: [
          { name: "assessmentId", type: "string", required: true, note: "UUID" },
          { name: "employeeId", type: "string", required: true, note: "the employee's HiBob id" },
        ],
        returns: `{ assessment: { id, name, stage, audience }, criteria: { id, name, description }[], attendee: { id, email, fullName, title, track }, submission: { id, averageScore, positiveFeedback, constructiveFeedback, ownerId, ownerName, updatedAt, scores: Record<string, { score, comment, mentions: { email, fullName }[] }> } | null, people: { email, fullName }[], transcripts: { id, recordingId, recordedAt, durationMs, recordedByName: string | null, text }[], bootcamp: { id, startDate, btcDays, intDays } | null }`,
        errors: [{ status: 404, error: "not_found", when: "no such active assessment, or the attendee is not one it applies to" }],
      },
      {
        method: "POST",
        path: "/api/evals/scoring/{assessmentId}/{employeeId}/transcripts",
        summary: "Transcribes one recording made while scoring an attendee, and files the transcript with their assessment at the active bootcamp.",
        access: "scorer",
        token: true,
        notes: `Deepgram's nova-3 model, with punctuation, number formatting and a blank line between paragraphs; when more than one voice is heard, each change of speaker starts a paragraph with "Speaker 1:", "Speaker 2:" and so on. text is empty when nothing was heard. The audio is passed through and not kept. Sending the same recordingId again returns the transcript already filed, with 200, without transcribing it again. Up to ${PAGE_SIZE} are kept per attendee per assessment per bootcamp.`,
        params: [
          { name: "assessmentId", type: "string", required: true, note: "UUID" },
          { name: "employeeId", type: "string", required: true, note: "the employee's HiBob id" },
        ],
        body: {
          kind: "multipart",
          fields: [
            {
              name: "audio",
              type: "file",
              required: true,
              note: "a recording in any container Deepgram reads (webm, ogg, mp4, wav, mp3…); 25 MiB at most",
            },
            { name: "recordingId", type: "string", required: true, note: "UUID; names the recording, so a retry is not filed twice" },
            { name: "recordedAt", type: "number", required: true, note: "when it started, in milliseconds since the epoch" },
            { name: "durationMs", type: "number", required: true, note: "how long it is, in milliseconds" },
          ],
        },
        returns: "{ id, recordingId, recordedAt, durationMs, recordedByName: string | null, text } — 201 when filed, 200 when it already was",
        errors: [
          { status: 400, error: "invalid", when: "the body is not form data, or a field is missing or not that shape" },
          { status: 400, error: "empty", when: "the audio file is empty" },
          { status: 404, error: "not_found", when: "assessmentId is not a UUID, no such active assessment, or the attendee is not one it applies to" },
          { status: 409, error: "no_bootcamp", when: "no bootcamp is active, or for intermediate, the active one holds no intermediate class" },
          { status: 409, error: "too_many", when: `${PAGE_SIZE} transcripts are already filed for them` },
          { status: 409, error: "conflict", when: "that recordingId is filed for another attendee, assessment or bootcamp" },
          { status: 413, error: "too_large", when: "the audio file is over 25 MiB" },
          { status: 502, error: "upstream", when: "Deepgram refused the request or could not be reached" },
          { status: 503, error: "unconfigured", when: "no DEEPGRAM_API_KEY is set on this deployment" },
        ],
      },
      {
        method: "POST",
        path: "/api/evals/scoring/{assessmentId}/{employeeId}/transcripts/{transcriptId}/review",
        summary: "Asks Claude to read one filed transcript against the assessment's criteria, and returns a short note for each.",
        access: "scorer",
        token: true,
        notes:
          "Claude Opus 5.5 is sent the assessment's name, the attendee's name, every criterion still asked with its description, and the transcript; it is told not to score. Nothing is saved: the scoring form appends each summary on a new line of that criterion's comment, and the judge saves the form as usual. comments follows the order of the criteria, one per criterion at most; a criterion Claude wrote nothing for has none. Takes up to two minutes.",
        params: [
          { name: "assessmentId", type: "string", required: true, note: "UUID" },
          { name: "employeeId", type: "string", required: true, note: "the employee's HiBob id" },
          { name: "transcriptId", type: "string", required: true, note: "UUID; the id of a transcript filed for them, not its recordingId" },
        ],
        returns: "{ comments: { criterionId, summary }[] }",
        errors: [
          { status: 404, error: "not_found", when: "an id is not that shape, no such active assessment, the attendee is not one it applies to, or no such transcript is filed for them at the active bootcamp" },
          { status: 409, error: "no_bootcamp", when: "no bootcamp is active, or for intermediate, the active one holds no intermediate class" },
          { status: 409, error: "empty", when: "the transcript has no text: nothing was heard" },
          { status: 409, error: "no_criteria", when: "the assessment asks no criteria" },
          { status: 422, error: "refused", when: "Claude declined to review it" },
          { status: 502, error: "upstream", when: "Claude could not be reached, ran out of time, or answered with something unreadable" },
          { status: 503, error: "unconfigured", when: "no ANTHROPIC_API_KEY is set on this deployment" },
        ],
      },
      {
        method: "PUT",
        path: "/api/evals/scoring/{assessmentId}/{employeeId}",
        summary: "Saves one attendee's submission at the active bootcamp, making the caller its owner.",
        access: "scorer",
        token: true,
        notes:
          "Every criterion still asked needs a whole score from 1 to 4; comments are optional. averageScore is their mean to one decimal place. Rounded to a whole number, an average of 1 or 2 requires constructiveFeedback and an average of 4 requires positiveFeedback. A revision replaces the scores, dropping any for criteria since retired. A comment's mentions tag people with \"@\"; a revision keeps a tag still listed as it was made and drops one no longer listed. The feedback cannot tag anyone.",
        params: [
          { name: "assessmentId", type: "string", required: true, note: "UUID" },
          { name: "employeeId", type: "string", required: true, note: "the employee's HiBob id" },
        ],
        body: {
          kind: "json",
          fields: [
            {
              name: "scores",
              type: "{ criterionId: string, score: 1 | 2 | 3 | 4, comment?: string, mentions?: string[] }[]",
              required: true,
              note: `one per criterion still asked; a comment up to ${EVALS_ASSESSMENT_LIMITS.comment} characters, tagging up to ${SCHEDULE_LIMITS.mentions} people by email`,
            },
            { name: "positiveFeedback", type: "string", note: `up to ${EVALS_ASSESSMENT_LIMITS.feedback} characters` },
            { name: "constructiveFeedback", type: "string", note: `up to ${EVALS_ASSESSMENT_LIMITS.feedback} characters` },
            {
              name: "revises",
              type: "ISO 8601 string | null",
              required: true,
              note: "the updatedAt of the submission being revised, or null for the first",
            },
          ],
        },
        returns: "{ id, attendeeEmail, assessmentName, averageScore, updatedAt }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or the scores are not exactly the criteria still asked" },
          { status: 400, error: "feedback_required", when: "the average requires feedback that is empty" },
          { status: 400, error: "not_scorer", when: "a mention can neither use eVals nor judge the active bootcamp; email names it" },
          { status: 404, error: "not_found", when: "no such active assessment, or the attendee is not one it applies to" },
          { status: 409, error: "no_bootcamp", when: "no bootcamp is active, or for intermediate, the active one holds no intermediate class" },
          { status: 409, error: "conflict", when: "someone else saved it since revises, or saved the first one first" },
        ],
      },
    ],
  },
  {
    id: "reporting-bootcamp",
    title: "Reporting: Bootcamp",
    intro:
      "Everyone's BTC and INT, as Reporting → Live Sessions shows them. Any signed-in account may call these, and each caller sees only the people under them in the last HiBob sync, every level down and themselves left out; an Assessments Viewer or above sees everyone. Below Assessments Viewer, a bootcamp's BTC or INT results stay hidden until an Assessments Administrator releases that class, and the assessments behind a score are never shown.",
    endpoints: [
      {
        method: "GET",
        path: "/api/reporting/bootcamp",
        summary: "Lists the people the caller may see with a BTC or INT record, newest class first, a page at a time.",
        access: "signedIn",
        token: true,
        notes:
          "A record is a class someone was assessed in that the caller may see: once it is released, or for an Assessments Viewer also once its bootcamp is complete. level is the furthest class attended: intermediate, else bootcamp. date is their latest class day. key addresses their page: their employee id, else, for someone assessed whom the employee list does not have, a submission's. fullName is null for someone it has no name for, and active false for anyone the last HiBob sync did not send. counts gives everyone the caller may see, the active and the inactive, whatever the search or status.",
        query: [
          ...listQuery(BOOTCAMP_RECORD_LIST.sorts, "the name or email", BOOTCAMP_RECORD_LIST.dir),
          { name: "status", type: HISTORY_STATUSES.map((s) => `"${s}"`).join(" | "), note: "only the active or only the inactive; everyone if omitted" },
        ],
        returns: `{ people: { key, email, fullName: string | null, level: "intermediate" | "bootcamp", date: "YYYY-MM-DD", active: boolean }[], ${PAGE_FIELDS}, status: "active" | "inactive" | null, counts: { total: number, active: number, inactive: number } }`,
        errors: [{ status: 400, error: "invalid_status", when: "status is neither active nor inactive" }],
      },
      {
        method: "GET",
        path: "/api/reporting/bootcamp/cohort",
        summary: "Returns the active bootcamp, which of its classes are released, and a page of the people in its cohort the caller may see.",
        access: "signedIn",
        token: true,
        notes:
          "stages lists the classes the caller may see the cohort of: every class the bootcamp holds for an Assessments Viewer or above, else only those released. cohort holds one row per person and class in those stages; averageScore is the mean of their submissions' averages, null with none scored, and scored how many there are. bootcamp is null, and cohort empty, when no bootcamp is active.",
        query: listQuery(BOOTCAMP_COHORT_LIST.sorts, "the name or email", BOOTCAMP_COHORT_LIST.dir),
        returns: `{ bootcamp: { id, startDate, intermediate: boolean, released: { bootcamp: { at, byName: string | null } | null, intermediate: { at, byName: string | null } | null } } | null, stages: ("bootcamp" | "intermediate")[], cohort: { key, email, fullName: string | null, stage: "bootcamp" | "intermediate", scored: number, averageScore: number | null }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/reporting/bootcamp/release",
        summary: "Releases the active bootcamp's BTC or INT results to managers, which marks everyone assessed in that class as having attended it.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "From then on, managers see that class's results for the people in their org. Everyone scored in the class has attended it from then on: a BTC class moves on to Intermediate on Cohorts → Current, and an INT class leaves it. written counts the people scored in it. A release cannot be taken back; releasing a class already released changes nothing, writes nothing, and returns when it was.",
        body: { kind: "json", fields: [{ name: "stage", type: '"bootcamp" | "intermediate"', required: true }] },
        returns: "{ ok: true, stage, bootcamp: { id, startDate }, releasedAt, written: number }",
        errors: [
          { status: 400, error: "invalid", when: "stage is missing or neither bootcamp nor intermediate" },
          { status: 409, error: "no_bootcamp", when: "no bootcamp is active" },
          { status: 409, error: "no_intermediate", when: "stage is intermediate and the active bootcamp holds no intermediate class" },
        ],
      },
      {
        method: "GET",
        path: "/api/reporting/bootcamp/people/{key}",
        summary: "Returns one person's BTC and INT, and for an Assessments Viewer every assessment behind them.",
        access: "signedIn",
        token: true,
        notes:
          "classes is what a manager sees: each class's day, overall score and score per exercise, from the latest released class of it they were assessed in. records is null below Assessments Viewer. Above it, submissions is every assessment of them at any bootcamp, newest bootcamp first, with each criterion's score and comment; released says whether managers may see it yet.",
        params: [{ name: "key", type: "string", required: true, note: "a key from the list: an employee id or a submission's" }],
        returns:
          '{ key, email, employee: { fullName, title, department, site, reportsToName, reportsToEmail, startDate, track } | null, classes: { bootcamp: ClassSummary, intermediate: ClassSummary }, records: { submissions: { id, bootcamp: { id, startDate, status }, stage, assessmentName, averageScore, positiveFeedback, constructiveFeedback, ownerName, submittedAt, updatedAt, released, scores: { criterionId, criterionName, score, comment }[] }[] } | null }, where ClassSummary is { date: string | null, score: number | null, exercises: { name, score }[] }',
        errors: [{ status: 404, error: "not_found", when: "the key names no one, or someone the caller may not see" }],
      },
      {
        method: "PATCH",
        path: "/api/reporting/bootcamp/submissions/{id}",
        summary: "Corrects one assessment of someone, at any bootcamp: its scores, comments and feedback.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "It keeps the criteria the assessment was scored on, their names as scored, and its owner; the audit log records who corrected it. The average follows the new scores, and the feedback the eVals form requires for that average is still required. An assessment with no criteria, as those imported from the old bootcamp history are, takes scores as [] and its averageScore directly, and requires no feedback.",
        params: [{ name: "id", type: "string", required: true, note: "the submission's id" }],
        body: { kind: "json", fields: [
          { name: "scores", type: "{ criterionId, score: 1 | 2 | 3 | 4, comment?: string }[]", required: true, note: `every criterion it was scored on, once each; comments up to ${EVALS_ASSESSMENT_LIMITS.comment} characters` },
          { name: "positiveFeedback", type: "string", note: `up to ${EVALS_ASSESSMENT_LIMITS.feedback} characters` },
          { name: "constructiveFeedback", type: "string", note: `up to ${EVALS_ASSESSMENT_LIMITS.feedback} characters` },
          { name: "averageScore", type: "number", note: `${BOOTCAMP_SCORE.min} to ${BOOTCAMP_SCORE.max}, to one decimal place; only for an assessment with no criteria, and required for one` },
          { name: "revises", type: "string", required: true, note: "the updatedAt of the version being corrected" },
        ] },
        returns: "{ ok: true, submission: { id, attendeeEmail, assessmentName, averageScore, updatedAt } }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or the scores are not exactly the criteria it was scored on" },
          { status: 400, error: "feedback_required", when: "the average requires feedback that is empty" },
          { status: 404, error: "not_found", when: "`id` is not a UUID, or no submission has it" },
          { status: 409, error: "conflict", when: "someone saved it since revises" },
        ],
      },
    ],
  },
  {
    id: "canary-wire",
    title: "Canary Wire",
    intro:
      "Monthly Canary Wire completion in Mindtickle, by manager, as Reporting → Canary Wire shows it. It names everyone in the three Canary Wire role groups and who is behind, so it is for people managers — anyone HiBob has reporting to them — and Assessments Viewers and above, who see everyone. A manager sees their own org by default: themselves and everyone under them, every level down.",
    endpoints: [
      {
        method: "GET",
        path: "/api/evals/canary-wire",
        summary: "Returns one Canary Wire month from the newest Mindtickle pull: every rep's progress per module, grouped by manager, with per-role and overall rates.",
        access: "canaryWire",
        token: true,
        notes:
          "Built from the newest pull and today's exemptions, so a past month counts whoever was accountable then. A rep is pre-bootcamp, and counted in no rate, until the month after the first BTC they attended (a released class they were assessed in); someone pinned to the exempt track on Cohorts → Current counts in every month. With no BTC, someone whose HiBob start date is before the first BTC on record counts in every month, since the records don't go back far enough to have them; anyone else with none counts in none. None of this applies to SDRs, who never attend bootcamp: they count from their first full month at Harness by HiBob's start date (starting October 2 counts from November, October 1 from October), and in every month with no start date. Names, titles and managers are the HiBob sync's (the employee list), matched by email, with Mindtickle's for anyone HiBob doesn't have; an IC is someone nobody in HiBob reports to. Rates are percentages to one place, null when nothing is owed. A role's and the totals' rates are in people: of the learners who owe something this month, the share who finished everything they owe. A team's and a rep's are in modules. A cell is keyed by module label: accountable cells are counted, exempt ones are pre-bootcamp work and off-role ones (neither) are another edition's module, shown but not counted. atPt is the event's moment in Pacific, empty when only the day is known. lastActivity is the newest completion in the month's content. hasSnapshot is false until the first pull from Mindtickle has finished, and every list is then empty. With format=csv, the same month as a CSV download, one row per rep.",
        query: [
          { name: "month", type: "string", note: 'a month the picker offers, "September 2026"; the newest month anybody has worked in if omitted' },
          { name: "format", type: '"csv"', note: "a CSV download instead of JSON" },
          { name: "scope", type: '"org" | "everyone"', note: "org: the caller and everyone under them in HiBob, for a manager; everyone: the whole Canary Wire. Defaults to org for a manager and everyone otherwise" },
        ],
        returns:
          "{ month, scope: \"org\" | \"everyone\", months: string[], monthsWithData: string[], hasSnapshot, hasData, labels: string[], modules: { label, edition, name }[], teams: { manager, managerEmail, roles: string[], directs: Rep[], learners, exempt, assigned, completed, pct, fullyComplete, notActivated }[], roles: { role, learners, finished, pct, icLearners, icFinished, icPct, exempt, modules: string[] }[], totals: { learners, finished, pct, icLearners, icFinished, icPct, exempt, rostered, notActivated } | null, lastActivity: { at, atPt, who, module, role }, fetchedAtPt, savedAt: string | null, notes: string[], seriesLinks: { edition, label, url }[], moduleUrlTemplate }, where Rep is { name, email, role, manager, managerEmail, title, notActivated, ic, exempt, exemptFrom, exemptSource: \"bootcamp\" | \"predates_history\" | \"no_bootcamp\" | \"first_month\" | \"edition\", cells: Record<label, { state, on, atPt, moduleId, seriesId, moduleType, accountable, exempt, also: { state, on, atPt, edition }[], edition? }>, assigned, completed, pct, offRole }; text/csv with format=csv",
        errors: [
          { status: 400, error: "invalid_month", when: "month is not one the picker offers" },
          { status: 400, error: "invalid_format", when: "format is set to anything but csv" },
          { status: 400, error: "invalid_scope", when: "scope is neither org nor everyone" },
          { status: 400, error: "not_a_manager", when: "scope is org and nobody reports to the caller" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/canary-wire/history",
        summary: "Returns the Canary Wire month over month: each rep's share of their own lineup finished in each of the last six months with content, as the dots beside each rep on Reporting → Canary Wire show it.",
        access: "canaryWire",
        token: true,
        notes:
          "months are the last six months with Canary Wire content from June 2026, oldest first; a month nobody published for is skipped. The current month in Pacific is included once anyone has finished one of its modules, and a later month never is, however early its content was published. Each month is the same month GET /api/evals/canary-wire returns, with the same people, scope and exemptions. A rep's mark is the percentage of their own lineup they finished that month, null when they owed nothing; exempt marks a month they didn't count yet (pre-bootcamp, or an SDR before their first full month). lastCompleted is the day they last finished a module of their own lineup in these months, as Sep 12, 2026, or an empty string. A team's, a role's and the totals' rates are in people: of those who owed something that month, the share who finished everything. Teams and their reps sort best first by the latest month, ties broken by the month before, and so on back. With format=csv, one row per rep with a column per month, blank where they owed nothing; the CSV is not capped at six months but has a column for every month with content from June 2026.",
        query: [
          { name: "scope", type: '"org" | "everyone"', note: "as for GET /api/evals/canary-wire" },
          { name: "format", type: '"csv"', note: "a CSV download instead of JSON" },
        ],
        returns:
          "{ months: string[], scope: \"org\" | \"everyone\", hasSnapshot, teams: { manager, managerEmail, roles: string[], directs: { name, email, role, manager, managerEmail, title, notActivated, marks: { pct: number | null, completed, assigned, exempt }[], lastCompleted: string }[], rates: { learners, finished, pct }[] }[], roles: { role, rates }[], totals: { learners, finished, pct }[], seriesLinks }; text/csv with format=csv",
        errors: [
          { status: 400, error: "invalid_scope", when: "scope is neither org nor everyone" },
          { status: 400, error: "not_a_manager", when: "scope is org and nobody reports to the caller" },
          { status: 400, error: "invalid_format", when: "format is set to anything but csv" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/canary-wire/pull",
        summary: "Returns the newest pull from Mindtickle, running or not, and whether Mindtickle is configured.",
        access: "canaryWire",
        token: true,
        notes:
          "A pull takes about 15 minutes, so it goes in steps of up to four minutes (POST /api/evals/canary-wire/pull/step), each saving where it got to. done of total counts learners fetched, 0 of 0 until the rosters are in. working is true while a step holds the pull. A running pull nobody works on for 6 hours is given up as failed. configured is false when MT_API_KEY or MT_SECRET_KEY is unset, and no pull can start.",
        returns: "{ configured: boolean, pull: { id, trigger: \"manual\" | \"schedule\", status: \"running\" | \"succeeded\" | \"failed\", message, done: number, total: number, error: string | null, startedAt, updatedAt, finishedAt: string | null, startedByName: string | null, working: boolean } | null }",
      },
      {
        method: "POST",
        path: "/api/evals/canary-wire/pull",
        summary: "Starts a pull from Mindtickle now (Sync Now), rather than waiting for the next two-hourly one.",
        access: "platform",
        token: true,
        notes:
          "Fetches nothing itself: call POST /api/evals/canary-wire/pull/step until the pull ends, as the page does. When it succeeds it replaces the Canary Wire's data.",
        returns: "{ pull: { id, trigger: \"manual\" | \"schedule\", status: \"running\" | \"succeeded\" | \"failed\", message, done: number, total: number, error: string | null, startedAt, updatedAt, finishedAt: string | null, startedByName: string | null, working: boolean } }",
        errors: [
          { status: 409, error: "running", when: "a pull is already running" },
          { status: 409, error: "not_configured", when: "Mindtickle's key pair or tenant is unset" },
        ],
      },
      {
        method: "POST",
        path: "/api/evals/canary-wire/pull/step",
        summary: "Works on the running pull for up to four minutes, then returns how it stands.",
        access: "platform",
        token: true,
        notes:
          "Answers at once, with the pull unchanged, when another step holds it, and with null when no pull is running. Each step fetches learners' histories in order and saves every ten, so a step cut short loses little. One learner's history failing is noted and costs that learner; Mindtickle refusing the key pair fails the pull. Allows 300 seconds.",
        returns: "{ pull: { id, trigger: \"manual\" | \"schedule\", status: \"running\" | \"succeeded\" | \"failed\", message, done: number, total: number, error: string | null, startedAt, updatedAt, finishedAt: string | null, startedByName: string | null, working: boolean } | null }",
      },
    ],
  },
  {
    id: "evals",
    title: "eVals settings",
    endpoints: [
      {
        method: "GET",
        path: "/api/evals/employees",
        summary: "Lists the employees stored by the last HiBob sync, a page at a time.",
        access: "employeeSearch",
        token: true,
        notes:
          "Training administrators read it to pick a bootcamp's guest judges. fullName and reportsToName are first and last name as the person's email spells them (first.last@), using HiBob's spelling of each word it has, with the first name replaced by the preferred first name the person gave on the Pre-Bootcamp form, when nameChosen is true (their official name is not changed); HiBob's full name is kept only for an email that is not first.last. total counts every stored employee, whatever the search.",
        query: [
          {
            name: "match",
            type: `"all" | "person"`,
            note: "What q searches. person: only the name and email, as the people pickers search. Default all.",
          },
          ...listQuery(EMPLOYEE_LIST.sorts, "the name, email, title, department, site, or the manager's name or email"),
        ],
        returns: `{ people: { id, email, fullName, nameChosen: boolean, title, department, site, reportsToEmail, reportsToName, startDate, activeEffectiveDate }[], ${PAGE_FIELDS}, total: number, syncedAt: ISO 8601 string | null }`,
        errors: [{ status: 400, error: "invalid_match", when: "match is not all or person" }],
      },
      {
        method: "GET",
        path: "/api/evals/organization",
        summary: "Lists who the last HiBob sync found reporting up to the Organization Leader, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "depth counts the links between a person and the leader, the leader included. managementChain is the emails of their managers, from the direct one up to and including the leader, joined with semicolons and no spaces. track is the one an administrator set by hand, if any; otherwise ignored for a title on the Ignored list, deferred when they started too close to the next bootcamp (see GET /api/evals/deferral-days), or else the Sales or Engineer list their title is on, or null for a title on no list. btcDate and intDate are the day of the latest BTC and INT they attended (a released class they were assessed in), null where there is none; btcScore and intScore are the mean of their assessments there, from 1 (poor) to 4 (outstanding), to one decimal place. The list is as of the last sync; current is false once a different leader has been set since, until the next sync runs. total counts everyone listed, whatever the search.",
        query: listQuery(ORGANIZATION_LIST.sorts, "the name, email, title, department, track, or the manager's name or email"),
        returns: `{ members: { email, fullName, title, department, reportsToEmail, reportsToName, track: "sales" | "engineer" | "ignored" | "exempt" | "deferred" | null, depth, leaderEmail, managementChain: string, btcDate, btcScore, intDate, intScore }[], ${PAGE_FIELDS}, total: number, leaderEmail: string | null, current: boolean }`,
      },
      {
        method: "GET",
        path: "/api/evals/titles",
        summary: "Lists the titles on the Sales, Engineer and Ignored lists, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        query: [
          { name: "list", type: `"sales" | "engineer" | "ignored"`, note: "One list only. Default every list." },
          ...listQuery(TITLE_LIST.sorts, "the title or who added it"),
        ],
        returns: `{ titles: { id, list: "sales" | "engineer" | "ignored", title, createdAt, addedBy: string | null }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 400, error: "invalid_list", when: "list is not one of the three" }],
      },
      {
        method: "POST",
        path: "/api/evals/titles",
        summary: "Adds titles to one list.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Titles are compared case-insensitively after collapsing whitespace. A title already on any list is reported in existing and not moved. Blank titles are dropped.",
        body: {
          kind: "json",
          fields: [
            { name: "list", type: `"sales" | "engineer" | "ignored"`, required: true },
            { name: "titles", type: "string[]", required: true, note: "1–500 titles, each up to 200 characters" },
          ],
        },
        returns: "{ added: string[], existing: { title, list }[] }",
        errors: [{ status: 400, error: "invalid", when: "the body does not parse" }],
      },
      {
        method: "PATCH",
        path: "/api/evals/titles/{id}",
        summary: "Renames a listed title, or moves it to another list.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        body: {
          kind: "json",
          fields: [
            { name: "title", type: "string", required: true, note: "up to 200 characters" },
            { name: "list", type: `"sales" | "engineer" | "ignored"`, note: "omit to keep the current list" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or the title is blank" },
          { status: 404, error: "not_found", when: "id is not a UUID, or no such title" },
          { status: 409, error: "duplicate", when: "another entry has that title; the body also carries its list" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/evals/titles/{id}",
        summary: "Removes a title from its list.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such title" }],
      },
      {
        method: "GET",
        path: "/api/evals/assessments",
        summary: "Lists the assessments attendees can be scored on, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "criteria counts those still asked; submissions counts the attendees scored on it at any bootcamp. total counts every assessment, whatever the search.",
        query: listQuery(ASSESSMENT_LIST.sorts, "the name"),
        returns: `{ assessments: { id, name, stage: "bootcamp" | "intermediate", audience: "sales" | "engineer" | "both", active: boolean, updatedAt, criteria: number, submissions: number }[], ${PAGE_FIELDS}, total: number }`,
      },
      {
        method: "GET",
        path: "/api/evals/assessments/unassigned-breakouts",
        summary: "Lists the breakouts at scheduled and active bootcamps that name no assessment.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Ordered by the bootcamp's start date, then track, day and start; at most 100. total counts every such breakout. Their groups appear under no assessment's Assigned to me until one is picked on the session's Breakout Assignments.",
        returns: `{ breakouts: { id, name, track: "btc" | "int" | "btc_se" | "int_se", day: number, start: number, bootcampId, bootcampStartDate, bootcampStatus: "scheduled" | "active" }[], total: number }`,
      },
      {
        method: "POST",
        path: "/api/evals/assessments",
        summary: "Creates an assessment and its criteria.",
        access: "assessmentsAdmin",
        token: true,
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: `up to ${EVALS_ASSESSMENT_LIMITS.name} characters` },
            { name: "stage", type: `"bootcamp" | "intermediate"`, required: true, note: "the session it scores" },
            { name: "audience", type: `"sales" | "engineer" | "both"`, required: true, note: "the tracks it scores" },
            { name: "active", type: "boolean", required: true, note: "whether the eVals page offers it" },
            {
              name: "criteria",
              type: "{ id?: string, name: string, description?: string }[]",
              required: true,
              note: `1 to ${EVALS_ASSESSMENT_LIMITS.criteria}, in the order they are asked; a name up to ${EVALS_ASSESSMENT_LIMITS.criterionName} characters, a description up to ${EVALS_ASSESSMENT_LIMITS.description}`,
            },
          ],
        },
        returns: "{ id }",
        errors: [{ status: 400, error: "invalid", when: "the body is not that shape, or a criterion has an id" }],
      },
      {
        method: "GET",
        path: "/api/evals/assessments/{id}",
        summary: "Reads one assessment and the criteria it still asks, in order.",
        access: "assessmentsAdmin",
        token: true,
        notes: "scored says some submission holds a score against that criterion, so removing it retires it rather than deleting it.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: `{ id, name, stage, audience, active, createdAt, updatedAt, submissions: number, criteria: { id, name, description, scored: boolean }[] }`,
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such assessment" }],
      },
      {
        method: "PUT",
        path: "/api/evals/assessments/{id}",
        summary: "Replaces an assessment's fields and criteria.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "A criterion sent with its id is kept, renamed and moved as given; one sent without an id is added; one left out is deleted if nobody has been scored on it, or else retired, so it is no longer asked but the scores given against it remain. Submissions keep the names they were scored under. Once anyone has been scored on it, stage and audience cannot change. An attendee scored before a criterion was added shows as needing rescoring.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: `up to ${EVALS_ASSESSMENT_LIMITS.name} characters` },
            { name: "stage", type: `"bootcamp" | "intermediate"`, required: true, note: "the session it scores" },
            { name: "audience", type: `"sales" | "engineer" | "both"`, required: true, note: "the tracks it scores" },
            { name: "active", type: "boolean", required: true, note: "whether the eVals page offers it" },
            {
              name: "criteria",
              type: "{ id?: string, name: string, description?: string }[]",
              required: true,
              note: `1 to ${EVALS_ASSESSMENT_LIMITS.criteria}, in the order they are asked; a name up to ${EVALS_ASSESSMENT_LIMITS.criterionName} characters, a description up to ${EVALS_ASSESSMENT_LIMITS.description}`,
            },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or a criterion id is not one it still asks" },
          { status: 404, error: "not_found", when: "id is not a UUID, or no such assessment" },
          { status: 409, error: "locked", when: "stage or audience changes on an assessment someone has been scored on" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/evals/assessments/{id}",
        summary: "Removes an assessment nobody has been scored on.",
        access: "assessmentsAdmin",
        token: true,
        notes: "One with scores is kept; set active to false with PUT instead.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "id is not a UUID, or no such assessment" },
          { status: 409, error: "has_scores", when: "someone has been scored or recorded on it" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/slack-contacts",
        summary: "Lists the Additional Slack Contacts, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "These people are added to the Slack messages sent to each attendee's team at the end of a bootcamp, after the attendee's management chain. fullName is their name in the employee list now, and empty only if it has none. total counts every contact, whatever the search.",
        query: listQuery(SLACK_CONTACT_LIST.sorts, "the name, the email or who added them"),
        returns: `{ contacts: { id, email, fullName, createdAt, addedBy: string | null }[], ${PAGE_FIELDS}, total: number }`,
      },
      {
        method: "POST",
        path: "/api/evals/slack-contacts",
        summary: "Adds one Additional Slack Contact.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "The email is lowercased and must belong to someone at Harness, in the employee list from the last HiBob sync: anyone the app reaches in Slack is in HiBob. fullName is their name there.",
        body: {
          kind: "json",
          fields: [{ name: "email", type: "string", required: true, note: "up to 320 characters" }],
        },
        returns: "{ id, email, fullName }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or email is not an email address" },
          { status: 400, error: "not_employee", when: "nobody at Harness in the employee list has that email" },
          { status: 409, error: "duplicate", when: "that email is already a contact" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/evals/slack-contacts/{id}",
        summary: "Removes one Additional Slack Contact.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such contact" }],
      },
      {
        method: "GET",
        path: "/api/evals/hibob/sync",
        summary: "Lists the HiBob sync log a page at a time, newest first.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "A run that has said running for over 10 minutes is shown as failed, and running is false for it. running says whether a sync is under way, whichever page is asked for. The HiBob token itself is never returned.",
        query: listQuery(HIBOB_SYNC_LIST.sorts, "who started it, the trigger, the status or the error", "desc"),
        returns: `{ runs: { id, trigger: "schedule" | "manual", triggeredBy: string | null, status: "running" | "succeeded" | "failed", startedAt, finishedAt, employeeCount, skipped, error }[], ${PAGE_FIELDS}, running: boolean, serviceUser: string | null }`,
      },
      {
        method: "POST",
        path: "/api/evals/hibob/sync",
        summary: "Syncs every active employee from HiBob now.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Calls HiBob and replaces the whole employees table in one transaction, so a failed sync leaves the previous one in place. Can take several seconds; the route allows 180. Every attempt, failed or not, is logged in the sync history.",
        returns: "{ count: number, skipped: number }",
        errors: [
          { status: 409, error: "already_running", when: "another sync is running" },
          { status: 409, error: "not_configured", when: "the deployment has no HiBob service user or token" },
          { status: 422, error: "rejected", when: "HiBob refused the credentials; detail says more" },
          { status: 502, error: "unreachable", when: "HiBob could not be reached; detail says more" },
          { status: 502, error: "bad_response", when: "HiBob answered with an error or no employee list; detail says more" },
        ],
      },
      {
        method: "PUT",
        path: "/api/evals/org-leader",
        summary: "Sets the Organization Leader whose reports eVals draws attendees from.",
        access: "assessmentsAdmin",
        token: true,
        body: {
          kind: "json",
          fields: [
            { name: "email", type: "string", required: true, note: "an employee from the last HiBob sync; stored lowercased" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "email is missing or malformed" },
          { status: 400, error: "not_an_employee", when: "the last HiBob sync did not import that email" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/candidate-cutoffs",
        summary: "Gets the date cutoffs on who in the org counts as a bootcamp or intermediate candidate.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "A candidate's HiBob start date must be on or after startDateOnOrAfter, or blank; their HiBob active effective date must be after activeEffectiveDateAfter, and not blank. null means that cutoff is off. Until one is saved, each is the Google Sheet's: 2025-04-01 and 2026-01-01.",
        returns: `{ startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }`,
      },
      {
        method: "PUT",
        path: "/api/evals/candidate-cutoffs",
        summary: "Sets either or both candidate date cutoffs.",
        access: "assessmentsAdmin",
        token: true,
        notes: "A field left out keeps its value. The Current tab uses the new cutoffs at once; no sync is needed.",
        body: {
          kind: "json",
          fields: [
            { name: "startDateOnOrAfter", type: `"YYYY-MM-DD" | null`, note: "null turns the cutoff off" },
            { name: "activeEffectiveDateAfter", type: `"YYYY-MM-DD" | null`, note: "null turns the cutoff off" },
          ],
        },
        returns: `{ startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }, as saved`,
        errors: [
          { status: 400, error: "invalid", when: "neither field is given, a date is not a real YYYY-MM-DD day, or the body has another field" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/deferral-days",
        summary: "Gets the deferral window: how close to the next bootcamp someone can start and still be put in it.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Someone whose HiBob start date is fewer than days before bootcampStart, or after it, is on the deferred track rather than their title list's; an ignored title or a track set by hand still comes first. A blank start date is never deferred. 0 turns deferral off. Until one is saved, days is the Google Sheet's 14. bootcampStart is the active bootcamp's start, else the soonest scheduled one starting today or later, or null when there is none, which also leaves no one deferred.",
        returns: `{ days: number, bootcampStart: "YYYY-MM-DD" | null }`,
      },
      {
        method: "PUT",
        path: "/api/evals/deferral-days",
        summary: "Sets the deferral window, and retracks the org by it at once.",
        access: "assessmentsAdmin",
        token: true,
        notes: "Every org member's track is worked out again rather than at the next sync; retracked counts those whose track changed. Creating, editing or deleting a bootcamp does the same.",
        body: {
          kind: "json",
          fields: [{ name: "days", type: "integer", required: true, note: "0 to 365; 0 turns deferral off" }],
        },
        returns: `{ days: number, bootcampStart: "YYYY-MM-DD" | null, retracked: number }`,
        errors: [{ status: 400, error: "invalid", when: "days is missing, not a whole number from 0 to 365, or the body has another field" }],
      },
    ],
  },
  {
    id: "platform",
    title: "Platform",
    endpoints: [
      {
        method: "GET",
        path: "/api/settings/domains",
        summary: "Lists the email domains allowed to sign in, those added here a page at a time.",
        access: "platform",
        token: true,
        notes:
          "fromEnvironment comes from AUTH_ALLOWED_EMAIL_DOMAINS, cannot be changed through the API, and is returned whole whatever the query: the search and the paging apply to domains only.",
        query: listQuery(DOMAIN_LIST.sorts, "the domain, the note or who added it"),
        returns: `{ domains: { id, domain, note, createdAt, addedBy: string | null }[], ${PAGE_FIELDS}, fromEnvironment: string[] }`,
      },
      {
        method: "POST",
        path: "/api/settings/domains",
        summary: "Adds a sign-in domain.",
        access: "platform",
        token: false,
        notes:
          "The domain is lowercased, and anything up to an @ is dropped, so an email address works too.",
        body: {
          kind: "json",
          fields: [
            { name: "domain", type: "string", required: true, note: "up to 253 characters" },
            { name: "note", type: "string", note: "up to 200 characters" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or the domain is not a valid domain" },
          { status: 409, error: "duplicate", when: "the domain is already listed" },
          { status: 409, error: "self_lockout", when: "the change would leave you unable to sign in" },
        ],
      },
      {
        method: "PATCH",
        path: "/api/settings/domains/{id}",
        summary: "Changes a sign-in domain and its note.",
        access: "platform",
        token: false,
        notes: "Sending no note clears it.",
        params: [{ name: "id", type: "string", required: true }],
        body: {
          kind: "json",
          fields: [
            { name: "domain", type: "string", required: true, note: "up to 253 characters" },
            { name: "note", type: "string", note: "up to 200 characters" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or the domain is not a valid domain" },
          { status: 404, error: "not_found", when: "no such domain" },
          { status: 409, error: "duplicate", when: "another entry has that domain" },
          { status: 409, error: "self_lockout", when: "the change would leave you unable to sign in" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/settings/domains/{id}",
        summary: "Removes a sign-in domain.",
        access: "platform",
        token: false,
        notes: "People on that domain can no longer sign in, unless another rule still allows them.",
        params: [{ name: "id", type: "string", required: true }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "no such domain" },
          { status: 409, error: "self_lockout", when: "the change would leave you unable to sign in" },
        ],
      },
      {
        method: "GET",
        path: "/api/settings/frame-domains",
        summary: "Lists the sites allowed to show the app in a frame, a page at a time.",
        access: "platform",
        token: true,
        notes:
          "Every page's Content-Security-Policy is frame-ancestors 'self' plus each of these domains and its subdomains; with none, only the app's own pages may frame it.",
        query: listQuery(FRAME_DOMAIN_LIST.sorts, "the domain, the note or who added it"),
        returns: `{ domains: { id, domain, note, createdAt, addedBy: string | null }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "POST",
        path: "/api/settings/frame-domains",
        summary: "Allows a site to show the app in a frame.",
        access: "platform",
        token: false,
        notes:
          "The domain is lowercased, and a URL or a leading *. is reduced to its domain. Subdomains are always allowed with it. Other instances pick the change up within 30 seconds.",
        body: {
          kind: "json",
          fields: [
            { name: "domain", type: "string", required: true, note: "up to 253 characters" },
            { name: "note", type: "string", note: "up to 200 characters" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or the domain is not a valid domain" },
          { status: 409, error: "duplicate", when: "the domain is already listed" },
        ],
      },
      {
        method: "PATCH",
        path: "/api/settings/frame-domains/{id}",
        summary: "Changes a frame domain and its note.",
        access: "platform",
        token: false,
        notes: "Sending no note clears it.",
        params: [{ name: "id", type: "string", required: true }],
        body: {
          kind: "json",
          fields: [
            { name: "domain", type: "string", required: true, note: "up to 253 characters" },
            { name: "note", type: "string", note: "up to 200 characters" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or the domain is not a valid domain" },
          { status: 404, error: "not_found", when: "no such domain" },
          { status: 409, error: "duplicate", when: "another entry has that domain" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/settings/frame-domains/{id}",
        summary: "Stops a site from showing the app in a frame.",
        access: "platform",
        token: false,
        notes: "Frames already open keep the page they loaded; the next page they load is refused.",
        params: [{ name: "id", type: "string", required: true }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "no such domain" }],
      },
      {
        method: "GET",
        path: "/api/backups",
        summary: "Lists this deployment's Cloud SQL backups, newest first.",
        access: "platform",
        token: false,
        notes: "Reads up to 50 backups from the Cloud SQL Admin API.",
        returns:
          "{ backups: { id, type, status, startTime, endTime, location, description, error }[] }",
        errors: [
          { status: 503, error: "not_configured", when: "GCP_ADMIN_PROJECT_ID or CLOUD_SQL_INSTANCE is unset" },
          { status: 502, error: "permission_denied", when: "Cloud SQL refused the app's credentials" },
          { status: 502, error: "unavailable", when: "Cloud SQL failed for another reason" },
        ],
      },
      {
        method: "POST",
        path: "/api/backups",
        summary: "Takes an on-demand backup of this deployment's database.",
        access: "platform",
        token: false,
        notes: "Starts the backup and returns; it finishes in Cloud SQL. The action is written to the audit log.",
        body: {
          kind: "json",
          fields: [
            {
              name: "description",
              type: "string",
              note: "up to 255 characters; defaults to \"On demand — {your email}\"",
            },
          ],
        },
        returns: "202 { ok: true }",
        errors: [
          { status: 400, error: "invalid_body", when: "description is over 255 characters" },
          { status: 503, error: "not_configured", when: "GCP_ADMIN_PROJECT_ID or CLOUD_SQL_INSTANCE is unset" },
          { status: 502, error: "permission_denied", when: "Cloud SQL refused the app's credentials" },
          { status: 502, error: "unavailable", when: "Cloud SQL failed for another reason" },
        ],
      },
      {
        method: "POST",
        path: "/api/backups/{id}/restore",
        summary: "Restores this deployment's database from a backup.",
        access: "platform",
        token: false,
        notes:
          "Overwrites the whole database, including sessions, with the backup. Irreversible. Events created since the backup that still hold cloud resources lose their only record; they are returned as stranded. The attempt is written to the audit log before it runs.",
        params: [{ name: "id", type: "string", required: true, note: "the backup run id" }],
        body: {
          kind: "json",
          fields: [
            {
              name: "confirmation",
              type: "string",
              required: true,
              note: "must be this deployment's Cloud SQL instance name",
            },
          ],
        },
        returns: "202 { ok: true, stranded: { id, name }[] }",
        errors: [
          { status: 400, error: "invalid_body", when: "confirmation is missing" },
          { status: 400, error: "confirmation_mismatch", when: "confirmation is not the instance name" },
          { status: 404, error: "not_found", when: "no such backup" },
          { status: 409, error: "not_restorable", when: "the backup did not succeed" },
          { status: 503, error: "not_configured", when: "GCP_ADMIN_PROJECT_ID or CLOUD_SQL_INSTANCE is unset" },
          { status: 502, error: "permission_denied", when: "Cloud SQL refused the app's credentials" },
          { status: 502, error: "unavailable", when: "Cloud SQL failed for another reason" },
        ],
      },
      {
        method: "GET",
        path: "/api/backups/production",
        summary: "Lists production's backups, on a deployment that can import them.",
        access: "platform",
        token: false,
        notes: "Only QA has this. Production, and anywhere not configured for it, answers 404.",
        returns:
          "{ backups: { id, type, status, startTime, endTime, location, description, error }[] }",
        errors: [
          { status: 404, error: "not_found", when: "this deployment cannot import production backups" },
          { status: 502, error: "permission_denied", when: "Cloud SQL refused the app's credentials" },
          { status: 502, error: "unavailable", when: "Cloud SQL failed for another reason" },
        ],
      },
      {
        method: "POST",
        path: "/api/backups/production/{id}/import",
        summary: "Replaces this deployment's database with one of production's backups.",
        access: "platform",
        token: false,
        notes:
          "QA only. Starts a tf-runner job that pauses QA's reaper and provisioner, backs QA up, restores the production backup, and calls the finish step. Overwrites QA's whole database; progress is in the job's logs. Refused while any QA event holds cloud resources. The action is written to the audit log.",
        params: [{ name: "id", type: "string", required: true, note: "the production backup run id" }],
        body: {
          kind: "json",
          fields: [
            {
              name: "confirmation",
              type: "string",
              required: true,
              note: "must be this (QA's) Cloud SQL instance name, not production's",
            },
          ],
        },
        returns: "202 { ok: true, execution: string | null }",
        errors: [
          { status: 404, error: "not_found", when: "this deployment cannot import, or no such backup" },
          { status: 400, error: "invalid_body", when: "confirmation is missing" },
          { status: 400, error: "confirmation_mismatch", when: "confirmation is not this instance's name" },
          { status: 409, error: "not_restorable", when: "the backup did not succeed" },
          { status: 409, error: "runs_hold_resources", when: "events here still hold cloud resources; holding lists them" },
          { status: 503, error: "not_configured", when: "AUTH_URL or TF_RUNNER_JOB is unset" },
          { status: 502, error: "permission_denied", when: "Google Cloud refused the app's credentials" },
          { status: 502, error: "unavailable", when: "Cloud SQL or Cloud Run failed for another reason" },
        ],
      },
    ],
  },
  {
    id: "audit",
    title: "Audit trail",
    endpoints: [
      {
        method: "GET",
        path: "/api/audit",
        summary: "Lists the audit trail a page at a time: every change made through the API, every sign-in, and what the runner did on its own.",
        access: "platform",
        token: true,
        notes:
          "A request refused with 401 is not recorded, and nor is a GET or a POST that changes nothing. Request bodies are stored with secret-looking fields redacted.",
        query: listQuery(AUDIT_LIST.sorts, "who, action, summary, path, target, address, outcome or detail", "desc"),
        returns: `{ events: { id, at: ISO 8601 string, actorId: string | null, actorName: string | null, actorEmail: string | null, via: "session" | "token" | "system" | "anonymous", action, summary, path: string | null, target: string | null, targetLabel: string | null, status: number | null, outcome: "succeeded" | "denied" | "failed", detail: object | null, ip: string | null }[], ${PAGE_FIELDS} }`,
      },
    ],
  },
  {
    id: "internal",
    title: "Internal",
    endpoints: [
      {
        method: "GET",
        path: "/api/auth/{...nextauth}",
        summary: "Auth.js sign-in, callback and session endpoints, and the one OAuth callback every connection returns to.",
        access: "internal",
        token: false,
        notes:
          "GET /api/auth/callback/google is the only redirect URI any provider needs: Google sign-in, Connect Google account (GET /api/evals/google-meetings/connect), Connect Zoom user (GET /api/evals/google-meetings/zoom/connect) and Add to Slack (GET /api/cohorts/slack/install) all return to it. A state that starts wo. is a connection, and is handled here for a signed-in session only (401 without one, 403 without the role the connection needs, 400 for a purpose it does not know, 503 when the provider is not configured), redirecting back to the page that started it; any other state is Auth.js's sign-in.",
        returns: "handled by Auth.js, or a redirect back to the page a connection started from",
      },
      {
        method: "POST",
        path: "/api/auth/{...nextauth}",
        summary: "Auth.js sign-in, callback and session endpoints.",
        access: "internal",
        token: false,
        returns: "handled by Auth.js",
      },
      {
        method: "POST",
        path: "/api/settings/timed-jobs/tick",
        summary: "Starts each of the app's own timed jobs that has fallen due, for Cloud Scheduler.",
        access: "internal",
        token: false,
        notes:
          "Called every five minutes. Accepts only a Google-signed OIDC token for TIMED_JOBS_AUDIENCE from the TIMED_JOBS_INVOKER service account; either unset refuses every call. Starts, side by side, every job GET /api/settings/timed-jobs lists with via \"dispatcher\" whose schedule fell due in the last 30 minutes and after the time it was last started for; that time is claimed first, so a retried or doubled call starts nothing twice, and a time missed by more than 30 minutes is skipped rather than run late. Each job runs the same code as its Sync Now button, logged with trigger schedule: the HiBob sync and then the cohort Slack sync as POST /api/cohorts/slack/sync runs it, with the day's intake form reminders; the Google Meetings sync as POST /api/evals/google-meetings/sync without preview, so a dry run while the sync is not live and on the test group's invites while it is on; and a step of the Canary Wire's pull. A job switched off is recorded as skipped and answers { skipped: \"off\" }. Answers 502, with the same body, if any job it started failed, so Cloud Scheduler's history shows it. Allows 300 seconds.",
        returns:
          "{ ran: { key: string, status: number, body: <as that job's own route answers, or { skipped: string }> }[] }; an empty ran when nothing was due",
        errors: [
          { status: 401, error: "unauthorized", when: "the OIDC token is missing, invalid or from someone else" },
        ],
      },
      {
        method: "POST",
        path: "/api/backups/production/finish",
        summary: "Finishes a production import, called by the import job.",
        access: "internal",
        token: false,
        notes:
          "Accepts only a Google-signed OIDC token for PRODUCTION_IMPORT_AUDIENCE from the PRODUCTION_IMPORT_INVOKER service account. Runs every migration, deletes production's sessions, invites, API tokens and Harness credentials, clears imported attendee passwords, revokes everyone's access, then restores the snapshot users' roles and Google sign-in links. Allows 300 seconds.",
        body: {
          kind: "json",
          fields: [
            { name: "backupId", type: "string", required: true, note: "digits only" },
            { name: "actor", type: "string", required: true, note: "who started the import" },
            {
              name: "snapshot[]",
              type: "object[]",
              required: true,
              note: "QA's users before the restore: id, email, name, image, eventRole, trainingRole, assessmentsRole, irisRole, isPlatformAdmin, calendarScope, accounts[]",
            },
          ],
        },
        returns:
          "{ migrations: string[], attendeePasswordsCleared: number, usersRestored: number, usersAdded: number }",
        errors: [
          { status: 401, error: "unauthorized", when: "not QA, or the OIDC token is missing, invalid or from someone else" },
          { status: 400, error: "invalid_body", when: "the body does not parse" },
          { status: 500, error: "finish_failed", when: "a migration or the clean-up failed; detail has the message" },
        ],
      },
    ],
  },
];
