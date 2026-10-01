/** The org secrets page. */

import { OrgSecretsView } from "@/components/org-secrets-view";
import { listOrgSecrets } from "@/lib/harness-org-secrets";
import { ORG_SECRET_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { secretsConfigured } from "@/lib/secret-box";

export default async function OrgSecretsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, ORG_SECRET_LIST);
  return (
    <OrgSecretsView
      query={query}
      page={await listOrgSecrets(null, query)}
      configured={secretsConfigured()}
    />
  );
}
