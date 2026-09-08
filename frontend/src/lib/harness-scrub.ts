import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessDeployedSecrets,
  harnessTokens,
  type HarnessDeployedSecret,
  type ScrubStatus,
} from "@/db/schema";
import { harnessBaseUrl } from "@/lib/harness-platform";
import { openSecret } from "@/lib/secret-box";

/**
 * Taking this site's credentials back out of somebody else's Harness account.
 *
 * A content deploy writes every value from Settings → Org Secrets into an
 * organization in an account we do not own — which is the point of it: a
 * prospect's account works immediately, with our licence key, our service
 * account, our tokens. Unlike a workshop's organization, that one is permanent,
 * so nothing ever removes them and they would otherwise sit in a stranger's
 * account for good.
 *
 * So after a week each value is overwritten with `123`. Overwritten rather than
 * deleted, and not only because a placeholder is more use than a hole: Harness
 * refuses to delete a secret that anything references, and force-delete is off
 * on most accounts. The result is deliberately identical to what a placeholder
 * secret looks like — see the placeholder section of `@/lib/harness-deploy` —
 * because the two mean the same thing to whoever finds it: the shape is right
 * and the value has to be put in by hand.
 *
 * What is here is the act of scrubbing, for one token, on demand. The scheduled
 * sweep is `runner/src/scrub.ts`: it runs in the reaper's Cloud Run job because
 * that is what this deployment already has on a timer, and it is a second
 * implementation of the same policy for the same reason `applyOrgSecrets` and
 * `deploySecrets` are two — the runner and the app are separate packages and
 * cannot import each other. Change the rules in one and change them in both.
 */

/* ------------------------------------------------------------------ *
 * Policy
 * ------------------------------------------------------------------ */

/**
 * What a scrubbed secret is set to. Obviously not a credential: it fails at the
 * first use rather than being mistaken for something that still works.
 */
export const SCRUB_VALUE = "123";

/**
 * Tags a scrubbed secret carries. `deployed_by` is what the deploy set and is
 * kept — it is still true — and `placeholder` is what the placeholder path uses,
 * so a scrubbed value and a never-known one are labelled the same way.
 */
const SCRUB_TAGS = { deployed_by: "workshop-orchestrator", placeholder: "true" };

/** How long the real values are allowed to live in somebody else's account. */
const DEFAULT_SCRUB_DAYS = 7;

/**
 * The window, in days, from `HARNESS_CONTENT_SCRUB_DAYS`.
 *
 * Zero is legal and means "at the next sweep" — a demo somebody wants emptied
 * as soon as it has been given. Anything unparseable or negative falls back to
 * the default rather than throwing: a typo in an env var must not be able to
 * stop deploys, and a week is the safe reading of an unclear setting.
 */
export function scrubWindowDays(): number {
  const raw = process.env.HARNESS_CONTENT_SCRUB_DAYS;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_SCRUB_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_SCRUB_DAYS;
}

/** When a secret written now becomes due. Fixed at write time — see the schema. */
export function scrubDeadline(from: Date = new Date()): Date {
  return new Date(from.getTime() + scrubWindowDays() * 86_400_000);
}

const scrubDescription = () =>
  `Value scrubbed by Workshop Orchestrator on ${new Date().toISOString().slice(0, 10)}. ` +
  `It held a real credential for the first ${scrubWindowDays()} day(s) after this ` +
  `content was deployed and now holds ${SCRUB_VALUE} — put the right value in ` +
  `before anything uses it.`;

/* ------------------------------------------------------------------ *
 * The ledger
 * ------------------------------------------------------------------ */

/** One org secret, as just written into a deployed organization. */
export type DeployedSecret = {
  /** The token that wrote it, and the credential the scrub will need. */
  tokenId: string;
  accountId: string;
  orgIdentifier: string;
  secretIdentifier: string;
  /** `text` or `file` — which endpoint the scrub has to use. */
  kind: string;
  /** Harness's own `updatedAt` for it, if the reply carried one. */
  harnessUpdatedAt: Date | null;
};

