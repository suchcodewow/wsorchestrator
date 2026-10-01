/** The HiBob sync history a page at a time, and syncing now — the HiBob tab's button. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import {
  hibobServiceUser,
  listHibobSyncRuns,
  STATUS_FOR,
  syncHibobEmployees,
  syncInProgress,
} from "@/lib/evals/hibob";
import { audited } from "@/lib/audit";
import { HIBOB_SYNC_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

// HiBob takes several seconds to send ~1,500 employees.
export const maxDuration = 180;

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, HIBOB_SYNC_LIST);
  const [{ rows, page, hasMore }, running] = await Promise.all([listHibobSyncRuns(query), syncInProgress()]);
  return NextResponse.json({ runs: rows, page, hasMore, running, serviceUser: hibobServiceUser() });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const result = await syncHibobEmployees("manual", user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ count: result.count, skipped: result.skipped });
});
