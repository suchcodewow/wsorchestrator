import { dueScrubs, recordScrub, withScrubLock, type DueScrub } from "./db.js";
import { openSecret, secretsConfigured } from "./secret-box.js";

/**
 * The scheduled half of taking this site's credentials back out of other
 * people's Harness accounts.
 *
 * A content deploy writes every value from Settings → Org Secrets into an
 * organization in an account we do not own — our licence key, our service
 * account, our tokens — so a prospect's account works the moment they open it.
 * Unlike a workshop's org, that one is permanent and nothing tears it down, so a
 * week later each value is overwritten with `123`: the demo keeps its shape, and
 * nothing of ours is left behind to be used or leaked.
 *
 * This runs in the reaper's Cloud Run job, on the reaper's existing schedule,
 * because that is a timer this deployment already has and the alternative was a
 * new scheduler target pointed at a public endpoint on the app, with a new
 * shared-secret auth path to get wrong.
 *
 * It is a second implementation of the policy in
 * `frontend/src/lib/harness-scrub.ts`, for the same reason `applyOrgSecrets` here
 * duplicates `deploySecrets` there and `secret-box.ts` exists twice: the runner
 * and the app are separately deployed packages with no shared code. **Change the
 * rules in one and change them in both** — in particular the placeholder value,
 * the tags, and the modified-since guard, which are what somebody looking at a
 * scrubbed secret in Harness actually sees.
 *
 * Nothing here touches the site's own Harness account, so it deliberately uses
 * neither `./harness.js` nor `harnessCfg()`: every call in that module is bound
 * to the site's own account id and API key, and each row below carries its own
 * account id and its own token belonging to somebody else. Reading the cluster
 * URL is the only overlap, and it is read directly — going through `harnessCfg()`
 * for it made the sweep throw when the site's own Harness credentials were
 * missing, over a call that has no use for them.
 */

/* ------------------------------------------------------------------ *
 * Policy — mirrored from the app
 * ------------------------------------------------------------------ */

/** What a scrubbed secret holds. Fails at first use rather than half-working. */
const SCRUB_VALUE = "123";

/**
 * Tags a scrubbed secret carries. `deployed_by` is what the deploy set and is
 * still true; `placeholder` is what the app's placeholder path uses, so a value
 * we took back and one we never had are labelled the same way.
 */
const SCRUB_TAGS = { deployed_by: "workshop-orchestrator", placeholder: "true" };

const scrubDescription = () =>
  `Value scrubbed by Workshop Orchestrator on ${new Date().toISOString().slice(0, 10)}. ` +
  `It held a real credential while this content was first demonstrated and now ` +
  `holds ${SCRUB_VALUE} — put the right value in before anything uses it.`;

/**
 * How far apart our clock and Harness's may be before a timestamp reads as
 * somebody's edit. Only used for a row that has no recorded Harness timestamp;
 * one that does is compared exactly.
 */
const SKEW_MS = 5 * 60_000;

const TIMEOUT_MS = 20_000;

/** Which Harness cluster, the same way `harnessCfg` reads it. */
const baseUrl = () =>
  (process.env.HARNESS_BASE_URL ?? "https://app.harness.io").replace(/\/+$/, "");

/* ------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------ */

/**
 * Scrub every deployed secret whose window has passed.
 *
 * Called from the reaper, and reports rather than throws: this rides somebody
 * else's job, and a Harness account that cannot be reached must not be able to
 * fail a tick that also has workshops to tear down. Every row's outcome is
 * written to the ledger, which is what the token's row in the app displays — so
 * "could not do it" ends up in front of the person who deployed, not only in a
 * Cloud Run log.
 */
export async function scrubDeployedSecrets(): Promise<void> {
  const ran = await withScrubLock(sweep);
  if (!ran) console.log("scrub: another sweep is already running, skipping");
}

