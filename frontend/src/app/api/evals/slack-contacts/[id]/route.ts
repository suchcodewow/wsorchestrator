/** Removes one Additional Slack Contact. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { deleteSlackContact, STATUS_FOR } from "@/lib/evals/slack-contacts";

const idSchema = z.string().uuid();

export const DELETE = audited(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await deleteSlackContact(id.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] });
  }
  noteAudit({ target: id.data, targetLabel: result.email });
  return NextResponse.json({ ok: true });
});
