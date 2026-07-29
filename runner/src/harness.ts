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

/** A Harness error response carries its reason in `message`. */
function messageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    return parsed.message ?? body;
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

async function api(
  method: "POST" | "DELETE",
  path: string,
  query: Record<string, string | undefined>,
  body?: Json,
): Promise<{ ok: boolean; duplicate: boolean }> {
  const cfg = harnessCfg();
  const params = new URLSearchParams({ accountIdentifier: cfg.accountId });
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v);
  }

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

  throw new Error(
    `Harness ${method} ${path} failed (${res.status}): ${messageOf(text)}`,
  );
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

/**
 * Invite an attendee at a scope with a single managed role binding. Harness
 * treats an invite for an existing member as a duplicate, so re-running is
 * safe.
 */
async function invite(
  email: string,
  scope: { orgIdentifier: string; projectIdentifier?: string },
  role: string,
  resourceGroup: string,
): Promise<void> {
  await api("POST", "/ng/api/invites", scope, {
    emails: [email],
    roleBindings: [
      {
        roleIdentifier: role,
        resourceGroupIdentifier: resourceGroup,
        managedRole: true,
      },
    ],
    userGroups: [],
  });
}

/** Make an attendee an administrator of their own project. */
export async function grantProjectAdmin(
  orgId: string,
  projectId: string,
  email: string,
): Promise<void> {
  const cfg = harnessCfg();
  await invite(
    email,
    { orgIdentifier: orgId, projectIdentifier: projectId },
    cfg.projectAdminRole,
    cfg.projectAdminResourceGroup,
  );
}

/** Give an attendee view/use access across the whole workshop org. */
export async function grantOrgViewer(
  orgId: string,
  email: string,
): Promise<void> {
  const cfg = harnessCfg();
  await invite(
    email,
    { orgIdentifier: orgId },
    cfg.orgViewerRole,
    cfg.orgViewerResourceGroup,
  );
}
