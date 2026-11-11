/**
 * Diagnostic Settings → Slack: the daily reminder to Participants with tests
 * left, whether it is live or a dry run, who is due, Preview and Remind Now,
 * and every run, a page at a time.
 */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { dueParticipants, getRemindersLive, listReminderRuns, reminderRunInProgress, remindersSentToday } from "@/lib/iris/reminders";
import { IRIS_REMINDER_RUN_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { slackToken } from "@/lib/slack";
import { listTimedJobs } from "@/lib/timed-jobs";
import { DiagnosticSlackView } from "./slack-view";

export default async function DiagnosticSlackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const query = parseListQuery(await searchParams, IRIS_REMINDER_RUN_LIST);
  const [page, running, live, sentToday, token, { assigned, due }, jobs] = await Promise.all([
    listReminderRuns(query),
    reminderRunInProgress(),
    getRemindersLive(),
    remindersSentToday(),
    slackToken(),
    dueParticipants(),
    listTimedJobs(),
  ]);
  const job = jobs.find((j) => j.key === "diagnostic-reminders");

  return (
    <DiagnosticSlackView
      configured={Boolean(token)}
      live={live}
      sentToday={sentToday}
      assigned={assigned.length}
      due={due.length}
      schedule={job ? { text: job.schedule, enabled: job.enabled, nextRunAt: job.nextRunAt } : null}
      running={running}
      query={query}
      page={{
        ...page,
        rows: page.rows.map((run) => ({
          ...run,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
      }}
    />
  );
}
