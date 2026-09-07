import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  harnessTokens,
  MAX_HARNESS_TOKENS_PER_USER,
  type HarnessPermissionCheck,
  type HarnessToken,
} from "@/db/schema";
import {
  checkHarnessToken,
  fingerprint,
  harnessOrgUrl,
  type CheckError,
} from "@/lib/harness-platform";
import {
  EMPTY_SCRUB,
  scrubSummaries,
  scrubWithToken,
  type ScrubRun,
  type ScrubSummary,
} from "@/lib/harness-scrub";
import { openSecret, sealSecret } from "@/lib/secret-box";

/**
 * A user's saved Harness platform tokens.
 *
 * Every function here is scoped by `userId` inside the same statement as the id,
 * so somebody else's token is simply not found rather than found and refused.
 * These are other people's credentials for another system; the narrowest
 * possible access path is worth the small repetition.
 */

/**
 * The last deploy made with a token: which organization it built, and when.
 *
 * Null until there has been one. Not a history — one deploy per token is
 * remembered, because what the row needs to say is where its content is now.
 */
export type HarnessDeploy = {
  /** The name as it was typed. What the prompt prefills next time. */
  orgName: string;
  /** What Harness derived from that name, and addresses the org by. */
  orgIdentifier: string;
  /** Harness console link to it. */
  orgUrl: string;
  /** ISO, when the deploy finished. */
  at: string;
};

/** A saved token as its owner sees it — everything except the secret. */
export type HarnessTokenSummary = {
  id: string;
  kind: string;
  accountId: string;
  /**
   * The account name Harness gave at the last check — what names the row, since
   * nothing asks the user for a label. Null when the token cannot read its own
   * account, and then the id below stands in.
   */
  accountName: string | null;
  principal: string | null;
  principalType: string | null;
  /** Last four characters, for telling two rows apart. */
  tail: string;
  permissions: HarnessPermissionCheck[];
  /** ISO, or null if it has never been confirmed. */
  verifiedAt: string | null;
  createdAt: string;
  /**
   * Whether the stored secret can still be decrypted. False means the
   * encryption key changed underneath it — the row is a record of a token
   * nobody can use, and the only fix is pasting it again.
   */
  usable: boolean;
  /** Where this token last deployed content, or null if it never has. */
  lastDeploy: HarnessDeploy | null;
  /**
   * What has become of the site's credentials this token deployed: how many are
   * still live in that account, when the first is due to be scrubbed, and
   * anything that needs a person. All zeroes for a token that never deployed.
   */
  scrub: ScrubSummary;
};

/**
 * The three deploy columns as one value, or null.
 *
 * All three or none: a row with a name but no timestamp would render as a deploy
 * that happened at no particular time, so the incomplete case is treated as the
 * absent one.
 */
const lastDeployOf = (row: HarnessToken): HarnessDeploy | null =>
  row.deployedOrgName !== null &&
  row.deployedOrgIdentifier !== null &&
  row.deployedAt !== null
    ? {
        orgName: row.deployedOrgName,
        orgIdentifier: row.deployedOrgIdentifier,
        orgUrl: harnessOrgUrl(row.accountId, row.deployedOrgIdentifier),
        at: row.deployedAt.toISOString(),
      }
    : null;

/**
 * `scrub` is passed in rather than read here, because it is a second query and
 * only the list needs it: saving or re-checking a token answers with the row it
 * just changed, and the page it answers to re-reads the list anyway. So those
 * two get the empty summary rather than a round trip whose result is discarded.
 */
const summarize = (
  row: HarnessToken,
  scrub: ScrubSummary = EMPTY_SCRUB,
): HarnessTokenSummary => ({
  id: row.id,
  kind: row.kind,
  accountId: row.accountId,
  accountName: row.accountName,
  principal: row.principal,
  principalType: row.principalType,
  tail: row.tail,
  permissions: row.permissions,
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  // Cheap — a few bytes of AES per row — and the alternative is a list that
  // looks healthy right up until somebody tries to use one of them.
  usable: openSecret(row.secret) !== null,
  lastDeploy: lastDeployOf(row),
  scrub,
});

