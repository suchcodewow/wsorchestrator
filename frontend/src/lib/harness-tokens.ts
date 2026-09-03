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
  type CheckError,
} from "@/lib/harness-platform";
import { openSecret, sealSecret } from "@/lib/secret-box";

/**
 * A user's saved Harness platform tokens.
 *
 * Every function here is scoped by `userId` inside the same statement as the id,
 * so somebody else's token is simply not found rather than found and refused.
 * These are other people's credentials for another system; the narrowest
 * possible access path is worth the small repetition.
 */

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
};

const summarize = (row: HarnessToken): HarnessTokenSummary => ({
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
});

export async function listHarnessTokens(
  userId: string,
): Promise<HarnessTokenSummary[]> {
  const rows = await db
    .select()
    .from(harnessTokens)
    .where(eq(harnessTokens.userId, userId))
    .orderBy(asc(harnessTokens.createdAt));
  return rows.map(summarize);
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

/** Forget a token. Deleted outright — there is nothing to keep a record of. */
export async function deleteHarnessToken(
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(harnessTokens)
    .where(and(eq(harnessTokens.id, id), eq(harnessTokens.userId, userId)))
    .returning({ id: harnessTokens.id });
  return deleted.length > 0;
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
