import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canRunSql } from "@/lib/roles";
import { MAX_SQL_LENGTH, runReadOnlyQuery } from "@/lib/sql-console";

const bodySchema = z.object({ sql: z.string().min(1).max(MAX_SQL_LENGTH) });

/**
 * Run one read-only query for an administrator. Authorisation is enforced here,
 * not just hidden in the UI: the role is checked before anything touches the
 * database, and the query itself runs in a fixed READ ONLY transaction (see
 * `runReadOnlyQuery`), so this endpoint can never write.
 */
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

  // Audit trail: who ran what lands in the server logs (Cloud Logging in prod).
  console.log(
    `[sql-console] ${session.user.email} ran: ${parsed.data.sql
      .replace(/\s+/g, " ")
      .slice(0, 500)}`,
  );

  // Both success and query errors come back as a 200 with an `ok` discriminator
  // — a syntax error in the user's SQL is a normal outcome here, not a 500.
  const result = await runReadOnlyQuery(parsed.data.sql);
  return NextResponse.json(result);
}
