/**
 * Removes one Additional Channel Contact. Someone the sync invited for being
 * one is taken out of the channels on its next run, unless they still belong.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { deleteChannelContact, STATUS_FOR } from "@/lib/cohorts/channel-contacts";
import { canManageTrainingSettings } from "@/lib/roles";

const idSchema = z.string().uuid();

export const DELETE = audited(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await deleteChannelContact(id.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  noteAudit({ target: id.data, targetLabel: result.email, detail: { kind: result.kind } });
  return NextResponse.json({ ok: true });
});
