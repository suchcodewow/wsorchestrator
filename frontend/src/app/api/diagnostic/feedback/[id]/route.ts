/** One rating given during a sitting, as an Assessments Administrator closes it, or opens it again, on Diagnostic Settings → Feedback. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { setIrisFeedbackClosed } from "@/lib/iris/feedback";
import { canManageIris } from "@/lib/roles";

const idSchema = z.string().uuid();
const bodySchema = z.object({ closed: z.boolean() });

export const PATCH = audited(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (!(await setIrisFeedbackClosed(id.data, user.id, parsed.data.closed))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  noteAudit({ target: id.data, targetLabel: "Diagnostic feedback", detail: { closed: parsed.data.closed } });
  return NextResponse.json({ ok: true, closed: parsed.data.closed });
});