export async function listHarnessTokens(
  userId: string,
): Promise<HarnessTokenSummary[]> {
  const rows = await db
    .select()
    .from(harnessTokens)
    .where(eq(harnessTokens.userId, userId))
    .orderBy(asc(harnessTokens.createdAt));

  const scrub = await scrubSummaries(rows.map((row) => row.id));
  return rows.map((row) => summarize(row, scrub.get(row.id)));
}

export type SaveError =
  | CheckError
  /** Already have `MAX_HARNESS_TOKENS_PER_USER` saved. */
  | "too_many"
  /** This exact token is already in the list. */
  | "duplicate"
  /** No encryption key configured, so nothing can be stored safely. */
  | "no_key";

export type SaveResult =
  | { ok: true; token: HarnessTokenSummary }
  | { ok: false; error: SaveError; detail?: string };

/**
 * Check a pasted token with Harness and, if it is real, save it.
 *
 * Checking first is the whole design: a token that Harness rejects is never
 * written, so the list is a list of credentials known to have worked rather than
 * of strings somebody typed. The findings from that check — account name,
 * principal, what it may do — are stored alongside it, because they are what
 * makes the row readable later without a round trip per row. The account name in
 * particular is why the form is one field: the check has to happen anyway, and it
 * comes back knowing what to call the token better than a person would.
 */
export async function saveHarnessToken(
  userId: string,
  token: string,
): Promise<SaveResult> {
  const raw = token.trim();
  if (raw.length === 0) return { ok: false, error: "malformed" };

  const existing = await db
    .select({ id: harnessTokens.id, fingerprint: harnessTokens.fingerprint })
    .from(harnessTokens)
    .where(eq(harnessTokens.userId, userId));

  // Both checked before talking to Harness: neither answer changes based on what
  // Harness says, and there is no reason to send somebody's credential to
  // another system to earn a refusal we already know about.
  const print = fingerprint(raw);
  if (existing.some((row) => row.fingerprint === print)) {
    return { ok: false, error: "duplicate" };
  }
  if (existing.length >= MAX_HARNESS_TOKENS_PER_USER) {
    return { ok: false, error: "too_many" };
  }

  const check = await checkHarnessToken(raw);
  if (!check.ok) return { ok: false, error: check.error, detail: check.detail };

  // Sealing can only fail for want of a key, and that is a deployment fault
  // rather than anything the user did — so it gets its own error instead of
  // surfacing as a 500 on a form that had just succeeded.
  let secret: Buffer;
  try {
    secret = sealSecret(raw);
  } catch {
    return { ok: false, error: "no_key" };
  }

  const [row] = await db
    .insert(harnessTokens)
    .values({
      userId,
      kind: check.token.kind,
      accountId: check.token.accountId,
      accountName: check.accountName,
      principal: check.principal,
      principalType: check.principalType,
      tail: check.token.tail,
      fingerprint: print,
      secret,
      permissions: check.permissions,
      verifiedAt: new Date(),
    })
    .returning();

  return { ok: true, token: summarize(row!) };
}

export type RecheckResult =
  | { ok: true; token: HarnessTokenSummary }
  | { ok: false; error: SaveError | "not_found" | "unreadable"; detail?: string };

/**
 * Ask Harness about a token that is already saved, and update what we know.
 *
 * The stored findings are a snapshot: a token expires, a role assignment is
 * taken away, an account is renamed. Re-checking is deliberately a button rather
 * than something the page does on render — it is a write and a cross-region call
 * per row, and nobody wants either as the cost of opening their settings.
 *
 * A failed check updates the row's findings but does not delete it. "This token
 * stopped working" is worth seeing next to the account it was for.
 */
