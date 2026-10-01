import type { EndpointGroup } from "./types";

export const EVENT_GROUPS: EndpointGroup[] = [
  {
    id: "events",
    title: "Events",
    intro:
      "An event is a `Run` row: { id, userId, name, mode, slug, userCount, clouds, scenarios, status, scheduledStart, orgUnitPath, gcpProjectId, statePrefix, harnessOnly, componentSetId, outputs, error, ttlSeconds, deleteRequested, expiresAt, destroyAttempts, destroyStartedAt, createdAt, destroyedAt, environment }. " +
      "`status` is one of scheduled, requested, provisioning, applying, ready, destroying, destroy_failed, destroyed, failed; `mode` is workshop or challenge; `clouds` holds aws, azure, gcp. " +
      "On the /api/runs/{id} routes an event you may not act on is a 404, never a 403.",
    endpoints: [
      {
        method: "GET",
        path: "/api/runs",
        summary: "Lists the events you booked, newest first.",
        access: "contributor",
        token: true,
        notes:
          "Only the caller's own events, even for an Event Manager. Use /api/runs/calendar to see everyone's.",
        returns: "{ runs: Run[] }",
      },
      {
        method: "POST",
        path: "/api/runs",
        summary: "Books a new event, and optionally starts it now.",
        access: "operator",
        token: true,
        notes:
          "With `startNow`, this starts the runner's Cloud Run job at once, and the job provisions real Google Workspace users, a Harness org and cloud accounts. " +
          "Without it, the scheduler starts the event at `scheduledStart`. A past `scheduledStart` is not rejected. " +
          "Scenarios that need a cluster also add that cloud's cluster scenario.",
        body: {
          kind: "json",
          fields: [
            { name: "name", type: "string", required: true, note: "trimmed, 1–200 characters" },
            { name: "mode", type: `"workshop" | "challenge"`, note: `default "workshop"` },
            {
              name: "userCount",
              type: "number",
              required: true,
              note: "integer; 1–50 for a workshop, 1–5 for a challenge",
            },
            { name: "ttlDays", type: "number", note: "integer 1–3, default 1; how long it runs before teardown" },
            {
              name: "clouds[]",
              type: `("aws" | "azure" | "gcp")[]`,
              required: true,
              note: "a workshop takes 0–3 clouds, a challenge exactly 1; duplicates are dropped",
            },
            {
              name: "scenarios[]",
              type: "string[]",
              note:
                "default []; ids gcp-cluster, gcp-connectivity-egress, gcp-connectivity-binauthz, gcp-delegate-blocked-manager, aws-cluster, aws-connectivity-egress, azure-cluster, azure-connectivity-egress; each must belong to a cloud in `clouds`",
            },
            {
              name: "scheduledStart",
              type: "ISO 8601 string",
              note: "UTC with a Z suffix; required unless `startNow` is true, and ignored when it is",
            },
            { name: "startNow", type: "boolean", note: "start provisioning immediately" },
          ],
        },
        returns:
          "201 { run: Run, started: boolean } — `started` is false when the job could not be started now; the scheduler then picks it up",
        errors: [
          {
            status: 400,
            error: "invalid_body",
            when: "the body fails validation, breaks the mode's limits, has a scenario for a missing cloud, or has neither `startNow` nor `scheduledStart`",
          },
        ],
      },
      {
        method: "GET",
        path: "/api/runs/{id}",
        summary: "Reads one event with its build log, attendee accounts, resources and owner.",
        access: "eventOwner",
        token: true,
        notes:
          "`accounts` includes each attendee's temporary password and Azure access pass. Events imported from production are readable here, though the other /api/runs/{id} routes treat them as not found.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        returns:
          "{ run: Run, logs: { id, runId, ts, stream, message }[], accounts: { id, runId, email, tempPassword, azureAccessPass, azureAccessPassExpiresAt, claimedName, claimedFrom, claimedVacation, claimedAt, createdAt }[], resources: { id, runId, kind, key, label, detail, url, done, total, createdAt, updatedAt }[], owner: { id, name, email } | null }",
        errors: [{ status: 404, error: "not_found", when: "no such event, or not yours to see" }],
      },
      {
        method: "PATCH",
        path: "/api/runs/{id}",
        summary: "Changes an event's attendee count, clouds and scenarios.",
        access: "eventOwner",
        token: true,
        notes:
          "A scheduled event can change freely. A ready event can only grow: the change is saved and the runner's Cloud Run job is started to apply it, which creates real accounts and cloud resources. Turning a scenario off on a ready event destroys that scenario's layer. " +
          "If the job cannot be started, the change stays saved but the live environment is unchanged and `applying` is false. Scenarios for a cloud not in `clouds` are dropped silently.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        body: {
          kind: "json",
          fields: [
            { name: "userCount", type: "number", required: true, note: "integer 1–50, and within the mode's limit" },
            { name: "clouds[]", type: `("aws" | "azure" | "gcp")[]`, required: true, note: "within the mode's cloud limits" },
            { name: "scenarios[]", type: "string[]", note: "scenario ids; omit to keep the current ones" },
          ],
        },
        returns: "{ run: Run, applying: boolean } — `applying` is true when the runner job was started",
        errors: [
          { status: 400, error: "invalid_body", when: "the body fails validation" },
          { status: 400, error: "exceeds_mode_limits", when: "userCount or the cloud count is outside the event mode's limits" },
          { status: 404, error: "not_found", when: "no such event, not yours, or imported from another deployment" },
          { status: 409, error: "locked", when: "the event is neither scheduled nor ready" },
          { status: 409, error: "shrink_not_allowed", when: "a ready event's userCount would go down" },
          { status: 409, error: "cloud_removal_not_allowed", when: "a ready event would lose a cloud" },
        ],
      },
      {
        method: "DELETE",
        path: "/api/runs/{id}",
        summary: "Deletes an event, tearing down whatever it built first.",
        access: "eventOwner",
        token: true,
        notes:
          "A scheduled or destroyed event is deleted at once. Any other event is marked for deletion: the reaper destroys its accounts, org unit and cloud resources within a few minutes, then removes the row and its logs. This cannot be undone. On a destroy_failed event it restarts the teardown from the start.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        returns: `{ outcome: "deleted" | "teardown_requested" }`,
        errors: [
          { status: 404, error: "not_found", when: "no such event, not yours, or imported from another deployment" },
          { status: 409, error: "in_flight", when: "the event is requested, provisioning or applying" },
        ],
      },
      {
        method: "POST",
        path: "/api/runs/{id}/end",
        summary: "Ends a live event now, so it tears down as if it had reached its end time.",
        access: "eventOwner",
        token: true,
        notes:
          "Sets `expiresAt` to now. The reaper then destroys the event's accounts and cloud resources within a few minutes, which cannot be undone. The event and its log stay on record as destroyed.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        returns: "{ run: Run }",
        errors: [
          { status: 404, error: "not_found", when: "no such event, not yours, or imported from another deployment" },
          { status: 409, error: "not_running", when: "the event is not ready, or is already being deleted" },
        ],
      },
      {
        method: "POST",
        path: "/api/runs/{id}/extend",
        summary: "Adds one day to an event's lifetime.",
        access: "eventOwner",
        token: true,
        notes:
          "A live event's `expiresAt` moves a day later; an event that has not gone live gets a day added to `ttlSeconds`. Each call adds a day, past the 3 days booking allows.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        returns: "{ run: Run }",
        errors: [
          { status: 404, error: "not_found", when: "no such event, not yours, or imported from another deployment" },
          {
            status: 409,
            error: "not_extendable",
            when: "the event is being deleted, or is destroying, destroy_failed, destroyed or failed",
          },
        ],
      },
      {
        method: "POST",
        path: "/api/runs/{id}/retry",
        summary: "Retries a failed provision.",
        access: "eventOwner",
        token: true,
        notes:
          "Clears the error, sets the event to requested and starts the runner's Cloud Run job, which provisions real accounts and cloud resources.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "no such event, or not yours" },
          { status: 409, error: "not_retryable", when: "the event is not failed, or was imported from another deployment" },
          { status: 502, error: "trigger_failed", when: "the runner job could not be started; the event goes back to failed" },
        ],
      },
      {
        method: "POST",
        path: "/api/runs/{id}/retry-teardown",
        summary: "Restarts a teardown that gave up.",
        access: "eventOwner",
        token: true,
        notes:
          "Sets the event back to destroying, and the reaper starts the teardown again from the top within a few minutes.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        returns: "{ ok: true }",
        errors: [
          { status: 404, error: "not_found", when: "no such event, not yours, or imported from another deployment" },
          { status: 409, error: "not_retryable", when: "the event is not destroy_failed" },
        ],
      },
      {
        method: "GET",
        path: "/api/runs/calendar",
        summary: "Lists the events the Events calendar shows: yours, or everyone's.",
        access: "contributor",
        token: true,
        notes:
          "Without `scope`, an Event Manager gets their saved calendar scope and everyone else gets their own events. Sorted by `scheduledStart`, latest first.",
        query: [
          {
            name: "scope",
            type: `"own" | "all"`,
            note: `"all" needs Event Manager or above; overrides the saved scope`,
          },
        ],
        returns:
          `{ scope: "own" | "all", runs: { id, name, mode, status, scheduledStart, ttlSeconds, expiresAt, userCount, clouds, ownerId, ownerName, ownerEmail }[] }`,
        errors: [
          { status: 400, error: "invalid_scope", when: "`scope` is not own or all" },
          { status: 403, error: "forbidden", when: "`scope=all` from someone below Event Manager" },
        ],
      },
      {
        method: "GET",
        path: "/api/runs/stranded",
        summary: "Lists the events a database restore to a given time would strand.",
        access: "platform",
        token: true,
        notes:
          "An event is stranded when it was created at or after `since` and is provisioning, applying, ready or destroying, so it holds cloud resources a restored database would not know about. Read-only.",
        query: [{ name: "since", type: "ISO 8601 string", required: true, note: "the backup's time" }],
        returns: "{ runs: { id, name, status }[] }",
        errors: [{ status: 400, error: "invalid_since", when: "`since` is missing or not a date" }],
      },
    ],
  },
  {
    id: "cloud-status",
    title: "Cloud status",
    endpoints: [
      {
        method: "GET",
        path: "/api/cloud-status",
        summary: "Runs the cloud audit behind the Cloud Status page's Refresh button.",
        access: "eventAdmin",
        token: true,
        notes:
          "Lists live resources in GCP, AWS, Azure and Harness and matches each to the event that owns it. Read-only, but it calls all four providers, so it is slow. One provider failing does not fail the request; that target reports `ok: false`.",
        returns:
          `{ report: Record<"gcp" | "aws" | "azure" | "harness", { ok: true, audit: { target, scope, columns, resources, missing, counts } } | { ok: false, error: "not_configured" | "permission_denied" | "unavailable" }> }`,
      },
    ],
  },
  {
    id: "attendees",
    title: "Attendee page",
    intro:
      "The endpoints behind an event's attendee page, which attendees open without an account. The event's UUID in the link is the only key.",
    endpoints: [
      {
        method: "GET",
        path: "/api/attend/{id}",
        summary: "Reads an event's attendee page: its console links and every attendee's sign-in details.",
        access: "public",
        token: true,
        notes:
          "Includes each attendee's temporary password, AWS password and Azure access pass, so treat the link as a secret.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        returns:
          `{ name, mode: "workshop" | "challenge", status, links: { cloud, url }[], harnessOrgUrl: string | null, accounts: { id, email, tempPassword, azureAccessPass, azureAccessPassExpiresAt, awsPassword, claimedName, claimedFrom, claimedVacation, claimedAt, links: { cloud, url }[], harnessProjectUrl }[] }`,
        errors: [{ status: 404, error: "not_found", when: "`id` is not a UUID, or no such event" }],
      },
      {
        method: "PATCH",
        path: "/api/attend/{id}",
        summary: "Claims an attendee account by saving the attendee's name and answers.",
        access: "public",
        token: true,
        notes:
          "Anyone with the URL can overwrite any account's claim on that event. Values are trimmed; an empty `name` releases the claim and clears `claimedAt`.",
        params: [{ name: "id", type: "string", required: true, note: "event UUID" }],
        body: {
          kind: "json",
          fields: [
            { name: "accountId", type: "number", required: true, note: "positive integer; an account on this event" },
            { name: "name", type: "string", required: true, note: "at most 80 characters; may be empty" },
            { name: "from", type: "string", required: true, note: "at most 80 characters; may be empty" },
            { name: "vacation", type: "string", required: true, note: "at most 120 characters; may be empty" },
          ],
        },
        returns: "{ ok: true }",
        errors: [
          { status: 400, error: "invalid", when: "the body fails validation" },
          { status: 404, error: "not_found", when: "`id` is not a UUID, or the account is not on this event" },
        ],
      },
    ],
  },
];
