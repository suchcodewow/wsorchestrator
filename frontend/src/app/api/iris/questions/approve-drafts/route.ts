/** Approves every draft question on one subject and form at once. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { FORMS } from "@/lib/iris/engine";
import { approveDrafts } from "@/lib/iris/reviews";
import { SUBJECTS, SUBJECT_KEYS } from "@/lib/iris/subjects";
import { canManageIris } from "@/lib/roles";

const bodySchema = z.object({ subject: z.enum(SUBJECT_KEYS), form: z.enum(FORMS).default("A") });

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { subject, form } = parsed.data;

  const result = await approveDrafts(user.id, subject, form);
  noteAudit({ target: subject, targetLabel: `${SUBJECTS[subject].name}, form ${form}` });
  return NextResponse.json({ ok: true, approved: result.ok ? result.written : 0 });
});
