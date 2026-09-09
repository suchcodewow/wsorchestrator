/** The database backups page. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { backupTarget, listBackups } from "@/lib/backups";
import { canManageBackups } from "@/lib/roles";
import { BackupsTable } from "./backups-table";

export const metadata: Metadata = {
  title: "Backups",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageBackups(session.user.siteRole)) notFound();

  const target = backupTarget();
  const result = await listBackups();

  return (
    <BackupsTable
      instance={target?.instance ?? null}
      project={target?.project ?? null}
      initial={result.ok ? result.backups : []}
      error={result.ok ? null : result.error}
    />
  );
}