/**
 * Note that a real value now exists in somebody else's account.
 *
 * Called per secret as the deploy writes it, and only when Harness accepted the
 * write — a refused secret is not there and must not be scheduled for scrubbing,
 * or the sweep would spend a week reporting a failure about something that never
 * landed.
 *
 * A second deploy into the same organization overwrites the row: the real values
 * have just gone back in, so the clock starts again and any earlier verdict about
 * this secret is stale. That is what re-running a demo means.
 *
 * Lets its errors out, unlike `recordHarnessDeploy`. A deploy whose ledger row is
 * missing is a deploy whose credentials nothing will ever come back for, so the
 * caller reports it in the deploy report rather than swallowing it.
 */
export async function recordDeployedSecret(
  secret: DeployedSecret,
): Promise<void> {
  const now = new Date();
  await db
    .insert(harnessDeployedSecrets)
    .values({
      tokenId: secret.tokenId,
      accountId: secret.accountId,
      orgIdentifier: secret.orgIdentifier,
      secretIdentifier: secret.secretIdentifier,
      kind: secret.kind,
      harnessUpdatedAt: secret.harnessUpdatedAt,
      writtenAt: now,
      scrubAfter: scrubDeadline(now),
      status: "pending",
    })
    .onConflictDoUpdate({
      target: [
        harnessDeployedSecrets.accountId,
        harnessDeployedSecrets.orgIdentifier,
        harnessDeployedSecrets.secretIdentifier,
      ],
      set: {
        // The token may differ from the one that wrote it last time — whichever
        // just put a real value there is the one that can take it out.
        tokenId: secret.tokenId,
        kind: secret.kind,
        harnessUpdatedAt: secret.harnessUpdatedAt,
        writtenAt: now,
        scrubAfter: scrubDeadline(now),
        status: "pending",
        checkedAt: null,
        note: null,
      },
    });
}

/** Harness's `updatedAt`, which is epoch milliseconds, as a date. */
export const harnessTimestamp = (value: unknown): Date | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value)
    : null;

/* ------------------------------------------------------------------ *
 * What the page says about it
 * ------------------------------------------------------------------ */

/** Everything one token has deployed, counted by what became of it. */
export type ScrubSummary = {
  pending: number;
  scrubbed: number;
  skipped: number;
  failed: number;
  /** The deadline of the earliest pending secret, ISO, or null if none is. */
  dueAt: string | null;
  /** When the last scrub happened here, ISO, or null. */
  scrubbedAt: string | null;
  /**
   * The organizations these secrets are in, deduplicated. Usually one — a token
   * deployed twice into the same place — but a token used for two different
   * organizations has secrets in both, and the row has to be able to say so
   * rather than name whichever was last.
   */
  orgs: string[];
  /**
   * The ones that need a person: skipped because somebody else's value is
   * there now, or failed because Harness could not be reached. Named, because
   * "two failed" is not something anybody can act on.
   */
  problems: {
    secretIdentifier: string;
    orgIdentifier: string;
    status: ScrubStatus;
    note: string | null;
  }[];
};

export const EMPTY_SCRUB: ScrubSummary = {
  pending: 0,
  scrubbed: 0,
  skipped: 0,
  failed: 0,
  dueAt: null,
  scrubbedAt: null,
  orgs: [],
  problems: [],
};

/**
 * The ledger for a set of tokens, summarised one per token.
 *
 * One query for the whole list rather than one per row: a token list is short,
 * its ledger is a few rows per token, and the alternative is N round trips to
 * render a page that has to render anyway.
 */
