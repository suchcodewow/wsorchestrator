/** The Harness tokens page. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { deployChoices } from "@/lib/harness-deploy-choices";
import { scrubWindowDays } from "@/lib/harness-scrub";
import { listHarnessTokens } from "@/lib/harness-tokens";
import { canManageSettings } from "@/lib/roles";
import { secretsConfigured } from "@/lib/secret-box";
import { HarnessTokensView } from "./harness-tokens-view";
import { canSeeMySettingsTab } from "../tabs";

export default async function MyTokensPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeMySettingsTab(session.user.access, "/me/tokens")) notFound();

  const [tokens, choices] = await Promise.all([
    listHarnessTokens(session.user.id),
    deployChoices(session.user.id),
  ]);

  return (
    <HarnessTokensView
      tokens={tokens}
      choices={choices}
      configured={secretsConfigured()}
      canDeploy={canManageSettings(session.user.access)}
      scrubDays={scrubWindowDays()}
    />
  );
}
