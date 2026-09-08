/** The signed-in user's saved view preferences. */

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

const DEFAULTS: UserPreferences = {
  themePreference: "system",
  calendarScope: "own",
};

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

export async function getThemePreference(): Promise<ThemePreference> {
  return (await getUserPreferences()).themePreference;
}
