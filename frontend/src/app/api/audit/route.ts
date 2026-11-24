/** One page of the audit trail, searched and sorted, as the Audit Trail page shows it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { parseAuditFilter } from "@/lib/audit-shape";
import { listAuditEvents } from "@/lib/audit";
import { AUDIT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canViewAuditTrail } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canViewAuditTrail);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const query = parseListQuery(params, AUDIT_LIST);
  const { rows, page, hasMore } = await listAuditEvents(query, parseAuditFilter(params));
  return NextResponse.json({ events: rows, page, hasMore });
}
