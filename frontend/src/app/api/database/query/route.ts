/** Runs one read-only query for an administrator. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canRunSql } from "@/lib/roles";
import { MAX_SQL_LENGTH, runReadOnlyQuery } from "@/lib/sql-console";

const bodySchema = z.object({ sql: z.string().min(1).max(MAX_SQL_LENGTH) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canRunSql(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  console.log(
    `[sql-console] ${session.user.email} ran: ${parsed.data.sql
      .replace(/\s+/g, " ")
      .slice(0, 500)}`,
  );

  const result = await runReadOnlyQuery(parsed.data.sql);
  return NextResponse.json(result);
}
