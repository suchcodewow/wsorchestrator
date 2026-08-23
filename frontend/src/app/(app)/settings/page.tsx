import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { envAllowedDomains, listAllowedDomains } from "@/lib/allowed-domains";
import { canManageSettings } from "@/lib/roles";
import { isBootstrapAdmin } from "@/lib/site-admins";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // Not a redirect: for anyone below administrator this page simply isn't
  // there, and saying "forbidden" would only advertise it.
  if (!canManageSettings(session.user.siteRole)) notFound();

  const domains = await listAllowedDomains();

  return (
    <SettingsView
      domains={domains.map((d) => ({
        ...d,
        // Serialized for the client component; the table only ever formats it.
        createdAt: d.createdAt.toISOString(),
      }))}
      envDomains={envAllowedDomains()}
      viewerEmail={session.user.email ?? ""}
      // Whether this administrator is exempt from the list they are editing.
      // The page says so rather than letting the "you'd lock yourself out"
      // guard look inconsistent when it declines to fire for them.
      viewerExempt={isBootstrapAdmin(session.user.email)}
    />
  );
}