export async function recheckHarnessToken(
  userId: string,
  id: string,
): Promise<RecheckResult> {
  const [row] = await db
    .select()
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
  if (!row) return { ok: false, error: "not_found" };

  const raw = openSecret(row.secret);
  if (raw === null) return { ok: false, error: "unreadable" };

  const check = await checkHarnessToken(raw);
  if (!check.ok) {
    // `verifiedAt` is cleared so the list stops claiming it was ever confirmed,
    // rather than showing a date that is now a lie.
    await db
      .update(harnessTokens)
      .set({ verifiedAt: null })
      .where(eq(harnessTokens.id, row.id));
    return { ok: false, error: check.error, detail: check.detail };
  }

  const [updated] = await db
    .update(harnessTokens)
    .set({
      // Kept if this check came back without one. The name is how the row is
      // identified now, and a single lookup that failed is a worse answer than
      // the name Harness gave last time.
      accountName: check.accountName ?? row.accountName,
      principal: check.principal,
      principalType: check.principalType,
      permissions: check.permissions,
      verifiedAt: new Date(),
    })
    .where(eq(harnessTokens.id, row.id))
    .returning();

  return { ok: true, token: summarize(updated!) };
}

export type DeleteResult = {
  deleted: boolean;
  /**
   * What the scrub on the way out managed, when there was anything to scrub.
   * Null when the token had deployed nothing, or when its secret could not be
   * opened so nothing could be attempted.
   */
  scrub: ScrubRun | null;
};

/**
 * Forget a token — after taking back whatever it left in somebody else's Harness
 * account.
 *
 * The scrub happens here because this is the last moment it can: the ledger row
 * keeps its record either way, but the credential that could reach those secrets
 * is about to be deleted, and afterwards nothing on this site can scrub them.
 * Deleting a token is also a fair statement of intent — somebody is done with
 * that account — so doing it silently later would be the wrong shape anyway.
 *
 * The token still goes if the scrub fails. Refusing to remove a credential
 * because a *third party's* API would not answer traps somebody's own token in
 * their list with no way out; the caller is told what did not get scrubbed
 * instead, which is the only thing that helps at that point.
 */
export async function deleteHarnessToken(
  userId: string,
  id: string,
): Promise<DeleteResult> {
  const [row] = await db
    .select({ id: harnessTokens.id, secret: harnessTokens.secret })
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
  if (!row) return { deleted: false, scrub: null };

  const raw = openSecret(row.secret);
  let scrub: ScrubRun | null = null;
  if (raw !== null) {
    // Never allowed to stop the delete — see above.
    scrub = await scrubWithToken(id, raw).catch(() => null);
  }

  const deleted = await db
    .delete(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)))
    .returning({ id: harnessTokens.id });
  return { deleted: deleted.length > 0, scrub };
}

/**
 * Note that a deploy happened, so the row can say where its content went.
 *
 * Written when the deploy finishes rather than when the organization is created,
 * and written even if some entities inside it failed: the organization exists
 * either way, and the point of the record is that a re-run knows the name is one
 * this token already built. Overwrites any previous deploy — see
 * `deployedOrgName` in the schema for why this is one slot and not a history.
 *
 * Best-effort by design: `deployContent` calls it after every write it was asked
 * to make, so a failure here loses a note about work that did happen and must not
 * turn a finished deploy into an error.
 */
export async function recordHarnessDeploy(
  userId: string,
  id: string,
  org: { name: string; identifier: string },
): Promise<void> {
  await db
    .update(harnessTokens)
    .set({
      deployedOrgName: org.name,
      deployedOrgIdentifier: org.identifier,
      deployedAt: new Date(),
    })
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
}

/**
 * The usable secret for one of a user's tokens, for code that needs to call
 * Harness as them. Nothing in the UI calls this — it is the reason the tokens
 * are stored encrypted rather than hashed, and the seam the next feature uses.
 */
export async function harnessTokenSecret(
  userId: string,
  id: string,
): Promise<string | null> {
  const [row] = await db
    .select({ secret: harnessTokens.secret })
    .from(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)));
  return row ? openSecret(row.secret) : null;
}
