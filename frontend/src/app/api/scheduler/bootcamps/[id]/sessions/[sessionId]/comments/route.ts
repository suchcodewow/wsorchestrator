/** A session's comments, a page at a time, newest first, and adding one, which can tag people with "@". */

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

/** The bootcamp's and the session's ids, if the session is one of the bootcamp's. */
async function sessionIn(params: Params["params"]): Promise<{ bootcampId: string; sessionId: string } | null> {
  const { id, sessionId } = await params;
  const bootcamp = idSchema.safeParse(id);
  const session = idSchema.safeParse(sessionId);
  if (!bootcamp.success || !session.success) return null;
  return (await sessionOf(bootcamp.data, session.data)) ? { bootcampId: bootcamp.data, sessionId: session.data } : null;
}

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const found = await sessionIn(params);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { rows, page, hasMore } = await listComments(found.sessionId, parseListQuery(new URL(req.url).searchParams, SESSION_COMMENT_LIST));
  return NextResponse.json({ comments: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const found = await sessionIn(params);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = commentInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await addComment(user.id, found.bootcampId, found.sessionId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error, email: result.email }, { status: 400 });
  return NextResponse.json(result.comment, { status: 201 });
});
