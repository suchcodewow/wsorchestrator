/** Your personal access tokens, for calling the API from a script. */

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { ApiTokensCard } from "@/components/api-tokens-card";
import { listTokens } from "@/lib/api-tokens";

export default async function MyApiTokensPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  return (
    <ApiTokensCard
      tokens={await listTokens(session.user.id)}
      intro={
        <p className="text-sm text-muted-foreground">
          A token acts as you, with your roles, until you revoke it or your
          account is deleted. Backups, user and invite changes, sign-in domains and tokens
          themselves still need the browser. Every endpoint is in the{" "}
          <Link href="/api" className="text-brand hover:underline">
            API reference
          </Link>
          .
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
