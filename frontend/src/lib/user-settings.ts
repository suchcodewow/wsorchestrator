"use server";

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

/**
 * Persist the user's colour scheme choice. The menu applies the theme to the
 * DOM itself, so this deliberately does not revalidate — re-rendering the page
 * would be a visible cost for a change the user can already see.
 */
export async function setThemePreference(
  preference: ThemePreference,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  // The value crosses a network boundary, so it is re-checked here rather than
  // trusted from the client's type signature.
  if (!THEME_PREFERENCES.includes(preference)) return;

  await db
    .update(users)
    .set({ themePreference: preference })
    .where(eq(users.id, session.user.id));
}

/**
 * Persist whose events the calendar shows.
 *
 * Unlike the theme, this one *does* revalidate: the change is a different set
 * of rows, which only the server can fetch. `/events` is the only page that
 * reads it, so that is all that is thrown away.
 *
 * Refused for anyone below manager — the menu doesn't offer it to them, and
 * this is the check that makes that stick.
 */
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
