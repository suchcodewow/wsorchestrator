/** One run of the Diagnostic's Slack reminders, and a page of whom it messaged, would have, or could not. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { getReminderRun, listReminderMessages } from "@/lib/iris/reminders";
import { IRIS_REMINDER_MESSAGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const id = idSchema.safeParse((await params).id);
  const run = id.success ? await getReminderRun(id.data) : null;
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const query = parseListQuery(new URL(req.url).searchParams, IRIS_REMINDER_MESSAGE_LIST);
  const { rows, page, hasMore } = await listReminderMessages(run.id, query);
  return NextResponse.json({ run, messages: rows, page, hasMore });
}