export async function scrubSummaries(
  tokenIds: string[],
): Promise<Map<string, ScrubSummary>> {
  const summaries = new Map<string, ScrubSummary>();
  if (tokenIds.length === 0) return summaries;

  const rows = await db
    .select()
    .from(harnessDeployedSecrets)
    .where(inArray(harnessDeployedSecrets.tokenId, tokenIds))
    .orderBy(asc(harnessDeployedSecrets.secretIdentifier));

  for (const row of rows) {
    if (row.tokenId === null) continue;
    const summary =
      summaries.get(row.tokenId) ?? { ...EMPTY_SCRUB, orgs: [], problems: [] };

    if (!summary.orgs.includes(row.orgIdentifier)) {
      summary.orgs.push(row.orgIdentifier);
    }

    const status = row.status as ScrubStatus;
    if (status === "pending") {
      summary.pending += 1;
      // The earliest deadline: the sweep works one row at a time, so the first
      // one due is when this organization starts being scrubbed.
      const due = row.scrubAfter.toISOString();
      if (summary.dueAt === null || due < summary.dueAt) summary.dueAt = due;
    } else if (status === "scrubbed") {
      summary.scrubbed += 1;
      const at = (row.checkedAt ?? row.writtenAt).toISOString();
      if (summary.scrubbedAt === null || at > summary.scrubbedAt) {
        summary.scrubbedAt = at;
      }
    } else {
      summary[status] += 1;
      summary.problems.push({
        secretIdentifier: row.secretIdentifier,
        orgIdentifier: row.orgIdentifier,
        status,
        note: row.note,
      });
    }

    summaries.set(row.tokenId, summary);
  }

  return summaries;
}

/* ------------------------------------------------------------------ *
 * The Harness client — two calls, and nothing else
 * ------------------------------------------------------------------ */

/**
 * Its own rather than the deploy's `harnessRequest`, because `harness-deploy`
 * imports this module to record what it writes and the two cannot import each
 * other. Small enough to be worth that: a scrub is one read and one write.
 */
const TIMEOUT_MS = 20_000;

type Reply = { status: number; text: string };

async function request(
  token: string,
  method: "GET" | "PUT",
  path: string,
  query: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const url = `${harnessBaseUrl()}${path}?${new URLSearchParams(query)}`;
  const multipart = body instanceof FormData;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "x-api-key": token,
        // Left to fetch for a FormData body, so the multipart boundary is right.
        ...(body !== undefined && !multipart
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    // Status 0 for "never got an answer", the same convention the deploy uses.
    return {
      status: 0,
      text: err instanceof Error ? err.message : "Could not reach Harness.",
    };
  }
}

const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300;

