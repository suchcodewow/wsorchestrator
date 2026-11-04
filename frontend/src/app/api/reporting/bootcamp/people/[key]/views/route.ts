/**
 * Who has opened a Live Sessions card, and recording that the caller has. 404
 * for someone the caller may not see.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { readerOf } from "@/lib/reporting/bootcamp";
import { listCardViewers, recordCardView } from "@/lib/reporting/card-views";
import { canSeeBootcampRecords } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const result = await listCardViewers(readerOf(user), (await params).key);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const viewed = await recordCardView(user.id, readerOf(user), (await params).key);
  if (!viewed) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: viewed.email, targetLabel: `Live Sessions card: ${viewed.email}` });
  return NextResponse.json({ ok: true });
});
