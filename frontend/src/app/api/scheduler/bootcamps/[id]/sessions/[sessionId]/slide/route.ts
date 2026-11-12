/** Makes a breakout's slide, its instructors with their rooms and groups, in Google Slides. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { generateBreakoutSlide } from "@/lib/scheduler/breakout-slide";

export const maxDuration = 120;

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string; sessionId: string }> };

const STATUS_FOR = { not_found: 404, not_breakout: 409, failed: 502 } as const;

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id, sessionId } = await params;
  const bootcampId = idSchema.safeParse(id);
  const session = idSchema.safeParse(sessionId);
  if (!bootcampId.success || !session.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!user.email) {
    return NextResponse.json({ error: "no_email", message: "Your account has no email to share the slide with." }, { status: 409 });
  }

  noteAudit({ target: session.data, targetLabel: "Breakout slide" });
  const result = await generateBreakoutSlide(bootcampId.data, session.data, user.email);
  if (!result.ok) {
    const status = result.error in STATUS_FOR ? STATUS_FOR[result.error as keyof typeof STATUS_FOR] : 409;
    return NextResponse.json({ error: result.error, message: result.message }, { status });
  }
  return NextResponse.json({ url: result.url, instructors: result.instructors, attendees: result.attendees }, { status: 201 });
});
