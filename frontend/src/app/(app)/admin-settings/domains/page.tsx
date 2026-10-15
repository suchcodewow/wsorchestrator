/** The Sign-in Domains tab: who may sign in. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { envAllowedDomains, listAllowedDomains } from "@/lib/allowed-domains";
import { DOMAIN_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageSignInDomains } from "@/lib/roles";
import { isBootstrapAdmin } from "@/lib/site-admins";
import { DomainsView } from "./domains-view";

export default async function SignInDomainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageSignInDomains(session.user.access)) notFound();

  const query = parseListQuery(await searchParams, DOMAIN_LIST);
  const page = await listAllowedDomains(query);

  return (
    <DomainsView
      query={query}
      page={{ ...page, rows: page.rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })) }}
      envDomains={envAllowedDomains()}
      viewerEmail={session.user.email ?? ""}
      viewerExempt={isBootstrapAdmin(session.user.email)}
    />
  );
}
