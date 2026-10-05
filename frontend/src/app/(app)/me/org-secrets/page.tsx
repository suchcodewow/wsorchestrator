/** This account's own org secrets. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { OrgSecretsView } from "@/components/org-secrets-view";
import { listOrgSecrets } from "@/lib/harness-org-secrets";
import { ORG_SECRET_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { secretsConfigured } from "@/lib/secret-box";
import { canSeeMySettingsTab } from "../tabs";

export default async function MyOrgSecretsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeMySettingsTab(session.user.access, "/me/org-secrets")) notFound();

  const query = parseListQuery(await searchParams, ORG_SECRET_LIST);
  return (
    <OrgSecretsView
      mine
      query={query}
      page={await listOrgSecrets(session.user.id, query)}
      configured={secretsConfigured()}
    />
  );
}
