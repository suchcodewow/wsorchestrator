/**
 * The ticket a sign-in popup hands to the frame that opened it, and the
 * session the frame trades it for. See `src/lib/frame-cookie.ts` for why.
 *
 * A ticket is good for one claim within a minute. Only its SHA-256 is kept,
 * in Auth.js's `verificationToken` table under a `frame-signin:` identifier;
 * nothing else uses that table, since there is no email sign-in.
 */

import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, like, lt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, verificationTokens } from "@/db/schema";
import { FRAME_SESSION_MAX_AGE } from "@/lib/frame-cookie";

export const FRAME_TICKET_SECONDS = 60;

const IDENTIFIER = "frame-signin:";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** A ticket for `userId`, to be claimed within a minute. */
export async function mintFrameTicket(userId: string): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await db
    .delete(verificationTokens)
    .where(and(like(verificationTokens.identifier, `${IDENTIFIER}%`), lt(verificationTokens.expires, new Date())));
  await db.insert(verificationTokens).values({
    identifier: `${IDENTIFIER}${userId}`,
    token: sha256(ticket),
    expires: new Date(Date.now() + FRAME_TICKET_SECONDS * 1000),
  });
  return ticket;
}

export type FrameSession = {
  sessionToken: string;
  user: { id: string; email: string | null; name: string | null };
};

/**
 * Uses up `ticket` and starts a session for its user, or null if the ticket
 * is unknown, already used, or past its minute.
 */
export async function claimFrameTicket(ticket: string): Promise<FrameSession | null> {
  const [used] = await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.token, sha256(ticket)),
        like(verificationTokens.identifier, `${IDENTIFIER}%`),
        gt(verificationTokens.expires, new Date()),
      ),
    )
    .returning({ identifier: verificationTokens.identifier });
  if (!used) return null;

  const userId = used.identifier.slice(IDENTIFIER.length);
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  const sessionToken = randomUUID();
  await db.insert(sessions).values({
    sessionToken,
    userId,
    expires: new Date(Date.now() + FRAME_SESSION_MAX_AGE * 1000),
  });
  return { sessionToken, user };
}
