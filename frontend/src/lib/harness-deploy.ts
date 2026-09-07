import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { harnessTokens } from "@/db/schema";
import type { DeployError } from "@/lib/harness-deploy-errors";
import { harnessIdentifier } from "@/lib/harness-identifier";
import { orgSecretValues } from "@/lib/harness-org-secrets";
import { ACCOUNT_ADMIN } from "@/lib/harness-permissions";
import {
  harnessBaseUrl,
  harnessOrgUrl,
  parseHarnessToken,
} from "@/lib/harness-platform";
import {
  harnessTimestamp,
  recordDeployedSecret,
} from "@/lib/harness-scrub";
import { listTemplateSources, templateSourceToken } from "@/lib/harness-templates";
import { recordHarnessDeploy } from "@/lib/harness-tokens";
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
 *     precisely so there is somewhere to keep the plaintext. Anything the content
 *     references and that tab does not hold gets a placeholder rather than
 *     stopping the entity that needed it — see `createFillingGaps`;
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

/* ------------------------------------------------------------------ *
 * Placeholder secrets
 * ------------------------------------------------------------------ */

/**
 * Standing in for a secret the source referenced and this site has no value for.
 *
 * The common failure copying content between accounts: a connector names
 * `org.some_token`, that token was a value somebody typed into the *source*
 * account, and Harness will not hand it back — so the connector is refused and
 * everything downstream of it goes with it. A placeholder gets the shape of the
 * organization built, and leaves exactly one thing to do by hand: put the real
 * value in.
 *
 * `123` is deliberately obviously wrong. Anything that looks like a credential
 * risks being left in place; a three-digit number fails at the first use and the
 * secret says in its own description what it is.
 */
const PLACEHOLDER_VALUE = "123";

const PLACEHOLDER_DESCRIPTION =
  "Placeholder created by Workshop Orchestrator. The content deployed here " +
  "references this secret and the real value was not available — replace it " +
  "before anything uses it.";

/**
 * Rounds of "create what it named and try again" per entity. One entity can
 * reference several missing secrets and Harness only reports the first, so this
 * has to loop; the cap is what stops it looping forever on a refusal that keeps
 * naming something new.
 */
const MAX_PLACEHOLDERS = 5;

/**
 * Harness's own words for it, and they carry the scope it looked in:
 *
 *   * `...with the id foo` — an `account.foo` reference, so account level;
 *   * `...with the id foo  in organization myorg` — org level;
 *   * `...with the id foo  in organization myorg in project myproj` — project.
 *
 * Which is why this is parsed rather than the reference being read out of the
 * body being sent: the message says where Harness *looked*, and that is where the
 * secret has to be for the retry to work. The double space is Harness's.
 *
 * Matched against the extracted `message` and not the raw response, and on
 * identifier characters rather than non-whitespace, for the same reason: in the
 * JSON body the message is followed immediately by `","correlationId":"…"`, and a
 * greedy `\S+` reads all of that as the organization's name. Which it did, and
 * every placeholder was then addressed to an organization called
 * `MyOrg","correlationId":"4d8de80c…`, which of course does not exist — so each
 * one failed, and so did the retry it was supposed to rescue.
 */
const MISSING_SECRET =
  /No secret exists with the id\s+([\w.$-]+)(?:\s+in organization\s+([\w.$-]+))?(?:\s+in project\s+([\w.$-]+))?/;

