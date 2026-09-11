import { harnessCfg } from "./config.js";
import {
  loadCatalog,
  loadOrgSecrets,
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
 * Four things about the shape of this are deliberate:
 *
 *   * **Read wherever the row points, write at the org.** A source row naming a
 *     project is read from that project, and its content still lands at the
 *     workshop org's level. Attendees work in their own projects, and the
 *     attendee role grants org-level view/access — so content in the org is
 *     usable by every attendee, where content in a project of its own would be
 *     visible to nobody who needs it.
 *
 *   * **No secret value is ever copied.** Harness does not return one — every
 *     secret reads back with `value: null` — and this does not ask. Real values
 *     reach a workshop org from Settings → Org Secrets, applied just before this
 *     runs, and from the catalog's cloud credentials. What the copy contributes
 *     is a *stand-in*, of the same kind as the secret the content is reaching
 *     for, for references neither of those covers: see `createPlaceholder`.
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
 *
 * A `FormData` body is sent as multipart with no Content-Type of our own — only
 * the secret-file endpoint takes one, and the boundary has to come from fetch.
 * It survives the retry loop because the parts are held in memory.
 */
async function request(
  token: string,
  method: "GET" | "POST",
  path: string,
  query: Query,
  body?: Json | FormData | string,
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
          ...(body === undefined || body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        // A string body is sent verbatim — the template endpoint takes raw YAML
        // under a JSON content type, which is what Harness accepts (see
        // `createTemplate` in harness.ts).
        body:
          body === undefined
            ? undefined
            : body instanceof FormData || typeof body === "string"
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

/** The two kinds of secret a copied entity can be referring to. */
export type SecretType = "SecretText" | "SecretFile";

/**
 * What kind of secret the missing reference names, asked of the organization it
 * was copied *from*.
 *
 * A reference says only an identifier, and the two kinds are not
 * interchangeable: a connector wanting a service-account *file* is not satisfied
 * by a text secret of the same name, so a stand-in has to be the kind the
 * content is actually reaching for. The source knows, because the real secret is
 * sitting there — only its value is unreadable (Harness returns `value: null`
 * for every secret, which is the whole reason placeholders exist).
 *
 * The scope is mapped across rather than reused: Harness says where it *looked*,
 * which is the workshop's org, and the corresponding place to ask is the same
 * level of the source — org for an org reference, the source's project for a
 * project one, the account for an unqualified one.
 *
 * Null when the source cannot answer — a reference to something that is not
 * there either, a token without the standing to read it. The caller falls back
 * to text, which is what the majority are.
 */
async function secretTypeOf(
  from: Scope,
  missing: MissingSecret,
): Promise<SecretType | null> {
  const scope =
    missing.project !== null
      ? { orgIdentifier: from.org, projectIdentifier: from.project ?? undefined }
      : missing.org !== null
        ? { orgIdentifier: from.org }
        : {};

  const reply = await request(
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
 * Which secret manager a stand-in is created in.
 *
 * This is not cosmetic. Harness will not let a secret change managers after it
 * is created — `Cannot change organization, project, identifier, type or secret
 * manager of a secret after creation` — so a placeholder made in the *account's*
 * built-in manager can never be updated by anything that addresses the org's,
 * and the catalog's `upsertSecretText`/`upsertSecretFile` address the org's.
 * Getting this wrong made a same-kind placeholder as fatal as a wrong-kind one,
 * which is exactly the failure `mintedHere` exists to prevent.
 *
 * `org.harnessSecretManager` is the built-in manager as seen from an
 * organization, which is what `harness.ts` and the app's `deploySecrets` both
 * use; the bare name is the account's, and is right only for a reference that
 * named no org at all.
 */
const secretManagerFor = (missing: MissingSecret) =>
  missing.org === null ? "harnessSecretManager" : "org.harnessSecretManager";

/** The JSON half of a placeholder, shared by both kinds. */
const placeholderSecret = (missing: MissingSecret, type: SecretType) => ({
  name: missing.identifier,
  identifier: missing.identifier,
  orgIdentifier: missing.org ?? undefined,
  projectIdentifier: missing.project ?? undefined,
  description: PLACEHOLDER_DESCRIPTION,
  tags: { ...TAGS, placeholder: "true" },
  type,
  spec:
    type === "SecretFile"
      ? { secretManagerIdentifier: secretManagerFor(missing) }
      : {
          secretManagerIdentifier: secretManagerFor(missing),
          valueType: "Inline",
          value: PLACEHOLDER_VALUE,
        },
});

/**
 * Create a stand-in for a secret the copied content names and the site has no
 * value for, so the entity above it can exist at all.
 *
 * `123` either way — inline for a text secret, and as the entire contents of the
 * uploaded file for a file one. It fails at first use rather than half-working,
 * and the description and `placeholder` tag are there so nobody mistakes it for
 * a credential that was meant to work: the same bargain the app's deploy makes,
 * and the same one the scrub sweep leaves behind.
 *
 * A file secret goes to its own endpoint as multipart, which is the only reason
 * the two kinds are not one call — the JSON body is identical but for the spec.
 */
async function createPlaceholder(
  to: Scope,
  missing: MissingSecret,
  type: SecretType,
): Promise<Reply> {
  const secret = placeholderSecret(missing, type);
  const query = {
    accountIdentifier: to.accountId,
    orgIdentifier: missing.org ?? undefined,
    projectIdentifier: missing.project ?? undefined,
  };

  if (type === "SecretText") {
    return request(to.token, "POST", "/ng/api/v2/secrets", query, { secret });
  }

  const form = new FormData();
  form.append("spec", JSON.stringify({ secret }));
  form.append(
    "file",
    new Blob([PLACEHOLDER_VALUE], { type: "text/plain" }),
    `${missing.identifier}.txt`,
  );
  return request(to.token, "POST", "/ng/api/v2/secrets/files", query, form);
}

/**
 * Everything one copy needs that is not the entity itself: both ends of the
 * copy, which secrets the workshop supplies for itself, and how to write down
 * what happened to a stand-in secret made along the way.
 */
type Copying = {
  from: Scope;
  to: Scope;
  /**
   * Every identifier this workshop provides a real value for, and which kind of
   * secret that value is: the Settings → Org Secrets rows, applied moments ago,
   * and the catalog's cloud credentials, minted once an apply finishes.
   *
   * Standing in for one of these is fine and often useful — the real value is
   * upserted over the placeholder later, so the entity that needed it ends up
   * working. Standing in with the *wrong kind* is not: Harness will not change a
   * secret's type (or its manager) after creation, `upsertSecret` throws on the
   * refusal, and that throw fails the whole run. So a mismatch waits instead,
   * which costs one entity rather than the workshop.
   */
  ownedHere: Map<string, SecretType>;
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

    // Text unless the source says otherwise: a source that cannot be asked is
    // not a reason to refuse the stand-in, and text is what most of them are.
    const type = (await secretTypeOf(ctx.from, missing)) ?? "SecretText";

    const owned = ctx.ownedHere.get(missing.identifier);
    if (owned !== undefined && owned !== type) {
      return {
        outcome: "waiting",
        detail:
          `it references org.${missing.identifier} as a ${type}, and this ` +
          `workshop supplies that identifier as a ${owned} — a stand-in of the ` +
          `wrong kind would block the real value from ever landing`,
      };
    }

    const placeholder = await createPlaceholder(ctx.to, missing, type);
    const result = outcomeOf(placeholder);
    await ctx.record(
      "secret",
      `${missing.identifier} (placeholder)`,
      result.outcome === "failed"
        ? result
        : {
            outcome: result.outcome,
            detail:
              `${type} holding ${PLACEHOLDER_VALUE} — the copied content ` +
              `references it and the site has no value for it` +
              (owned !== undefined
                ? `; this workshop's own value replaces it once it is minted`
                : ""),
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
const listingFailed = (ctx: Copying, kind: string, detail: string) =>
  ctx.record(kind, `(all in ${scopeLabel(ctx.from)})`, {
    outcome: "failed",
    detail: `could not list them: ${detail}`,
  });

async function copyConnectors(ctx: Copying): Promise<void> {
  const { from, to } = ctx;
  const listed = await listPages<{ connector?: Json; harnessManaged?: boolean }>(
    from.token,
    "GET",
    "/ng/api/connectors",
    scopeQuery(from),
    { page: "pageIndex", size: "pageSize" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "connector", listed.detail);
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
      request(to.token, "POST", "/ng/api/connectors", scopeQuery(to), {
        connector: {
          ...rest,
          orgIdentifier: to.org,
          projectIdentifier: to.project ?? undefined,
          tags: { ...((connector.tags as Json | undefined) ?? {}), ...TAGS },
        },
      }),
    );

    await ctx.record("connector", identifier, result);
  }
}

async function copyTemplates(ctx: Copying): Promise<void> {
  const { from, to } = ctx;
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
    await listingFailed(ctx, "template", listed.detail);
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
        orgIdentifier: to.org,
        projectIdentifier: to.project,
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
        to.token,
        "POST",
        "/template/api/templates",
        { ...scopeQuery(to), storeType: "INLINE" },
        body,
      ),
    );

    await ctx.record("template", label, result);
  }
}

async function copyEnvironments(ctx: Copying): Promise<void> {
  const { from, to } = ctx;
  const listed = await listPages<{ environment?: Json }>(
    from.token,
    "GET",
    "/ng/api/environmentsV2",
    scopeQuery(from),
    { page: "page", size: "size" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "environment", listed.detail);
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
          orgIdentifier: to.org,
          projectIdentifier: to.project,
        });
      } catch {}
    }

    const result = await createFillingGaps(ctx, () =>
      request(
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
  ctx: Copying,
  environment: string,
  blocked: string | null,
): Promise<void> {
  const { from, to } = ctx;
  const listed = await listPages<{ infrastructure?: Json }>(
    from.token,
    "GET",
    "/ng/api/infrastructures",
    { ...scopeQuery(from), environmentIdentifier: environment },
    { page: "page", size: "size" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "infrastructure", listed.detail);
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
        orgIdentifier: to.org,
        projectIdentifier: to.project,
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
async function copyVariables(ctx: Copying): Promise<void> {
  const { from, to } = ctx;
  const listed = await listPages<{ variable?: Json }>(
    from.token,
    "GET",
    "/ng/api/variables",
    scopeQuery(from),
    { page: "pageIndex", size: "pageSize" },
  );
  if (!listed.ok) {
    await listingFailed(ctx, "variable", listed.detail);
    return;
  }

  for (const entry of listed.items) {
    const variable = entry.variable;
    const identifier = variable?.identifier;
    if (!variable || typeof identifier !== "string") continue;

    const rest = { ...variable };
    delete rest.accountIdentifier;

    const reply = await request(
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

    await ctx.record("variable", identifier, outcomeOf(reply));
  }
}

/**
 * One source, in the order that lets each kind find what it references:
 * connectors before the templates and infrastructure that name them, variables
 * alongside them since nothing depends on a variable existing first.
 */
async function copySource(ctx: Copying): Promise<void> {
  await copyConnectors(ctx);
  await copyVariables(ctx);
  await copyTemplates(ctx);
  await copyEnvironments(ctx);
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

  // Everything this workshop puts a real value behind, and the kind each one
  // takes, so a stand-in is only ever made where the real value can later land
  // on top of it — see `Copying.ownedHere`. Both sources are listed, the org
  // secrets applied minutes ago and the catalog credentials still to come,
  // because a placeholder outlives the pass that made it: it is still there on
  // the next provision, when a secret added to settings in between goes to
  // overwrite it.
  const ownedHere = new Map<string, SecretType>([
    ...(await loadOrgSecrets()).map(
      (s): [string, SecretType] => [
        s.identifier,
        s.kind === "file" ? "SecretFile" : "SecretText",
      ],
    ),
    ...(await loadCatalog(run.component_set_id ?? undefined))
      .filter((c) => c.kind === "secret_text" || c.kind === "secret_file")
      .map((c): [string, SecretType] => [
        c.identifier,
        c.kind === "secret_file" ? "SecretFile" : "SecretText",
      ]),
  ]);

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
      await copySource({ from, to, ownedHere, record });
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
