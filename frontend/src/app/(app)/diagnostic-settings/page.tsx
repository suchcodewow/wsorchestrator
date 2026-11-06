/** Sends /diagnostic-settings to its first tab. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageIris } from "@/lib/roles";

export default async function DiagnosticSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  redirect("/diagnostic-settings/participants");
}
