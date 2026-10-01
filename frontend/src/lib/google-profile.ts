/** Keeping a user's name and photo in step with their Google account. */

import { eq } from "drizzle-orm";
import type { Profile } from "next-auth";
import { db } from "@/db";
import { users } from "@/db/schema";

const PEOPLE_ME_PHOTOS = "https://people.googleapis.com/v1/people/me?personFields=photos";

type PeoplePhoto = { url?: string; default?: boolean; metadata?: { primary?: boolean } };

/**
 * Whether the People API's answer says the account's photo is one its owner
 * chose, as opposed to the lettered circle Google makes for an account without
 * one. `null` when the answer does not say.
 */
export function photoIsChosen(body: unknown): boolean | null {
  const photos = (body as { photos?: PeoplePhoto[] } | null)?.photos;
  if (!Array.isArray(photos) || photos.length === 0) return null;

  const photo = photos.find((p) => p.metadata?.primary) ?? photos[0]!;
  return typeof photo.default === "boolean" ? !photo.default : null;
}

/**
 * Asks Google whether the signed-in account has chosen a photo. The ID token's
 * `picture` cannot tell: an account with no photo still gets one, a generated
 * initial. `null` whenever the People API cannot answer — it is off in the
 * project, the token lacks the scope, or the call is slow — so a sign-in never
 * waits on, or fails because of, a nicety.
 */
export async function googlePhotoChosen(accessToken: string | undefined): Promise<boolean | null> {
  if (!accessToken) return null;

  try {
    const res = await fetch(PEOPLE_ME_PHOTOS, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`People API photo check: HTTP ${res.status}; using the ID token's picture`);
      return null;
    }
    return photoIsChosen(await res.json());
  } catch (err) {
    console.warn(`People API photo check failed: ${(err as Error).message}; using the ID token's picture`);
    return null;
  }
}

/**
 * Copies the Google account's current name and picture onto the user, on every
 * sign-in. Auth.js writes them only when the account is first created, so
 * without this a renamed account or a new photo never shows up here.
 *
 * A name Google leaves out is kept rather than blanked. A picture it leaves out,
 * or one `photoChosen` says is Google's generated default, clears the stored
 * one, so the nav falls back to its own initial.
 */
export async function syncGoogleProfile(
  userId: string | undefined,
  profile: Pick<Profile, "name" | "picture"> | undefined,
  photoChosen: boolean | null = null,
): Promise<void> {
  if (!userId || !profile) return;

  const picture = typeof profile.picture === "string" ? profile.picture.trim() : "";
  const image = photoChosen === false ? null : picture || null;
  const changes: { name?: string; image: string | null } = { image };
  if (profile.name?.trim()) changes.name = profile.name.trim();

  await db.update(users).set(changes).where(eq(users.id, userId));
}
