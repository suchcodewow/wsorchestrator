import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, type ThemePreference } from "@/db/schema";

/**
 * The signed-in user's colour scheme.
 *
 * Deliberately not a server action: it is a read, and putting it in the
 * "use server" module alongside the setter would publish it as a callable
 * endpoint for no reason.
 *
 * `cache` dedupes it within a single request — both the root layout (for the
 * inlined theme script) and the app layout (to seed the menu) ask for it, and
 * that should be one query, not two.
 *
 * Falls back to `system` for signed-out visitors — the sign-in page renders
 * through the same root layout — and for a session whose user row has since
 * been deleted. That is the same default a new account gets.
 */
export const getThemePreference = cache(
  async (): Promise<ThemePreference> => {
    const session = await auth();
    if (!session?.user?.id) return "system";

    const row = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { themePreference: true },
    });
    return row?.themePreference ?? "system";
  },
);