function messageOf(text: string): string {
  try {
    return (JSON.parse(text) as { message?: string }).message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * Whether Harness is saying the thing is not there any more.
 *
 * Both shapes, verified against the live API, arrive as HTTP **400** rather than
 * a 404 — so this has to be read out of the message:
 *
 *   * `Secret with identifier [x] is not found in the given scope`
 *   * `Organization with identifier [x] not found`
 *
 * Either one is the good ending: the account's owner deleted our secret, or the
 * whole organization, and there is nothing left to take out.
 */
const GONE = /identifier \[[^\]]*\] (?:is )?not found/i;

/** A secret's metadata, narrowed to what a scrub needs. */
type Metadata = {
  updatedAt: Date | null;
  name: string | null;
  /** The manager it lives in. Sent back unchanged — moving it is not our business. */
  secretManager: string | null;
};

function metadataOf(text: string): Metadata {
  try {
    const data = (
      JSON.parse(text) as {
        data?: {
          updatedAt?: unknown;
          secret?: { name?: unknown; spec?: { secretManagerIdentifier?: unknown } };
        };
      }
    ).data;
    const name = data?.secret?.name;
    const manager = data?.secret?.spec?.secretManagerIdentifier;
    return {
      updatedAt: harnessTimestamp(data?.updatedAt),
      name: typeof name === "string" && name.length > 0 ? name : null,
      secretManager: typeof manager === "string" && manager.length > 0 ? manager : null,
    };
  } catch {
    return { updatedAt: null, name: null, secretManager: null };
  }
}

/**
 * How far apart our clock and Harness's may be before a timestamp is read as
 * somebody's edit. Only used for a row written before we knew what Harness's
 * timestamp was; a row with one recorded is compared exactly.
 */
const SKEW_MS = 5 * 60_000;

/**
 * Whether the value in Harness is somebody else's now.
 *
 * The guard, and the reason the ledger stores a timestamp at all. Harness will
 * not hand a secret's value back, so "is this still the value we put there" is
 * unanswerable directly — but every edit moves `updatedAt`, so a timestamp that
 * is not the one our own write produced means the account's owner has replaced
 * the credential with a real one of theirs. Scrubbing that to `123` would break
 * their pipelines, which is worse than leaving a demo credential in place, so
 * the row is skipped and reported instead.
 *
 * The tag cannot do this job — an edit in the Harness UI keeps the tags and
 * changes only the value, which is exactly what was seen when this was tested.
 *
 * Unknown either way — no timestamp recorded, or Harness did not send one — is
 * not treated as modified: it falls back to the write time plus a skew
 * allowance, because refusing to scrub on missing metadata would leave real
 * credentials sitting there, which is the failure this whole thing exists to
 * prevent.
 */
function modifiedSince(row: HarnessDeployedSecret, live: Date | null): boolean {
  if (live === null) return false;
  if (row.harnessUpdatedAt !== null) {
    return live.getTime() !== row.harnessUpdatedAt.getTime();
  }
  return live.getTime() > row.writtenAt.getTime() + SKEW_MS;
}

/* ------------------------------------------------------------------ *
 * Scrubbing one secret
 * ------------------------------------------------------------------ */

export type ScrubVerdict = { status: ScrubStatus; note: string | null };

/**
 * Overwrite one deployed secret with the placeholder value.
 *
 * Reads it first, which is not a wasted round trip: it is where the guard above
 * gets its timestamp, where "already deleted" is discovered without a write, and
 * where the secret's current name and secret manager come from — a scrub should
 * change the value and nothing else, so those are sent back as they are rather
 * than reset to what the deploy originally used.
 */
export async function scrubSecret(
  row: HarnessDeployedSecret,
  token: string,
): Promise<ScrubVerdict> {
  const query = {
    accountIdentifier: row.accountId,
    orgIdentifier: row.orgIdentifier,
  };
  const id = encodeURIComponent(row.secretIdentifier);

  const current = await request(token, "GET", `/ng/api/v2/secrets/${id}`, query);
  if (!ok(current)) {
    const message = messageOf(current.text);
    if (GONE.test(message)) {
      return {
        status: "scrubbed",
        note: "Already gone from Harness — nothing left to scrub.",
      };
    }
    if (current.status === 401 || current.status === 403) {
      return {
        status: "failed",
        note:
          "The token that deployed this can no longer read it in Harness, so " +
          `remove the value by hand: ${message}`,
      };
    }
    return {
      status: "failed",
      note:
        current.status === 0
          ? `Could not reach Harness: ${current.text}`
          : `Harness would not report on it: ${message} (HTTP ${current.status})`,
    };
  }

  const live = metadataOf(current.text);
  if (modifiedSince(row, live.updatedAt)) {
    return {
      status: "skipped",
      note:
        "Somebody changed this secret in Harness after it was deployed, so the " +
        "value there is theirs now and has been left alone.",
    };
  }

  const name = live.name ?? row.secretIdentifier;
  const secretManager = live.secretManager ?? "org.harnessSecretManager";
  const description = scrubDescription();

  let reply: Reply;
  if (row.kind === "file") {
    // A file secret takes multipart, at its own path. Sending it as JSON — or
    // sending a text secret to this path — is refused.
    const form = new FormData();
    form.append(
      "spec",
      JSON.stringify({
        secret: {
          type: "SecretFile",
          name,
          identifier: row.secretIdentifier,
          orgIdentifier: row.orgIdentifier,
          description,
          tags: SCRUB_TAGS,
          spec: { secretManagerIdentifier: secretManager },
        },
      }),
    );
    form.append(
      "file",
      new Blob([SCRUB_VALUE], { type: "text/plain" }),
      `${row.secretIdentifier}.txt`,
    );
    reply = await request(
      token,
      "PUT",
      `/ng/api/v2/secrets/files/${id}`,
      query,
      form,
    );
  } else {
    reply = await request(token, "PUT", `/ng/api/v2/secrets/${id}`, query, {
      secret: {
        type: "SecretText",
        name,
        identifier: row.secretIdentifier,
        orgIdentifier: row.orgIdentifier,
        description,
        tags: SCRUB_TAGS,
        spec: {
          secretManagerIdentifier: secretManager,
          valueType: "Inline",
          value: SCRUB_VALUE,
        },
      },
    });
  }

  if (ok(reply)) return { status: "scrubbed", note: null };

  const message = messageOf(reply.text);
  if (GONE.test(message)) {
    return {
      status: "scrubbed",
      note: "Already gone from Harness — nothing left to scrub.",
    };
  }
  return {
    status: "failed",
    note:
      reply.status === 0
        ? `Could not reach Harness: ${reply.text}`
        : `Harness refused the overwrite: ${message} (HTTP ${reply.status})`,
  };
}

/** Write a verdict down. `checked_at` moves whatever was decided. */
async function record(id: string, verdict: ScrubVerdict): Promise<void> {
  await db
    .update(harnessDeployedSecrets)
    .set({ status: verdict.status, note: verdict.note, checkedAt: new Date() })
    .where(eq(harnessDeployedSecrets.id, id));
}

/* ------------------------------------------------------------------ *
 * Scrubbing everything one token deployed
 * ------------------------------------------------------------------ */

export type ScrubRun = {
  scrubbed: number;
  skipped: number;
  failed: number;
  /** The ones that did not get scrubbed, named, for the sentence the page shows. */
  problems: { secretIdentifier: string; status: ScrubStatus; note: string | null }[];
};

const EMPTY_RUN: ScrubRun = { scrubbed: 0, skipped: 0, failed: 0, problems: [] };

/**
 * Scrub everything a token has deployed, now, whatever the deadline says.
 *
 * The manual half of the design, and it exists because the scheduled sweep can
 * fail quietly: the job stops running, the credential is revoked, nobody
 * notices, and real credentials sit in a customer's account with a page
 * cheerfully saying they will be scrubbed on Tuesday. A button that does the
 * work in this process — not one that queues it for the sweep — is the thing
 * somebody can rely on when the sweep is the part that is broken.
 *
 * `skipped` rows are left as they are. That verdict means the value belongs to
 * the account's owner now, and a person pressing a button has no more right to
 * overwrite it than the sweep did; the note says so, and Harness is where that
 * gets settled. `failed` ones are retried, which is most of the point.
 *
 * Scoped to the caller's own token, like everything in `harness-tokens`: another
 * user's token is simply not found.
 */
export async function scrubDeployedSecrets(
  userId: string,
  tokenId: string,
): Promise<ScrubRun | { error: "not_found" | "unreadable" }> {
  const [token] = await db
    .select({ id: harnessTokens.id, secret: harnessTokens.secret })
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, tokenId), eq(harnessTokens.userId, userId)));
  if (!token) return { error: "not_found" };

  const raw = openSecret(token.secret);
  if (raw === null) return { error: "unreadable" };

  return scrubWithToken(tokenId, raw);
}

