"use client";

/** Whom one reminder run messaged, or in a dry run would have, and what it said; or why it could not. */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { HEADER_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { IrisReminderOutcome } from "@/db/schema";
import type { IrisReminderMessageSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { SlackMessage } from "@/app/(app)/cohort-settings/slack/[id]/run-view";
import { RunResult, formatWhen, type ReminderRun } from "../slack-view";

export type MessageListing = {
  id: string;
  email: string;
  fullName: string;
  outcome: IrisReminderOutcome;
  detail: string;
  at: string;
};

const OUTCOMES: Record<IrisReminderOutcome, { live: string; dry: string }> = {
  messaged: { live: "Sent a direct message", dry: "Would send a direct message" },
  not_in_slack: { live: "No Slack account", dry: "No Slack account" },
  failed: { live: "Failed", dry: "Failed" },
};

export function ReminderRunView({
  run,
  query,
  page,
}: {
  run: ReminderRun;
  query: ListQuery<IrisReminderMessageSort>;
  page: Page<MessageListing>;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <Link
          href="/diagnostic-settings/slack"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Slack
        </Link>
      </motion.div>

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
          <span className="font-medium tnum">{formatWhen(run.startedAt)}</span>
          {run.dryRun ? <Badge variant="secondary">Dry run</Badge> : <Badge>Live</Badge>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
          <span className="font-medium">Triggered by</span>
          <span className="text-muted-foreground">
            {run.trigger === "schedule" ? "The daily schedule" : (run.triggeredByName ?? "Someone since removed")}
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-2.5">
          <span className="font-medium">Result</span>
          <span className="max-w-xl text-right">
            <RunResult run={run} />
          </span>
        </div>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name, email or message" label="Search this run" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="person" {...sortProps}>
                  Participant
                </SortHeader>
                <SortHeader column="outcome" {...sortProps}>
                  Outcome
                </SortHeader>
                <SortHeader column="at" {...sortProps}>
                  Message
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((m) => (
                <tr key={m.id} className="border-b align-top last:border-b-0">
                  <td className="px-5 py-3">
                    <span className="block font-medium">{m.fullName || m.email}</span>
                    {m.fullName && <span className="block text-xs text-muted-foreground">{m.email}</span>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{OUTCOMES[m.outcome][run.dryRun ? "dry" : "live"]}</td>
                  <td className="px-5 py-3">
                    {m.outcome === "messaged" ? (
                      <SlackMessage text={m.detail} />
                    ) : (
                      <span className="text-muted-foreground">{m.detail}</span>
                    )}
                  </td>
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No one matches." : "Nobody was messaged in this run."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="people" />
        </div>
      </motion.div>
    </motion.div>
  );
}
