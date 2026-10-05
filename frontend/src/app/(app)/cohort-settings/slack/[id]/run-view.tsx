"use client";

/** What one Slack sync run did, channel by channel and person by person. */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { SlackSyncAction } from "@/db/schema";
import type { SlackSyncChangeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatWhen } from "../../format";
import { RunResult, type SlackRun } from "../slack-view";

export type ChangeListing = {
  id: string;
  channelName: string;
  action: SlackSyncAction;
  email: string;
  fullName: string | null;
  detail: string | null;
  at: string;
};

const ACTIONS: Record<SlackSyncAction, { live: string; dry: string }> = {
  created: { live: "Created the channel", dry: "Would create the channel" },
  joined: { live: "Joined the channel", dry: "Would join the channel" },
  invited: { live: "Invited", dry: "Would invite" },
  removed: { live: "Removed", dry: "Would remove" },
  not_in_slack: { live: "No Slack account", dry: "No Slack account" },
  failed: { live: "Failed", dry: "Failed" },
};

export function RunDetailView({
  run,
  query,
  page,
}: {
  run: SlackRun;
  query: ListQuery<SlackSyncChangeSort>;
  page: Page<ChangeListing>;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-2">
        <Link
          href="/cohort-settings/slack"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Slack
        </Link>
        <h2 className="flex items-center gap-2 text-xl font-medium tracking-tight">
          Sync of {formatWhen(run.startedAt)}
          {run.dryRun && <Badge variant="secondary">Dry run</Badge>}
        </h2>
        <div className="text-sm">
          <RunResult run={run} />
        </div>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by channel, person or action" label="Search this run" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="channelName" {...sortProps}>
                  Channel
                </SortHeader>
                <SortHeader column="action" {...sortProps}>
                  Action
                </SortHeader>
                <SortHeader column="email" {...sortProps}>
                  Person
                </SortHeader>
                <PlainHeader>Detail</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((c) => (
                <tr key={c.id} className="border-b align-top last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-2.5 font-mono">{c.channelName ? `#${c.channelName}` : "—"}</td>
                  <td className={`whitespace-nowrap px-5 py-2.5 ${c.action === "failed" ? "text-destructive" : ""}`}>
                    {ACTIONS[c.action][run.dryRun ? "dry" : "live"]}
                  </td>
                  <td className="px-5 py-2.5">
                    {c.email ? (
                      <>
                        <span className="font-medium">{c.fullName || c.email}</span>
                        {c.fullName && <span className="block text-muted-foreground">{c.email}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-muted-foreground wrap-break-word">{c.detail ?? ""}</td>
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "Nothing matches." : "This run changed nothing."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="changes" />
        </div>
      </motion.div>
    </motion.div>
  );
}
