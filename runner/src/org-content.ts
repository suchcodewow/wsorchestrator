import { harnessCfg } from "./config.js";
import {
  loadCatalog,
  loadTemplateSources,
  log,
  recordResource,
  type RunRow,
  type TemplateSource,
} from "./db.js";
import { isDuplicate, isRetryable } from "./harness.js";
import { openSecret, secretsConfigured } from "./secret-box.js";

/**
 * Copy the site's authored Harness content into a workshop's organization.
 *
 * The sources are the rows in Settings → Templates: organizations (or one
 * project inside one) in a Harness account somebody on the team authors in.
 * Everything org-shaped in them comes across — connectors, templates,
 * environments with their infrastructure definitions, and org variables — so a
 * workshop org opens with the content the labs were written against instead of
 * only the three cloud connectors the catalog builds.
 *
 * This is the workshop-build half of what `frontend/src/lib/harness-deploy.ts`
 * does for a person deploying the same content into their own Harness account
 * from the tokens page. It is a second implementation for the reason
 * `applyOrgSecrets` and `secret-box.ts` are: the runner and the app are
 * separately deployed packages with no shared code. **Change the rules in one
 * and change them in both** — in particular what gets copied, the placeholder
 * value, and the tags, which are what somebody looking at the org sees.
 *
 * Three things about the shape of this are deliberate:
 *
 *   * **Read wherever the row points, write at the org.** A source row naming a
 *     project is read from that project, and its content still lands at the
 *     workshop org's level. Attendees work in their own projects, and the
 *     attendee role grants org-level view/access — so content in the org is
 *     usable by every attendee, where content in a project of its own would be
 *     visible to nobody who needs it.
 *
 *   * **Best-effort, like the repositories.** A source whose token has been
 *     rotated, an entity Harness refuses, a whole account that is unreachable:
 *     each is logged and left behind rather than failing a workshop that is
 *     otherwise fine. What did not come across is on the run page.
 *
 *   * **Re-entrant.** Every create treats a duplicate as "already there", so
 *     running it twice converges. That is what lets `run.ts` copy again after
 *     the clouds are built, for content that referenced a credential the
 *     catalog had not minted yet — see `waiting` below.
 *
 * Nothing here has a teardown: `deleteOrg` removes the organization with
 * everything in it, and these are copies that exist nowhere else in a run.
 */

/* ------------------------------------------------------------------ *
 * Talking to two Harness accounts at once
 * ------------------------------------------------------------------ */

type Json = Record<string, unknown>;
type Query = Record<string, string | undefined>;
type Reply = { status: number; text: string };

/**
 * One end of a copy: a token, the account it belongs to, and where in it.
 *
 * Both ends need one because the two are not the same account. The source is
 * somebody's authoring account, reached with the token stored on its settings
 * row; the target is this deployment's own, reached with `HARNESS_API_KEY`. So
 * unlike everything in `harness.ts`, no call here can assume the site's
 * credentials — which is exactly why this module does not use that client.
 */
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

const sourceLabel = (source: TemplateSource) =>
  source.projectIdentifier === null
    ? (source.orgName ?? source.orgIdentifier)
    : `${source.orgName ?? source.orgIdentifier} / ${
        source.projectName ?? source.projectIdentifier
      }`;

const TAGS = { managed_by: "workshop-orchestrator" };
const DESCRIPTION = "Copied from the site's template sources.";

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A Harness error's own words, plus the correlation id support needs. */
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

/**
 * One request against whichever account `token` belongs to, retrying Harness's
 * own 5xx and rate limiter and returning the final status verbatim. Interpreting
 * it is the caller's job: a duplicate is success here, and a missing secret is
 * the start of a placeholder.
 */
