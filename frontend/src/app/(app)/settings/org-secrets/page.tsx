/** The org secrets page. */

import { OrgSecretsView } from "@/components/org-secrets-view";
import { listOrgSecrets } from "@/lib/harness-org-secrets";
import { secretsConfigured } from "@/lib/secret-box";

export default async function OrgSecretsPage() {
  return (
    <OrgSecretsView
      secrets={await listOrgSecrets(null)}
      configured={secretsConfigured()}
    />
  );
}
