import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { harnessBaseUrl } from "@/lib/harness-platform";
import { listHarnessTokens } from "@/lib/harness-tokens";
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
    />
  );
}