async function request(
  token: string,
  method: "GET" | "POST",
  path: string,
  query: Query,
  body?: Json | string,
): Promise<Reply> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const url = `${harnessCfg().baseUrl}${path}?${params.toString()}`;

  let last: Reply = { status: 0, text: "" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "x-api-key": token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        // A string body is sent verbatim — the template endpoint takes raw YAML
        // under a JSON content type, which is what Harness accepts (see
        // `createTemplate` in harness.ts).
        body:
          body === undefined
            ? undefined
            : typeof body === "string"
              ? body
              : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
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

const detailOf = (reply: Reply) =>
  reply.status === 0
    ? reply.text
    : `${messageOf(reply.text)} (HTTP ${reply.status})`;

const PAGE_SIZE = 100;

/** A ceiling on paging, so a bad `total` cannot spin here forever. */
const MAX_PAGES = 20;

/**
 * Every page of a list endpoint. The page and size parameters are named
 * differently across Harness's list APIs — `pageIndex`/`pageSize` on the older
 * ones, `page`/`size` on the newer — so the caller says which.
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
    const reply = await request(
      token,
      method,
      path,
      { ...query, [names.page]: String(page), [names.size]: String(PAGE_SIZE) },
      body,
    );
    if (!ok(reply)) return { ok: false, detail: detailOf(reply) };

    const content = dataOf<{ content?: T[] }>(reply)?.content ?? [];
    items.push(...content);
    if (content.length < PAGE_SIZE) break;
  }

  return { ok: true, items };
}

/* ------------------------------------------------------------------ *
 * Rescoping — the same YAML, addressed to the workshop's org
 * ------------------------------------------------------------------ */

const yamlScalar = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The entity's own YAML with the keys that say *where it lives* replaced.
 *
 * Textual rather than parsed, for the reason `templateYaml` in `harness.ts` is:
 * a Harness body is full of `<+expressions>`, block scalars and deep structure,
 * and round-tripping it through a parser risks changing something the author
 * meant. The keys being replaced all sit at a known two-space indent under the
 * root, so the edit is exact without understanding the rest.
 */
export function rescopeYaml(
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
 * What became of one entity
 * ------------------------------------------------------------------ */

/**
 * `waiting` is the one that is not a verdict on the copy. It means the entity
 * references a secret this workshop builds for itself — a cloud credential a
 * Terraform apply has not minted yet — so the copy is early rather than wrong,
 * and `run.ts` comes back for it once the clouds are up.
 */
type Outcome = "created" | "existed" | "failed" | "waiting";

type Result = { outcome: Outcome; detail?: string };

type Tally = Record<Outcome, number>;

/** Recording one entity's fate: a log line now, a count for the summary row. */
type Record_ = (
  kind: string,
  identifier: string,
  result: Result,
) => Promise<void>;

const outcomeOf = (reply: Reply): Result =>
  ok(reply)
    ? { outcome: "created" }
    : isDuplicate(reply.status, reply.text)
      ? { outcome: "existed" }
      : { outcome: "failed", detail: detailOf(reply) };

/* ------------------------------------------------------------------ *
 * Placeholder secrets
 * ------------------------------------------------------------------ */

const PLACEHOLDER_VALUE = "123";

const PLACEHOLDER_DESCRIPTION =
  "Placeholder created by Workshop Orchestrator. The content copied into this " +
  "organization references this secret and the site had no value for it — put " +
  "the right value in before anything uses it.";

/** How many missing secrets one entity may drag in before we stop trying. */
const MAX_PLACEHOLDERS = 5;

const MISSING_SECRET =
  /No secret exists with the id\s+([\w.$-]+)(?:\s+in organization\s+([\w.$-]+))?(?:\s+in project\s+([\w.$-]+))?/;

type MissingSecret = {
  identifier: string;
  org: string | null;
  project: string | null;
};

export function missingSecret(body: string): MissingSecret | null {
  const match = MISSING_SECRET.exec(messageOf(body));
  if (!match) return null;
  return {
    identifier: match[1]!,
    org: match[2] ?? null,
    project: match[3] ?? null,
  };
}

/**
 * Create a stand-in for a secret the copied content names and the site has no
 * value for, so the entity above it can exist at all.
 *
 * The value fails at first use rather than half-working, and the description and
 * `placeholder` tag are there so nobody mistakes it for a credential that was
 * meant to work — the same bargain the app's deploy makes, and the same one the
 * scrub sweep leaves behind.
 */
async function createPlaceholder(
  to: Scope,
  missing: MissingSecret,
): Promise<Reply> {
  const scope = {
    orgIdentifier: missing.org ?? undefined,
    projectIdentifier: missing.project ?? undefined,
  };
  return request(
    to.token,
    "POST",
    "/ng/api/v2/secrets",
    { accountIdentifier: to.accountId, ...scope },
    {
      secret: {
        name: missing.identifier,
        identifier: missing.identifier,
        ...scope,
        description: PLACEHOLDER_DESCRIPTION,
        tags: { ...TAGS, placeholder: "true" },
        type: "SecretText",
        spec: {
          secretManagerIdentifier: "harnessSecretManager",
          valueType: "Inline",
          value: PLACEHOLDER_VALUE,
        },
      },
    },
  );
}

/**
 * Everything one copy needs that is not the entity itself: where it is going,
 * which secrets the workshop mints for itself, and how to write down what
 * happened to a stand-in secret made along the way.
 */
type Copying = {
  to: Scope;
  /**
   * Identifiers the component catalog owns, which must never be stood in for.
   *
   * A placeholder is always a `SecretText`, and the catalog's `gcp_service_account`
   * is a *file* secret — so a placeholder squatting on that identifier would
   * make the catalog's later upsert a type change, which Harness refuses and
   * which `upsertSecret` turns into a thrown error that fails the whole run. An
   * entity that needs one of these waits for the real value instead.
   */
  mintedHere: Set<string>;
  record: Record_;
};

/**
 * Send `make()`, standing in for the secrets it turns out to need, and say what
 * became of it.
 *
 * Harness reports only the first missing reference, so this goes round: create
 * the stand-in, send again, see what it asks for next. An identifier is only
 * ever attempted once, so a create that keeps failing for the same secret ends
 * rather than looping.
 */
async function createFillingGaps(
  ctx: Copying,
  make: () => Promise<Reply>,
): Promise<Result> {
  let reply = await make();
  const made: string[] = [];
  const attempted = new Set<string>();

  for (let round = 0; round < MAX_PLACEHOLDERS; round++) {
    if (ok(reply) || isDuplicate(reply.status, reply.text)) break;

    const missing = missingSecret(reply.text);
    if (!missing || attempted.has(missing.identifier)) break;
    attempted.add(missing.identifier);

    if (ctx.mintedHere.has(missing.identifier)) {
      return {
        outcome: "waiting",
        detail:
          `it references org.${missing.identifier}, which this workshop mints ` +
          `for itself once its cloud is built`,
      };
    }

    const placeholder = await createPlaceholder(ctx.to, missing);
    const result = outcomeOf(placeholder);
    await ctx.record(
      "secret",
      `${missing.identifier} (placeholder)`,
      result.outcome === "failed"
        ? result
        : {
            outcome: result.outcome,
            detail: `value ${PLACEHOLDER_VALUE} — the copied content references ` +
              `it and the site has no value for it`,
          },
    );

    if (result.outcome === "failed") break;
    made.push(missing.identifier);
    reply = await make();
  }

  const result = outcomeOf(reply);
  return result.outcome === "created" && made.length > 0
    ? {
        outcome: "created",
        detail: `needed placeholder secret(s): ${made.join(", ")}`,
      }
    : result;
}

/* ------------------------------------------------------------------ *
 * The five kinds of content
 * ------------------------------------------------------------------ */

/** One failed listing, said the same way whatever was being listed. */
const listingFailed = (
  ctx: Copying,
  kind: string,
  from: Scope,
  detail: string,
) =>
  ctx.record(kind, `(all in ${scopeLabel(from)})`, {
    outcome: "failed",
    detail: `could not list them: ${detail}`,
  });

async function copyConnectors(
  from: Scope,
  ctx: Copying,
): Promise<void> {
  const listed = await listPages<{ connector?: Json; harnessManaged?: boolean }>(
    from.token,
    "GET",
    "/ng/api/connectors",
    scopeQuery(from),
    { page: "pageIndex", size: "pageSize" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "connector", from, listed.detail);
    return;
  }

  for (const entry of listed.items) {
    // Harness's own built-in connectors exist in every scope already; copying
    // one would be a duplicate at best and an overwrite at worst.
    if (entry.harnessManaged === true) continue;
    const connector = entry.connector;
    const identifier = connector?.identifier;
    if (!connector || typeof identifier !== "string") continue;

    const rest = { ...connector };
    delete rest.accountIdentifier;

    const result = await createFillingGaps(ctx, () =>
      request(ctx.to.token, "POST", "/ng/api/connectors", scopeQuery(ctx.to), {
        connector: {
          ...rest,
          orgIdentifier: ctx.to.org,
          projectIdentifier: ctx.to.project ?? undefined,
          tags: { ...((connector.tags as Json | undefined) ?? {}), ...TAGS },
        },
      }),
    );

    await ctx.record("connector", identifier, result);
  }
}

async function copyTemplates(from: Scope, ctx: Copying): Promise<void> {
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
    await listingFailed(ctx, "template", from, listed.detail);
    return;
  }

  for (const meta of listed.items) {
    const { identifier, versionLabel } = meta;
    if (typeof identifier !== "string" || typeof versionLabel !== "string") {
      continue;
    }
    // A template's identity is its identifier *and* its version, and every
    // version is copied — lab content pins the one it was written against.
    const label = `${identifier}:${versionLabel}`;

    const fetched = await request(
      from.token,
      "GET",
      `/template/api/templates/${encodeURIComponent(identifier)}`,
      { ...scopeQuery(from), versionLabel },
    );
    const yaml = dataOf<{ yaml?: string }>(fetched)?.yaml;
    if (!ok(fetched) || typeof yaml !== "string") {
      await ctx.record("template", label, {
        outcome: "failed",
        detail: `could not read it from ${scopeLabel(from)}: ${
          ok(fetched) ? "Harness returned no YAML" : detailOf(fetched)
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
        orgIdentifier: ctx.to.org,
        projectIdentifier: ctx.to.project,
      });
    } catch (err) {
      await ctx.record("template", label, {
        outcome: "failed",
        detail: err instanceof Error ? err.message : "unreadable YAML",
      });
      continue;
    }

    const result = await createFillingGaps(ctx, () =>
      request(
        ctx.to.token,
        "POST",
        "/template/api/templates",
        { ...scopeQuery(ctx.to), storeType: "INLINE" },
        body,
      ),
    );

    await ctx.record("template", label, result);
  }
}

async function copyEnvironments(from: Scope, ctx: Copying): Promise<void> {
  const listed = await listPages<{ environment?: Json }>(
    from.token,
    "GET",
    "/ng/api/environmentsV2",
    scopeQuery(from),
    { page: "page", size: "size" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "environment", from, listed.detail);
    return;
  }

  for (const entry of listed.items) {
    const environment = entry.environment;
    const identifier = environment?.identifier;
    if (!environment || typeof identifier !== "string") continue;

    const name =
      typeof environment.name === "string" ? environment.name : identifier;
    const yaml = typeof environment.yaml === "string" ? environment.yaml : null;

    // An environment is described by its own columns *and* a YAML body that
    // repeats them plus its variables and overrides. The body is optional here:
    // an environment created without one is still an environment, where one
    // created with an unrescopable body would be refused outright.
    let body: string | null = null;
    if (yaml !== null) {
      try {
        body = rescopeYaml(yaml, "environment", {
          name,
          identifier,
          orgIdentifier: ctx.to.org,
          projectIdentifier: ctx.to.project,
        });
      } catch {}
    }

    const result = await createFillingGaps(ctx, () =>
      request(
        ctx.to.token,
        "POST",
        "/ng/api/environmentsV2",
        { accountIdentifier: ctx.to.accountId },
        {
          identifier,
          name,
          orgIdentifier: ctx.to.org,
          projectIdentifier: ctx.to.project ?? undefined,
          description: DESCRIPTION,
          tags: { ...((environment.tags as Json | undefined) ?? {}), ...TAGS },
          type:
            typeof environment.type === "string"
              ? environment.type
              : "PreProduction",
          ...(body === null ? {} : { yaml: body }),
        },
      ),
    );

    await ctx.record("environment", identifier, result);

    await copyInfrastructures(
      from,
      ctx,
      identifier,
      result.outcome === "created" || result.outcome === "existed"
        ? null
        : (result.detail ?? "it was not created"),
    );
  }
}

/**
 * The infrastructure definitions inside one environment.
 *
 * Listed per environment because that is how Harness scopes them, and skipped
 * wholesale when the environment did not land: an infrastructure with no
 * environment to belong to is refused, and one refusal per definition would say
 * the same thing several times over.
 */
async function copyInfrastructures(
  from: Scope,
  ctx: Copying,
  environment: string,
  blocked: string | null,
): Promise<void> {
  const listed = await listPages<{ infrastructure?: Json }>(
    from.token,
    "GET",
    "/ng/api/infrastructures",
    { ...scopeQuery(from), environmentIdentifier: environment },
    { page: "page", size: "size" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "infrastructure", from, listed.detail);
    return;
  }

  for (const entry of listed.items) {
    const infrastructure = entry.infrastructure;
    const identifier = infrastructure?.identifier;
    if (!infrastructure || typeof identifier !== "string") continue;

    const label = `${environment} / ${identifier}`;

    if (blocked !== null) {
      await ctx.record("infrastructure", label, {
        outcome: "failed",
        detail: `the environment ${environment} is not there: ${blocked}`,
      });
      continue;
    }

    const name =
      typeof infrastructure.name === "string" ? infrastructure.name : identifier;
    const yaml =
      typeof infrastructure.yaml === "string" ? infrastructure.yaml : null;
    if (yaml === null) {
      await ctx.record("infrastructure", label, {
        outcome: "failed",
        detail: "Harness returned no YAML for it, so there is nothing to copy",
      });
      continue;
    }

    let body: string;
    try {
      body = rescopeYaml(yaml, "infrastructureDefinition", {
        name,
        identifier,
        orgIdentifier: ctx.to.org,
        projectIdentifier: ctx.to.project,
        environmentRef: environment,
      });
    } catch (err) {
      await ctx.record("infrastructure", label, {
        outcome: "failed",
        detail: err instanceof Error ? err.message : "unreadable YAML",
      });
      continue;
    }

    const result = await createFillingGaps(ctx, () =>
      request(
        ctx.to.token,
        "POST",
        "/ng/api/infrastructures",
        { accountIdentifier: ctx.to.accountId },
        {
          identifier,
          name,
          orgIdentifier: ctx.to.org,
          projectIdentifier: ctx.to.project ?? undefined,
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
    );

    await ctx.record("infrastructure", label, result);
  }
}

/**
 * Org variables — the plain `<+variable.org.x>` values pipelines read.
 *
 * No tags and no description of ours: the variables API takes neither, and a
 * variable's whole content is its fixed value, so it is copied as it stands.
 */
async function copyVariables(from: Scope, ctx: Copying): Promise<void> {
  const listed = await listPages<{ variable?: Json }>(
    from.token,
    "GET",
    "/ng/api/variables",
    scopeQuery(from),
    { page: "pageIndex", size: "pageSize" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "variable", from, listed.detail);
    return;
  }

  for (const entry of listed.items) {
    const variable = entry.variable;
    const identifier = variable?.identifier;
    if (!variable || typeof identifier !== "string") continue;

    const rest = { ...variable };
    delete rest.accountIdentifier;

    const reply = await request(
      ctx.to.token,
      "POST",
      "/ng/api/variables",
      { accountIdentifier: ctx.to.accountId },
      {
        variable: {
          ...rest,
          orgIdentifier: ctx.to.org,
          projectIdentifier: ctx.to.project ?? undefined,
        },
      },
    );

    await ctx.record("variable", identifier, outcomeOf(reply));
  }
}

/**
 * One source, in the order that lets each kind find what it references:
 * connectors before the templates and infrastructure that name them, variables
 * alongside them since nothing depends on a variable existing first.
 */
async function copySource(from: Scope, ctx: Copying): Promise<void> {
  await copyConnectors(from, ctx);
  await copyVariables(from, ctx);
  await copyTemplates(from, ctx);
  await copyEnvironments(from, ctx);
}

/* ------------------------------------------------------------------ *
 * The pass
 * ------------------------------------------------------------------ */

export type ContentResult = {
  /** Entities that are now in the org, whether this pass put them there. */
  copied: number;
  /** Entities that could not be copied and will not be on a later pass. */
  failed: number;
  /**
   * Entities held back for a credential the workshop has not minted yet. More
   * than zero is what makes a second pass after the clouds worth running.
   */
  waiting: number;
};

/**
 * Copy every site template source into the workshop's organization.
 *
 * Returns what happened so `run.ts` can decide whether to come back. Never
 * throws: see the module comment on why this is best-effort.
 */
export async function copyOrgContent(
  run: RunRow,
  orgId: string,
  pass: "first" | "again" = "first",
): Promise<ContentResult> {
  const tally: Tally = { created: 0, existed: 0, failed: 0, waiting: 0 };
  const sources = await loadTemplateSources();
  if (sources.length === 0) return { copied: 0, failed: 0, waiting: 0 };

  // Said once, up front, the way `applyOrgSecrets` does: with no key every
  // token comes back unreadable, and "this runner has no key" is a deployment
  // problem rather than each source's problem.
  if (!secretsConfigured()) {
    await log(
      run.id,
      "system",
      `${sources.length} template source(s) skipped — this runner has no ` +
        `HARNESS_TOKEN_ENC_KEY or AUTH_SECRET, so no token can be decrypted`,
    );
    return { copied: 0, failed: 0, waiting: 0 };
  }

  const cfg = harnessCfg();
  const to: Scope = {
    token: cfg.apiKey,
    accountId: cfg.accountId,
    org: orgId,
    project: null,
  };

  const mintedHere = new Set(
    (await loadCatalog(run.component_set_id ?? undefined))
      .filter((c) => c.kind === "secret_text" || c.kind === "secret_file")
      .map((c) => c.identifier),
  );

  const record: Record_ = async (kind, identifier, result) => {
    tally[result.outcome] += 1;
    if (result.outcome === "failed") {
      await log(
        run.id,
        "stderr",
        `${kind} ${identifier} not copied — ${result.detail ?? "Harness refused it"}`,
      );
      return;
    }
    const said =
      result.outcome === "created"
        ? "copied"
        : result.outcome === "existed"
          ? "already there"
          : "not copied yet";
    await log(
      run.id,
      "stdout",
      `${kind} ${identifier} ${said}` +
        (result.detail ? ` — ${result.detail}` : ""),
    );
  };

  await log(
    run.id,
    "system",
    pass === "first"
      ? `Copying content from ${sources.length} template source(s) into org ${orgId}`
      : `Copying the content that was waiting on a cloud credential into org ${orgId}`,
  );

  for (const source of sources) {
    const token = openSecret(source.secret);
    if (token === null) {
      // One unreadable source must not cost the workshop the others. The fix is
      // re-entering the token in settings, not anything a retry would do.
      await log(
        run.id,
        "stderr",
        `template source ${sourceLabel(source)} skipped — its token cannot be ` +
          `decrypted with this deployment's key; re-add it in Settings → Templates`,
      );
      tally.failed += 1;
      continue;
    }

    const from: Scope = {
      token,
      accountId: source.accountId,
      org: source.orgIdentifier,
      project: source.projectIdentifier,
    };

    try {
      await copySource(from, { to, mintedHere, record });
    } catch (err) {
      // `copySource` turns every expected failure into a recorded outcome, so
      // this is for the unexpected kind — and one source's surprise must not
      // strand the ones after it.
      const message = err instanceof Error ? err.message : String(err);
      await log(
        run.id,
        "stderr",
        `template source ${sourceLabel(source)} stopped early — ${message}`,
      );
      tally.failed += 1;
    }
  }

  const copied = tally.created + tally.existed;
  const total = copied + tally.failed + tally.waiting;

  // One counted row for all of it, the same shape the catalog and the org
  // secrets use: what an organizer needs is how much of the site's content the
  // room actually has, which a row per template would bury.
  await recordResource(run.id, {
    kind: "harness_content",
    label: "Site Harness content",
    detail:
      tally.failed === 0 && tally.waiting === 0
        ? `all copied from ${sources.length} template source(s)`
        : [
            tally.failed > 0 ? `${tally.failed} could not be copied` : null,
            tally.waiting > 0
              ? `${tally.waiting} waiting on a workshop credential`
              : null,
          ]
            .filter(Boolean)
            .join(", "),
    done: copied,
    total,
  });

  return { copied, failed: tally.failed, waiting: tally.waiting };
}
