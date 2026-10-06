/** Starts an Iris sitting, or picks up the one in progress. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { startSitting, type StartError } from "@/lib/iris/attempts";
import { FORMS } from "@/lib/iris/engine";
import { SUBJECTS, SUBJECT_KEYS } from "@/lib/iris/subjects";
import { canManageIris, canTakeIris } from "@/lib/roles";

const bodySchema = z.object({
  subject: z.enum(SUBJECT_KEYS),
  form: z.enum(FORMS).default("A"),
  mode: z.enum(["live", "preview"]).default("live"),
});

const STATUS: Record<StartError, number> = { no_track: 409, already_taken: 409, not_ready: 409 };

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canTakeIris);
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { subject, form, mode } = parsed.data;
  if (mode === "preview" && !canManageIris(user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  noteAudit({ targetLabel: `${SUBJECTS[subject].name}, form ${form}${mode === "preview" ? ", preview" : ""}` });
  const result = await startSitting(user.id, subject, form, mode);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  noteAudit({ target: result.sitting.attemptId });
  return NextResponse.json(
    { sitting: result.sitting, resumed: result.resumed },
    { status: result.resumed ? 200 : 201 },
  );
});
