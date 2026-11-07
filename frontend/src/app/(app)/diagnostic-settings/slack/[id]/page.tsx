/** One run of the Diagnostic's Slack reminders: its result, then whom it messaged and what, a page at a time. */

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth, signInPath } from "@/auth";
import { getReminderRun, listReminderMessages } from "@/lib/iris/reminders";
import { IRIS_REMINDER_MESSAGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { ReminderRunView } from "./run-view";

export default async function DiagnosticReminderRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const id = z.string().uuid().safeParse((await params).id);
  const run = id.success ? await getReminderRun(id.data) : null;
  if (!run) notFound();

  const query = parseListQuery(await searchParams, IRIS_REMINDER_MESSAGE_LIST);
  const page = await listReminderMessages(run.id, query);
  return (
    <ReminderRunView
      run={{ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }}
      query={query}
      page={{ ...page, rows: page.rows.map((m) => ({ ...m, at: m.at.toISOString() })) }}
    />
  );
}
