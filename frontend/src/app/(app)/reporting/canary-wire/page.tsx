/** Canary Wire: monthly Mindtickle completion by manager, for people managers and platform administrators. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { mindtickleConfig } from "@/lib/canary-wire/mindtickle";
import { latestPull } from "@/lib/canary-wire/pull";
import { repTrends } from "@/lib/canary-wire/history";
import { canaryWireHistory, canaryWireView } from "@/lib/canary-wire/store";
import { scopeFor } from "@/lib/canary-wire/scope";
import { canRefreshCanaryWire, canSeeCanaryWire } from "@/lib/roles";
import { CanaryWireReport } from "./canary-wire-report";

export const metadata: Metadata = { title: "Canary Wire" };

export default async function CanaryWirePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeCanaryWire(session.user.access)) notFound();

  const { month, scope } = await searchParams;
  const { access } = session.user;
  const whose = scopeFor({ access, email: session.user.email ?? null }, typeof scope === "string" ? scope : null);
  // A hand-typed month or scope that doesn't apply opens the default, as a bad sort does.
  if (!whose.ok) redirect("/reporting/canary-wire");
  // The history is always the last six months to now, whichever month is
  // picked, so a rep's dots don't change as the month does.
  const [view, history, pull] = await Promise.all([
    canaryWireView(typeof month === "string" ? month : null, whose.scope),
    canaryWireHistory(whose.scope),
    latestPull(),
  ]);
  if (!view) redirect("/reporting/canary-wire");
  return (
    <CanaryWireReport
      view={view}
      trends={repTrends(history)}
      pull={pull}
      configured={mindtickleConfig() !== null}
      canSwitchScope={access.manager}
      canRefresh={canRefreshCanaryWire(access)}
    />
  );
}
