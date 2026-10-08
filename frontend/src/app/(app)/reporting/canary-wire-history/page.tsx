/** Canary Wire History: each rep's completion month over month, for people managers and platform administrators. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { scopeFor } from "@/lib/canary-wire/scope";
import { canaryWireHistory } from "@/lib/canary-wire/store";
import { canSeeCanaryWire } from "@/lib/roles";
import { HistoryReport } from "./history-report";

export const metadata: Metadata = { title: "Canary Wire History" };

export default async function CanaryWireHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canSeeCanaryWire(session.user.access)) notFound();

  const { scope } = await searchParams;
  const { access } = session.user;
  const whose = scopeFor({ access, email: session.user.email ?? null }, typeof scope === "string" ? scope : null);
  // A hand-typed scope that doesn't apply opens the default, as a bad sort does.
  if (!whose.ok) redirect("/reporting/canary-wire-history");
  return <HistoryReport history={await canaryWireHistory(whose.scope)} canSwitchScope={access.manager} />;
}
