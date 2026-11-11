"use client";

/**
 * Feedback Management: the active bootcamp's classes and their buttons,
 * whether Slack is live, then each release message run, each linking to
 * who it messaged. While a run is sending, the page keeps itself current.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, User, XCircle } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { ReleaseNoticeStatus } from "@/db/schema";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { StagePending } from "@/lib/evals/participation";
import type { ReleaseNoticeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { formatDate, formatWhen } from "../../cohort-settings/format";
import type { ViewBootcamp } from "../../reporting/bootcamp/bootcamp-view";
import { ClassActions } from "./class-actions";

/** How often a page showing a run still sending reloads it. */
export const REFRESH_MS = 2_000;

export type NoticeRun = {
  id: string;
  stage: ReleaseStage;
  triggeredBy: string | null;
  preview: boolean;
  dryRun: boolean;
  testGroup: boolean;
  status: ReleaseNoticeStatus;
  startedAt: string;
  finishedAt: string | null;
  recipients: number;
  messaged: number;
  notInSlack: number;
  failures: number;
  error: string | null;
};

/** Keeps the page current while `running`. */
export function useRefreshWhile(running: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, router]);
}

/** "Release", "Preview", with "(test group)" when it went to the test group instead. */
export function runKind(run: Pick<NoticeRun, "preview" | "testGroup">): string {
  return `${run.preview ? "Preview" : "Release"}${run.testGroup ? " (test group)" : ""}`;
}

/** "12 messaged, 1 not in Slack", or "12 to message" in a dry run, leaving out the zeros. */
export function noticeCounts(run: Pick<NoticeRun, "messaged" | "notInSlack" | "failures" | "dryRun" | "recipients">): string {
  const parts = [
    run.messaged && `${run.messaged.toLocaleString()} ${run.dryRun ? "to message" : "messaged"}`,
    run.notInSlack && `${run.notInSlack.toLocaleString()} not in Slack`,
    run.failures && `${run.failures.toLocaleString()} ${run.failures === 1 ? "failure" : "failures"}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : run.recipients === 0 ? "Nobody to message" : "Nothing sent";
}

export function NoticeResult({ run }: { run: NoticeRun }) {
  if (run.status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Sending: {run.messaged + run.notInSlack + run.failures} of {run.recipients}
      </span>
    );
  }
  if (run.status === "succeeded") {
    return (
      <span className="flex items-center gap-1.5">
        {run.failures > 0 ? (
          <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        {noticeCounts(run)}
      </span>
    );
  }
  return (
    <span className="flex items-start gap-1.5 text-destructive">
      <XCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="wrap-break-word">{run.error ?? "Failed"}</span>
    </span>
  );
}

export function FeedbackView({
  bootcamp,
  pending,
  slackLive,
  query,
  page,
}: {
  bootcamp: ViewBootcamp | null;
  /** What each class's Generate button would write, and who its release waits on; null for a class it can no longer run on. */
  pending: Record<ReleaseStage, StagePending | null>;
  slackLive: boolean;
  query: ListQuery<ReleaseNoticeSort>;
  page: Page<NoticeRun>;
}) {
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  useRefreshWhile(page.rows.some((run) => run.status === "running"));

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1">
        <h2 className="text-xl font-medium tracking-tight">Feedback Management</h2>
        {bootcamp && <p className="text-sm text-muted-foreground">For the bootcamp starting {formatDate(bootcamp.startDate)}</p>}
      </motion.div>

      <motion.div variants={riseChild}>
        <ClassActions bootcamp={bootcamp} pending={pending} slackLive={slackLive} />
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-medium tracking-tight">
          Release messages
          {slackLive ? <Badge>Slack live</Badge> : <Badge variant="secondary">Slack in dry run</Badge>}
        </h3>
        <Link href="/admin-settings/connectors" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          Slack&apos;s mode is set on Admin Settings → External Connectors
        </Link>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by who, class, status or error" label="Search the release messages" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="startedAt" {...sortProps}>
                  Started
                </SortHeader>
                <SortHeader column="triggeredBy" {...sortProps}>
                  By
                </SortHeader>
                <SortHeader column="stage" {...sortProps}>
                  Class
                </SortHeader>
                <SortHeader column="status" {...sortProps}>
                  Result
                </SortHeader>
                <PlainHeader className="w-24" />
              </tr>
            </thead>
            <tbody>
              {page.rows.map((run) => {
                const href = `/reporting-settings/feedback/${run.id}`;
                return (
                  <tr key={run.id} className={`${LINK_ROW} align-top`} onClick={rowLink(href)}>
                    <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                      <Link href={href} className="group-hover:underline">
                        {formatWhen(run.startedAt)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <User className="size-3.5" />
                        {run.triggeredBy ?? "Someone since removed"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                      {STAGE_LABELS[run.stage]} · {runKind(run)}
                    </td>
                    <td className="px-5 py-2.5">
                      <NoticeResult run={run} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">{run.dryRun && <Badge variant="secondary">Dry run</Badge>}</td>
                  </tr>
                );
              })}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No release messages match." : "No release messages yet. Preview one to see who it would reach."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="runs" />
        </div>
      </motion.div>
    </motion.div>
  );
}
