/**
 * The previous Mimir, kept for reference: its reference library, glossary and
 * progress, read-only, for Training Administrators. Nothing here writes
 * anything: no coach, no visits, no start-over. The live Mimir is at /mimir.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canManageMimir } from "@/lib/roles";
import { MimirTabs } from "./mimir-tabs";

export const metadata: Metadata = { title: "Mimir archive" };

export default async function MimirArchiveLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageMimir(session.user.access)) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-medium tracking-tight">Mimir archive</h1>
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          This is the previous Mimir, kept to read. It no longer coaches or records progress.{" "}
          <Link href="/mimir" className="font-medium underline underline-offset-2">
            Go to Mimir
          </Link>
          .
        </p>
      </div>
      <MimirTabs />
      {children}
    </div>
  );
}
