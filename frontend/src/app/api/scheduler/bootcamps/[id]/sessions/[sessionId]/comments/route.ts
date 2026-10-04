/** A session's comments, a page at a time, newest first, and adding one. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { SESSION_COMMENT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { addComment, commentInputSchema, listComments } from "@/lib/scheduler/comments";
import { sessionOf } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string; sessionId: string }> };

/** The session's id, if it is one of the bootcamp's. */
async function sessionIn(params: Params["params"]): Promise<string | null> {
  const { id, sessionId } = await params;
  const bootcamp = idSchema.safeParse(id);
  const session = idSchema.safeParse(sessionId);
  if (!bootcamp.success || !session.success) return null;
  return (await sessionOf(bootcamp.data, session.data)) ? session.data : null;
}

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const sessionId = await sessionIn(params);
  if (!sessionId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { rows, page, hasMore } = await listComments(sessionId, parseListQuery(new URL(req.url).searchParams, SESSION_COMMENT_LIST));
  return NextResponse.json({ comments: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const sessionId = await sessionIn(params);
  if (!sessionId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = commentInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  return NextResponse.json(await addComment(user.id, sessionId, parsed.data), { status: 201 });
});
