/** Iris: an assessment type alongside eVals, open to eVals Viewers and above. A stub for now. */

import type { Metadata } from "next";
import { Eye } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canUseEvals } from "@/lib/roles";

export const metadata: Metadata = { title: "Iris" };

export default async function IrisPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseEvals(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-medium tracking-tight">Iris</h1>

      <div className="rounded-2xl border border-dashed p-10 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
          <Eye className="size-5" />
        </span>
        <p className="mt-4 text-sm font-medium">Nothing here yet</p>
      </div>
    </div>
  );
}
