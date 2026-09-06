import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { envAllowedDomains, listAllowedDomains } from "@/lib/allowed-domains";
import { isBootstrapAdmin } from "@/lib/site-admins";
import { DomainsView } from "./domains-view";

/**
 * Which email domains may sign in.
 *
 * The administrator check is the section's layout — see `settings/layout.tsx`.
 * The session is read again here for the viewer's own address, which the copy
 * below the table needs.
 */
export default async function SignInDomainsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const domains = await listAllowedDomains();

  return (
    <DomainsView
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
