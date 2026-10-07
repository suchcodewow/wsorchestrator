/** Answers the question on screen in one of the caller's own sittings, and returns the next. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { answer, withoutLevel, type AnswerError } from "@/lib/iris/attempts";
import { canManageIris, canTakeIris } from "@/lib/roles";

const idSchema = z.string().uuid();
const bodySchema = z.object({ number: z.number().int().min(1).max(100), choice: z.number() });

const STATUS: Record<AnswerError, number> = { not_found: 404, finished: 409, stale: 409, invalid_choice: 400 };

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canTakeIris);
  if (error) return error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await answer(user.id, id.data, parsed.data.number, parsed.data.choice);
  if (!result.ok) {
    return NextResponse.json(
      result.sitting ? { error: result.error, sitting: result.sitting } : { error: result.error },
      { status: STATUS[result.error] },
    );
  }
  if (result.done) {
    const finished = {
      done: true,
      subject: result.subject,
      mode: result.mode,
      questions: result.questions,
      placement: result.placement,
      confidence: result.confidence,
    };
    // A taker is never told their level; an Iris administrator is.
    return NextResponse.json(canManageIris(user.access) ? finished : withoutLevel(finished));
  }
  return NextResponse.json({ done: false, sitting: result.sitting });
});
