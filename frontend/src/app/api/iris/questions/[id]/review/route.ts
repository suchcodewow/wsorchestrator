/** Approves, rejects or returns to draft one Iris question's current version, with an optional note. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { IRIS_NOTE_MAX, IRIS_REVIEW_STATUSES } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { setReviews } from "@/lib/iris/reviews";
import { canManageIris } from "@/lib/roles";

const bodySchema = z.object({
  status: z.enum(IRIS_REVIEW_STATUSES),
  note: z.string().max(IRIS_NOTE_MAX).optional(),
});

export const PUT = audited(async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { id } = await params;

  const result = await setReviews(user.id, [{ id, ...parsed.data }]);
  if (!result.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ targetLabel: id });
  return NextResponse.json({ ok: true, status: parsed.data.status });
});
