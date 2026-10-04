/** Removing a comment on a session; only the person who wrote it can. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { deleteComment } from "@/lib/scheduler/comments";
import { sessionOf } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string; sessionId: string; commentId: string }> };

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id, sessionId, commentId } = await params;
  const parsed = z.object({ id: idSchema, sessionId: idSchema, commentId: idSchema }).safeParse({ id, sessionId, commentId });
  if (!parsed.success || !(await sessionOf(parsed.data.id, parsed.data.sessionId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await deleteComment(user.id, parsed.data.sessionId, parsed.data.commentId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 403 });
  return NextResponse.json({ ok: true });
});
