/** eVals. A placeholder until its functions are specified. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { ComingSoon } from "@/components/coming-soon";
import { canUseEvals } from "@/lib/roles";

export const metadata: Metadata = { title: "eVals" };

export default async function EvalsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvals(session.user.access)) notFound();

  return (
    <ComingSoon title="eVals" Icon={FlaskConical} />
  );
}
