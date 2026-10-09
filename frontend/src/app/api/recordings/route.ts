/** Every take recorded through the recording link, a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { RECORDING_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listTakes } from "@/lib/recording/recordings";
import { canManageTrainingSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { rows, page, hasMore } = await listTakes(parseListQuery(new URL(req.url).searchParams, RECORDING_LIST));
  return NextResponse.json({ takes: rows, page, hasMore });
}
