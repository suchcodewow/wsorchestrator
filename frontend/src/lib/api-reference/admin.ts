import { DIETARY_LIST, FOOD_ORDER_LIST, GUEST_JUDGE_LIST, INTAKE_RESPONSE_LIST, JUDGE_PROSPECT_LIST, ASSESSMENT_ATTENDEE_LIST, ASSESSMENT_LIST, AUDIT_LIST, BOOTCAMP_HISTORY_LIST, BOOTCAMP_LIST, CURRENT_COHORT_LIST, DOMAIN_LIST, EMPLOYEE_LIST, HIBOB_SYNC_LIST, HISTORY_STATUSES, JUDGE_LIST, ORGANIZATION_LIST, PREVIOUS_SESSION_LIST, SESSION_COMMENT_LIST, SESSION_TYPE_LIST, GOOGLE_MEETING_LIST, SLACK_CONTACT_LIST, SLACK_SYNC_CHANGE_LIST, SLACK_SYNC_LIST, CHANNEL_CONTACT_LIST, TITLE_LIST, USER_LIST, FACILITY_LIST } from "@/lib/list-specs";
import { BOOTCAMP_LIMITS, CHECKLIST_LIMITS, EVALS_ASSESSMENT_LIMITS, FACILITY_LIMITS, FOOD_ORDER_LIMITS, GOOGLE_MEETING_LIMITS, INTAKE_LIMITS, SCHEDULE_LIMITS } from "@/db/schema";
import { PAGE_SIZE } from "@/lib/paging";
import { CHECKLIST_ITEM_ROW } from "./account";
import { GUEST_JUDGE_DEPARTMENTS, GUEST_SPEAKER_LIMITS } from "@/lib/logistics/guest-judge-values";
import { PAGE_FIELDS, listQuery } from "./paging";
import type { Endpoint, EndpointGroup, Field } from "./types";

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
  when: "a judge is not in the employee list; email names them",
};

const ACTIVE_EXISTS_ERROR: EndpointError = {
  status: 409,
  error: "active_exists",
  when: "status is active, another bootcamp already is, and completeActive does not name it; active names it",
};

const INTAKE_QUESTION_SHAPE = `{ id, kind: "short" | "paragraph" | "choice" | "checkboxes" | "dropdown", title, description, required: boolean, options: string[], other: boolean }`;

