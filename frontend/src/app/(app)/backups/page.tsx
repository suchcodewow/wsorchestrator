import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { backupTarget, listBackups } from "@/lib/backups";
import { canManageBackups } from "@/lib/roles";
import { BackupsTable } from "./backups-table";

export const metadata: Metadata = {
  title: "Backups",
  robots: { index: false, follow: false },
};

/**
 * The database's backup history, and the button that rolls it back.
 *
 * Administrators only — for anyone below, this page is a 404 rather than a
 * "forbidden", the same as the users page.
 *
 * The list is fetched on the server so the page arrives with it, and refetched
 * by the client after a backup is taken. Nothing here is cached: an
 * administrator opening this page is usually asking "did last night's backup
 * run?", and a stale answer to that question is worse than no page at all.
 */
export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
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
