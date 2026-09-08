/** The org secrets page. */

import { listOrgSecrets } from "@/lib/harness-org-secrets";
import { secretsConfigured } from "@/lib/secret-box";
import { OrgSecretsView } from "./org-secrets-view";

export default async function OrgSecretsPage() {
  return (
    <OrgSecretsView
      secrets={await listOrgSecrets()}
      configured={secretsConfigured()}
    />
  );
}
