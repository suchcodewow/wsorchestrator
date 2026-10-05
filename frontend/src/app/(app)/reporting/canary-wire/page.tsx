/** Canary Wire: a Reporting tab, open to eVals Viewers and above. A stub for now. */

import type { Metadata } from "next";
import { Radio } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseEvals } from "@/lib/roles";

export const metadata: Metadata = { title: "Canary Wire" };

export default async function CanaryWirePage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvals(session.user.access)) notFound();

  return (
    <div className="rounded-2xl border border-dashed p-10 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
        <Radio className="size-5" />
      </span>
      <p className="mt-4 text-sm font-medium">Nothing here yet</p>
    </div>
  );
}
