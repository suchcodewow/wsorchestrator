/** One session of a bootcamp's schedule: reading it with what it clashes with, changing it, or removing it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import {
  SESSION_STATUS_FOR,
  clashesOf,
  deleteSession,
  getSession,
  scheduleBootcamp,
  sessionPatchSchema,
  updateSession,
} from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string; sessionId: string }> };

async function ids(params: Params["params"]) {
  const { id, sessionId } = await params;
  const bootcamp = idSchema.safeParse(id);
  const session = idSchema.safeParse(sessionId);
  return bootcamp.success && session.success ? { bootcampId: bootcamp.data, sessionId: session.data } : null;
}

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const found = await ids(params);
  const bootcamp = found ? await scheduleBootcamp(found.bootcampId) : null;
  const session = found && bootcamp ? await getSession(found.bootcampId, found.sessionId) : null;
  if (!bootcamp || !session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ...session, clashes: await clashesOf(bootcamp, session) });
}

export const PATCH = audited(async function PATCH(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const found = await ids(params);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = sessionPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateSession(found.bootcampId, found.sessionId, parsed.data);
  if (!result.ok) {
    const { error, email, clashes } = result;
    return NextResponse.json({ error, email, clashes }, { status: SESSION_STATUS_FOR[error] });
  }
  return NextResponse.json(result.session);
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const found = await ids(params);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await deleteSession(found.bootcampId, found.sessionId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
});
