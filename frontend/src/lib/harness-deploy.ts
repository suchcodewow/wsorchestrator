/** Builds a Harness organization from this site's settings. */

import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { harnessTokens } from "@/db/schema";
import type { DeployError } from "@/lib/harness-deploy-errors";
import {
  mergeDeployed,
  nothingSelected,
  type DeployedContent,
  type DeploySelection,
} from "@/lib/harness-deploy-selection";
import { harnessIdentifier } from "@/lib/harness-identifier";
import {
  orgSecretValues,
  type SecretChoice,
} from "@/lib/harness-org-secrets";
import { ACCOUNT_ADMIN } from "@/lib/harness-permissions";
import { isDuplicate, isRetryable } from "@/lib/harness-retry";
import {
  harnessBaseUrl,
  harnessOrgUrl,
  parseHarnessToken,
} from "@/lib/harness-platform";
import {
  harnessTimestamp,
  recordDeployedSecret,
} from "@/lib/harness-scrub";
import {
  deployableTemplateSources,
  templateSourceToken,
  type TemplateSourceRow,
} from "@/lib/harness-templates";
import { recordHarnessDeploy } from "@/lib/harness-tokens";
import { openSecret } from "@/lib/secret-box";

export type DeployOutcome =
  | "created"
  | "existed"
  | "failed"
  | "skipped";

export type DeployStep = {
  scope: string;
  kind:
    | "organization"
    | "project"
    | "secret"
    | "connector"
    | "template"
    | "variable"
    | "environment"
    | "infrastructure";
  identifier: string;
  outcome: DeployOutcome;
  detail?: string;
};

export type DeployReport = {
  orgIdentifier: string;
  orgName: string;
  orgUrl: string;
  steps: DeployStep[];
  counts: Record<DeployOutcome, number>;
  sources: number;
};

export type DeployResult =
  | { ok: true; report: DeployReport }
  | { ok: false; error: DeployError; detail?: string };

type Json = Record<string, unknown>;
type Query = Record<string, string | undefined>;

const TIMEOUT_MS = 30_000;

const MAX_ATTEMPTS = 3;

type Reply = { status: number; text: string };

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
    return body.slice(0, 400);
  }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

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
      last = {
        status: 0,
        text: err instanceof Error ? err.message : "Could not reach Harness.",
      };
    }

    if (attempt === MAX_ATTEMPTS) break;
    await wait(1000 * 2 ** (attempt - 1));
  }

  return last;
}

const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300;

function dataOf<T>(reply: Reply): T | null {
  try {
    return (JSON.parse(reply.text) as { data?: T }).data ?? null;
  } catch {
    return null;
  }
}

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

const PAGE_SIZE = 100;

const MAX_PAGES = 20;

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

const yamlScalar = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

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

type Scope = {
  token: string;
  accountId: string;
  org: string;
  project: string | null;
};

const scopeQuery = (scope: Scope): Query => ({
  accountIdentifier: scope.accountId,
  orgIdentifier: scope.org,
  projectIdentifier: scope.project ?? undefined,
});

const scopeLabel = (scope: Scope) =>
  scope.project ? `${scope.org} / ${scope.project}` : scope.org;

/** A template source the way the tokens page names it, kept for the record. */
const sourceLabel = (source: TemplateSourceRow) =>
  source.projectIdentifier === null
    ? (source.orgName ?? source.orgIdentifier)
    : `${source.orgName ?? source.orgIdentifier} / ${
        source.projectName ?? source.projectIdentifier
      }`;

const TAGS = { deployed_by: "workshop-orchestrator" };
const DESCRIPTION = "Deployed by Workshop Orchestrator.";

type Record_ = (step: DeployStep) => void;

const PLACEHOLDER_VALUE = "123";

const PLACEHOLDER_DESCRIPTION =
  "Placeholder created by Workshop Orchestrator. The content deployed here " +
  "references this secret and the real value was not available — replace it " +
  "before anything uses it.";

const MAX_PLACEHOLDERS = 5;

const MISSING_SECRET =
  /No secret exists with the id\s+([\w.$-]+)(?:\s+in organization\s+([\w.$-]+))?(?:\s+in project\s+([\w.$-]+))?/;

type MissingSecret = {
  identifier: string;
  org: string | null;
  project: string | null;
};

function missingSecret(body: string): MissingSecret | null {
  const match = MISSING_SECRET.exec(messageOf(body));
  if (!match) return null;
  return {
    identifier: match[1]!,
    org: match[2] ?? null,
    project: match[3] ?? null,
  };
}

const missingLabel = (missing: MissingSecret) =>
  missing.project
    ? `${missing.org} / ${missing.project}`
    : (missing.org ?? "the account");

