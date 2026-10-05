import { ASSESSMENT_ATTENDEE_LIST, ASSESSMENT_LIST, AUDIT_LIST, BOOTCAMP_HISTORY_LIST, BOOTCAMP_LIST, CURRENT_COHORT_LIST, DOMAIN_LIST, EMPLOYEE_LIST, HIBOB_SYNC_LIST, HISTORY_STATUSES, JUDGE_LIST, ORGANIZATION_LIST, PREVIOUS_SESSION_LIST, SESSION_COMMENT_LIST, SESSION_TYPE_LIST, SLACK_CONTACT_LIST, TITLE_LIST, USER_LIST, FACILITY_LIST } from "@/lib/list-specs";
import { BOOTCAMP_LIMITS, CHECKLIST_LIMITS, EVALS_ASSESSMENT_LIMITS, FACILITY_LIMITS, SCHEDULE_LIMITS } from "@/db/schema";
import { PAGE_SIZE } from "@/lib/paging";
import { CHECKLIST_ITEM_ROW } from "./account";
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
  { name: "track", type: `"btc" | "int"`, required: true, note: "the class" },
  { name: "day", type: "number", required: true, note: "1-based, as a session's" },
];

const COMMENT_SHAPE = "{ id, body, authorId: string | null, authorName, authorEmail, createdAt, mentions: { email, fullName }[] }";

const TRACK_TYPE = `"btc" | "int" | "btc_se" | "int_se"`;
const KIND_TYPE = `"main" | "breakout" | "unstructured"`;
const AUDIENCE_TYPE = `"both" | "sales" | "engineers"`;
const COLOR_TYPE = `"slate" | "red" | "orange" | "amber" | "green" | "teal" | "blue" | "violet" | "pink"`;
const MINUTES_NOTE = `a multiple of ${SCHEDULE_LIMITS.slot} from ${SCHEDULE_LIMITS.slot} to ${SCHEDULE_LIMITS.maxMinutes}`;

