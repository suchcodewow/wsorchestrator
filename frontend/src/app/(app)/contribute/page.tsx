/** The contributor page. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { listTokens } from "@/lib/api-tokens";
import { listComponentSets, listBaseline } from "@/lib/components/catalog";
import { referenceMap } from "@/lib/components/graph";
import { canPublishComponents, canUseEvents } from "@/lib/roles";
import { ContributeView } from "./contribute-view";

export default async function ContributePage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvents(session.user.access)) notFound();

  const canReview = canPublishComponents(session.user.access);
  const [tokens, sets, baseline] = await Promise.all([
    listTokens(session.user.id),
    listComponentSets(),
    listBaseline(),
  ]);

  const { dependsOn, usedBy } = referenceMap(baseline);

  return (
    <ContributeView
      tokens={tokens}
      catalog={baseline.map((c) => ({
        identifier: c.identifier,
        kind: c.kind,
        name: c.name,
        description: c.description,
        versionLabel: c.versionLabel,
        builtin: c.builtin,
        requires: c.requires,
        dependsOn: dependsOn.get(c.identifier) ?? [],
        usedBy: usedBy.get(c.identifier) ?? [],
      }))}
      sets={(canReview ? sets : sets.filter((s) => s.authorId === session.user.id)).map(
        (s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }),
      )}
      canReview={canReview}
      mine={session.user.id}
    />
  );
}
