/**
 * The layout for Mimir: the reference library and its coach, open to everyone
 * signed in. Progress is each person's own and kept between visits, so the
 * header offers to carry on from the item they last opened, or to start over.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { resumePoint } from "@/lib/mimir/progress";
import { canUseMimir } from "@/lib/roles";
import { MimirHeaderActions } from "./header-actions";
import { MimirTabs } from "./mimir-tabs";

export const metadata: Metadata = { title: "Mimir" };

export default async function MimirLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canUseMimir(session.user.access)) notFound();

  const resume = await resumePoint(session.user.id);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-medium tracking-tight">Mimir</h1>
        <MimirHeaderActions resume={resume} />
      </div>
      <MimirTabs />
      {children}
    </div>
  );
}