type SecretType = "SecretText" | "SecretFile";

/**
 * What kind of secret the missing reference names, asked of the organization it
 * is being copied *from*.
 *
 * A reference carries only an identifier, and the two kinds are not
 * interchangeable — a connector reaching for a service-account *file* is not
 * satisfied by a text secret of the same name. The source knows which it is,
 * since the real secret is sitting there; only the value is unreadable, which is
 * the whole reason a stand-in is needed. Null when the source cannot answer, and
 * the caller falls back to text.
 */
async function secretTypeOf(
  from: Scope,
  missing: MissingSecret,
): Promise<SecretType | null> {
  // Harness names the scope it looked in, which is the target. The place to ask
  // is the matching level of the source.
  const scope =
    missing.project !== null
      ? { orgIdentifier: from.org, projectIdentifier: from.project ?? undefined }
      : missing.org !== null
        ? { orgIdentifier: from.org }
        : {};

  const reply = await harnessRequest(
    from.token,
    "GET",
    `/ng/api/v2/secrets/${encodeURIComponent(missing.identifier)}`,
    { accountIdentifier: from.accountId, ...scope },
  );
  if (!ok(reply)) return null;

  const type = dataOf<{ secret?: { type?: string } }>(reply)?.secret?.type;
  return type === "SecretText" || type === "SecretFile" ? type : null;
}

/**
 * Stand in for a secret the deployed content names and this site has no value
 * for, as the same kind of secret the content is reaching for.
 *
 * `123` either way — inline for a text secret, and as the whole contents of the
 * uploaded file for a file one, which goes to its own multipart endpoint.
 */
async function createPlaceholder(
  to: Scope,
  missing: MissingSecret,
  type: SecretType,
): Promise<Reply> {
  const scope = {
    orgIdentifier: missing.org ?? undefined,
    projectIdentifier: missing.project ?? undefined,
  };
  // The org's built-in manager, not the account's — the same one `deploySecrets`
  // uses for the real values. Harness refuses to move a secret between managers
  // after it is created, so a placeholder in the wrong one could never be
  // replaced by a real value under the same identifier.
  const secretManagerIdentifier =
    missing.org === null ? "harnessSecretManager" : "org.harnessSecretManager";
  const secret = {
    name: missing.identifier,
    identifier: missing.identifier,
    ...scope,
    description: PLACEHOLDER_DESCRIPTION,
    tags: { ...TAGS, placeholder: "true" },
    type,
    spec:
      type === "SecretFile"
        ? { secretManagerIdentifier }
        : {
            secretManagerIdentifier,
            valueType: "Inline",
            value: PLACEHOLDER_VALUE,
          },
  };
  const query = { accountIdentifier: to.accountId, ...scope };

  if (type === "SecretText") {
    return harnessRequest(to.token, "POST", "/ng/api/v2/secrets", query, {
      secret,
    });
  }

  const form = new FormData();
  form.append("spec", JSON.stringify({ secret }));
  form.append(
    "file",
    new Blob([PLACEHOLDER_VALUE], { type: "text/plain" }),
    `${missing.identifier}.txt`,
  );
  return harnessRequest(
    to.token,
    "POST",
    "/ng/api/v2/secrets/files",
    query,
    form,
  );
}

async function createFillingGaps(
  from: Scope,
  to: Scope,
  send: () => Promise<Reply>,
  record: Record_,
): Promise<{ outcome: DeployOutcome; detail?: string }> {
  let reply = await send();
  const made: string[] = [];
  const attempted = new Set<string>();

  for (let round = 0; round < MAX_PLACEHOLDERS; round++) {
    if (ok(reply) || isDuplicate(reply.status, reply.text)) break;

    const missing = missingSecret(reply.text);
    if (!missing || attempted.has(missing.identifier)) break;
    attempted.add(missing.identifier);

    // Text unless the source says otherwise: a source that cannot be asked is
    // not a reason to refuse the stand-in, and text is what most of them are.
    const type = (await secretTypeOf(from, missing)) ?? "SecretText";

    const placeholder = await createPlaceholder(to, missing, type);
    const result = outcomeOf(placeholder);
    record({
      scope: missingLabel(missing),
      kind: "secret",
      identifier: `${missing.identifier} (placeholder)`,
      outcome: result.outcome,
      detail:
        result.detail ??
        `A ${type} holding ${PLACEHOLDER_VALUE} — referenced by the content ` +
          `being deployed, and no real value for it was available.`,
    });

    if (result.outcome === "failed") break;
    made.push(missing.identifier);
    reply = await send();
  }

  const result = outcomeOf(reply);
  return result.outcome === "created" && made.length > 0
    ? {
        outcome: "created",
        detail: `Needed placeholder secrets: ${made.join(", ")}.`,
      }
    : result;
}

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

    const rest = { ...connector };
    delete rest.accountIdentifier;

    const outcome = await createFillingGaps(
      from,
      to,
      () =>
        harnessRequest(to.token, "POST", "/ng/api/connectors", scopeQuery(to), {
          connector: {
            ...rest,
            orgIdentifier: to.org,
            projectIdentifier: to.project ?? undefined,
            tags: { ...((connector.tags as Json | undefined) ?? {}), ...TAGS },
          },
        }),
      record,
    );

    record({
      scope: scopeLabel(to),
      kind: "connector",
      identifier,
      ...outcome,
    });
  }
}

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

    const outcome = await createFillingGaps(
      from,
      to,
      () =>
        harnessRequest(
          to.token,
          "POST",
          "/template/api/templates",
          { ...scopeQuery(to), storeType: "INLINE" },
          body,
        ),
      record,
    );

    record({
      scope: scopeLabel(to),
      kind: "template",
      identifier: label,
      ...outcome,
    });
  }
}

