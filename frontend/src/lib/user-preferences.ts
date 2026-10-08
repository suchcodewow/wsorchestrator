/** The signed-in user's saved view preferences. */

import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  CALENDAR_SCOPES,
  THEME_PREFERENCES,
  users,
  type CalendarScope,
  type ThemePreference,
} from "@/db/schema";
import { canSeeAllEvents, type Access } from "@/lib/roles";

export type UserPreferences = {
  themePreference: ThemePreference;
  calendarScope: CalendarScope;
};

const DEFAULTS: UserPreferences = {
  themePreference: "system",
  calendarScope: "own",
};

export const getUserPreferences = cache(
  async (): Promise<UserPreferences> => {
    const session = await auth();
    if (!session?.user?.id) return DEFAULTS;
    const shown = await preferencesOf(session.user.id);
    if (!session.impersonator) return shown;

    // Viewing as someone else shows their calendar, in your own theme.
    const own = await preferencesOf(session.impersonator.id);
    return { ...shown, themePreference: own.themePreference };
  },
);

export async function preferencesOf(userId: string): Promise<UserPreferences> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { themePreference: true, calendarScope: true },
  });
  return row ?? DEFAULTS;
}

export type PreferencesError = "invalid" | "forbidden";

/** Saves whichever preferences are given; the calendar scope needs the role. */
export async function savePreferences(
  user: { id: string; access: Access },
  patch: { themePreference?: unknown; calendarScope?: unknown },
): Promise<{ ok: true } | { ok: false; error: PreferencesError }> {
  const set: Partial<UserPreferences> = {};

  if (patch.themePreference !== undefined) {
    if (!THEME_PREFERENCES.includes(patch.themePreference as ThemePreference)) {
      return { ok: false, error: "invalid" };
    }
    set.themePreference = patch.themePreference as ThemePreference;
  }

  if (patch.calendarScope !== undefined) {
    if (!CALENDAR_SCOPES.includes(patch.calendarScope as CalendarScope)) {
      return { ok: false, error: "invalid" };
    }
    if (!canSeeAllEvents(user.access)) return { ok: false, error: "forbidden" };
    set.calendarScope = patch.calendarScope as CalendarScope;
  }

  if (Object.keys(set).length > 0) {
    await db.update(users).set(set).where(eq(users.id, user.id));
  }
  return { ok: true };
}

export async function getThemePreference(): Promise<ThemePreference> {
  return (await getUserPreferences()).themePreference;
}
