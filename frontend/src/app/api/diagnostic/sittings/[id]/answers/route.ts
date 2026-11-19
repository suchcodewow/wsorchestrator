/**
 * Answers the question on screen in one of the caller's own sittings, and
 * returns the next: `choice` for a question with options, or `text` for a
 * typed one, which Claude grades before anything is recorded.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { answer, sittingModes, type AnswerError } from "@/lib/iris/attempts";
import { TEXT_ANSWER_LIMITS } from "@/lib/iris/text-answer";
import { canSitIris } from "@/lib/roles";

const idSchema = z.string().uuid();
const number = z.number().int().min(1).max(100);
const bodySchema = z.union([
  z.object({ number, choice: z.number() }).strict(),
  // The box stops at the limit, so anything longer did not come from it.
  z.object({ number, text: z.string().max(TEXT_ANSWER_LIMITS.chars * 2) }).strict(),
]);

const STATUS: Record<AnswerError, number> = {
  not_found: 404,
  finished: 409,
  stale: 409,
  invalid_choice: 400,
  invalid_answer: 400,
  // Nothing was recorded: the taker can send the same answer again.
  grading_failed: 503,
};

export const POST = audited(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canSitIris);
  if (error) return error;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const reply = "text" in parsed.data ? { text: parsed.data.text } : parsed.data.choice;
  const result = await answer(user.id, id.data, parsed.data.number, reply, Math.random, sittingModes(user.access));
  if (!result.ok) {
    return NextResponse.json(result.sitting ? { error: result.error, sitting: result.sitting } : { error: result.error }, {
      status: STATUS[result.error],
    });
  }
  if (result.done) {
    const finished = {
      done: true,
      subject: result.subject,
      mode: result.mode,
      questions: result.questions,
    };
    // Nobody is told their level, administrators included: a sitting reads the same for everyone.
    return NextResponse.json(finished);
  }
  return NextResponse.json({ done: false, sitting: result.sitting });
});