const SESSION_SHAPE = `{ id, track: ${TRACK_TYPE}, day: number, start: number, minutes: number, kind, audience: ${AUDIENCE_TYPE}, typeId: string | null, name, description, emoji, color, roomId: string | null, staff: { email, fullName, leader: boolean, roomId: string | null }[], comments: number, updatedAt }`;

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
        returns: `{ users: { id, name, email, eventRole, trainingRole, evalsRole, isPlatformAdmin, isBootstrapAdmin, eventCount }[], ${PAGE_FIELDS}, pendingAdmins: string[] }`,
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
              type: `"event" | "training" | "evals" | "platform"`,
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
              note: "required when area is training or evals; null removes access",
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
              name: "evalsRole",
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
        summary: "Lists the org members still to train — bootcamp and intermediate candidates — narrowed to a stage and a track, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "A bootcamp candidate is anyone under the Organization Leader, on the sales, engineer or deferred track or on none, with no BTC date in their bootcamp history; an intermediate candidate has a BTC date and no INT date. Either must also pass the date cutoffs in GET /api/evals/candidate-cutoffs, which cutoffs echoes. The ignored and exempt tracks are left out. A track is, first, one an administrator set by hand with PUT /api/cohorts/current/track, which overridden marks; then exempt where their history says so; then ignored for a title on the Ignored list; then deferred when their HiBob start date is fewer than deferral.days before deferral.bootcampStart, or after it; then the Sales or Engineer list their title is on. undecided is a title on no list. deferral echoes GET /api/evals/deferral-days. counts gives each stage on each track; each stage's counts ignore the track filter, each track's ignore the stage filter, and neither depends on the search. activeBootcamp is the one active bootcamp, or null.",
        query: [
          { name: "stage", type: `"bootcamp" | "intermediate"`, note: "only that stage; both if omitted" },
          { name: "track", type: `"sales" | "engineer" | "undecided" | "deferred"`, note: "only that track; all four if omitted" },
          ...listQuery(CURRENT_COHORT_LIST.sorts, "the name, email, title or track"),
        ],
        returns: `{ stage: string | null, track: string | null, members: { email, fullName, title, department, site, reportsToEmail, reportsToName, startDate: "YYYY-MM-DD" | null, activeEffectiveDate: "YYYY-MM-DD" | null, track: "sales" | "engineer" | "undecided" | "deferred", overridden: boolean, stage: "bootcamp" | "intermediate", historyId: string | null, btcDate: "YYYY-MM-DD" | null, btcScore: number | null }[], ${PAGE_FIELDS}, counts: Record<"bootcamp" | "intermediate", { sales: number, engineer: number, undecided: number, deferred: number }>, syncedAt: ISO 8601 string | null, cutoffs: { startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }, deferral: { days: number, bootcampStart: "YYYY-MM-DD" | null }, activeBootcamp: { id, startDate, btcDays, intDays } | null }`,
        errors: [
          { status: 400, error: "invalid_stage", when: "stage is neither bootcamp nor intermediate" },
          { status: 400, error: "invalid_track", when: "track is not sales, engineer, undecided or deferred" },
        ],
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
          "sales, engineer and ignored put the person's title on that list, moving it off another list if it is on one, and re-track everyone in the org who holds it, compared as the lists compare titles; title says where it went, and is null when it was on that list already or the person has no title. Anyone else with the title whose track was set by hand keeps it. The person is also pinned to the choice where the rules still give them something else, such as exempt history or a late start, and always when they have no title. undecided, deferred and exempt pin just this person. A pin holds through every later sync, title-list change and bootcamp change, until automatic hands the person back to the rules; exempt here does not change their bootcamp history. ignored and exempt take people off the Current tab. track in the response is the one the person has now, overridden whether they are pinned, and retracked how many people's tracks changed, the person included.",
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
        notes: `judges is every guest judge by name, up to ${BOOTCAMP_LIMITS.judges}; fullName is as the employee list had them when they were added.`,
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
          { status: 409, error: "has_scores", when: "an assessment has been scored at it" },
        ],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/judges",
        summary: "Lists one bootcamp's guest judges, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "While the bootcamp is active, each judge can see and submit assessments on the eVals page, whatever other access they have. fullName is as the employee list had them when they were added. total counts every judge, whatever the search.",
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
        summary: "Reads one bootcamp's whole schedule: every day of its four tracks, its rooms, and who can run a session.",
        access: "trainingViewer",
        token: true,
        notes: `days.btc[0] is day 1 of Bootcamp; each day's sessions are in start order, at most ${SCHEDULE_LIMITS.sessionsPerDay}. start is minutes after midnight, on the quarter hour, from 480 (8:00 AM); a session ends by midnight, and no two on one track-day overlap. Time between them is unscheduled. The SE tracks run as many days as the class they break out of, and a track the bootcamp does not hold has no days. Day N of every track is the same calendar day. instructors is every Training administrator and every guest judge of the bootcamp.`,
        params: [BOOTCAMP_ID],
        returns: `{ bootcamp: { id, startDate, btcDays, intDays, status, facilityId, facilityName }, rooms: { id, name, capacity }[], instructors: { email, fullName, role: "administrator" | "judge" }[], days: { btc, int, btc_se, int_se: ${SESSION_SHAPE}[][] } }`,
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
          "Copies every session and who runs it, but not comments or breakout groups. Rooms come too only when both bootcamps are at the same facility. Days past the end of a track here are left out; notes says what was.",
        params: [BOOTCAMP_ID],
        body: {
          kind: "json",
          fields: [
            { name: "from", type: "string", required: true, note: "the bootcamp to copy" },
            { name: "replace", type: "boolean", note: "true to replace the sessions it has" },
          ],
        },
        returns: "{ sessions: number, notes: string[] }",
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
        summary: "Counts each class-day's checklist items, and how many are done.",
        access: "trainingViewer",
        token: true,
        notes: "A day with no items is left out.",
        params: [BOOTCAMP_ID],
        returns: "{ days: { track: \"btc\" | \"int\", day: number, total: number, done: number }[] }",
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp" }],
      },
      {
        method: "GET",
        path: "/api/scheduler/bootcamps/{id}/checklist/{track}/{day}",
        summary: "Lists what is to be done before one day of one class, oldest first.",
        access: "trainingViewer",
        token: true,
        notes: `Whole: a class-day holds at most ${CHECKLIST_LIMITS.itemsPerDay} items. The SE tracks share their class's checklist.`,
        params: CHECKLIST_DAY_PARAMS,
        returns: `{ items: ${CHECKLIST_ITEM_ROW}[] }`,
        errors: [{ status: 404, error: "not_found", when: "no such bootcamp, or track or day is not one" }],
      },
      {
        method: "POST",
        path: "/api/scheduler/bootcamps/{id}/checklist/{track}/{day}",
        summary: "Adds an item to one class-day's checklist, recording you as who wrote it.",
        access: "trainingAdmin",
        token: true,
        params: CHECKLIST_DAY_PARAMS,
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: `up to ${CHECKLIST_LIMITS.name} characters` },
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
          { status: 400, error: "invalid", when: "name is empty or too long" },
          { status: 400, error: "no_day", when: "the class does not run that many days at this bootcamp" },
          { status: 400, error: "not_instructor", when: "ownerEmail or a mention is not an administrator or guest judge of the bootcamp; email names it" },
          { status: 404, error: "not_found", when: "no such bootcamp, or track or day is not one" },
          { status: 409, error: "full", when: `the day already has ${CHECKLIST_LIMITS.itemsPerDay} items` },
        ],
      },
      {
        method: "PATCH",
        path: "/api/scheduler/bootcamps/{id}/checklist/items/{itemId}",
        summary: "Ticks a checklist item done, or puts it back to do.",
        access: "signedIn",
        token: true,
        notes:
          "A Training Administrator can tick any item; anyone else only one they own, matched by their account's email. Ticking one already done keeps when it was first ticked.",
        params: [BOOTCAMP_ID, CHECKLIST_ITEM_ID],
        body: { kind: "json", fields: [{ name: "done", type: "boolean", required: true }] },
        returns: CHECKLIST_ITEM_ROW,
        errors: [
          { status: 400, error: "invalid", when: "done is missing or not a boolean" },
          { status: 403, error: "not_owner", when: "you are not a Training Administrator and it is not yours" },
          { status: 404, error: "not_found", when: "no such bootcamp or item" },
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
          "An attendee is a current candidate (see GET /api/evals/current-cohort) in the assessment's stage on the sales or engineer track, as its audience takes in. averageScore is to one decimal place, and null if they are not scored at the active bootcamp. needsRescoring is true for one scored before a criterion was added. attendees and scored count everyone it applies to, whatever the search.",
        params: [{ name: "assessmentId", type: "string", required: true, note: "UUID" }],
        query: listQuery(ASSESSMENT_ATTENDEE_LIST.sorts, "the name, email or title"),
        returns: `{ assessment: { id, name, stage, audience }, bootcamp: { id, startDate, btcDays, intDays } | null, attendees: number, scored: number, people: { id, email, fullName, title, track: "sales" | "engineer", averageScore: number | null, needsRescoring: boolean }[], ${PAGE_FIELDS} }`,
        errors: [{ status: 404, error: "not_found", when: "assessmentId is not a UUID, or no such active assessment" }],
      },
      {
        method: "GET",
        path: "/api/evals/scoring/{assessmentId}/{employeeId}",
        summary: "Reads one attendee's scoring form: the criteria still asked, and their submission at the active bootcamp.",
        access: "scorer",
        token: true,
        notes:
          "submission is null until someone scores them. Its scores are keyed by criterion id; a criterion added since has none. ownerName is whoever saved it last. Send its updatedAt as revises when saving. people is whom a comment can tag: anyone who can use eVals, and the active bootcamp's guest judges; it is empty with no bootcamp.",
        params: [
          { name: "assessmentId", type: "string", required: true, note: "UUID" },
          { name: "employeeId", type: "string", required: true, note: "the employee's HiBob id" },
        ],
        returns: `{ assessment: { id, name, stage, audience }, criteria: { id, name, description }[], attendee: { id, email, fullName, title, track }, submission: { id, averageScore, positiveFeedback, constructiveFeedback, ownerId, ownerName, updatedAt, scores: Record<string, { score, comment, mentions: { email, fullName }[] }> } | null, people: { email, fullName }[], bootcamp: { id, startDate, btcDays, intDays } | null }`,
        errors: [{ status: 404, error: "not_found", when: "no such active assessment, or the attendee is not one it applies to" }],
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
        access: "evalsViewer",
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
        access: "evalsViewer",
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
          "Training administrators read it to pick a bootcamp's guest judges. total counts every stored employee, whatever the search.",
        query: listQuery(EMPLOYEE_LIST.sorts, "the name, email, title, department, site, or the manager's name or email"),
        returns: `{ people: { id, email, fullName, title, department, site, reportsToEmail, reportsToName, startDate, activeEffectiveDate }[], ${PAGE_FIELDS}, total: number, syncedAt: ISO 8601 string | null }`,
      },
      {
        method: "GET",
        path: "/api/evals/organization",
        summary: "Lists who the last HiBob sync found reporting up to the Organization Leader, a page at a time.",
        access: "evalsAdmin",
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
        access: "evalsAdmin",
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
        access: "evalsAdmin",
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
        access: "evalsAdmin",
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
        access: "evalsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such title" }],
      },
      {
        method: "GET",
        path: "/api/evals/assessments",
        summary: "Lists the assessments attendees can be scored on, a page at a time.",
        access: "evalsAdmin",
        token: true,
        notes:
          "criteria counts those still asked; submissions counts the attendees scored on it at any bootcamp. total counts every assessment, whatever the search.",
        query: listQuery(ASSESSMENT_LIST.sorts, "the name"),
        returns: `{ assessments: { id, name, stage: "bootcamp" | "intermediate", audience: "sales" | "engineer" | "both", active: boolean, updatedAt, criteria: number, submissions: number }[], ${PAGE_FIELDS}, total: number }`,
      },
      {
        method: "POST",
        path: "/api/evals/assessments",
        summary: "Creates an assessment and its criteria.",
        access: "evalsAdmin",
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
        access: "evalsAdmin",
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
        access: "evalsAdmin",
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
        access: "evalsAdmin",
        token: true,
        notes: "One with scores is kept; set active to false with PUT instead.",
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "id is not a UUID, or no such assessment" },
          { status: 409, error: "has_scores", when: "someone has been scored on it" },
        ],
      },
      {
        method: "GET",
        path: "/api/evals/slack-contacts",
        summary: "Lists the Additional Slack Contacts, a page at a time.",
        access: "evalsAdmin",
        token: true,
        notes:
          "These people are added to the Slack messages sent to each attendee's team at the end of a bootcamp, after the attendee's management chain. fullName is as the employee list had them when they were added, and empty for someone not in it. total counts every contact, whatever the search.",
        query: listQuery(SLACK_CONTACT_LIST.sorts, "the name, the email or who added them"),
        returns: `{ contacts: { id, email, fullName, createdAt, addedBy: string | null }[], ${PAGE_FIELDS}, total: number }`,
      },
      {
        method: "POST",
        path: "/api/evals/slack-contacts",
        summary: "Adds one Additional Slack Contact.",
        access: "evalsAdmin",
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
        access: "evalsAdmin",
        token: true,
        params: [{ name: "id", type: "string", required: true, note: "UUID" }],
        returns: "{ ok: true }",
        errors: [{ status: 404, error: "not_found", when: "id is not a UUID, or no such contact" }],
      },
      {
        method: "GET",
        path: "/api/evals/hibob/sync",
        summary: "Lists the HiBob sync log a page at a time, newest first.",
        access: "evalsAdmin",
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
        access: "evalsAdmin",
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
        access: "evalsAdmin",
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
        access: "evalsAdmin",
        token: true,
        notes:
          "A candidate's HiBob start date must be on or after startDateOnOrAfter, or blank; their HiBob active effective date must be after activeEffectiveDateAfter, and not blank. null means that cutoff is off. Until one is saved, each is the Google Sheet's: 2025-04-01 and 2026-01-01.",
        returns: `{ startDateOnOrAfter: "YYYY-MM-DD" | null, activeEffectiveDateAfter: "YYYY-MM-DD" | null }`,
      },
      {
        method: "PUT",
        path: "/api/evals/candidate-cutoffs",
        summary: "Sets either or both candidate date cutoffs.",
        access: "evalsAdmin",
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
        access: "evalsAdmin",
        token: true,
        notes:
          "Someone whose HiBob start date is fewer than days before bootcampStart, or after it, is on the deferred track rather than their title list's; an ignored title, exempt history or a track set by hand still comes first. A blank start date is never deferred. 0 turns deferral off. Until one is saved, days is the Google Sheet's 14. bootcampStart is the active bootcamp's start, else the soonest scheduled one starting today or later, or null when there is none, which also leaves no one deferred.",
        returns: `{ days: number, bootcampStart: "YYYY-MM-DD" | null }`,
      },
      {
        method: "PUT",
        path: "/api/evals/deferral-days",
        summary: "Sets the deferral window, and retracks the org by it at once.",
        access: "evalsAdmin",
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
        summary: "Auth.js sign-in, callback and session endpoints.",
        access: "internal",
        token: false,
        returns: "handled by Auth.js",
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
        path: "/api/evals/hibob/sync/scheduled",
        summary: "Runs the daily HiBob sync for Cloud Scheduler.",
        access: "internal",
        token: false,
        notes:
          "Accepts only a Google-signed OIDC token for HIBOB_SYNC_AUDIENCE from the HIBOB_SYNC_INVOKER service account; either unset refuses every call. Same sync as the manual one.",
        returns: "{ count: number, skipped: number }",
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
              note: "QA's users before the restore: id, email, name, image, eventRole, trainingRole, evalsRole, isPlatformAdmin, calendarScope, accounts[]",
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