const INTAKE_FORM_FIELDS: Field[] = [
  { name: "title", type: "string", required: true, note: `up to ${INTAKE_LIMITS.title} characters` },
  { name: "description", type: "string", note: `up to ${INTAKE_LIMITS.description} characters; shown under the title` },
  {
    name: "questions",
    type: `${INTAKE_QUESTION_SHAPE}[]`,
    required: true,
    note: `1 to ${INTAKE_LIMITS.questions}, in the order asked, each id distinct. A choice, checkboxes or dropdown question needs 1 to ${INTAKE_LIMITS.options} distinct options of up to ${INTAKE_LIMITS.option} characters; other adds a free-text "Other" to choice and checkboxes, and is ignored on the rest`,
  },
];

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
          "pendingAdmins lists the SITE_ADMIN_EMAILS addresses that have not signed in yet, whichever page is asked for.",
        query: listQuery(USER_LIST.sorts, "the name or email"),
        returns: `{ users: { id, name, email, eventRole, trainingRole, assessmentsRole, isPlatformAdmin, isBootstrapAdmin, eventCount }[], ${PAGE_FIELDS}, pendingAdmins: string[] }`,
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
              note: "required when area is training or assessments; null removes access. The assessments role covers Iris too: a viewer takes it, an administrator runs it.",
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
          "A bootcamp candidate is anyone under the Organization Leader, on the sales, engineer or deferred track or on none, with no BTC date in their bootcamp history; an intermediate candidate has a BTC date and no INT date. Either must also pass the date cutoffs in GET /api/evals/candidate-cutoffs, which cutoffs echoes. The ignored and exempt tracks are left out. A track is, first, one an administrator set by hand with PUT /api/cohorts/current/track, which overridden marks; then exempt where their history says so; then ignored for a title on the Ignored list; then deferred when their HiBob start date is fewer than deferral.days before deferral.bootcampStart, or after it; then the Sales or Engineer list their title is on. undecided is a title on no list. members never includes anyone deferred, and track cannot ask for them; they are on GET /api/cohorts/deferred. deferral echoes GET /api/evals/deferral-days. counts gives each stage on each track, deferred included; each stage's counts ignore the track filter, each track's ignore the stage filter, and neither depends on the search. activeBootcamp is the one active bootcamp, or null. Scores are shown only to a caller in eVals; for anyone else btcScore is null, scores is {}, averageScore is null and assessments is null. For a caller in eVals, assessments is null unless stage is given and track is sales or engineer; then it lists the active assessments for that stage whose audience is that track or both, by name, and each member's scores gives their average score on each of them at the active bootcamp, by assessment id, for those scored there. An intermediate assessment's scores need an active bootcamp with an intermediate class. averageScore is the mean of scores to one decimal place, or null when there are none; sorting by it puts those with none last, and without score columns it orders by name.",
        query: [
          { name: "stage", type: `"bootcamp" | "intermediate"`, note: "only that stage; both if omitted" },
          { name: "track", type: `"sales" | "engineer" | "undecided"`, note: "only that track; all three if omitted" },
          ...listQuery(CURRENT_COHORT_LIST.sorts, "the name, email, title or track"),
        ],
        returns: `{ stage: string | null, track: string | null, assessments: { id, name }[] | null, members: { email, fullName, title, department, site, reportsToEmail, reportsToName, startDate: "YYYY-MM-DD" | null, activeEffectiveDate: "YYYY-MM-DD" | null, track: "sales" | "engineer" | "undecided", overridden: boolean, stage: "bootcamp" | "intermediate", historyId: string | null, btcDate: "YYYY-MM-DD" | null, btcScore: number | null, scores: Record<assessment id, number>, averageScore: number | null }[], ${PAGE_FIELDS}, counts: Record<"bootcamp" | "intermediate", { sales: number, engineer: number, undecided: number, deferred: number }>, syncedAt: ISO 8601 string | null, cutoffs: { startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }, deferral: { days: number, bootcampStart: "YYYY-MM-DD" | null }, activeBootcamp: { id, startDate, btcDays, intDays } | null }`,
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
          "A candidate is drawn as for GET /api/cohorts/current, which says who is deferred: their HiBob start date is fewer than deferral.days before deferral.bootcampStart, or after it, or an administrator deferred them with PUT /api/cohorts/current/track, which overridden marks. Any other track takes them off this list and onto GET /api/cohorts/current. counts gives how many are deferred in each stage, whatever the stage filter or the search. deferral echoes GET /api/evals/deferral-days; bootcampStart is the active bootcamp's start, or else the next scheduled one's, or null when there is neither, when no one is deferred by the rule. activeBootcamp is the one active bootcamp, or null. No assessment is set for the deferred track, so scores is always {} and averageScore null; btcScore is shown only to a caller in eVals, and is null for anyone else.",
        query: [
          { name: "stage", type: `"bootcamp" | "intermediate"`, note: "only that stage; both if omitted" },
          ...listQuery(CURRENT_COHORT_LIST.sorts, "the name, email, title or track"),
        ],
        returns: `{ stage: string | null, members: { email, fullName, title, department, site, reportsToEmail, reportsToName, startDate: "YYYY-MM-DD" | null, activeEffectiveDate: "YYYY-MM-DD" | null, track: "deferred", overridden: boolean, stage: "bootcamp" | "intermediate", historyId: string | null, btcDate: "YYYY-MM-DD" | null, btcScore: number | null, scores: {}, averageScore: null }[], ${PAGE_FIELDS}, counts: { bootcamp: number, intermediate: number }, syncedAt: ISO 8601 string | null, cutoffs: { startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }, deferral: { days: number, bootcampStart: "YYYY-MM-DD" | null }, activeBootcamp: { id, startDate, btcDays, intDays } | null }`,
        errors: [{ status: 400, error: "invalid_stage", when: "stage is neither bootcamp nor intermediate" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/previous",
        summary: "Lists each day BTC or INT was held, with how many people attended each, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "A day is a session when anyone's bootcamp history has it as their BTC or INT date; 2000-01-01, which marks someone exempt, is never one. bootcamp and intermediate count the people with that BTC date and that INT date. total and first count every session, whatever page is asked for; first is null when there are none.",
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
          "Each side is ordered by name, from the employee list, with anyone not in it last by email; fullName is null for them, and active is false for anyone not in the employee list from the last HiBob sync. id is the person's bootcamp history record, for GET /api/evals/bootcamp-history/{id}.",
        params: [{ name: "date", type: "string", required: true, note: "YYYY-MM-DD" }],
        query: [
          { name: "bootcamp.page", type: "integer", note: `The bootcamp side's page, from 1. Default 1. A page holds at most ${PAGE_SIZE}.` },
          { name: "intermediate.page", type: "integer", note: `The intermediate side's page, the same way.` },
        ],
        returns: `{ date: "YYYY-MM-DD", bootcamp: { rows: { id, email, fullName: string | null, active: boolean }[], ${PAGE_FIELDS} }, intermediate: the same }`,
        errors: [
          { status: 400, error: "invalid_date", when: "date is not a real YYYY-MM-DD day" },
          { status: 404, error: "not_found", when: "no one's BTC or INT date is that day, as for 2000-01-01" },
        ],
      },
      {
        method: "PUT",
        path: "/api/cohorts/current/track",
        summary: "Sets one org member's track by hand; sales, engineer and ignored put their title on that list.",
        access: "trainingAdmin",
        token: true,
        notes:
          "sales, engineer and ignored put the person's title on that list, moving it off another list if it is on one, and re-track everyone in the org who holds it, compared as the lists compare titles; title says where it went, and is null when it was on that list already or the person has no title. Anyone else with the title whose track was set by hand keeps it. The person is also pinned to the choice where the rules still give them something else, such as exempt history or a late start, and always when they have no title. undecided, deferred and exempt pin just this person; deferred moves them from the Current tab to the Deferred tab. A pin holds through every later sync, title-list change and bootcamp change, until automatic hands the person back to the rules; exempt here does not change their bootcamp history. ignored and exempt take people off the Current tab. track in the response is the one the person has now, overridden whether they are pinned, and retracked how many people's tracks changed, the person included.",
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
          "Bootcamp Contacts (kind sales) are added to the active bootcamp's sales- Slack channels and Engineer Contacts (kind se) to its se- ones, beside the cohort. fullName is their name in the employee list, as of when they were added or the last HiBob sync since, and empty for someone not in it. total counts every contact of that kind, whatever the search.",
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
          "The email is lowercased. If it belongs to an imported employee, their name is stored with it; anyone else is added by email alone. The next Slack sync invites them.",
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
        summary: "Lists the Google meetings, a page at a time, with the connected Google account and who is on every invite.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "A meeting is upcoming until it ends. groups are the Current-tab groups it invites: bootcamp_sales is the bootcamp stage on the Sales track, and so on. status is not_synced until a sync sends its invite, synced once one has, changed when it was edited since, and failed when the last sync of it failed, with syncError saying why. invited counts the guests the last sync put on the invite. connection is null until an Assessments Administrator connects a Google account, and never includes its token; running says whether a sync is under way. administrators are the Assessments Administrators, on every invite and able to edit it. groupSizes counts whom each group would invite now. counts are every upcoming and past meeting, whatever the search.",
        query: [
          { name: "when", type: `"upcoming" | "past"`, note: "Default upcoming." },
          ...listQuery(GOOGLE_MEETING_LIST.sorts, "the title"),
        ],
        returns: `{ meetings: { id, title, startsAt, durationMinutes: 15 | 30 | 60, groups: ("bootcamp_sales" | "bootcamp_engineer" | "intermediate_sales" | "intermediate_engineer")[], zoomJoinUrl: string | null, status: "not_synced" | "synced" | "changed" | "failed", syncError: string | null, syncedAt: string | null, invited: number, addedBy: string | null }[], ${PAGE_FIELDS}, connection: { email, connectedAt, connectedBy: string | null, calendarId: string | null, lastSyncAt: string | null, lastSyncError: string | null, running: boolean } | null, zoomConfigured: boolean, administrators: string[], counts: { upcoming: number, past: number }, groupSizes: { bootcamp_sales, bootcamp_engineer, intermediate_sales, intermediate_engineer: number } }`,
        errors: [{ status: 400, error: "invalid_when", when: "when is not upcoming or past" }],
      },
      {
        method: "POST",
        path: "/api/evals/google-meetings",
        summary: "Adds a Google meeting. Nothing is sent until a sync.",
        access: "assessmentsAdmin",
        token: true,
        body: {
          kind: "json",
          fields: [
            { name: "title", type: "string", required: true, note: `1 to ${GOOGLE_MEETING_LIMITS.title} characters, trimmed` },
            { name: "startsAt", type: "string", required: true, note: "ISO 8601 with an offset, not in the past" },
            { name: "durationMinutes", type: "15 | 30 | 60", required: true },
            {
              name: "groups",
              type: `("bootcamp_sales" | "bootcamp_engineer" | "intermediate_sales" | "intermediate_engineer")[]`,
              note: "whom it invites besides the Assessments Administrators; defaults to none",
            },
          ],
        },
        returns: "{ id, title }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or a field is out of range" },
          { status: 400, error: "in_past", when: "startsAt has passed" },
        ],
      },
      {
        method: "PATCH",
        path: "/api/evals/google-meetings/{id}",
        summary: "Changes a Google meeting. The next sync sends the change.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        notes: "Any field left out is kept. A meeting can be renamed after it has ended, but not moved into the past.",
        body: {
          kind: "json",
          fields: [
            { name: "title", type: "string", note: `1 to ${GOOGLE_MEETING_LIMITS.title} characters, trimmed` },
            { name: "startsAt", type: "string", note: "ISO 8601 with an offset" },
            { name: "durationMinutes", type: "15 | 30 | 60" },
            {
              name: "groups",
              type: `("bootcamp_sales" | "bootcamp_engineer" | "intermediate_sales" | "intermediate_engineer")[]`,
              note: "replaces the set",
            },
          ],
        },
        returns: "{ id, title }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or a field is out of range" },
          { status: 400, error: "in_past", when: "startsAt changes to a time that has passed" },
          { status: 404, error: "not_found", when: "id is not a UUID, or no such meeting" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/evals/google-meetings/{id}",
        summary: "Deletes a Google meeting, first cancelling its invite and Zoom meeting.",
        access: "assessmentsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        notes:
          "A meeting still to end that a sync sent is cancelled in Google Calendar, which emails every guest, and its Zoom meeting is deleted; the row goes only once both are gone. A meeting that has ended, or was never synced, is deleted with nothing sent. Allows 60 seconds.",
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "id is not a UUID, or no such meeting" },
          { status: 409, error: "not_connected", when: "its invite needs cancelling and no working Google account is connected; detail says why" },
          { status: 502, error: "remote_failed", when: "Google or Zoom refused to cancel it; detail has their answer" },
        ],
      },
      {
        method: "POST",
        path: "/api/evals/google-meetings/sync",
        summary: "Creates and updates the Google Calendar invite and Zoom meeting of every meeting still to end.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "Runs as the connected Google account. The invites are on a calendar of its own, eVals Meetings, made on the first sync; every Assessments Administrator is given edit access to it, and is a guest on every invite. Each invite's guests are its groups' people on the Cohorts page's Current tab and the administrators; the sync takes off only guests it added itself. With Zoom set up, each meeting gets a Zoom meeting under the connected account, with every administrator who has an active Zoom user on that account as an alternative host. An invite or Zoom meeting already right is left alone, since a change emails every guest. One meeting failing is reported in its outcome and the sync carries on. notes lists what was skipped, such as an administrator Zoom does not know. Allows 300 seconds.",
        returns:
          '{ ok: true, account: string, meetings: { id, title, outcome: "created" | "updated" | "unchanged" | "failed", invited: number, error?: string }[], notes: string[] }',
        errors: [
          { status: 409, error: "not_connected", when: "no Google account is connected" },
          { status: 409, error: "running", when: "another sync is under way" },
          { status: 409, error: "revoked", when: "Google no longer accepts the account's token; connect it again" },
          { status: 502, error: "failed", when: "Google refused before any meeting was synced; detail has its answer" },
          { status: 503, error: "not_configured", when: "AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET is unset" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/google-meetings/connect",
        summary: "Sends the browser to Google to connect the account Google Meetings sends invites from.",
        access: "assessmentsAdmin",
        token: false,
        notes:
          "A browser link, not an API call: it redirects to Google's consent screen, asking for calendar access and a refresh token, with GOOGLE_USER as the sign-in hint when it is set. Google then sends the browser to the shared OAuth callback, GET /api/auth/callback/google, the URI already registered for sign-in. It checks the state cookie, trades the code for a refresh token, seals it, and stores it with the account's email. Reconnecting the same account replaces its token; a different one is refused while any meeting has an invite, because those invites are on the first account's calendar. It then redirects to the Google Meetings tab with ?google= connected, denied, expired, failed, scope or different_account (with ?current= naming the account already connected), and writes an audit record either way.",
        returns: "a redirect to accounts.google.com",
        errors: [{ status: 503, error: "not_configured", when: "AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET is unset" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/sync",
        summary: "Lists the cohort Slack channel sync's log a page at a time, newest first, with the active bootcamp's channels.",
        access: "trainingAdmin",
        token: true,
        notes:
          "A run that has said running for over 10 minutes is shown as failed. running says whether a sync is under way, whichever page is asked for; live whether syncs change Slack or are dry runs; configured whether there is a bot token to sync with, from the Slack app's install or the deployment's SLACK_BOT_TOKEN, which is never returned. active is null when no bootcamp is active; a channel's slackChannelId is null until a live sync has found or created it.",
        query: listQuery(SLACK_SYNC_LIST.sorts, "who started it, the trigger, the status or the error", "desc"),
        returns: `{ runs: { id, trigger: "schedule" | "manual", triggeredBy: string | null, status: "running" | "succeeded" | "skipped" | "failed", dryRun: boolean, startedAt, finishedAt, invited, removed, notInSlack, failures: number, unfinished: boolean, error: string | null }[], ${PAGE_FIELDS}, running: boolean, live: boolean, configured: boolean, active: { bootcampId, startDate: "YYYY-MM-DD", channels: { kind: "sales_bootcamp" | "se_bootcamp" | "sales_intermediate" | "se_intermediate", name, slackChannelId: string | null, created: boolean }[] } | null }`,
      },
      {
        method: "POST",
        path: "/api/cohorts/slack/sync",
        summary: "Syncs the active bootcamp's Slack channels with the Current tab now.",
        access: "trainingAdmin",
        token: true,
        notes:
          "Also runs after each scheduled HiBob sync. With no bootcamp active the run is skipped. Otherwise it finds or creates the public channels sales-bootcamp-{mon}-{yyyy} and se-bootcamp-{mon}-{yyyy}, and the -intermediate- pair when the bootcamp holds an intermediate class, from its start date; joins each; invites the Current tab's Sales and Engineers at that stage, and the Bootcamp Contacts, to the sales- channel, and its Engineers and the Engineer Contacts to the se- one; and removes anyone it invited earlier who no longer belongs. Undecided people are left out, and no one it did not invite is ever removed. In dry run (see PUT /api/cohorts/slack/settings) it changes nothing and the counts say what it would do. Slack's rate limits can stop a run part-way, when unfinished is true and the next run carries on. Allows 300 seconds; every attempt is logged.",
        returns: `{ ok: true, runId, status: "succeeded" | "skipped", dryRun: boolean, invited, removed, notInSlack, failures: number, unfinished: boolean }`,
        errors: [
          { status: 409, error: "already_running", when: "another sync is running" },
          { status: 409, error: "not_configured", when: "the Slack app is not installed and the deployment has no SLACK_BOT_TOKEN" },
          { status: 502, error: "slack_error", when: "Slack refused the token or a call every member would need, such as a missing scope; detail says which" },
        ],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/sync/{id}",
        summary: "One Slack sync run, and a page of what it did.",
        access: "trainingAdmin",
        token: true,
        notes:
          "One change per channel created or joined, per person invited, removed or refused, and per email with no Slack account (with an empty channelName). In a dry run each says what would have happened. fullName is the employee list's name for the email now, or null.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        query: listQuery(SLACK_SYNC_CHANGE_LIST.sorts, "the channel, the action, the email, the name or the detail"),
        returns: `{ run: <as in GET /api/cohorts/slack/sync>, changes: { id, channelName, action: "created" | "joined" | "invited" | "removed" | "not_in_slack" | "failed", email, fullName: string | null, detail: string | null, at }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such run" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/settings",
        summary: "Whether the cohort Slack sync is live or a dry run.",
        access: "trainingAdmin",
        token: true,
        returns: "{ live: boolean }",
      },
      {
        method: "PUT",
        path: "/api/cohorts/slack/settings",
        summary: "Turns the cohort Slack sync live, or back to a dry run.",
        access: "trainingAdmin",
        token: true,
        notes: "It starts as a dry run. QA shares production's Slack workspace, so leave QA in dry run.",
        body: { kind: "json", fields: [{ name: "live", type: "boolean", required: true }] },
        returns: "{ live: boolean }",
        errors: [{ status: 400, error: "invalid", when: "the body is not that shape" }],
      },
      {
        method: "GET",
        path: "/api/cohorts/slack/installation",
        summary: "The Slack app's install in the workspace, which the cohort sync acts as.",
        access: "trainingAdmin",
        token: true,
        notes:
          "The bot token is never returned. app.configured says whether the deployment has the app's Client ID and secret, and so can offer Add to Slack. installation is null until someone adds the app; missingScopes lists any the sync needs (users:read, users:read.email, channels:read, channels:manage, channels:join) that it was not granted; readable is false when the saved token was sealed by another deployment, as after an import, and the app must be added again. envToken says whether the deployment also sets SLACK_BOT_TOKEN, which the sync uses only while nothing is installed.",
        returns:
          "{ app: { configured: boolean, appId: string | null }, installation: { teamId, teamName: string | null, appId, botUserId, scopes: string[], missingScopes: string[], readable: boolean, installedBy: string | null, installedAt } | null, envToken: boolean }",
      },
      {
        method: "DELETE",
        path: "/api/cohorts/slack/installation",
        summary: "Forgets the Slack app's bot token, which stops the sync until the app is added again.",
        access: "trainingAdmin",
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
        access: "trainingAdmin",
        token: false,
        notes:
          "For a browser, from the button on Cohort Settings → Slack. It sets a state cookie for ten minutes and redirects (307) to slack.com, asking for the scopes the sync needs. Slack then returns to the shared OAuth callback, GET /api/auth/callback/google, which must be one of the app's Redirect URLs on api.slack.com, as {AUTH_URL}/api/auth/callback/google. It checks the state cookie, trades the code for the bot token, which is sealed and replaces any earlier install (a SLACK_APP_ID that is set must match the app Slack names), and redirects to /cohort-settings/slack?slack=installed, cancelled, bad_state or slack_error (with detail, Slack's error such as invalid_code, or wrong_app). An install or a refused one is audited.",
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
          "Only one bootcamp may be active; the active one's start date is the BTC and INT date its final scores are loaded with. To make a new one active while another is, name that other in completeActive: it is marked complete in the same write.",
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
          { status: 400, error: "not_employee", when: "nobody in the employee list has that email" },
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
    id: "logistics",
    title: "Logistics",
    endpoints: [
      {
        method: "GET",
        path: "/api/logistics/intake-form",
        summary: "Reads the intake form, as Logistics settings edits it.",
        access: "trainingAdmin",
        token: true,
        notes: "Until it is first saved this is the default form, with updatedAt null.",
        returns: `{ title, description, questions: ${INTAKE_QUESTION_SHAPE}[], updatedAt: string | null }`,
      },
      {
        method: "PUT",
        path: "/api/logistics/intake-form",
        summary: "Replaces the intake form.",
        access: "trainingAdmin",
        token: true,
        notes: "Answers already sent keep the question ids they were given under; a question removed stops being asked.",
        body: { kind: "json", fields: INTAKE_FORM_FIELDS },
        returns: `{ title, description, questions: ${INTAKE_QUESTION_SHAPE}[], updatedAt: string }`,
        errors: [{ status: 400, error: "invalid", when: "the body is not that shape" }],
      },
      {
        method: "GET",
        path: "/api/logistics/intake-responses",
        summary: "Lists every response sent to the intake form, a page at a time, newest first.",
        access: "trainingAdmin",
        token: true,
        notes: "Each response is listed, including a second one from the same email.",
        query: [
          ...listQuery(INTAKE_RESPONSE_LIST.sorts, "the email or any answer"),
          { name: "question", type: "string", note: "with answer, only responses whose answer to this question id is, or for checkboxes includes, answer" },
          { name: "answer", type: "string", note: "with question; either alone is ignored" },
        ],
        returns: `{ responses: { id, email, answers: Record<string, string | string[]>, submittedAt }[], ${PAGE_FIELDS} }`,
      },
      {
        method: "GET",
        path: "/api/logistics/dietary",
        summary: "Lists the attendees who said they have dietary needs, a page at a time, the most critical first.",
        access: "trainingViewer",
        token: true,
        notes:
          "Reads each attendee's latest response only. critical is the first digit 1 to 5 in their answer to how critical their needs are, or null where there is none; 5 is an allergy or a religious restriction. counts covers everyone, whatever the search.",
        query: listQuery(DIETARY_LIST.sorts, "the name, email or needs"),
        returns: `{ attendees: { email, name: string | null, needs: string | null, critical: number | null, submittedAt }[], ${PAGE_FIELDS}, counts: { responded: number, withNeeds: number, byLevel: { 1..5: number }, unrated: number } }`,
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
        returns: `{ judges: { id, email: string | null, fullName, title: string | null, cohort: string, month: string, source: "scheduler" | "history", person: string | null, bootcampId: string | null, status: "scheduled" | "active" | "complete" | null, sessions: { name, role: "lead" | "teach" | "commentator" | "judge" | "speaker" | null, track: ${TRACK_TYPE}, day: number | null, start: number | null }[] }[], ${PAGE_FIELDS}, counts: { judges: number, cohorts: number, prospects: number }, emptyCohorts: string[] }`,
      },
      {
        method: "GET",
        path: "/api/logistics/guest-judges/prospects",
        summary: "Lists the sales and sales engineering leaders who have never been a guest judge, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes: `Read from the employee list as the last HiBob sync left it: anyone in ${GUEST_JUDGE_DEPARTMENTS.join(", ")} with at least one direct report, on no bootcamp's guest judges and not in the guest speaker history, by email. location is HiBob's work location and site its country. syncedAt is when that sync ran.`,
        query: listQuery(JUDGE_PROSPECT_LIST.sorts, "the name, email or title"),
        returns: `{ leaders: { email, fullName, title, department, reportsToName, location: string | null, site }[], ${PAGE_FIELDS}, syncedAt: string | null }`,
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
        summary: "Reads the intake form a new bootcamp attendee fills in at /intake.",
        access: "public",
        token: true,
        returns: `{ title, description, questions: ${INTAKE_QUESTION_SHAPE}[] }`,
      },
      {
        method: "POST",
        path: "/api/intake",
        summary: "Sends an attendee's answers to the intake form.",
        access: "public",
        token: true,
        notes:
          "Attendees have no account, so anyone with the link can send answers under any email. Answers are checked against the form as it stands now: trimmed, blanks dropped, and any for a question not on it ignored. Sending again adds another response rather than replacing the last.",
        body: {
          kind: "json",
          fields: [
            { name: "email", type: "string", required: true, note: "an email address; stored lowercased" },
            {
              name: "answers",
              type: "Record<string, string | string[]>",
              required: true,
              note: `keyed by question id: an array for checkboxes, a string for the rest, each up to ${INTAKE_LIMITS.answer} characters. A choice, checkboxes or dropdown answer must be one of the options, except for one free-text answer where the question offers "Other"`,
            },
          ],
        },
        returns: "201 { id }",
        errors: [
          { status: 400, error: "invalid", when: "the body is not that shape, or email is not an email address" },
          { status: 400, error: "required", when: "a required question has no answer; questionId names it" },
          { status: 400, error: "not_an_option", when: "an answer is not one the question offers, or a single-answer question was given several; questionId names it" },
        ],
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
    id: "bootcamp-history",
    title: "Bootcamp history",
    endpoints: [
      {
        method: "GET",
        path: "/api/evals/bootcamp-history",
        summary: "Lists everyone with a bootcamp history row, newest bootcamp first, a page at a time.",
        access: "assessmentsViewer",
        token: true,
        notes:
          "fullName is the person's name in the employee list from the last HiBob sync, or null for an email not in it, such as someone who has left. Someone is active while that list has their email, and inactive once it doesn't. btcDate is their bootcamp date; 2000-01-01 means they are exempt, which sorts as the oldest date. Rows that tie on the sort, such as one bootcamp's class, follow in name order, then email. counts gives everyone, the active and the inactive, whatever the search or status.",
        query: [
          ...listQuery(BOOTCAMP_HISTORY_LIST.sorts, "the name or email", BOOTCAMP_HISTORY_LIST.dir),
          { name: "status", type: HISTORY_STATUSES.map((s) => `"${s}"`).join(" | "), note: "only the active or only the inactive; everyone if omitted" },
        ],
        returns: `{ history: { id, email, fullName: string | null, btcDate: "YYYY-MM-DD" | null }[], ${PAGE_FIELDS}, status: "active" | "inactive" | null, counts: { total: number, active: number, inactive: number } }`,
        errors: [{ status: 400, error: "invalid_status", when: "status is neither active nor inactive" }],
      },
      {
        method: "GET",
        path: "/api/evals/bootcamp-history/{id}",
        summary: "Returns one person's bootcamp history row in full, with their employee record.",
        access: "assessmentsViewer",
        token: true,
        notes:
          "A date of 2000-01-01 means the person is exempt from that class. Scores run from 1 (poor) to 4 (outstanding), to one decimal place; btcIndividualScores and intIndividualScores map each exercise's column name to its score, or are null. updatedBy is the id of whoever last changed the row and updatedByName their name or email, both null when that account is gone. employee is null for an email not in the employee list.",
        params: [{ name: "id", type: "string", required: true, note: "the row's id" }],
        returns:
          `{ id, email, btcDate: string | null, intDate: string | null, btcScore: number | null, intScore: number | null, btcIndividualScores: Record<string, number> | null, intIndividualScores: Record<string, number> | null, updatedBy: string | null, updatedByName: string | null, createdAt, updatedAt, employee: { fullName, title, department, site, reportsToName, reportsToEmail, startDate: string | null, track: "sales" | "engineer" | "ignored" | "exempt" | "deferred" | null } | null }`,
        errors: [{ status: 404, error: "not_found", when: "`id` is not a UUID, or no row has it" }],
      },
    ],
  },
  {
    id: "canary-wire",
    title: "Canary Wire",
    intro:
      "Monthly Canary Wire completion in Mindtickle, by manager, as Reporting → Canary Wire shows it. It names everyone in the three Canary Wire role groups and who is behind, so it is for people managers — anyone HiBob has reporting to them — and platform administrators. A manager sees their own org by default: themselves and everyone under them, every level down.",
    endpoints: [
      {
        method: "GET",
        path: "/api/evals/canary-wire",
        summary: "Returns one Canary Wire month from the newest Mindtickle pull: every rep's progress per module, grouped by manager, with per-role and overall rates.",
        access: "canaryWire",
        token: true,
        notes:
          "Built from the newest pull and today's exemptions, so a past month counts whoever was accountable then. A rep is pre-bootcamp, and counted in no rate, until the month after their BTC date in bootcamp history; BTC marked exempt counts in every month. With no BTC date, someone whose HiBob start date is before the first real BTC date on record counts in every month, since bootcamp history doesn't go back far enough to have them; anyone else with none counts in none. None of this applies to SDRs, who never attend bootcamp: they count from their first full month at Harness by HiBob's start date (starting October 2 counts from November, October 1 from October), and in every month with no start date. Names, titles and managers are the HiBob sync's (the employee list), matched by email, with Mindtickle's for anyone HiBob doesn't have; an IC is someone nobody in HiBob reports to. Rates are percentages to one place, null when nothing is owed. A role's and the totals' rates are in people: of the learners who owe something this month, the share who finished everything they owe. A team's and a rep's are in modules. A cell is keyed by module label: accountable cells are counted, exempt ones are pre-bootcamp work and off-role ones (neither) are another edition's module, shown but not counted. atPt is the event's moment in Pacific, empty when only the day is known. lastActivity is the newest completion in the month's content. hasSnapshot is false until the first pull from Mindtickle has finished, and every list is then empty. With format=csv, the same month as a CSV download, one row per rep.",
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
          "months are the last six months with Canary Wire content from June 2026, oldest first; a month nobody published for is skipped. The current month in Pacific is included once anyone has finished one of its modules, and a later month never is, however early its content was published. Each month is the same month GET /api/evals/canary-wire returns, with the same people, scope and exemptions. A rep's mark is the percentage of their own lineup they finished that month, null when they owed nothing; exempt marks a month they didn't count yet (pre-bootcamp, or an SDR before their first full month). lastCompleted is the day they last finished a module of their own lineup in these months, as Sep 12, 2026, or an empty string. A team's, a role's and the totals' rates are in people: of those who owed something that month, the share who finished everything. Teams and their reps sort best first by the latest month, ties broken by the month before, and so on back. With format=csv, one row per rep with a column per month, blank where they owed nothing.",
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
        summary: "Starts a pull from Mindtickle now (Refresh now), rather than waiting for the next two-hourly one.",
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
          "Training administrators read it to pick a bootcamp's guest judges. fullName and reportsToName are first and last name as the person's email spells them (first.last@), using HiBob's spelling of each word it has; HiBob's full name is kept only for an email that is not first.last. total counts every stored employee, whatever the search.",
        query: [
          {
            name: "match",
            type: `"all" | "person"`,
            note: "What q searches. person: only the name and email, as the people pickers search. Default all.",
          },
          ...listQuery(EMPLOYEE_LIST.sorts, "the name, email, title, department, site, or the manager's name or email"),
        ],
        returns: `{ people: { id, email, fullName, title, department, site, reportsToEmail, reportsToName, startDate, activeEffectiveDate }[], ${PAGE_FIELDS}, total: number, syncedAt: ISO 8601 string | null }`,
        errors: [{ status: 400, error: "invalid_match", when: "match is not all or person" }],
      },
      {
        method: "GET",
        path: "/api/evals/organization",
        summary: "Lists who the last HiBob sync found reporting up to the Organization Leader, a page at a time.",
        access: "assessmentsAdmin",
        token: true,
        notes:
          "depth counts the links between a person and the leader, the leader included. managementChain is the emails of their managers, from the direct one up to and including the leader, joined with semicolons and no spaces. track is the one an administrator set by hand, if any; otherwise exempt when the person's bootcamp history marks BTC or INT exempt, ignored for a title on the Ignored list, deferred when they started too close to the next bootcamp (see GET /api/evals/deferral-days), or else the Sales or Engineer list their title is on, or null for a title on no list. btcDate, btcScore, intDate and intScore are from their bootcamp history, null where there is none; a date of 2000-01-01 means they are exempt from that class, and a score runs from 1 (poor) to 4 (outstanding), to one decimal place. The list is as of the last sync; current is false once a different leader has been set since, until the next sync runs. total counts everyone listed, whatever the search.",
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
          "These people are added to the Slack messages sent to each attendee's team at the end of a bootcamp, after the attendee's management chain. fullName is their name in the employee list, as of when they were added or the last HiBob sync since, and empty for someone not in it. total counts every contact, whatever the search.",
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
          "The email is lowercased. If it belongs to an imported employee, their name is stored with it; anyone else is added by email alone.",
        body: {
          kind: "json",
          fields: [{ name: "email", type: "string", required: true, note: "up to 320 characters" }],
        },
        returns: "{ id, email, fullName }",
        errors: [
          { status: 400, error: "invalid", when: "the body does not parse, or email is not an email address" },
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
          "Someone whose HiBob start date is fewer than days before bootcampStart, or after it, is on the deferred track rather than their title list's; an ignored title, exempt history or a track set by hand still comes first. A blank start date is never deferred. 0 turns deferral off. Until one is saved, days is the Google Sheet's 14. bootcampStart is the active bootcamp's start, else the soonest scheduled one starting today or later, or null when there is none, which also leaves no one deferred.",
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
          "GET /api/auth/callback/google is the only redirect URI any provider needs: Google sign-in, Connect Google account (GET /api/evals/google-meetings/connect) and Add to Slack (GET /api/cohorts/slack/install) all return to it. A state that starts wo. is a connection, and is handled here for a signed-in session only (401 without one, 403 without the role the connection needs, 400 for a purpose it does not know, 503 when the provider is not configured), redirecting back to the page that started it; any other state is Auth.js's sign-in.",
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
        path: "/api/evals/canary-wire/pull/scheduled",
        summary: "Starts the Canary Wire's two-hourly pull, or takes it a step further, for Cloud Scheduler.",
        access: "internal",
        token: false,
        notes:
          "Called every five minutes for the first half hour of every even hour. Accepts only a Google-signed OIDC token for CANARY_WIRE_PULL_AUDIENCE from the CANARY_WIRE_PULL_INVOKER service account; either unset refuses every call. Works on a pull already running, including one a closed page left halfway; otherwise starts one unless one started in the last 90 minutes, whatever became of it, so a failure is retried two hours later rather than every five minutes. Allows 300 seconds.",
        returns: "{ outcome: \"advanced\" | \"started\" | \"fresh\", pull: { id, trigger: \"manual\" | \"schedule\", status: \"running\" | \"succeeded\" | \"failed\", message, done: number, total: number, error: string | null, startedAt, updatedAt, finishedAt: string | null, startedByName: string | null, working: boolean } | null }",
        errors: [
          { status: 401, error: "unauthorized", when: "the OIDC token is missing, invalid or from someone else" },
          { status: 409, error: "not_configured", when: "Mindtickle's key pair or tenant is unset" },
        ],
      },
      {
        method: "POST",
        path: "/api/evals/hibob/sync/scheduled",
        summary: "Runs the daily HiBob sync for Cloud Scheduler.",
        access: "internal",
        token: false,
        notes:
          "Accepts only a Google-signed OIDC token for HIBOB_SYNC_AUDIENCE from the HIBOB_SYNC_INVOKER service account; either unset refuses every call. Same sync as the manual one. A successful sync is followed by the cohort Slack channel sync, as POST /api/cohorts/slack/sync does it; its result is slack, and its failure does not fail this call. Allows 300 seconds.",
        returns: "{ count: number, skipped: number, slack: <as POST /api/cohorts/slack/sync answers, or { ok: false, error, detail }> }",
        errors: [
          { status: 401, error: "unauthorized", when: "the OIDC token is missing, invalid or from someone else" },
          { status: 409, error: "already_running", when: "another sync is running" },
          { status: 409, error: "not_configured", when: "the deployment has no HiBob service user or token" },
          { status: 422, error: "rejected", when: "HiBob refused the credentials" },
          { status: 502, error: "unreachable", when: "HiBob could not be reached" },
          { status: 502, error: "bad_response", when: "HiBob answered with an error or no employee list" },
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
