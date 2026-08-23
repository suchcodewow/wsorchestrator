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
 * workshop slug like `k8s-intro` cannot be used as-is.
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

/**
 * Console link to one attendee's project — where they actually do the work,
 * so it lands on the project's overview rather than its settings the way
 * `orgUrl` does (an organizer opens an org to administer it; an attendee opens
 * a project to build in it).
 */
export function projectUrl(orgId: string, projectId: string): string {
  const cfg = harnessCfg();
  return `${cfg.baseUrl}/ng/account/${cfg.accountId}/home/orgs/${orgId}/projects/${projectId}/details`;
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

type Method = "GET" | "POST" | "PUT" | "DELETE";

/**
 * One Harness request, retrying its own 5xx / rate-limit, returning the final
 * status and body verbatim. The interpreting is left to callers: `api` maps it
 * to ok/duplicate, `ensureOrgDelegateToken` parses the JSON it needs.
 *
 * A `FormData` body is sent as multipart with no Content-Type of our own —
 * only the secret-file endpoints take one, and the boundary has to come from
 * fetch. It survives the retry loop: the parts are held in memory, so the body
 * is re-readable on a second attempt.
 *
 * A `string` body is sent verbatim. That is for the template endpoint, which
 * takes raw YAML — under a Content-Type of `application/json`, which is not a
 * mistake here but what Harness actually accepts (see `createTemplate`).
 */
async function rawRequest(
  method: Method,
  path: string,
  query: Record<string, string | undefined>,
  body?: Json | FormData | string,
  opts: { omitAccount?: boolean } = {},
): Promise<{ status: number; text: string }> {
  const cfg = harnessCfg();
  const params = new URLSearchParams();
  if (!opts.omitAccount) params.set("accountIdentifier", cfg.accountId);
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v);
  }

  const multipart = body instanceof FormData;
  const raw = typeof body === "string";

  let status = 0;
  let text = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${cfg.baseUrl}${path}?${params}`, {
      method,
      headers: {
        "x-api-key": cfg.apiKey,
        ...(multipart ? {} : { "Content-Type": "application/json" }),
      },
      body: multipart
        ? (body as FormData)
        : raw
          ? (body as string)
          : body
            ? JSON.stringify(body)
            : undefined,
    });

    status = res.status;
    text = await res.text();
    if (res.ok) break;

    // A 4xx is our request being wrong; sending it again will not fix it.
    if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) break;

    // 1s, 2s, 4s. Long enough for a scope to finish propagating, short enough
    // that a room is not left watching a blank screen.
    await wait(1000 * 2 ** (attempt - 1));
  }

  return { status, text };
}

async function api(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  query: Record<string, string | undefined>,
  // A `string` is sent verbatim — the template endpoint takes raw YAML.
  body?: Json | string,
  // The `/ng/api/*` endpoints take the account in the query string; the `/v1`
  // roles endpoint infers it from the api key and rejects the extra param, so
  // it opts out here.
  opts: { omitAccount?: boolean } = {},
): Promise<{ ok: boolean; duplicate: boolean }> {
  const { status, text } = await rawRequest(method, path, query, body, opts);

  if (status >= 200 && status < 300) return { ok: true, duplicate: false };
  if (isDuplicate(status, text)) return { ok: true, duplicate: true };
  // A delete of something already gone is not an error.
  if (method === "DELETE" && status === 404) {
    return { ok: true, duplicate: false };
  }

  throw new Error(
    `Harness ${method} ${path} failed (${status}): ${messageOf(text)} ` +
      `(after up to ${MAX_ATTEMPTS} attempts)`,
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

/**
 * Every project that actually exists in the org, by identifier.
 *
 * Teardown deletes projects by listing what is really there rather than
 * recomputing them from the attendee roster: a project created for an attendee
 * whose DB row was later lost would otherwise linger and block the org delete
 * (Harness refuses to delete a non-empty org). Throws if the org cannot be
 * listed, so the caller can fall back to the roster.
 */
