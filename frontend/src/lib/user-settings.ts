"use server";

/** Saves the signed-in user's preferences. */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import type { CalendarScope, ThemePreference } from "@/db/schema";
import { recordAudit, requestIp } from "@/lib/audit";
import { savePreferences } from "@/lib/user-preferences";

type Saved = Awaited<ReturnType<typeof savePreferences>>;

/** A server action is not a route, so `audited` never sees it; it records itself. */
async function recordPreference(
  user: { id: string; email?: string | null; name?: string | null },
  summary: string,
  detail: Record<string, unknown>,
  result: Saved,
): Promise<void> {
  await recordAudit({
    actor: { id: user.id, email: user.email ?? null, name: user.name ?? null },
    via: "session",
    action: "preferences.save",
    summary,
    target: user.id,
    outcome: result.ok ? "succeeded" : "failed",
    detail: { body: detail },
    ip: await requestIp(),
  });
}

export async function setThemePreference(
  preference: ThemePreference,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  // The theme is whoever is at the screen's, even while viewing as someone else.
  const user = session.impersonator
    ? { ...session.impersonator, access: session.user.access }
    : session.user;
  const result = await savePreferences(user, { themePreference: preference });
  await recordPreference(user, "Set their theme.", { themePreference: preference }, result);
}

export async function setCalendarScope(scope: CalendarScope): Promise<void> {
  const session = await auth();
  // Viewing as someone else changes nothing of theirs.
  if (!session?.user?.id || session.impersonator) return;

  const result = await savePreferences(session.user, { calendarScope: scope });
  await recordPreference(session.user, "Set which events their calendar shows.", { calendarScope: scope }, result);
  if (result.ok) revalidatePath("/events");
}
