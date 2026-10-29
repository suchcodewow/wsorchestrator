/** The Allowed Domains tab: who may sign in, and which sites may frame the app. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { envAllowedDomains, listAllowedDomains } from "@/lib/allowed-domains";
import { listFrameDomains } from "@/lib/frame-domains";
import { DOMAIN_LIST, FRAME_DOMAIN_LIST, FRAME_DOMAIN_PREFIX } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageSignInDomains } from "@/lib/roles";
import { DomainsView } from "./domains-view";

export default async function AllowedDomainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageSignInDomains(session.user.access)) notFound();

  const params = await searchParams;
  const query = parseListQuery(params, DOMAIN_LIST);
  const frameQuery = parseListQuery(params, FRAME_DOMAIN_LIST, FRAME_DOMAIN_PREFIX);
  const [page, framePage] = await Promise.all([listAllowedDomains(query), listFrameDomains(frameQuery)]);
  const serialize = <T extends { createdAt: Date }>(p: { rows: T[] }) => p.rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));

  return (
    <DomainsView
      query={query}
      page={{ ...page, rows: serialize(page) }}
      envDomains={envAllowedDomains()}
      viewerEmail={session.user.email ?? ""}
      frameQuery={frameQuery}
      framePage={{ ...framePage, rows: serialize(framePage) }}
    />
  );
}