export async function listOrgProjects(orgId: string): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 100;
  for (let pageIndex = 0; ; pageIndex++) {
    const { status, text } = await rawRequest("GET", "/ng/api/projects", {
      orgIdentifier: orgId,
      pageIndex: String(pageIndex),
      pageSize: String(pageSize),
    });
    if (status < 200 || status >= 300) {
      throw new Error(
        `could not list projects in org ${orgId} (${status}): ${messageOf(text)}`,
      );
    }
    const body = JSON.parse(text) as {
      data?: {
        content?: Array<{ project?: { identifier?: string } }>;
        totalPages?: number;
      };
    };
    const content = body.data?.content ?? [];
    for (const c of content) {
      if (c.project?.identifier) ids.push(c.project.identifier);
    }
    const totalPages = body.data?.totalPages ?? 1;
    if (content.length === 0 || pageIndex + 1 >= totalPages) break;
  }
  return ids;
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

/* ------------------------------------------------------------------ *
 * Cloud credentials — the event's Google service account key, stored as
 * an org secret and wired to an org Google Cloud connector.
 * ------------------------------------------------------------------ */

const SECRET_PATH = "/ng/api/v2/secrets";
const SECRET_FILE_PATH = "/ng/api/v2/secrets/files";

/**
 * Create a secret, or replace the value behind an existing one. Returns whether
 * it was already there.
 *
 * Unlike the other creates, a duplicate is not simply success: a secret is a
 * credential the runner may be re-uploading because it changed (a run whose
 * environment was rebuilt has a new key), and a stale secret behind a live
 * connector is worse than an error — so an existing secret is updated rather
 * than left alone.
 *
 * `make` is called per request rather than once because the multipart form the
 * file endpoint takes is consumed by the request that sends it.
 */
async function upsertSecret(
  path: string,
  orgId: string,
  identifier: string,
  make: () => Json | FormData,
): Promise<boolean> {
  const created = await rawRequest(
    "POST",
    path,
    { orgIdentifier: orgId },
    make(),
  );
  if (created.status >= 200 && created.status < 300) return false;
  if (!isDuplicate(created.status, created.text)) {
    throw new Error(
      `Harness POST ${path} failed (${created.status}): ` +
        `${messageOf(created.text)}`,
    );
  }

  const updated = await rawRequest(
    "PUT",
    `${path}/${identifier}`,
    { orgIdentifier: orgId },
    make(),
  );
  if (updated.status < 200 || updated.status >= 300) {
    throw new Error(
      `Harness PUT ${path}/${identifier} failed (${updated.status}): ` +
        `${messageOf(updated.text)}`,
    );
  }
  return true;
}

/**
 * Store `value` as an org-scoped inline text secret — the shape the Azure
 * client secret and the AWS secret access key take. See `upsertSecret` for why
 * an existing secret is overwritten.
 */
export async function upsertSecretText(
  orgId: string,
  identifier: string,
  name: string,
  value: string,
): Promise<boolean> {
  return upsertSecret(SECRET_PATH, orgId, identifier, () => ({
    secret: {
      type: "SecretText",
      name,
      identifier,
      orgIdentifier: orgId,
      description: "Created by Workshop Orchestrator.",
      tags: { managed_by: "workshop-orchestrator" },
      spec: {
        secretManagerIdentifier: "org.harnessSecretManager",
        valueType: "Inline",
        value,
      },
    },
  }));
}

/**
 * The multipart body a secret file takes: a JSON `spec` part describing the
 * secret, and the content itself as `file`.
 *
 * `org.harnessSecretManager` is the built-in Harness secret manager as seen
 * from an organization, which is what the reference `Add-SecretJson` uses.
 * Rebuilt per request rather than shared, so the create and the update that may
 * follow it each send their own.
 */
