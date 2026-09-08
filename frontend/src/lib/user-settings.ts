"use server";

/** Saves the signed-in user's preferences. */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  CALENDAR_SCOPES,
  THEME_PREFERENCES,
  users,
  type CalendarScope,
  type ThemePreference,
} from "@/db/schema";
import { canSeeAllEvents } from "@/lib/roles";

export async function setThemePreference(
  preference: ThemePreference,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  if (!THEME_PREFERENCES.includes(preference)) return;

  await db
    .update(users)
    .set({ themePreference: preference })
    .where(eq(users.id, session.user.id));
}

export async function setCalendarScope(scope: CalendarScope): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  if (!canSeeAllEvents(session.user.siteRole)) return;
  if (!CALENDAR_SCOPES.includes(scope)) return;

  await db
    .update(users)
    .set({ calendarScope: scope })
    .where(eq(users.id, session.user.id));

  revalidatePath("/events");
}
