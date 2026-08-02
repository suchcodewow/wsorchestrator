import { harnessCfg } from "./config.js";

/**
 * Harness NextGen API client.
 *
 * Every workshop gets one Harness organization named after it, containing one
 * project per attendee. Each attendee administers their own project and can
 * view everything else in the org.
 *
 * All the creates are idempotent: Harness answers a re-create with a duplicate
 * error, which is treated as success so a retried or grown run converges
 * instead of failing.
 */

/**
 * Harness entity identifiers must match `^[a-zA-Z_][0-9a-zA-Z_$]{0,127}$` —
 * notably no hyphens (those are allowed only in secret identifiers), so a
 * workshop slug or `bouncy-penguin` username cannot be used as-is.
 */
const MAX_IDENTIFIER = 128;

/**
 * Identifiers Harness reserves for its expression language. A workshop named
 * "Status" would otherwise produce an identifier the platform rejects.
 */
const RESERVED = new Set([
  "or", "and", "eq", "ne", "lt", "gt", "le", "ge", "div", "mod", "not",
  "null", "true", "false", "new", "var", "return", "step", "parallel",
  "stepgroup", "org", "account", "status", "liteenginetask", "notification",
]);

/**
 * Convert arbitrary text into a legal Harness identifier: disallowed
 * characters collapse to underscores, a leading digit gains an underscore
 * prefix, and reserved words gain an underscore suffix.
 */
export function harnessIdentifier(input: string, fallback = "workshop"): string {
  let id = input
    .normalize("NFKD")
    // Drop the combining marks NFKD split off, so "é" becomes "e" not "e_".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^0-9a-zA-Z_$]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  // Truncate before the checks below, so neither the leading-digit prefix nor
  // the reserved-word suffix can be trimmed back off afterwards.
  id = id.slice(0, MAX_IDENTIFIER - 1).replace(/_+$/, "");
  if (id.length === 0) id = fallback;

  // Must start with a letter or underscore.
  if (/^[0-9$]/.test(id)) id = `_${id}`;
  // A reserved word is legal syntax but rejected by the platform.
  if (RESERVED.has(id.toLowerCase())) id = `${id}_`;

  return id;
}

/** Length of the run-id suffix that keeps org identifiers unique. */
const SUFFIX_LEN = 8;

/**
 * Organization identifier for a workshop. Organization identifiers must be
 * unique across the whole Harness account, so a short slice of the run id is
 * appended — two workshops may legitimately share a name.
 */
export function orgIdentifier(name: string, runId: string): string {
  const suffix = runId.replace(/-/g, "").slice(0, SUFFIX_LEN);
  const base = harnessIdentifier(name).slice(0, MAX_IDENTIFIER - SUFFIX_LEN - 1);
  return `${base}_${suffix}`;
}

/** Project identifier for one attendee, from the local part of their email. */
export function projectIdentifier(email: string): string {
  return harnessIdentifier(email.split("@")[0] ?? email, "attendee");
}

/** Console link to the workshop's organization, surfaced in the run view. */
export function orgUrl(orgId: string): string {
  const cfg = harnessCfg();
  return `${cfg.baseUrl}/ng/account/${cfg.accountId}/settings/organizations/${orgId}/details`;
}

type Json = Record<string, unknown>;

/**
 * A Harness error response carries its reason in `message` — and, on a server
 * error, a `correlationId` that is the only thing their support can trace.
 *
 * The id used to be dropped, which made "Oops, something went wrong on our end"
 * the entire diagnostic: a message that says nothing, about a failure on a
 * system we cannot see into. It is kept now, whatever the status, because the
 * one time it is needed is the one time the message is useless.
 */
function messageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      correlationId?: string;
    };
    const message = parsed.message ?? body;
    return parsed.correlationId
      ? `${message} [correlationId ${parsed.correlationId}]`
      : message;
  } catch {
    return body;
  }
}

/**
 * Harness reports "already exists" inconsistently — sometimes 409, sometimes
 * 400 with a DUPLICATE_FIELD code — so both shapes are treated as success.
 */
function isDuplicate(status: number, body: string): boolean {
  return (
    status === 409 ||
    /DUPLICATE_FIELD|already exists|duplicate/i.test(body)
  );
}

/** Attempts for a request that fails with something retryable. */
const MAX_ATTEMPTS = 4;