function secretFileForm(
  orgId: string,
  identifier: string,
  name: string,
  content: string,
): FormData {
  const form = new FormData();
  form.append(
    "spec",
    JSON.stringify({
      secret: {
        type: "SecretFile",
        name,
        identifier,
        orgIdentifier: orgId,
        description: "Created by Workshop Orchestrator.",
        tags: { managed_by: "workshop-orchestrator" },
        spec: { secretManagerIdentifier: "org.harnessSecretManager" },
      },
    }),
  );
  form.append("file", new Blob([content], { type: "text/plain" }), `${identifier}.json`);
  return form;
}

/**
 * Store `content` as an org-scoped secret file — the shape a GCP service
 * account key takes, since a Google Cloud connector reads its credential from a
 * file secret. Multipart, which is why the secret endpoints are the one place
 * this client does not go through `api`.
 */
export async function upsertSecretFile(
  orgId: string,
  identifier: string,
  name: string,
  content: string,
): Promise<boolean> {
  return upsertSecret(SECRET_FILE_PATH, orgId, identifier, () =>
    secretFileForm(orgId, identifier, name, content),
  );
}

/**
 * Remove an org secret at teardown. One already gone is not an error. Both
 * kinds are deleted through the same path — the file endpoint only exists for
 * writing the content.
 */
export async function deleteSecret(
  orgId: string,
  identifier: string,
): Promise<void> {
  await api("DELETE", `${SECRET_PATH}/${identifier}`, {
    orgIdentifier: orgId,
  });
}

/**
 * Create one org-scoped connector. Returns whether it already existed.
 *
 * `type` and `spec` come from a catalog component rather than from a typed
 * wrapper per cloud — see `components.ts`. What each cloud's spec has to
 * contain is Harness's business, and the one thing worth knowing here is how it
 * names a secret: an unqualified reference is read as a *project* secret and
 * rejected with "The project level secret cannot be used at a org level", so a
 * spec referencing an org secret must say `org.<identifier>` even though the
 * connector is in that same org. That prefix is also what `components.ts` reads
 * dependencies out of.
 *
 * `executeOnDelegate: false` runs the connector's cloud calls on the Harness
 * platform rather than through a delegate. Manual credentials are self-
 * contained, so nothing here needs one — and the event's delegates are
 * best-effort and may not exist at all, which would otherwise leave the
 * connector permanently failing its test.
 */
export async function createConnector(
  orgId: string,
  identifier: string,
  name: string,
  type: string,
  spec: Json,
): Promise<boolean> {
  const { duplicate } = await api(
    "POST",
    "/ng/api/connectors",
    { orgIdentifier: orgId },
    {
      connector: {
        identifier,
        name,
        orgIdentifier: orgId,
        description: "Created by Workshop Orchestrator.",
        tags: { managed_by: "workshop-orchestrator" },
        type,
        spec: { ...spec, executeOnDelegate: false },
      },
    },
  );
  return duplicate;
}

/* ------------------------------------------------------------------ *
 * Templates — the reusable pipeline, stage, and step definitions the
 * labs are built out of
 * ------------------------------------------------------------------ */

/**
 * Top-level keys under `template:` that identify it, which this client owns
 * rather than the author.
 *
 * A contributor writing a template should be describing what it *does*; which
 * organization it lands in and what it is called are facts about the
 * deployment, and a workshop org is not known when the template is written. So
 * any of these in the submitted YAML are dropped and replaced — the same thing
 * the reference `Add-OrgYaml` does, and for the same reason.
 *
 * `projectIdentifier` is stripped though nothing here sets it: a template
 * carrying one would be created into a project rather than the org, which is
 * not what an org-scoped component means.
 */
const TEMPLATE_OWNED_KEYS = [
  "name",
  "identifier",
  "versionLabel",
  "orgIdentifier",
  "projectIdentifier",
];

