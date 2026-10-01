/** The audit trail: every action anyone, or the app itself, has taken. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { listAuditEvents } from "@/lib/audit";
import { AUDIT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canViewAuditTrail } from "@/lib/roles";
import { AuditTable } from "./audit-table";

export const metadata: Metadata = {
  title: "Audit Trail",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canViewAuditTrail(session.user.access)) notFound();

  const query = parseListQuery(await searchParams, AUDIT_LIST);
  const page = await listAuditEvents(query);

  return <AuditTable query={query} page={page} />;
}