/**
 * The loop itself, given a token already opened.
 *
 * Split out for the one caller that has the plaintext and no user to check it
 * against: removing a saved token scrubs what it deployed on the way out, since
 * deleting the credential does not take the credentials it delivered out of
 * somebody else's account — and afterwards there is nothing left that could.
 */
export async function scrubWithToken(
  tokenId: string,
  token: string,
): Promise<ScrubRun> {
  const rows = await db
    .select()
    .from(harnessDeployedSecrets)
    .where(
      and(
        eq(harnessDeployedSecrets.tokenId, tokenId),
        // Everything except the two settled states: `scrubbed` is done, and
        // `skipped` is not ours to touch.
        ne(harnessDeployedSecrets.status, "scrubbed"),
        ne(harnessDeployedSecrets.status, "skipped"),
      ),
    )
    .orderBy(asc(harnessDeployedSecrets.secretIdentifier));

  if (rows.length === 0) return { ...EMPTY_RUN };

  const run: ScrubRun = { ...EMPTY_RUN, problems: [] };
  for (const row of rows) {
    const verdict = await scrubSecret(row, token);
    await record(row.id, verdict);
    if (verdict.status === "scrubbed") run.scrubbed += 1;
    else if (verdict.status === "skipped") run.skipped += 1;
    else run.failed += 1;
    if (verdict.status !== "scrubbed") {
      run.problems.push({
        secretIdentifier: row.secretIdentifier,
        status: verdict.status,
        note: verdict.note,
      });
    }
  }
  return run;
}