/**
 * The YAML to send: the author's, with the identifying keys replaced by ours.
 *
 * Deliberately textual rather than parsed. A template body is arbitrary Harness
 * YAML full of `<+expressions>` and deep pipeline structure, and round-tripping
 * it through a parser risks changing something the author meant — quoting, key
 * order, a block scalar. The keys being replaced are all at a known two-space
 * indent directly under `template:`, so the edit is exact without understanding
 * the rest, which is why no YAML library is needed here at all.
 */
export function templateYaml(
  orgId: string,
  identifier: string,
  name: string,
  versionLabel: string,
  yaml: string,
): string {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const first = lines[0]?.trim();
  if (first !== "template:") {
    throw new Error(
      `template "${identifier}" must start with "template:" (found ${
        first ? `"${first}"` : "an empty first line"
      })`,
    );
  }

  const owned = new RegExp(`^ {2}(${TEMPLATE_OWNED_KEYS.join("|")}):`);
  const body = lines.slice(1).filter((line) => !owned.test(line));

  return [
    "template:",
    `  name: ${name}`,
    `  identifier: ${identifier}`,
    // Quoted: a version label of `1` is a number to YAML and a string to
    // Harness, and the reference quotes it.
    `  versionLabel: "${versionLabel}"`,
    `  orgIdentifier: ${orgId}`,
    ...body,
  ].join("\n");
}

/**
 * Create one org-scoped template. Returns whether it already existed.
 *
 * Two things about this endpoint are worth writing down, because both look like
 * bugs and neither is:
 *
 *   * the body is raw YAML sent under `Content-Type: application/json`. That is
 *     what the proven reference sends and what Harness accepts; a correct
 *     `application/yaml` is rejected.
 *   * `storeType=INLINE` says the template lives in Harness rather than in a
 *     connected Git repository. Without it the create is read as the start of a
 *     GitX flow and asks for repository details a workshop has none of.
 *
 * A template's identity is its identifier *and* its version label, so this
 * creates a version rather than overwriting one. An existing version is left
 * alone — which is right for a versioned entity, and is why this is `create`
 * where the secrets are `upsert`: editing a published template in place would
 * change what a running workshop's pipelines resolve to mid-lab.
 */
export async function createTemplate(
  orgId: string,
  identifier: string,
  name: string,
  versionLabel: string,
  yaml: string,
): Promise<boolean> {
  const { duplicate } = await api(
    "POST",
    "/template/api/templates",
    { orgIdentifier: orgId, storeType: "INLINE" },
    templateYaml(orgId, identifier, name, versionLabel, yaml),
  );
  return duplicate;
}

/** Remove an org connector at teardown. One already gone is not an error. */
export async function deleteConnector(
  orgId: string,
  identifier: string,
): Promise<void> {
  await api("DELETE", `/ng/api/connectors/${identifier}`, {
    orgIdentifier: orgId,
  });
}

/* ------------------------------------------------------------------ *
 * Delegate tokens — an org-scoped token per event, for the delegates
 * the runner installs into each workshop cluster.
 * ------------------------------------------------------------------ */

const DELEGATE_TOKEN_PATH = "/ng/api/delegate-token-ng";

/**
 * Get (creating if needed) an ORG-scoped delegate token for the event's org,
 * returning its secret value. It is the token's org scope that makes every
 * delegate registered with it an organization-level delegate.
 *
 * Idempotent for grows and retries: the NG list endpoint returns token values,
 * so an existing token by our name is reused rather than duplicated. The whole
 * delegate feature is best-effort in the runner, so if the value genuinely
 * cannot be obtained this throws and the caller logs it and moves on.
 */
