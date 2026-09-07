import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { harnessTokens } from "@/db/schema";
import type { DeployError } from "@/lib/harness-deploy-errors";
import { harnessIdentifier } from "@/lib/harness-identifier";
import { orgSecretValues } from "@/lib/harness-org-secrets";
import { ACCOUNT_ADMIN } from "@/lib/harness-permissions";
import { harnessBaseUrl, parseHarnessToken } from "@/lib/harness-platform";
import { listTemplateSources, templateSourceToken } from "@/lib/harness-templates";
import { openSecret } from "@/lib/secret-box";

/**
 * Building a whole Harness organization out of what this site already holds.
 *
 * Three separate stores come together here, and each contributes the part it is
 * the authority for:
 *
 *   * the user's own saved token (Settings → My Tokens) is the credential
 *     everything is *written* with, which is why the button only appears on a
 *     token that administers the account;
 *   * Settings → Org Secrets supplies the secret values, because a secret's
 *     value cannot be read back out of Harness — copying one from another
 *     organization is not a thing the platform permits, and this tab exists
 *     precisely so there is somewhere to keep the plaintext;
 *   * Settings → Templates supplies the *content*: each row names an
 *     organization (or one project in it) and carries its own token, and this
 *     reads connectors, templates, environments, and infrastructure definitions
 *     out of it.
 *
 * So a deploy is a copy between two Harness scopes with two different
 * credentials — read as the source row's token, written as the user's. They are
 * frequently different accounts, which is the whole point.
 *
 * Nothing is transactional and nothing is rolled back. Past the organization
 * itself, every entity is reported individually and a failure costs only that
 * entity: a connector Harness refuses because it references an account-level
 * secret that does not exist in the target is a line in the report, not a reason
 * to throw away the twenty things that landed. Deleting the organization is one
 * click in Harness, and is a far better recovery than a half-built rollback.
 */

/* ------------------------------------------------------------------ *
 * What comes back
 * ------------------------------------------------------------------ */

export type DeployOutcome =
  /** Made now. */
  | "created"
  /** Already there, and left as it was. */
  | "existed"
  /** Harness refused it. `detail` says what it said. */
  | "failed"
  /** Not attempted, and why. A secret that cannot be decrypted, say. */
  | "skipped";

/** One entity the deploy touched. The report is a list of these, in order. */
export type DeployStep = {
  /** Where it landed, as a person reads it: `myorg` or `myorg / myproject`. */
  scope: string;
  kind:
    | "organization"
    | "project"
    | "secret"
    | "connector"
    | "template"
    | "environment"
    | "infrastructure";
  /** The Harness identifier, and for a template its version after a colon. */
  identifier: string;
  outcome: DeployOutcome;
  /** Why, whenever the outcome is not simply "created". */
  detail?: string;
};

export type DeployReport = {
  orgIdentifier: string;
  orgName: string;
  /** Harness console link to what was just built. */
  orgUrl: string;
  steps: DeployStep[];
  counts: Record<DeployOutcome, number>;
  /** How many template sources were read, so the report says where this came from. */
  sources: number;
};

export type DeployResult =
  | { ok: true; report: DeployReport }
  | { ok: false; error: DeployError; detail?: string };

/* ------------------------------------------------------------------ *
 * The Harness client — writing, this time
 * ------------------------------------------------------------------ */

type Json = Record<string, unknown>;
type Query = Record<string, string | undefined>;

/**
 * Longer than the token check's twelve seconds. That one is a person waiting on
 * a form; this is one call inside a long batch, and a template create carrying a
 * thousand-line pipeline is legitimately slow.
 */
const TIMEOUT_MS = 30_000;

/** Attempts for a request that fails with something a retry could fix. */
const MAX_ATTEMPTS = 3;

type Reply = { status: number; text: string };

/**
 * Worth trying again: Harness's own 5xx and the rate limiter.
 *
 * A 500 straight after creating a scope is not the fatal condition it looks
 * like — Harness propagates a new organization asynchronously, and the first
 * write into it can land before the RBAC machinery has caught up. The runner
 * learned this the same way; see `runner/src/harness.ts`.
 */
const isRetryable = (status: number) => status === 429 || status >= 500;

