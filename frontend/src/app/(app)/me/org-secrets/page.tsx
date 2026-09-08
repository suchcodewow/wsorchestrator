/** This account's own org secrets. */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OrgSecretsView } from "@/components/org-secrets-view";
import { listOrgSecrets } from "@/lib/harness-org-secrets";
import { secretsConfigured } from "@/lib/secret-box";

export default async function MyOrgSecretsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <OrgSecretsView
      mine
      secrets={await listOrgSecrets(session.user.id)}
      configured={secretsConfigured()}
    />
  );
}