/**
 * Org variables — the plain `<+variable.org.x>` values pipelines read.
 *
 * No tags and no description of ours: the variables API takes neither, and a
 * variable's whole content is its fixed value, so it is copied as it stands.
 * Nothing references a variable by scope the way a connector references a
 * secret, so there is no gap to fill here either.
 */
async function copyVariables(
  from: Scope,
  to: Scope,
  record: Record_,
): Promise<void> {
  const listed = await listPages<{ variable?: Json }>(
    from.token,
    "GET",
    "/ng/api/variables",
    scopeQuery(from),
    { page: "pageIndex", size: "pageSize" },
  );

  if (!listed.ok) {
    record({
      scope: scopeLabel(to),
      kind: "variable",
      identifier: `(all, from ${scopeLabel(from)})`,
      outcome: "failed",
      detail: `Could not list them: ${listed.detail}`,
    });
    return;
  }

  for (const entry of listed.items) {
    const variable = entry.variable;
    const identifier = variable?.identifier;
    if (!variable || typeof identifier !== "string") continue;

    const rest = { ...variable };
    delete rest.accountIdentifier;

    const reply = await harnessRequest(
      to.token,
      "POST",
      "/ng/api/variables",
      { accountIdentifier: to.accountId },
      {
        variable: {
          ...rest,
          orgIdentifier: to.org,
          projectIdentifier: to.project ?? undefined,
        },
      },
    );

    record({
      scope: scopeLabel(to),
      kind: "variable",
      identifier,
      ...outcomeOf(reply),
    });
  }
}

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
      } catch {}
    }

    const outcome = await createFillingGaps(
      from,
      to,
      () =>
        harnessRequest(
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
            tags: {
              ...((environment.tags as Json | undefined) ?? {}),
              ...TAGS,
            },
            type:
              typeof environment.type === "string"
                ? environment.type
                : "PreProduction",
            ...(body === null ? {} : { yaml: body }),
          },
        ),
      record,
    );

    record({
      scope: scopeLabel(to),
      kind: "environment",
      identifier,
      ...outcome,
    });

    await copyInfrastructures(
      from,
      to,
      identifier,
      outcome.outcome === "failed" ? outcome.detail : null,
      record,
    );
  }
}

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

    const outcome = await createFillingGaps(
      from,
      to,
      () =>
        harnessRequest(
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
            tags: {
              ...((infrastructure.tags as Json | undefined) ?? {}),
              ...TAGS,
            },
            type: infrastructure.type,
            deploymentType: infrastructure.deploymentType,
            yaml: body,
          },
        ),
      record,
    );

    record({
      scope: scopeLabel(to),
      kind: "infrastructure",
      identifier: label,
      ...outcome,
    });
  }
}

async function copyScope(from: Scope, to: Scope, record: Record_): Promise<void> {
  await copyConnectors(from, to, record);
  await copyVariables(from, to, record);
  await copyTemplates(from, to, record);
  await copyEnvironments(from, to, record);
}

