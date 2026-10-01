"use server";

/** Saves the signed-in user's preferences. */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import type { CalendarScope, ThemePreference } from "@/db/schema";
import { savePreferences } from "@/lib/user-preferences";

export async function setThemePreference(
  preference: ThemePreference,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  await savePreferences(session.user, { themePreference: preference });
}

export async function setCalendarScope(scope: CalendarScope): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const result = await savePreferences(session.user, { calendarScope: scope });
  if (result.ok) revalidatePath("/events");
}