async function sweep(): Promise<void> {
  const rows = await dueScrubs();
  if (rows.length === 0) {
    console.log("scrub: no deployed credentials are due");
    return;
  }

  // Said once, up front, the way `applyOrgSecrets` does: without a key every
  // token comes back unreadable, and "this runner has no key" is a deployment
  // problem, not N secrets' problem.
  if (!secretsConfigured()) {
    console.error(
      `scrub: ${rows.length} deployed credential(s) are due but this runner has ` +
        `no HARNESS_TOKEN_ENC_KEY or AUTH_SECRET, so no token can be decrypted`,
    );
    return;
  }

  console.log(`scrub: ${rows.length} deployed credential(s) due`);

  const tally = { scrubbed: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    // `scrubOne` turns every expected failure into a verdict, so this is for the
    // unexpected kind — and one row's surprise must not strand the rest of the
    // sweep, or a single unscrubbable secret keeps every later one real forever.
    const verdict = await scrubOne(row).catch(
      (err: unknown): Verdict => ({
        status: "failed",
        note: `Scrubbing it failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
    tally[verdict.status] += 1;
    try {
      await recordScrub(row.id, verdict.status, verdict.note);
    } catch (err) {
      // The value in Harness is already whatever it now is; losing the record of
      // that only means the row is reconsidered next tick, which is harmless.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`scrub: could not record ${row.secret_identifier}: ${message}`);
    }
    console.log(
      `scrub: ${row.org_identifier}/${row.secret_identifier} -> ${verdict.status}` +
        (verdict.note ? ` (${verdict.note})` : ""),
    );
  }

  console.log(
    `scrub: ${tally.scrubbed} scrubbed, ${tally.skipped} left alone, ` +
      `${tally.failed} failed`,
  );
}

type Verdict = { status: "scrubbed" | "skipped" | "failed"; note: string | null };

/**
 * Overwrite one deployed secret, or explain why it was not.
 *
 * Reads it first, which earns its round trip three times over: it is where the
 * modified-since guard gets its timestamp, where "the customer already deleted
 * it" is discovered without a write, and where the secret's current name and
 * secret manager come from — a scrub changes the value and nothing else, so
 * those go back exactly as found rather than being reset to what we first sent.
 */
async function scrubOne(row: DueScrub): Promise<Verdict> {
  if (row.token_secret === null) {
    return {
      status: "failed",
      note:
        "The Harness token that deployed this has been removed from this site, " +
        `so nothing here can reach the secret any more — delete or replace ` +
        `${row.secret_identifier} in the ${row.org_identifier} organization by hand.`,
    };
  }

  const token = openSecret(row.token_secret);
  if (token === null) {
    return {
      status: "failed",
      note:
        "The stored Harness token could not be decrypted — it was sealed with a " +
        "different key than this deployment now holds. Re-enter the token on the " +
        "tokens page and scrub again, or remove the value in Harness by hand.",
    };
  }

  const query = {
    accountIdentifier: row.account_id,
    orgIdentifier: row.org_identifier,
  };
  const id = encodeURIComponent(row.secret_identifier);

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
          "The token that deployed this can no longer read it in Harness — " +
          `remove the value by hand. Harness said: ${message}`,
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
        "value there is theirs now and has been left alone. If it is still ours, " +
        "replace it by hand.",
    };
  }

  const name = live.name ?? row.secret_identifier;
  const secretManager = live.secretManager ?? "org.harnessSecretManager";
  const description = scrubDescription();

  let reply: Reply;
  if (row.kind === "file") {
    // A file secret takes multipart at its own path; sending it as JSON, or a
    // text secret to this path, is refused.
    const form = new FormData();
    form.append(
      "spec",
      JSON.stringify({
        secret: {
          type: "SecretFile",
          name,
          identifier: row.secret_identifier,
          orgIdentifier: row.org_identifier,
          description,
          tags: SCRUB_TAGS,
          spec: { secretManagerIdentifier: secretManager },
        },
      }),
    );
    form.append(
      "file",
      new Blob([SCRUB_VALUE], { type: "text/plain" }),
      `${row.secret_identifier}.txt`,
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
        identifier: row.secret_identifier,
        orgIdentifier: row.org_identifier,
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

/**
 * Whether the value in Harness is somebody else's now.
 *
 * The guard, and the whole reason the ledger stores a timestamp. Harness will
 * not hand a secret's value back, so "is this still what we put there" cannot be
 * asked directly — but every edit moves `updatedAt`, so a timestamp that is not
 * the one our own write produced means the account's owner has put a real
 * credential of their own in. Overwriting that with `123` would break their
 * pipelines, which is worse than leaving a demo credential in place: the row is
 * left alone and reported instead.
 *
 * Tags cannot do this job — an edit in the Harness UI keeps them and changes only
 * the value, which is what was observed when this was tested against the API.
 *
 * Unknown either way is not read as modified. A row with no recorded timestamp
 * falls back to its write time plus a skew allowance, and a reply that carried no
 * timestamp at all is scrubbed, because refusing on missing metadata would leave
 * real credentials sitting in a stranger's account — the failure this exists to
 * prevent.
 */
function modifiedSince(row: DueScrub, live: Date | null): boolean {
  if (live === null) return false;
  if (row.harness_updated_at !== null) {
    return live.getTime() !== row.harness_updated_at.getTime();
  }
  return live.getTime() > row.written_at.getTime() + SKEW_MS;
}

/* ------------------------------------------------------------------ *
 * A two-call Harness client, for accounts that are not ours
 * ------------------------------------------------------------------ */

type Reply = { status: number; text: string };

async function request(
  token: string,
  method: "GET" | "PUT",
  path: string,
  query: Record<string, string>,
  body?: unknown,
): Promise<Reply> {
  const url = `${baseUrl()}${path}?${new URLSearchParams(query)}`;
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
        body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    // Status 0 for "never got an answer", the same convention the app uses.
    return {
      status: 0,
      text: err instanceof Error ? err.message : "Could not reach Harness.",
    };
  }
}

const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300;

function messageOf(text: string): string {
  try {
    return (
      (JSON.parse(text) as { message?: string }).message ?? text.slice(0, 300)
    );
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * Whether Harness is saying the thing is not there any more. Both shapes arrive
 * as HTTP **400**, not 404, so it has to be read out of the message:
 *
 *   * `Secret with identifier [x] is not found in the given scope`
 *   * `Organization with identifier [x] not found`
 *
 * Either is the good ending — the account's owner removed our secret, or the
 * whole organization, and there is nothing left to take out.
 */
const GONE = /identifier \[[^\]]*\] (?:is )?not found/i;

/** Harness's `updatedAt`, which is epoch milliseconds, as a date. */
const harnessTimestamp = (value: unknown): Date | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value)
    : null;

/** A secret's metadata, narrowed to what a scrub needs to send back. */
type Metadata = {
  updatedAt: Date | null;
  name: string | null;
  secretManager: string | null;
};

function metadataOf(text: string): Metadata {
  try {
    const data = (
      JSON.parse(text) as {
        data?: {
          updatedAt?: unknown;
          secret?: {
            name?: unknown;
            spec?: { secretManagerIdentifier?: unknown };
          };
        };
      }
    ).data;
    const name = data?.secret?.name;
    const manager = data?.secret?.spec?.secretManagerIdentifier;
    return {
      updatedAt: harnessTimestamp(data?.updatedAt),
      name: typeof name === "string" && name.length > 0 ? name : null,
      secretManager:
        typeof manager === "string" && manager.length > 0 ? manager : null,
    };
  } catch {
    return { updatedAt: null, name: null, secretManager: null };
  }
}