async function deploySecrets(
  to: Scope,
  tokenId: string,
  userId: string,
  choice: SecretChoice,
  record: Record_,
): Promise<void> {
  for (const secret of await orgSecretValues(userId, choice)) {
    if (secret.value === null) {
      record({
        scope: scopeLabel(to),
        kind: "secret",
        identifier: secret.identifier,
        outcome: "skipped",
        detail:
          "It cannot be decrypted with this deployment's key — re-enter it in " +
          (secret.mine
            ? "My settings → My org secrets."
            : "Settings → Org Secrets."),
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

    const outcome = outcomeOf(reply);
    record({
      scope: scopeLabel(to),
      kind: "secret",
      identifier: secret.identifier,
      ...outcome,
    });

    if (outcome.outcome !== "created") continue;

    try {
      await recordDeployedSecret({
        tokenId,
        accountId: to.accountId,
        orgIdentifier: to.org,
        secretIdentifier: secret.identifier,
        kind: secret.kind,
        harnessUpdatedAt: harnessTimestamp(
          dataOf<{ updatedAt?: unknown }>(reply)?.updatedAt,
        ),
      });
    } catch (err) {
      record({
        scope: scopeLabel(to),
        kind: "secret",
        identifier: secret.identifier,
        outcome: "failed",
        detail:
          "The value is in Harness but this site could not record that it is, " +
          "so it will not be scrubbed automatically — remove it by hand when " +
          `the demo is over. (${err instanceof Error ? err.message : "unknown error"})`,
      });
    }
  }
}

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

export async function deployContent(
  userId: string,
  tokenId: string,
  orgName: string,
  selection: DeploySelection,
): Promise<DeployResult> {
  const typed = orgName.trim();
  const derived = harnessIdentifier(typed);
  if (typed.length === 0 || derived === null) {
    return { ok: false, error: "invalid_name" };
  }
  if (nothingSelected(selection)) {
    return { ok: false, error: "nothing_selected" };
  }

  const [row] = await db
    .select()
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, tokenId), eq(harnessTokens.userId, userId)));
  if (!row) return { ok: false, error: "not_found" };

  const rerun =
    row.deployedOrgIdentifier !== null &&
    row.deployedOrgIdentifier.toLowerCase() === derived.toLowerCase();
  const identifier = rerun ? row.deployedOrgIdentifier! : derived;

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

  const created = await harnessRequest(
    secret,
    "POST",
    "/ng/api/organizations",
    { accountIdentifier: parsed.accountId },
    {
      organization: {
        identifier,
        name: typed,
        description: DESCRIPTION,
        tags: TAGS,
      },
    },
  );
  if (!ok(created)) {
    if (!isDuplicate(created.status, created.text)) {
      return {
        ok: false,
        error: created.status === 0 ? "unreachable" : "org_failed",
        detail: created.status === 0 ? created.text : messageOf(created.text),
      };
    }
    if (!rerun) {
      return { ok: false, error: "org_exists", detail: messageOf(created.text) };
    }
  }

  const reused = !ok(created);
  const name = reused ? (row.deployedOrgName ?? typed) : typed;

  record({
    scope: identifier,
    kind: "organization",
    identifier,
    outcome: reused ? "existed" : "created",
    detail: reused
      ? "Deployed into before, so this is a re-run — anything already there is " +
        "left as it is."
      : undefined,
  });

  await deploySecrets(
    target,
    tokenId,
    userId,
    { official: selection.official, mine: selection.mySecrets },
    record,
  );

  const sources = await deployableTemplateSources(userId, {
    official: selection.official,
    mine: selection.myTemplates,
  });
  const ordered = [
    ...sources.filter((s) => s.projectIdentifier === null),
    ...sources.filter((s) => s.projectIdentifier !== null),
  ];

  // The user's own sources this run really read from, for the row's record of
  // what the organization holds. A source that was skipped never lands, so it
  // is not claimed here.
  const copied: string[] = [];

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
          (source.mine
            ? "My settings → My templates."
            : "Settings → Templates."),
      });
      continue;
    }

    const from: Scope = {
      token,
      accountId: source.accountId,
      org: source.orgIdentifier,
      project: source.projectIdentifier,
    };

    if (source.projectIdentifier === null) {
      await copyScope(from, target, record);
      if (source.mine) copied.push(sourceLabel(source));
      continue;
    }

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
    if (source.mine) copied.push(sourceLabel(source));
  }

  const counts: Record<DeployOutcome, number> = {
    created: 0,
    existed: 0,
    failed: 0,
    skipped: 0,
  };
  for (const step of steps) counts[step.outcome] += 1;

  const content: DeployedContent = {
    official: selection.official,
    mySecrets: selection.mySecrets,
    myTemplates: copied,
  };

  await recordHarnessDeploy(
    userId,
    tokenId,
    { name, identifier },
    rerun ? mergeDeployed(row.deployedContent, content) : content,
  ).catch(() => {});

  return {
    ok: true,
    report: {
      orgIdentifier: identifier,
      orgName: name,
      orgUrl: harnessOrgUrl(parsed.accountId, identifier),
      steps,
      counts,
      sources: ordered.length,
    },
  };
}
