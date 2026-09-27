/** The sign-in domains page. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { envAllowedDomains, listAllowedDomains } from "@/lib/allowed-domains";
import { canManageSignInDomains } from "@/lib/roles";
import { isBootstrapAdmin } from "@/lib/site-admins";
import { DomainsView } from "./domains-view";

export default async function SignInDomainsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageSignInDomains(session.user.access)) notFound();

  const domains = await listAllowedDomains();

  return (
    <DomainsView
      domains={domains.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      }))}
      envDomains={envAllowedDomains()}
      viewerEmail={session.user.email ?? ""}
      viewerExempt={isBootstrapAdmin(session.user.email)}
    />
  );
}
