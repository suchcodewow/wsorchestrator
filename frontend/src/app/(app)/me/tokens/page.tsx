import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { harnessBaseUrl } from "@/lib/harness-platform";
import { scrubWindowDays } from "@/lib/harness-scrub";
import { listHarnessTokens } from "@/lib/harness-tokens";
import { canManageSettings } from "@/lib/roles";
import { secretsConfigured } from "@/lib/secret-box";
import { HarnessTokensView } from "./harness-tokens-view";

export default async function MyTokensPage() {
  const session = await auth();
  // The `(app)` layout already redirects a signed-out visitor; this is for the
  // user id, and the guard is what makes that non-optional rather than asserted.
  if (!session?.user) redirect("/signin");

  return (
    <HarnessTokensView
      tokens={await listHarnessTokens(session.user.id)}
      // Which Harness these tokens are checked against. Shown rather than
      // assumed: a token for another cluster fails validation, and the page
      // should have already said which one it was going to try.
      baseUrl={harnessBaseUrl()}
      // A deployment with no key can't store a token at all. Better to say so
      // above an inert form than to let a paste earn a 503.
      configured={secretsConfigured()}
      // Whether to offer "Deploy content" at all. A deploy reads every org
      // secret and every template source, so it belongs to the role that
      // already administers those pages — the Harness permission on the token
      // is the second half of the gate, not the whole of it.
      canDeploy={canManageSettings(session.user.siteRole)}
      // How long a deploy's real credentials live in the other account. Env
      // configured, so the prompt has to be told rather than assume a week —
      // and it says it up front, because the whole arrangement only works if
      // whoever deploys knows the values are temporary.
      scrubDays={scrubWindowDays()}
    />
  );
}