export async function ensureOrgDelegateToken(orgId: string): Promise<string> {
  const name = harnessCfg().delegateTokenName;

  // Reuse an existing token if one is already there (idempotent grow/retry).
  const list = await rawRequest("GET", DELEGATE_TOKEN_PATH, {
    orgIdentifier: orgId,
    status: "ACTIVE",
  });
  if (list.status >= 200 && list.status < 300) {
    const tokens =
      (JSON.parse(list.text) as {
        resource?: Array<{ name?: string; value?: string }>;
      }).resource ?? [];
    const found = tokens.find((t) => t.name === name && t.value);
    if (found?.value) return found.value;
  }

  // Otherwise create it. The value is only returned here, on creation.
  const created = await rawRequest("POST", DELEGATE_TOKEN_PATH, {
    orgIdentifier: orgId,
    tokenName: name,
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(
      `could not create org delegate token for ${orgId} ` +
        `(${created.status}): ${messageOf(created.text)}`,
    );
  }
  const value = (
    JSON.parse(created.text) as { resource?: { value?: string } }
  ).resource?.value;
  if (!value) {
    throw new Error(`delegate token created for ${orgId} but no value returned`);
  }
  return value;
}

const DELEGATE_VERSION_PATH = "/ng/api/delegate-setup/latest-supported-version";

/**
 * The repository the delegate chart pulls its image from. The version endpoint
 * answers with a bare version ("26.08.89802") rather than an image reference,
 * so the repository has to come from somewhere — and it has to be the one the
 * chart itself uses, since that is the registry Harness publishes every
 * delegate tag to.
 */
const DELEGATE_IMAGE_REPO =
  "us-docker.pkg.dev/gar-prod-setup/harness-public/harness/delegate";

/** Delegate versions are `yy.mm.build`, e.g. 26.08.89802. */
const DELEGATE_VERSION_RE = /^\d{2}\.\d{2}\.\d+$/;

/**
 * The delegate image Harness currently supports, as a full image reference,
 * or "" if it cannot be determined.
 *
 * Worth a call per run because the Helm chart's own default image goes stale.
 * Harness releases the delegate every week or two but the chart only every few
 * months, so even the newest chart pins whichever delegate happened to be
 * current when that chart shipped. A delegate expires six months after its
 * release, so a chart that has gone that long between releases installs a
 * delegate that registers and is immediately marked expired — which is exactly
 * what the workshop delegates were doing.
 *
 * Never throws: the whole delegate step is best-effort, and "" leaves the
 * chart's default image in place, which is the previous behaviour rather than
 * a failure.
 */
export async function latestDelegateImage(): Promise<string> {
  let res: { status: number; text: string };
  try {
    res = await rawRequest("GET", DELEGATE_VERSION_PATH, {});
  } catch {
    return "";
  }
  if (res.status < 200 || res.status >= 300) return "";

  // Harness is not consistent about which envelope key an NG endpoint returns
  // its payload under, so both spellings are accepted rather than betting on
  // one and silently falling back forever if it is the other.
  let version: unknown;
  try {
    const parsed = JSON.parse(res.text) as {
      resource?: { latestSupportedVersion?: unknown };
      data?: { latestSupportedVersion?: unknown };
    };
    version =
      parsed.resource?.latestSupportedVersion ??
      parsed.data?.latestSupportedVersion;
  } catch {
    return "";
  }
  if (typeof version !== "string") return "";

  // Guard against a shape change handing back something that is not a version:
  // a bogus tag would fail the image pull on every workshop cluster, which is
  // worse than the stale-but-working chart default.
  const tag = version.trim();
  if (!DELEGATE_VERSION_RE.test(tag)) return "";

  return `${DELEGATE_IMAGE_REPO}:${tag}`;
}

/**
 * Revoke the event's org delegate token at teardown, before the org is deleted.
 * Best-effort: a missing token (nothing was ever created) or an unsupported
 * shape must not block org deletion, so callers wrap this and ignore failures.
 */
export async function revokeOrgDelegateToken(orgId: string): Promise<void> {
  await api(
    "PUT",
    DELEGATE_TOKEN_PATH,
    { orgIdentifier: orgId, tokenName: harnessCfg().delegateTokenName },
    { status: "REVOKED" },
  );
}
