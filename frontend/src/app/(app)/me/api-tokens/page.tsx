/** Your personal access tokens, for calling the API from a script. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { ApiTokensCard } from "@/components/api-tokens-card";
import { TOKEN_TTL_DAYS } from "@/db/schema";
import { listTokens } from "@/lib/api-tokens";

export default async function MyApiTokensPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return (
    <ApiTokensCard
      tokens={await listTokens(session.user.id)}
      intro={
        <p className="text-sm text-muted-foreground">
          A token acts as you, with your roles, for {TOKEN_TTL_DAYS} days.
          Backups, the SQL console, user and invite changes, sign-in domains
          and tokens themselves still need the browser.
        </p>
      }
      usage={
        <>
          Then:{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            curl -H &quot;Authorization: Bearer $TOKEN&quot; /api/me
          </code>
        </>
      }
    />
  );
}
