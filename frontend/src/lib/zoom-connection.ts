/**
 * The Zoom user Google Meetings schedules its Zoom meetings as: who it is,
 * and the tokens the sync acts with. Zoom rotates the refresh token every time
 * it is used, so a refresh is made under a row lock and the new tokens saved
 * before anyone else can try the old one; a sync and a cancel running together
 * share the access token it leaves behind.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, ZOOM_CONNECTION_KEY, zoomConnections } from "@/db/schema";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { refreshTokens, zoomApp, zoomClient, ZoomError, type ZoomClient, type ZoomTokens } from "@/lib/zoom";

const z = zoomConnections;

/** A token this close to expiring is renewed rather than risked on a long sync. */
const EXPIRY_MARGIN_MS = 2 * 60_000;

export type ZoomConnectionStatus = { email: string; connectedAt: Date; connectedBy: string | null };

/** The connection as the page and the API show it: never a token. */
export async function zoomConnectionStatus(): Promise<ZoomConnectionStatus | null> {
  const [row] = await db
    .select({ email: z.email, connectedAt: z.connectedAt, connectedByName: users.name, connectedByEmail: users.email })
    .from(z)
    .leftJoin(users, eq(users.id, z.connectedBy))
    .where(eq(z.key, ZOOM_CONNECTION_KEY));
  if (!row) return null;
  return { email: row.email, connectedAt: row.connectedAt, connectedBy: row.connectedByName ?? row.connectedByEmail };
}

/** Stores the user the consent screen returned, replacing any earlier one. */
export async function saveZoomConnection(
  actorId: string,
  account: { email: string; tokens: ZoomTokens },
): Promise<{ replaced: boolean; previous: string | null }> {
  const [current] = await db.select({ email: z.email }).from(z).where(eq(z.key, ZOOM_CONNECTION_KEY));
  const values = {
    email: account.email,
    refreshToken: sealSecret(account.tokens.refreshToken),
    accessToken: sealSecret(account.tokens.accessToken),
    accessTokenExpiresAt: account.tokens.expiresAt,
    scope: account.tokens.scope,
    connectedBy: actorId,
  };
  await db
    .insert(z)
    .values({ key: ZOOM_CONNECTION_KEY, ...values })
    .onConflictDoUpdate({ target: z.key, set: { ...values, connectedAt: new Date() } });
  return { replaced: current !== undefined, previous: current?.email ?? null };
}

/** A usable access token for the connected user, refreshing it first when it is spent or about to be. */
async function connectedAccessToken(): Promise<string> {
  const app = zoomApp();
  if (!app) throw new ZoomError(0, null, "ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET are not set.");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(z).where(eq(z.key, ZOOM_CONNECTION_KEY)).for("update");
    if (!row) throw new ZoomError(0, null, "No Zoom user is connected.");

    if (row.accessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
      const open = openSecret(row.accessToken);
      if (open) return open;
    }
    const refreshToken = openSecret(row.refreshToken);
    if (!refreshToken) throw new ZoomError(0, null, "The stored Zoom token cannot be opened. Connect the Zoom user again.");
    try {
      const tokens = await refreshTokens(app, refreshToken);
      await tx
        .update(z)
        .set({
          refreshToken: sealSecret(tokens.refreshToken),
          accessToken: sealSecret(tokens.accessToken),
          accessTokenExpiresAt: tokens.expiresAt,
        })
        .where(eq(z.key, ZOOM_CONNECTION_KEY));
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof ZoomError && err.revoked) {
        throw new ZoomError(err.status, null, `Zoom no longer accepts ${row.email}'s token. Connect the Zoom user again.`, err.reason);
      }
      throw err;
    }
  });
}

/** A client acting as the connected Zoom user, or null where there is no app or no user connected. */
export async function connectedZoom(): Promise<{ client: ZoomClient; email: string } | null> {
  if (!zoomApp()) return null;
  const [row] = await db.select({ email: z.email }).from(z).where(eq(z.key, ZOOM_CONNECTION_KEY));
  return row ? { client: zoomClient(connectedAccessToken), email: row.email } : null;
}