/** Harness reports "already exists" as a 409 sometimes and a 400 others. */
const isDuplicate = (status: number, body: string) =>
  status === 409 || /DUPLICATE_FIELD|already exists|duplicate/i.test(body);

/** Harness puts the reason in `message`, and on a 5xx a traceable id beside it. */
function messageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      correlationId?: string;
    };
    const message = parsed.message ?? body;
    // Kept whatever the status: the one time it is needed is the one time the
    // message itself is "Oops, something went wrong on our end".
    return parsed.correlationId
      ? `${message} [correlationId ${parsed.correlationId}]`
      : message;
  } catch {
    return body.slice(0, 400);
  }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * One Harness request, retried where a retry could help.
 *
 * A `string` body is sent verbatim — the template endpoint takes raw YAML, and
 * under `Content-Type: application/json`, which looks like a bug and is not:
 * that is what Harness accepts, and a correct `application/yaml` is refused.
 *
 * `FormData` is left for `fetch` to encode, so the multipart boundary is right.
 * Never throws: a transport failure comes back as status 0, which every caller
 * already has to handle because Harness refusals arrive the same way.
 */
async function harnessRequest(
  token: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  query: Query,
  body?: Json | FormData | string,
): Promise<Reply> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const url = `${harnessBaseUrl()}${path}?${params.toString()}`;

  let last: Reply = { status: 0, text: "" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "x-api-key": token,
          ...(body === undefined || body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData || typeof body === "string"
              ? body
              : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      last = { status: res.status, text: await res.text() };
      if (res.ok || !isRetryable(res.status)) return last;
    } catch (err) {
      // Timeout, DNS, TLS. Status 0 marks "nothing was decided", which reads
      // differently from a refusal and must not be reported as one.
      last = {
        status: 0,
        text: err instanceof Error ? err.message : "Could not reach Harness.",
      };
    }

    if (attempt === MAX_ATTEMPTS) break;
    // 1s then 2s — long enough for a fresh scope to finish propagating, short
    // enough that a batch of fifty entities does not stall on one bad one.
    await wait(1000 * 2 ** (attempt - 1));
  }

  return last;
}

const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300;

/** A successful reply's `data`, or null if it did not have one. */
function dataOf<T>(reply: Reply): T | null {
  try {
    return (JSON.parse(reply.text) as { data?: T }).data ?? null;
  } catch {
    return null;
  }
}

/**
 * Create something, and say which of "made it" and "it was already there"
 * happened. A duplicate is success: the point of this is to converge on an
 * organization that has the content in it, and a re-run after fixing one broken
 * connector must not fail on the forty-nine that worked the first time.
 */
function outcomeOf(reply: Reply): { outcome: DeployOutcome; detail?: string } {
  if (ok(reply)) return { outcome: "created" };
  if (isDuplicate(reply.status, reply.text)) return { outcome: "existed" };
  return {
    outcome: "failed",
    detail:
      reply.status === 0
        ? reply.text
        : `${messageOf(reply.text)} (HTTP ${reply.status})`,
  };
}

/* ------------------------------------------------------------------ *
 * Paging
 * ------------------------------------------------------------------ */

/** Harness caps these list endpoints at 100. */
const PAGE_SIZE = 100;

/** A stop, so a paging bug cannot spin here against somebody's account. */
const MAX_PAGES = 20;

/**
 * Walk a paged Harness list endpoint.
 *
 * The two families disagree about what the paging parameters are called —
 * `/ng/api/connectors` wants `pageIndex`/`pageSize` and the CD endpoints want
 * `page`/`size` — so the names are the caller's to supply. Everything else about
 * paging is the same, including that a short page is the last one: cheaper to
 * trust than `totalPages`, which not all of these responses carry.
 */
async function listPages<T>(
  token: string,
  method: "GET" | "POST",
  path: string,
  query: Query,
  names: { page: string; size: string },
  body?: Json,
): Promise<{ ok: true; items: T[] } | { ok: false; detail: string }> {
  const items: T[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const reply = await harnessRequest(
      token,
      method,
      path,
      { ...query, [names.page]: String(page), [names.size]: String(PAGE_SIZE) },
      body,
    );
    if (!ok(reply)) {
      return {
        ok: false,
        detail:
          reply.status === 0
            ? reply.text
            : `${messageOf(reply.text)} (HTTP ${reply.status})`,
      };
    }

    const content = dataOf<{ content?: T[] }>(reply)?.content ?? [];
    items.push(...content);
    if (content.length < PAGE_SIZE) break;
  }

  return { ok: true, items };
}

