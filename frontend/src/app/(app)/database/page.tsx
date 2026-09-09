/** The database console page. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canRunSql } from "@/lib/roles";
import { runReadOnlyQuery } from "@/lib/sql-console";
import { DatabaseConsole } from "./database-console";

export const metadata: Metadata = {
  title: "Database",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DatabasePage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canRunSql(session.user.siteRole)) notFound();

  const tablesRes = await runReadOnlyQuery(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  const tables = tablesRes.ok ? tablesRes.rows.map((r) => String(r[0])) : [];

  return <DatabaseConsole tables={tables} />;
}
