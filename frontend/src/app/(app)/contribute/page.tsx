import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listTokens } from "@/lib/api-tokens";
import { listComponentSets, listBaseline } from "@/lib/components/catalog";
import { referenceMap } from "@/lib/components/graph";
import { canPublishComponents } from "@/lib/roles";
import { ContributeView } from "./contribute-view";

/**
 * Where somebody picks up the contributor bundle, holds the token it needs, and
 * watches what they have proposed.
 *
 * Open to every signed-in account. Contributing components is the floor
 * permission rather than a privilege — what a contribution can actually reach
 * is decided at review, not here, and gating the page would only mean fewer
 * people able to offer work that a manager has to approve anyway.
 */
export default async function ContributePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const canReview = canPublishComponents(session.user.siteRole);
  const [tokens, sets, baseline] = await Promise.all([
    listTokens(session.user.id),
    listComponentSets(),
    listBaseline(),
  ]);

  // Worked out here rather than in the browser: it is the same answer for
  // everyone looking at the page, and the rules for it belong next to the
  // catalog rather than in a component that renders it.
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
      // A manager sees everyone's, because reviewing is the point; everybody
      // else sees their own. The API applies the same rule — this is what the
      // page draws, not what enforces it.
      sets={(canReview ? sets : sets.filter((s) => s.authorId === session.user.id)).map(
        (s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }),
      )}
      canReview={canReview}
      mine={session.user.id}
    />
  );
}
