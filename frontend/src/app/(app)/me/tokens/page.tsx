/** The Harness tokens page. */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { deployChoices } from "@/lib/harness-deploy-choices";
import { harnessBaseUrl } from "@/lib/harness-platform";
import { scrubWindowDays } from "@/lib/harness-scrub";
import { listHarnessTokens } from "@/lib/harness-tokens";
import { canManageSettings } from "@/lib/roles";
import { secretsConfigured } from "@/lib/secret-box";
import { HarnessTokensView } from "./harness-tokens-view";

export default async function MyTokensPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <HarnessTokensView
      tokens={await listHarnessTokens(session.user.id)}
      choices={await deployChoices(session.user.id)}
      baseUrl={harnessBaseUrl()}
      configured={secretsConfigured()}
      canDeploy={canManageSettings(session.user.siteRole)}
      scrubDays={scrubWindowDays()}
    />
  );
}
