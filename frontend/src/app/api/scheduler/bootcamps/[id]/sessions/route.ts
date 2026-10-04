/** Adding a session to one day of one of a bootcamp's tracks. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { SESSION_STATUS_FOR, createSession, sessionInputSchema } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = sessionInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await createSession(user.id, id.data, parsed.data);
  if (!result.ok) {
    const { error, email, clashes } = result;
    return NextResponse.json({ error, email, clashes }, { status: SESSION_STATUS_FOR[error] });
  }
  return NextResponse.json(result.session, { status: 201 });
});
