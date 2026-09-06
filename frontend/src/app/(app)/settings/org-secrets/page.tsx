import { listOrgSecrets } from "@/lib/harness-org-secrets";
import { secretsConfigured } from "@/lib/secret-box";
import { OrgSecretsView } from "./org-secrets-view";

/**
 * The secrets every workshop's Harness organization is given.
 *
 * The administrator check is the section's layout — see `settings/layout.tsx`.
 * Values are never sent to the browser: `listOrgSecrets` returns a length and a
 * kind, which is enough to tell "I pasted the key" from "I pasted its filename".
 */
export default async function OrgSecretsPage() {
  return (
    <OrgSecretsView
      secrets={await listOrgSecrets()}
      // Whether an encryption key exists at all. Without one nothing can be
      // stored, and the form says so instead of failing on save.
      configured={secretsConfigured()}
    />
  );
}