/* ------------------------------------------------------------------ *
 * Re-scoping YAML
 * ------------------------------------------------------------------ */

/** A scalar that is safe wherever a name with a colon or a quote in it lands. */
const yamlScalar = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Rewrite the keys that say *where* an entity lives, leaving the rest of the
 * document untouched.
 *
 * Deliberately textual rather than parsed. These bodies are arbitrary Harness
 * YAML — deep pipeline structure, `<+expressions>`, block scalars — and
 * round-tripping one through a parser risks silently changing something the
 * author meant: quoting, key order, how a multi-line string folds. The keys
 * being replaced all sit at a known two-space indent directly under the single
 * root key, so the edit is exact without understanding anything else, and no
 * YAML library is needed at all.
 *
 * Two-space anchoring is what makes it safe: a `connectorRef` or an
 * `orgIdentifier` nested inside a step's spec is at four spaces or more and is
 * left alone, which is right — those are references the author wrote, not this
 * entity's own address. These documents have exactly one root key, so nothing
 * else in them can be at two spaces either.
 *
 * A key mapped to null is removed and not rewritten, which is how an entity
 * copied from a project into an organization loses its `projectIdentifier`
 * rather than keeping one that no longer means anything.
 */
function rescopeYaml(
  yaml: string,
  rootKey: string,
  keys: Record<string, string | null>,
): string {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const root = lines.findIndex((line) => line.trimEnd() === `${rootKey}:`);
  if (root === -1) {
    throw new Error(
      `expected this ${rootKey} to start with "${rootKey}:" — Harness returned ` +
        `something else`,
    );
  }

  const owned = new RegExp(`^ {2}(${Object.keys(keys).join("|")}):`);
  const replacements = Object.entries(keys)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `  ${key}: ${yamlScalar(value!)}`);

  return [
    ...lines.slice(0, root + 1),
    ...replacements,
    ...lines.slice(root + 1).filter((line) => !owned.test(line)),
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Scopes
 * ------------------------------------------------------------------ */

/** One end of the copy: a credential and the scope it addresses. */
type Scope = {
  token: string;
  accountId: string;
  org: string;
  /** Null for the organization itself rather than a project inside it. */
  project: string | null;
};

/** The query every scoped endpoint takes. */
const scopeQuery = (scope: Scope): Query => ({
  accountIdentifier: scope.accountId,
  orgIdentifier: scope.org,
  projectIdentifier: scope.project ?? undefined,
});

/** How a scope reads in the report. */
const scopeLabel = (scope: Scope) =>
  scope.project ? `${scope.org} / ${scope.project}` : scope.org;

/** Every entity this deploy creates, tagged so it is findable in Harness later. */
const TAGS = { deployed_by: "workshop-orchestrator" };
const DESCRIPTION = "Deployed by Workshop Orchestrator.";

/* ------------------------------------------------------------------ *
 * Copying one kind at a time
 * ------------------------------------------------------------------ */

/**
 * A collector for the report, so each copy function can just say what happened
 * and never has to thread an array through itself.
 */
type Record_ = (step: DeployStep) => void;

/**
 * Connectors, as they are: whatever type and spec the source has, re-addressed
 * to the target scope.
 *
 * `harnessManaged` connectors are skipped silently rather than reported. Every
 * organization gets its own `harnessSecretManager` the moment it is created, so
 * copying one is both impossible and pointless — a skipped line for it in every
 * report would be noise that teaches nobody anything.
 *
 * A connector referencing a secret says so as `org.<identifier>`, and those
 * references keep working here because the org secrets went in first under the
 * same identifiers. One referencing `account.<identifier>` will not: nothing in
 * this site's settings describes account-level content, so Harness refuses it
 * and the report says which reference it could not resolve. That is a real limit
 * of copying between accounts, and worth reporting rather than papering over.
 */
async function copyConnectors(
  from: Scope,
  to: Scope,
  record: Record_,
): Promise<void> {
  const listed = await listPages<{
    connector?: Json;
    harnessManaged?: boolean;
  }>(from.token, "GET", "/ng/api/connectors", scopeQuery(from), {
    page: "pageIndex",
    size: "pageSize",
  });

  if (!listed.ok) {
    record({
      scope: scopeLabel(to),
      kind: "connector",
      identifier: `(all, from ${scopeLabel(from)})`,
      outcome: "failed",
      detail: `Could not list them: ${listed.detail}`,
    });
    return;
  }

  for (const entry of listed.items) {
    if (entry.harnessManaged === true) continue;
    const connector = entry.connector;
    const identifier = connector?.identifier;
    if (!connector || typeof identifier !== "string") continue;

    // The account is carried in the query string, and the source's own account
    // id in the body would contradict it.
    const rest = { ...connector };
    delete rest.accountIdentifier;

    const reply = await harnessRequest(
      to.token,
      "POST",
      "/ng/api/connectors",
      scopeQuery(to),
      {
        connector: {
          ...rest,
          orgIdentifier: to.org,
          projectIdentifier: to.project ?? undefined,
          tags: { ...((connector.tags as Json | undefined) ?? {}), ...TAGS },
        },
      },
    );

    record({
      scope: scopeLabel(to),
      kind: "connector",
      identifier,
      ...outcomeOf(reply),
    });
  }
}

/**
 * Templates, one version at a time.
 *
 * `templateListType=All` rather than `Stable`, because a template's identity is
 * its identifier *and* its version label: an organization that got only the
 * stable version of each is missing the versions its own pipelines pin to. Each
 * version needs its YAML fetched separately — the list endpoint returns metadata
 * only — so this is the one kind that costs two calls per entity.
 *
 * The name, identifier, and version label are written back into the YAML from
 * the metadata rather than trusted to be in it. They are frequently not: Harness
 * happily returns a template body with no `identifier:` line and derives one from
 * the name on create, which would quietly rename anything whose name and
 * identifier differ.
 */
async function copyTemplates(
  from: Scope,
  to: Scope,
  record: Record_,
): Promise<void> {
  const listed = await listPages<{
    identifier?: string;
    name?: string;
    versionLabel?: string;
  }>(
    from.token,
    "POST",
    "/template/api/templates/list-metadata",
    { ...scopeQuery(from), templateListType: "All" },
    { page: "page", size: "size" },
    { filterType: "Template" },
  );

  if (!listed.ok) {
    record({
      scope: scopeLabel(to),
      kind: "template",
      identifier: `(all, from ${scopeLabel(from)})`,
      outcome: "failed",
      detail: `Could not list them: ${listed.detail}`,
    });
    return;
  }

  for (const meta of listed.items) {
    const { identifier, versionLabel } = meta;
    if (typeof identifier !== "string" || typeof versionLabel !== "string") {
      continue;
    }
    // The version is part of what was copied, so it is part of what the report
    // names — two lines differing only in a suffix is the truth here.
    const label = `${identifier}:${versionLabel}`;

    const fetched = await harnessRequest(
      from.token,
      "GET",
      `/template/api/templates/${encodeURIComponent(identifier)}`,
      { ...scopeQuery(from), versionLabel },
    );
    const yaml = dataOf<{ yaml?: string }>(fetched)?.yaml;
    if (!ok(fetched) || typeof yaml !== "string") {
      record({
        scope: scopeLabel(to),
        kind: "template",
        identifier: label,
        outcome: "failed",
        detail: `Could not read it from ${scopeLabel(from)}: ${
          ok(fetched) ? "Harness returned no YAML." : messageOf(fetched.text)
        }`,
      });
      continue;
    }

    let body: string;
    try {
      body = rescopeYaml(yaml, "template", {
        name: meta.name ?? identifier,
        identifier,
        versionLabel,
        orgIdentifier: to.org,
        projectIdentifier: to.project,
      });
    } catch (err) {
      record({
        scope: scopeLabel(to),
        kind: "template",
        identifier: label,
        outcome: "skipped",
        detail: err instanceof Error ? err.message : "Unreadable YAML.",
      });
      continue;
    }

    // `storeType=INLINE` says the template lives in Harness. Without it the
    // create is read as the start of a GitX flow and asks for repository
    // details that nothing here has.
    const reply = await harnessRequest(
      to.token,
      "POST",
      "/template/api/templates",
      { ...scopeQuery(to), storeType: "INLINE" },
      body,
    );

    record({
      scope: scopeLabel(to),
      kind: "template",
      identifier: label,
      ...outcomeOf(reply),
    });
  }
}

/**
 * Environments, and then the infrastructure definitions inside each one.
 *
 * They are done together and in that order because Harness gives no way to list
 * infrastructure definitions across an environment boundary — `/infrastructures`
 * without an `environmentIdentifier` answers "the environment: null is no longer
 * available", not an empty list. So the environments *are* the index, and an
 * environment that failed to copy is also a set of infrastructure definitions
 * that has nowhere to go.
 *
 * They are listed from the source either way, though. Reporting each one as
 * skipped with the environment named is worth more than a silent gap the size of
 * however many there were.
 */
async function copyEnvironments(
  from: Scope,
  to: Scope,
  record: Record_,
): Promise<void> {
  const listed = await listPages<{ environment?: Json }>(
    from.token,
    "GET",
    "/ng/api/environmentsV2",
    scopeQuery(from),
    { page: "page", size: "size" },
  );

  if (!listed.ok) {
    record({
      scope: scopeLabel(to),
      kind: "environment",
      identifier: `(all, from ${scopeLabel(from)})`,
      outcome: "failed",
      detail: `Could not list them: ${listed.detail}`,
    });
    return;
  }

  for (const entry of listed.items) {
    const environment = entry.environment;
    const identifier = environment?.identifier;
    if (!environment || typeof identifier !== "string") continue;

    const name = typeof environment.name === "string" ? environment.name : identifier;
    const yaml = typeof environment.yaml === "string" ? environment.yaml : null;

    let body: string | null = null;
    if (yaml !== null) {
      try {
        body = rescopeYaml(yaml, "environment", {
          name,
          identifier,
          orgIdentifier: to.org,
          projectIdentifier: to.project,
        });
      } catch {
        // Fall through to the generated body below. An environment's YAML is
        // short and this is recoverable, unlike a template's.
      }
    }

    const reply = await harnessRequest(
      to.token,
      "POST",
      "/ng/api/environmentsV2",
      { accountIdentifier: to.accountId },
      {
        identifier,
        name,
        orgIdentifier: to.org,
        projectIdentifier: to.project ?? undefined,
        description: DESCRIPTION,
        tags: { ...((environment.tags as Json | undefined) ?? {}), ...TAGS },
        // Harness rejects an environment with no type; `PreProduction` is the
        // safer default of the two if the source somehow had none.
        type: typeof environment.type === "string" ? environment.type : "PreProduction",
        // The YAML is what carries everything else — variables, overrides — so
        // it is sent when there is one, and the fields above stand alone when
        // there is not.
        ...(body === null ? {} : { yaml: body }),
      },
    );

    const result = outcomeOf(reply);
    record({
      scope: scopeLabel(to),
      kind: "environment",
      identifier,
      ...result,
    });

    await copyInfrastructures(
      from,
      to,
      identifier,
      result.outcome === "failed" ? result.detail : null,
      record,
    );
  }
}

/**
 * The infrastructure definitions in one environment.
 *
 * `blocked` carries the reason the environment itself did not make it, so each
 * definition is reported as skipped for the real reason rather than as a create
 * that would fail with a confusing "environment not found".
 */
async function copyInfrastructures(
  from: Scope,
  to: Scope,
  environment: string,
  blocked: string | null | undefined,
  record: Record_,
): Promise<void> {
  const listed = await listPages<{ infrastructure?: Json }>(
    from.token,
    "GET",
    "/ng/api/infrastructures",
    { ...scopeQuery(from), environmentIdentifier: environment },
    { page: "page", size: "size" },
  );

  if (!listed.ok) {
    record({
      scope: scopeLabel(to),
      kind: "infrastructure",
      identifier: `(all in ${environment})`,
      outcome: "failed",
      detail: `Could not list them: ${listed.detail}`,
    });
    return;
  }

  for (const entry of listed.items) {
    const infrastructure = entry.infrastructure;
    const identifier = infrastructure?.identifier;
    if (!infrastructure || typeof identifier !== "string") continue;

    // Namespaced by its environment: two environments may each hold a `primary`,
    // and a report with two identical lines in it explains nothing.
    const label = `${environment} / ${identifier}`;

    if (blocked) {
      record({
        scope: scopeLabel(to),
        kind: "infrastructure",
        identifier: label,
        outcome: "skipped",
        detail: `The environment ${environment} could not be created: ${blocked}`,
      });
      continue;
    }

    const name =
      typeof infrastructure.name === "string" ? infrastructure.name : identifier;
    const yaml =
      typeof infrastructure.yaml === "string" ? infrastructure.yaml : null;
    if (yaml === null) {
      record({
        scope: scopeLabel(to),
        kind: "infrastructure",
        identifier: label,
        outcome: "skipped",
        // Unlike an environment, there is nothing to fall back to: the spec —
        // which cluster, which namespace — lives only in the YAML.
        detail: "Harness returned no YAML for it, so there is nothing to copy.",
      });
      continue;
    }

    let body: string;
    try {
      body = rescopeYaml(yaml, "infrastructureDefinition", {
        name,
        identifier,
        orgIdentifier: to.org,
        projectIdentifier: to.project,
        environmentRef: environment,
      });
    } catch (err) {
      record({
        scope: scopeLabel(to),
        kind: "infrastructure",
        identifier: label,
        outcome: "skipped",
        detail: err instanceof Error ? err.message : "Unreadable YAML.",
      });
      continue;
    }

    const reply = await harnessRequest(
      to.token,
      "POST",
      "/ng/api/infrastructures",
      { accountIdentifier: to.accountId },
      {
        identifier,
        name,
        orgIdentifier: to.org,
        projectIdentifier: to.project ?? undefined,
        environmentRef: environment,
        description: DESCRIPTION,
        tags: { ...((infrastructure.tags as Json | undefined) ?? {}), ...TAGS },
        type: infrastructure.type,
        deploymentType: infrastructure.deploymentType,
        yaml: body,
      },
    );

    record({
      scope: scopeLabel(to),
      kind: "infrastructure",
      identifier: label,
      ...outcomeOf(reply),
    });
  }
}

/**
 * One source scope copied into one target scope, in dependency order:
 * connectors, then templates, then environments, then the infrastructure
 * definitions inside each environment.
 *
 * That order is not cosmetic. A template referencing a connector needs it to
 * exist, and an infrastructure definition cannot be created without the
 * environment it belongs to. Secrets come before all of it, once per deploy,
 * because every scope's connectors may reference them.
 */
async function copyScope(from: Scope, to: Scope, record: Record_): Promise<void> {
  await copyConnectors(from, to, record);
  await copyTemplates(from, to, record);
  await copyEnvironments(from, to, record);
}

/* ------------------------------------------------------------------ *
 * Secrets
 * ------------------------------------------------------------------ */

/**
 * The site's org secrets, into the new organization.
 *
 * First, before any connector: a connector naming a secret that is not there yet
 * is refused, and no ordering inside the copy can fix that because the secret
 * comes from somewhere else entirely.
 *
 * The identifier doubles as the display name. Harness wants both and an
 * administrator supplied one string; inventing a prettier name would mean the
 * organization shows something nobody typed. Same choice the runner makes.
 */
async function deploySecrets(to: Scope, record: Record_): Promise<void> {
  for (const secret of await orgSecretValues()) {
    if (secret.value === null) {
      record({
        scope: scopeLabel(to),
        kind: "secret",
        identifier: secret.identifier,
        outcome: "skipped",
        detail:
          "It cannot be decrypted with this deployment's key — re-enter it in " +
          "Settings → Org Secrets.",
      });
      continue;
    }

    const spec = {
      name: secret.identifier,
      identifier: secret.identifier,
      orgIdentifier: to.org,
      description: DESCRIPTION,
      tags: TAGS,
    };

    let reply: Reply;
    if (secret.kind === "file") {
      // Multipart, which is why the file endpoint is the one place here that
      // does not send JSON.
      const form = new FormData();
      form.append(
        "spec",
        JSON.stringify({
          secret: {
            ...spec,
            type: "SecretFile",
            spec: { secretManagerIdentifier: "org.harnessSecretManager" },
          },
        }),
      );
      form.append(
        "file",
        new Blob([secret.value], { type: "text/plain" }),
        secret.fileName ?? `${secret.identifier}.txt`,
      );
      reply = await harnessRequest(
        to.token,
        "POST",
        "/ng/api/v2/secrets/files",
        { accountIdentifier: to.accountId, orgIdentifier: to.org },
        form,
      );
    } else {
      reply = await harnessRequest(
        to.token,
        "POST",
        "/ng/api/v2/secrets",
        { accountIdentifier: to.accountId, orgIdentifier: to.org },
        {
          secret: {
            ...spec,
            type: "SecretText",
            spec: {
              secretManagerIdentifier: "org.harnessSecretManager",
              valueType: "Inline",
              value: secret.value,
            },
          },
        },
      );
    }

    record({
      scope: scopeLabel(to),
      kind: "secret",
      identifier: secret.identifier,
      ...outcomeOf(reply),
    });
  }
}

/* ------------------------------------------------------------------ *
 * The deploy
 * ------------------------------------------------------------------ */

/** Console link to what was built, so the report ends somewhere useful. */
const orgUrl = (accountId: string, org: string) =>
  `${harnessBaseUrl()}/ng/account/${accountId}/settings/organizations/${org}/details`;

/**
 * Ask Harness, right now, whether this token still administers the account.
 *
 * The stored permission findings are a snapshot and gate the *button*; this gates
 * the write. A grant revoked since the token was last checked is exactly the case
 * worth one extra round trip before creating an organization and filling it with
 * the site's credentials.
 */
async function administersAccountNow(
  token: string,
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: DeployError; detail?: string }> {
  const reply = await harnessRequest(token, "POST", "/authz/api/acl", {
    accountIdentifier: accountId,
  }, {
    permissions: [
      {
        resourceScope: { accountIdentifier: accountId },
        resourceType: "ACCOUNT",
        permission: ACCOUNT_ADMIN,
      },
    ],
  });

  if (!ok(reply)) {
    if (reply.status === 0) {
      return { ok: false, error: "unreachable", detail: reply.text };
    }
    if (reply.status === 401 || reply.status === 403) {
      return { ok: false, error: "invalid_token", detail: messageOf(reply.text) };
    }
    return { ok: false, error: "harness_error", detail: messageOf(reply.text) };
  }

  const granted = dataOf<{
    accessControlList?: { permission?: string; permitted?: boolean }[];
  }>(reply)?.accessControlList?.some(
    (entry) => entry.permission === ACCOUNT_ADMIN && entry.permitted === true,
  );

  return granted ? { ok: true } : { ok: false, error: "not_permitted" };
}

/**
 * Build a new Harness organization from this site's settings, using one of the
 * user's own saved tokens.
 *
 * The order is the whole design, and it is dependency order rather than
 * anything alphabetical:
 *
 *   1. the organization;
 *   2. every secret from Settings → Org Secrets, because connectors reference
 *      them and nothing else can supply their values;
 *   3. every template source that names a *whole organization*, copied into the
 *      new organization at org scope — these are the shared entities that
 *      everything inside the org can reference as `org.<identifier>`;
 *   4. every template source that names a *project*, each into a project of the
 *      same name created inside the new organization.
 *
 * Org-scoped content before project-scoped content matters for the same reason
 * secrets come before connectors: a project's pipeline may reference an
 * `org.` template, and one that lands first resolves.
 */
export async function deployContent(
  userId: string,
  tokenId: string,
  orgName: string,
): Promise<DeployResult> {
  const name = orgName.trim();
  const identifier = harnessIdentifier(name);
  if (name.length === 0 || identifier === null) {
    return { ok: false, error: "invalid_name" };
  }

  const [row] = await db
    .select()
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, tokenId), eq(harnessTokens.userId, userId)));
  if (!row) return { ok: false, error: "not_found" };

  const secret = openSecret(row.secret);
  if (secret === null) return { ok: false, error: "unreadable" };

  const parsed = parseHarnessToken(secret);
  if (!parsed) {
    return {
      ok: false,
      error: "invalid_token",
      detail: "The stored token is not in a shape Harness accepts.",
    };
  }

  const allowed = await administersAccountNow(secret, parsed.accountId);
  if (!allowed.ok) return allowed;

  const target: Scope = {
    token: secret,
    accountId: parsed.accountId,
    org: identifier,
    project: null,
  };

  const steps: DeployStep[] = [];
  const record: Record_ = (step) => steps.push(step);

  /* 1. The organization. The one failure that stops everything: there is
        nowhere to put the rest of it. */
  const created = await harnessRequest(
    secret,
    "POST",
    "/ng/api/organizations",
    { accountIdentifier: parsed.accountId },
    {
      organization: { identifier, name, description: DESCRIPTION, tags: TAGS },
    },
  );
  if (!ok(created)) {
    if (isDuplicate(created.status, created.text)) {
      // Refused rather than treated as success, unlike every entity below. An
      // existing organization is somebody's — filling it with this site's
      // secrets and connectors is not a thing to do by accident on a name
      // collision.
      return {
        ok: false,
        error: "org_exists",
        detail: messageOf(created.text),
      };
    }
    return {
      ok: false,
      error: created.status === 0 ? "unreachable" : "org_failed",
      detail: created.status === 0 ? created.text : messageOf(created.text),
    };
  }
  record({
    scope: identifier,
    kind: "organization",
    identifier,
    outcome: "created",
  });

  /* 2. The site's secrets, before anything that could reference one. */
  await deploySecrets(target, record);

  /* 3 and 4. The template sources: whole organizations first, then projects. */
  const sources = await listTemplateSources();
  const ordered = [
    ...sources.filter((s) => s.projectIdentifier === null),
    ...sources.filter((s) => s.projectIdentifier !== null),
  ];

  for (const source of ordered) {
    const token = await templateSourceToken(source.id);
    if (token === null) {
      record({
        scope: scopeLabel(target),
        kind: "connector",
        identifier: `(everything from ${source.orgIdentifier})`,
        outcome: "skipped",
        detail:
          "That template source's token cannot be decrypted — re-add it in " +
          "Settings → Templates.",
      });
      continue;
    }

    const from: Scope = {
      token,
      accountId: source.accountId,
      org: source.orgIdentifier,
      project: source.projectIdentifier,
    };

    // A whole-organization source copies into the organization itself.
    if (source.projectIdentifier === null) {
      await copyScope(from, target, record);
      continue;
    }

    // A project source gets a project of the same name, and the same identifier
    // — the identifier is what `<+...>` references and connector refs resolve
    // against, so keeping it is what makes the copied content still work.
    const project = source.projectIdentifier;
    const projectName = source.projectName ?? project;
    const madeProject = await harnessRequest(
      secret,
      "POST",
      "/ng/api/projects",
      { accountIdentifier: parsed.accountId, orgIdentifier: identifier },
      {
        project: {
          identifier: project,
          name: projectName,
          orgIdentifier: identifier,
          description: DESCRIPTION,
          tags: TAGS,
        },
      },
    );
    const projectResult = outcomeOf(madeProject);
    record({
      scope: identifier,
      kind: "project",
      identifier: project,
      ...projectResult,
    });

    if (projectResult.outcome === "failed") {
      // Nothing below could land, and forty failures all saying "no such
      // project" would bury the one line that explains it.
      record({
        scope: `${identifier} / ${project}`,
        kind: "connector",
        identifier: `(everything from ${scopeLabel(from)})`,
        outcome: "skipped",
        detail: `The project ${project} could not be created.`,
      });
      continue;
    }

    await copyScope(from, { ...target, project }, record);
  }

  const counts: Record<DeployOutcome, number> = {
    created: 0,
    existed: 0,
    failed: 0,
    skipped: 0,
  };
  for (const step of steps) counts[step.outcome] += 1;

  return {
    ok: true,
    report: {
      orgIdentifier: identifier,
      orgName: name,
      orgUrl: orgUrl(parsed.accountId, identifier),
      steps,
      counts,
      sources: ordered.length,
    },
  };
}
