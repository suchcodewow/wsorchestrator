import { AUDIT_LIST, CURRENT_COHORT_LIST, DOMAIN_LIST, EMPLOYEE_LIST, HIBOB_SYNC_LIST, ORGANIZATION_LIST, TITLE_LIST, USER_LIST } from "@/lib/list-specs";
import { PAGE_FIELDS, listQuery } from "./paging";
import type { EndpointGroup } from "./types";

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
        summary: "Lists everyone the last HiBob sync put on the Sales or Engineer track, a page at a time.",
        access: "trainingViewer",
        token: true,
        notes:
          "A person's track is the title list their title was on when the sync ran, for everyone under the Organization Leader, unless their bootcamp history marks BTC or INT exempt, which makes it exempt and leaves them off this list. Changing a list takes effect at the next sync; changing someone's bootcamp history takes effect at once. counts gives everyone on each track, whatever the search.",
        query: listQuery(CURRENT_COHORT_LIST.sorts, "the name, email, title, department, track, or the manager's name or email"),
        returns: `{ members: { email, fullName, title, department, reportsToEmail, reportsToName, track: "sales" | "engineer" }[], ${PAGE_FIELDS}, counts: { sales: number, engineer: number }, syncedAt: ISO 8601 string | null }`,
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
        access: "evalsAdmin",
        token: true,
        notes: "total counts every stored employee, whatever the search.",
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
          "depth counts the links between a person and the leader, the leader included. track is exempt when the person's bootcamp history marks BTC or INT exempt, otherwise the title list their title was on when the sync ran, or null for a title on no list. btcDate, btcScore, intDate and intScore are from their bootcamp history, null where there is none; a date of 2000-01-01 means they are exempt from that class, and a score is a whole number from 1 (poor) to 4 (outstanding). The list is as of the last sync; current is false once a different leader has been set since, until the next sync runs. total counts everyone listed, whatever the search.",
        query: listQuery(ORGANIZATION_LIST.sorts, "the name, email, title, department, track, or the manager's name or email"),
        returns: `{ members: { email, fullName, title, department, reportsToEmail, reportsToName, track: "sales" | "engineer" | "ignored" | "exempt" | null, depth, leaderEmail, btcDate, btcScore, intDate, intScore }[], ${PAGE_FIELDS}, total: number, leaderEmail: string | null, current: boolean }`,
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