/**
 * Worth trying again: Harness's own 5xx, and the rate limiter.
 *
 * A 500 from a create is not the fatal condition it looks like. Harness
 * propagates a new scope asynchronously — a project exists the moment it is
 * created, but the RBAC machinery that an invite into that project needs is a
 * beat behind it — so an invite issued in the same second as the project can
 * land before the scope resolves and come back as a server error. It succeeds
 * on a second attempt a moment later.
 *
 * Retrying is safe for every call here: the creates treat a duplicate as
 * success, and a delete treats a 404 the same way, so a request that actually
 * did land before the connection broke converges rather than failing.
 */
const isRetryable = (status: number) => status >= 500 || status === 429;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(
  method: "POST" | "DELETE",
  path: string,
  query: Record<string, string | undefined>,
  body?: Json,
  // The `/ng/api/*` endpoints take the account in the query string; the `/v1`
  // roles endpoint infers it from the api key and rejects the extra param, so
  // it opts out here.
  opts: { omitAccount?: boolean } = {},
): Promise<{ ok: boolean; duplicate: boolean }> {
  const cfg = harnessCfg();
  const params = new URLSearchParams();
  if (!opts.omitAccount) params.set("accountIdentifier", cfg.accountId);
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v);
  }

  let last = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${cfg.baseUrl}${path}?${params}`, {
      method,
      headers: {
        "x-api-key": cfg.apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.ok) return { ok: true, duplicate: false };

    const text = await res.text();
    if (isDuplicate(res.status, text)) return { ok: true, duplicate: true };
    // A delete of something already gone is not an error.
    if (method === "DELETE" && res.status === 404) {
      return { ok: true, duplicate: false };
    }

    last = `Harness ${method} ${path} failed (${res.status}): ${messageOf(text)}`;

    // A 4xx is our request being wrong; sending it again will not fix it.
    if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) break;

    // 1s, 2s, 4s. Long enough for a scope to finish propagating, short enough
    // that a room is not left watching a blank screen.
    await wait(1000 * 2 ** (attempt - 1));
  }

  throw new Error(`${last} (after ${MAX_ATTEMPTS} attempts)`);
}

/** Create the workshop's organization. Returns whether it already existed. */
export async function createOrg(
  identifier: string,
  name: string,
): Promise<boolean> {
  const { duplicate } = await api("POST", "/ng/api/organizations", {}, {
    organization: {
      identifier,
      name,
      description: "Created by Workshop Orchestrator.",
      tags: { managed_by: "workshop-orchestrator" },
    },
  });
  return duplicate;
}

export async function deleteOrg(identifier: string): Promise<void> {
  await api("DELETE", `/ng/api/organizations/${identifier}`, {});
}

/**
 * Permissions the custom org-level attendee role grants, copied verbatim from
 * the reference `Add-AttendeeRole`. It is what lets an attendee actually use
 * the workshop org: build and edit IDP scorecards/layouts/integrations, and
 * view or access the core entities (environments, services, templates,
 * secrets, connectors, files, delegates) the labs depend on — without the
 * account-wide power an admin binding would give.
 */
const ATTENDEE_PERMISSIONS = [
  "idp_scorecard_view",
  "idp_scorecard_edit",
  "idp_scorecard_delete",
  "idp_layout_view",
  "idp_layout_edit",
  "idp_integration_view",
  "idp_integration_create",
  "idp_integration_edit",
  "idp_integration_delete",
  "core_environment_view",
  "core_environment_access",
  "core_environmentgroup_view",
  "core_environmentgroup_access",
  "core_governancePolicy_view",
  "core_governancePolicySets_evaluate",
  "core_governancePolicy_edit",
  "core_governancePolicySets_edit",
  "core_service_view",
  "core_service_access",
  "core_template_view",
  "core_template_access",
  "core_secret_view",
  "core_secret_access",
  "core_connector_view",
  "core_connector_access",
  "core_file_view",
  "core_file_access",
  "core_dashboards_view",
  "core_delegate_view",
  "core_delegateconfiguration_view",
];

/**
 * Create the custom attendee role inside the workshop org. Returns whether it
 * already existed. Uses the `/v1` roles endpoint (the one the reference proves
 * works), which infers the account from the api key rather than a query param.
 */
export async function createAttendeeRole(orgId: string): Promise<boolean> {
  const cfg = harnessCfg();
  const { duplicate } = await api(
    "POST",
    `/v1/orgs/${orgId}/roles`,
    {},
    {
      identifier: cfg.attendeeRole,
      name: cfg.attendeeRoleName,
      permissions: ATTENDEE_PERMISSIONS,
    },
    { omitAccount: true },
  );
  return duplicate;
}

/** Create one attendee's project inside the workshop org. */
export async function createProject(
  orgId: string,
  identifier: string,
  name: string,
): Promise<boolean> {
  const { duplicate } = await api(
    "POST",
    "/ng/api/projects",
    { orgIdentifier: orgId },
    {
      project: {
        identifier,
        name,
        orgIdentifier: orgId,
        description: "Workshop attendee project.",
        tags: { managed_by: "workshop-orchestrator" },
      },
    },
  );
  return duplicate;
}

export async function deleteProject(
  orgId: string,
  identifier: string,
): Promise<void> {
  await api("DELETE", `/ng/api/projects/${identifier}`, {
    orgIdentifier: orgId,
  });
}

/** The scope a role binding applies at, matching Harness's `roleScopeLevel`. */
type Scope = "account" | "organization" | "project";

/**
 * Assign an attendee a single role binding at a scope, via `/ng/api/user/users`
 * — the endpoint the reference `Add-HarnessUser`/`Add-HarnessAdmin` prove out.
 * (An earlier version used `/ng/api/invites`; this is the mechanism the working
 * script uses.) The scope is set by which of `orgIdentifier`/`projectIdentifier`
 * the query carries: neither is account, org alone is organization, both is
 * project. Assigning a role a user already has is treated as a duplicate, so
 * re-running is safe.
 */
async function assignRole(
  email: string,
  query: { orgIdentifier?: string; projectIdentifier?: string },
  scopeLevel: Scope,
  role: { identifier: string; name: string },
  resourceGroup: { identifier: string; name: string },
): Promise<void> {
  await api("POST", "/ng/api/user/users", query, {
    emails: [email],
    roleBindings: [
      {
        roleIdentifier: role.identifier,
        // The display names are not decoration. Harness carries them into the
        // notification it composes for the assignment — a null there is
        // dereferenced server-side, which surfaces as a 500 rather than as a
        // 400 naming the missing field. Sending them costs nothing.
        roleName: role.name,
        roleScopeLevel: scopeLevel,
        resourceGroupIdentifier: resourceGroup.identifier,
        resourceGroupName: resourceGroup.name,
        // The reference sends false for built-in and custom roles alike, and it
        // works — Harness resolves the role by identifier regardless.
        managedRole: false,
      },
    ],
  });
}

/** Make the run's creator an administrator of the whole Harness account. */
export async function grantAccountAdmin(email: string): Promise<void> {
  const cfg = harnessCfg();
  await assignRole(
    email,
    {},
    "account",
    { identifier: cfg.accountAdminRole, name: cfg.accountAdminRoleName },
    {
      identifier: cfg.accountAdminResourceGroup,
      name: cfg.accountAdminResourceGroupName,
    },
  );
}

/** Make an attendee an administrator of their own project. */
export async function grantProjectAdmin(
  orgId: string,
  projectId: string,
  email: string,
): Promise<void> {
  const cfg = harnessCfg();
  await assignRole(
    email,
    { orgIdentifier: orgId, projectIdentifier: projectId },
    "project",
    { identifier: cfg.projectAdminRole, name: cfg.projectAdminRoleName },
    {
      identifier: cfg.projectAdminResourceGroup,
      name: cfg.projectAdminResourceGroupName,
    },
  );
}

/**
 * Bind an attendee to the custom attendee role across the whole workshop org,
 * so they can view and use everyone's work (see `createAttendeeRole` for the
 * permissions). Replaces the earlier managed org-viewer binding.
 */
export async function grantOrgAttendee(
  orgId: string,
  email: string,
): Promise<void> {
  const cfg = harnessCfg();
  await assignRole(
    email,
    { orgIdentifier: orgId },
    "organization",
    { identifier: cfg.attendeeRole, name: cfg.attendeeRoleName },
    {
      identifier: cfg.orgResourceGroup,
      name: cfg.orgResourceGroupName,
    },
  );
}
