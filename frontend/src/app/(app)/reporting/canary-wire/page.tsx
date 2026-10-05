/** Canary Wire: monthly Mindtickle completion by manager, for eVals administrators. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canaryWireView } from "@/lib/canary-wire/store";
import { canSeeCanaryWire } from "@/lib/roles";
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

  const { month } = await searchParams;
  const view = await canaryWireView(typeof month === "string" ? month : null);
  // A hand-typed month the picker doesn't offer opens the default one, as a bad sort does.
  if (!view) redirect("/reporting/canary-wire");
  return <CanaryWireReport view={view} />;
}
