"use server";

import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { THEME_PREFERENCES, users, type ThemePreference } from "@/db/schema";

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
