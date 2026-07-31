import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  users,
  type CalendarScope,
  type ThemePreference,
} from "@/db/schema";

export type UserPreferences = {
  themePreference: ThemePreference;
  calendarScope: CalendarScope;
};

/** What a signed-out visitor — or a session whose row is gone — gets. */
const DEFAULTS: UserPreferences = {
  themePreference: "system",
  calendarScope: "own",
};

/**
 * The signed-in user's saved view preferences.
 *
 * Deliberately not a server action: these are reads, and putting them in the
 * "use server" module alongside the setters would publish them as callable
 * endpoints for no reason.
 *
 * `cache` dedupes within a single request — the root layout wants the theme
 * for its inlined script, the header wants both to seed the menu, and the
 * events page wants the scope. That should be one query, not three.
 */
export const getUserPreferences = cache(
  async (): Promise<UserPreferences> => {
    const session = await auth();
    if (!session?.user?.id) return DEFAULTS;

    const row = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { themePreference: true, calendarScope: true },
    });
    return row ?? DEFAULTS;
  },
);

/**
 * Colour scheme only. `system` follows the OS setting and can only be resolved
 * in the browser, so it is returned as-is for the inlined theme script to
 * settle.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  return (await getUserPreferences()).themePreference;
}
