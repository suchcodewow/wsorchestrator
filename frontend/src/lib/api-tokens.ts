import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  apiTokens,
  users,
  DAY_SECONDS,
  MAX_TOKENS_PER_USER,
  TOKEN_TTL_DAYS,
  type SiteRole,
} from "@/db/schema";

/**
 * Personal access tokens for the contributor bundle's scripts.
 *
 * The shape is `wo_<prefix>_<secret>`: the prefix is stored in the clear and is
 * what a lookup indexes on, the secret is never stored at all. That split is
 * what lets verification be one indexed row read instead of hashing the
 * candidate against every live token, while still leaving nothing in the
 * database that could be replayed.
 */

/** Distinguishes these from anything else that might be pasted into the field. */
const TOKEN_PREFIX = "wo";

/** Bytes of randomness in each half. 8 is plenty for an identifier; 32 is the key. */
const PREFIX_BYTES = 8;
const SECRET_BYTES = 32;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** Where a token came from. See the `source` column in the schema. */
export type TokenSource = "manual" | "bundle";

/** A newly minted token: the only time the secret half exists outside a shell. */
export type MintedToken = {
  id: string;
  name: string;
  prefix: string;
  expiresAt: Date;
  /** The whole token. Shown once and then unrecoverable. */
  token: string;
};

export type TokenError = "too_many" | "invalid_name";

/**
 * Issue a token for a user.
 *
 * The cap counts only live *manual* tokens. An expired or revoked one is a
 * record rather than a credential, and holding five stale rows should not stop
 * somebody replacing the one they lost — and a bundle token is already limited
 * to one by `mintBundleToken` replacing it on every download, so counting it
 * here would just mean a download could lock somebody out of making a manual
 * one.
 */
export async function mintToken(
  userId: string,
  name: string,
  source: TokenSource = "manual",
): Promise<{ ok: true; token: MintedToken } | { ok: false; error: TokenError }> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: "invalid_name" };

  if (source === "manual") {
    const live = await listTokens(userId);
    const manual = live.filter(
      (t) => t.status === "active" && t.source === "manual",
    );
    if (manual.length >= MAX_TOKENS_PER_USER) {
      return { ok: false, error: "too_many" };
    }
  }

  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}_${prefix}_${secret}`;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * DAY_SECONDS * 1000);

  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: trimmed,
      prefix,
      tokenHash: sha256(token),
      expiresAt,
      source,
    })
    .returning({ id: apiTokens.id });

  return {
    ok: true,
    token: { id: row!.id, name: trimmed, prefix, expiresAt, token },
  };
}

/** A token as its owner sees it afterwards — everything except the secret. */
export type TokenSummary = {
  id: string;
  name: string;
  source: TokenSource;
  prefix: string;
  status: "active" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

export async function listTokens(userId: string): Promise<TokenSummary[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(asc(apiTokens.createdAt));

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source as TokenSource,
    prefix: r.prefix,
    status: r.revokedAt
      ? ("revoked" as const)
      : r.expiresAt.getTime() < now
        ? ("expired" as const)
        : ("active" as const),
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

/**
 * Revoke one of a user's own tokens. Scoped by `userId` in the same statement
 * as the id, so a token belonging to somebody else is simply not found rather
 * than checked and refused.
 */
export async function revokeToken(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });

  return revoked.length > 0;
}

/**
 * Mint the token that goes inside a bundle download, revoking whatever the
 * previous download issued.
 *
 * One live bundle token per account, always the one in the most recent
 * download. That is what lets the bundle carry its own credential without
 * accumulating one per download, and it means a bundle left on a laptop stops
 * working the next time somebody downloads a fresh one — the right default for
 * a secret that ships inside a file and ends up in a Downloads folder.
 *
 * Manual tokens are untouched: somebody running these from CI or a second
 * machine should not have it taken away because they re-downloaded.
 */
export async function mintBundleToken(
  userId: string,
): Promise<MintedToken | null> {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.userId, userId),
        eq(apiTokens.source, "bundle"),
        isNull(apiTokens.revokedAt),
      ),
    );

  const issued = new Date().toISOString().slice(0, 10);
  const result = await mintToken(userId, `Bundle download ${issued}`, "bundle");
  // The only failure `mintToken` reports is the cap and a blank name, and a
  // bundle token is exempt from one and given the other — so this is
  // unreachable rather than merely unlikely. Returning null keeps the download
  // route honest about it instead of asserting.
  return result.ok ? result.token : null;
}

/** Who a valid token belongs to, in the shape the routes already expect. */
export type TokenBearer = { id: string; siteRole: SiteRole; email: string | null };

/**
 * Resolve a presented token to its owner, or null.
 *
 * The hash comparison is constant-time. That is close to superstition given the
 * candidate has already been narrowed to one row by a prefix an attacker would
 * have to know — but it costs a line, and the alternative is reasoning about
 * whether a timing signal on a credential check matters, which is a worse use
 * of anyone's attention than just doing it.
 */
export async function resolveToken(
  presented: string,
): Promise<TokenBearer | null> {
  // Matched rather than split on "_": the secret half is base64url, whose
  // alphabet includes the underscore, so a naive three-way split rejects every
  // token whose random bytes happened to encode one. The prefix is hex and
  // cannot contain a separator, which is what makes this unambiguous.
  const match = new RegExp(`^${TOKEN_PREFIX}_([0-9a-f]{${PREFIX_BYTES * 2}})_(.+)$`).exec(
    presented,
  );
  if (!match) return null;
  const prefix = match[1]!;

  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      tokenHash: apiTokens.tokenHash,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      siteRole: users.siteRole,
      email: users.email,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.prefix, prefix));

  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;

  const expected = Buffer.from(row.tokenHash, "hex");
  const actual = Buffer.from(sha256(presented), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  // Best-effort: a token that worked must not fail because recording its use
  // did. The column exists to tell an owner which tokens are dead weight, and
  // an occasional missed write does not change that answer.
  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .catch(() => {});

  return { id: row.userId, siteRole: row.siteRole, email: row.email };
}