type MissingSecret = {
  identifier: string;
  /** Null for an account-level reference. */
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

/**
 * Where a placeholder landed, as the report reads it. An account-level one is
 * called out as such because it is the one thing here written *outside* the new
 * organization — shared with everything else in the account, and worth seeing.
 */
const missingLabel = (missing: MissingSecret) =>
  missing.project
    ? `${missing.org} / ${missing.project}`
    : (missing.org ?? "the account");

async function createPlaceholder(
  to: Scope,
  missing: MissingSecret,
): Promise<Reply> {
  const scope = {
    orgIdentifier: missing.org ?? undefined,
    projectIdentifier: missing.project ?? undefined,
  };
  return harnessRequest(
    to.token,
    "POST",
    "/ng/api/v2/secrets",
    { accountIdentifier: to.accountId, ...scope },
    {
      secret: {
        // The identifier doubles as the name, as everywhere else here: the
        // reference is by identifier, and inventing a prettier name would put a
        // string in Harness that nothing in the content refers to.
        name: missing.identifier,
        identifier: missing.identifier,
        ...scope,
        description: PLACEHOLDER_DESCRIPTION,
        // Tagged twice over, so "which of these are fake" is a filter in Harness
        // rather than a memory of what the report said.
        tags: { ...TAGS, placeholder: "true" },
        type: "SecretText",
        spec: {
          // Unprefixed, so it means the secret manager belonging to whichever
          // scope this is going into — every scope Harness creates gets its own.
          secretManagerIdentifier: "harnessSecretManager",
          valueType: "Inline",
          value: PLACEHOLDER_VALUE,
        },
      },
    },
  );
}

/**
 * Create something, and if Harness refuses it for want of a secret, make a
 * placeholder for that secret and try again.
 *
 * Every create goes through here, because any of them can reference a secret and
 * only Harness knows which. The retry is driven entirely by what it says: no
 * attempt is made to find secret references in the body being sent, since a
 * reference can be nested anywhere in arbitrary YAML and Harness has already done
 * that work by the time it refuses.
 *
 * A placeholder is only ever created for a secret Harness has just said is *not
 * there*, so this cannot overwrite a real value — including the org secrets from
 * Settings, which went in first and are found rather than reported missing.
 *
 * Each identifier is attempted once. If the retry fails naming the same secret
 * again — the placeholder is a text secret and the field wanted a file, say —
 * that is Harness's answer and it goes in the report as the entity's failure.
 */
async function createFillingGaps(
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

    const placeholder = await createPlaceholder(to, missing);
    const result = outcomeOf(placeholder);
    record({
      scope: missingLabel(missing),
      kind: "secret",
      // Marked in the identifier rather than only in the detail: this is a
      // secret with a wrong value in it, and that has to be legible in a list
      // of forty lines somebody skims.
      identifier: `${missing.identifier} (placeholder)`,
      outcome: result.outcome,
      detail:
        result.detail ??
        `Value ${PLACEHOLDER_VALUE} — referenced by the content being deployed, ` +
          `and no real value for it was available.`,
    });

    // Nothing to retry against if the placeholder itself was refused.
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
 * same identifiers. Anything else it names — an `account.` reference, or an
 * `org.` one this site holds no value for — gets a placeholder instead of
 * refusing the connector; see `createFillingGaps`.
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

    const outcome = await createFillingGaps(
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
    const outcome = await createFillingGaps(
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

    const outcome = await createFillingGaps(
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
            // Harness rejects an environment with no type; `PreProduction` is
            // the safer default of the two if the source somehow had none.
            type:
              typeof environment.type === "string"
                ? environment.type
                : "PreProduction",
            // The YAML is what carries everything else — variables, overrides —
            // so it is sent when there is one, and the fields above stand alone
            // when there is not.
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

    const outcome = await createFillingGaps(
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
 *
 * Each one that lands is written to the ledger, because this is the step that
 * puts *our* real credentials into an account we do not own. Nothing else here
 * needs that: a connector or a template is content, and copying it gives nothing
 * away. See `@/lib/harness-scrub` for what becomes of them.
 */
async function deploySecrets(
  to: Scope,
  /** The saved token being deployed with — what a scrub will need to come back. */
  tokenId: string,
  record: Record_,
): Promise<void> {
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

    const outcome = outcomeOf(reply);
    record({
      scope: scopeLabel(to),
      kind: "secret",
      identifier: secret.identifier,
      ...outcome,
    });

    // Only what Harness accepted. A refused secret is not in that account, and
    // scheduling a scrub for it would mean a week of the sweep reporting a
    // failure about something that was never there. "Already existed" does not
    // count either: this deploy did not put the value there, so it does not know
    // what the value is or whose it is.
    if (outcome.outcome !== "created") continue;

    try {
      await recordDeployedSecret({
        tokenId,
        accountId: to.accountId,
        orgIdentifier: to.org,
        secretIdentifier: secret.identifier,
        kind: secret.kind,
        // Harness's own timestamp for the write it just did, which is what the
        // scrub compares against to tell our value from one somebody has since
        // replaced. Absent is survivable — see `modifiedSince`.
        harnessUpdatedAt: harnessTimestamp(
          dataOf<{ updatedAt?: unknown }>(reply)?.updatedAt,
        ),
      });
    } catch (err) {
      // A secret that landed but was not written down is the one case this
      // feature cannot recover from on its own: nothing will ever come back for
      // it. So it is said out loud in the report rather than logged and lost.
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

/* ------------------------------------------------------------------ *
 * The deploy
 * ------------------------------------------------------------------ */

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
 *
 * Naming the organization this token last deployed into re-runs that deploy
 * instead of being refused: everything already there is found rather than made,
 * and whatever failed the first time is tried again. Where it went is recorded on
 * the token row afterwards, which is what makes that distinguishable from a
 * collision with an organization somebody else made.
 */
export async function deployContent(
  userId: string,
  tokenId: string,
  orgName: string,
): Promise<DeployResult> {
  const typed = orgName.trim();
  const derived = harnessIdentifier(typed);
  if (typed.length === 0 || derived === null) {
    return { ok: false, error: "invalid_name" };
  }

  const [row] = await db
    .select()
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, tokenId), eq(harnessTokens.userId, userId)));
  if (!row) return { ok: false, error: "not_found" };

  // Whether this names the organization the token last deployed into, and so is
  // a re-run rather than a new one.
  //
  // Compared case-insensitively because that is how Harness compares: creating
  // `wo_probe` when `WO_Probe` exists is refused as a duplicate. Matching
  // case-sensitively here would read somebody's own organization, retyped with
  // different capitals, as a collision with a stranger's.
  //
  // The recorded identifier is then the one used, not the freshly derived one:
  // it is the string Harness actually has, so every write below addresses the
  // organization that exists rather than a spelling of it. Same for the name — on
  // a re-run the organization keeps the name it was created with, and the record
  // should say what Harness shows.
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

  /* 1. The organization. The one failure that stops everything: there is
        nowhere to put the rest of it.
        Attempted even on a re-run, because the organization may have been
        deleted in Harness since — and then re-creating it is exactly right. */
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
    // An organization that is already there is only safe to fill if it is one
    // *this token* built: the row remembers where it last deployed, so a repeat
    // of that name converges — the way to finish a deploy that had failures in
    // it — and every entity below is created or found, never duplicated. Any
    // other collision is somebody else's organization, and pouring this site's
    // secrets and connectors into it is not a thing to do on a name clash.
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

  // The organization was found rather than made, so its name is whatever it was
  // created with — not what was typed just now.
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

  /* 2. The site's secrets, before anything that could reference one. */
  await deploySecrets(target, tokenId, record);

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

  // Last, so the row records a deploy that actually ran. Not awaited for its
  // result and deliberately not allowed to fail the call: the organization is in
  // Harness whatever this note does, and the report is the more important half of
  // the answer.
  await recordHarnessDeploy(userId, tokenId, { name, identifier }).catch(
    () => {},
  );

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
