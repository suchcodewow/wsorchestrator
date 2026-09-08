/** Personal access tokens: minting, listing and revoking them. */

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

const TOKEN_PREFIX = "wo";

const PREFIX_BYTES = 8;
const SECRET_BYTES = 32;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export type TokenSource = "manual" | "bundle";

export type MintedToken = {
  id: string;
  name: string;
  prefix: string;
  expiresAt: Date;
  token: string;
};

export type TokenError = "too_many" | "invalid_name";

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
  return result.ok ? result.token : null;
}

export type TokenBearer = { id: string; siteRole: SiteRole; email: string | null };

export async function resolveToken(
  presented: string,
): Promise<TokenBearer | null> {
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

  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .catch(() => {});

  return { id: row.userId, siteRole: row.siteRole, email: row.email };
}
