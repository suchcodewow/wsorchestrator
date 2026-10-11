"use client";

/**
 * What one Slack sync run did and sent, or in a dry run would have, each
 * row saying to whom: a channel, or a person by direct message, with the
 * message as Slack shows it. Filtered to the channels, the messages or the
 * problems, with how many of each there are.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Hash, Info, MessageSquare } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { SlackSyncAction } from "@/db/schema";
import type { SlackChangeKind } from "@/lib/cohorts/slack-sync";
import type { SlackSyncChangeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { slackTextParts } from "@/lib/slack-text";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../format";
import { RunResult, SCOPE_LABELS, type SlackRun } from "../slack-view";

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
  messaged: { live: "Sent a direct message", dry: "Would send a direct message" },
  not_in_slack: { live: "No Slack account", dry: "No Slack account" },
  failed: { live: "Failed", dry: "Failed" },
};

const KINDS: { kind: SlackChangeKind | null; label: string }[] = [
  { kind: null, label: "Everything" },
  { kind: "channels", label: "Channels" },
  { kind: "messages", label: "Messages" },
  { kind: "problems", label: "Problems" },
];

/** A message's text as Slack shows it: bold where it is starred, links where it links. */
function SlackMessage({ text }: { text: string }) {
  return (
    <blockquote className="whitespace-pre-line border-l-2 border-brand/50 pl-3 text-foreground">
      {slackTextParts(text).map((part, i) =>
        part.kind === "bold" ? (
          <strong key={i}>{part.text}</strong>
        ) : part.kind === "link" ? (
          <a key={i} href={part.href} target="_blank" rel="noreferrer" className="text-brand underline">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </blockquote>
  );
}

/** Where a change landed: a channel, or the person themselves. */
function Target({ change }: { change: ChangeListing }) {
  if (change.channelName) {
    return (
      <span className="flex items-center gap-1 font-mono">
        <Hash className="size-3.5 shrink-0 text-muted-foreground" />
        {change.channelName}
      </span>
    );
  }
  if (change.action === "messaged" || change.action === "failed") {
    return (
      <span className="flex items-center gap-1.5">
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        Direct message
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

export function RunDetailView({
  run,
  query,
  kind,
  counts,
  page,
}: {
  run: SlackRun;
  query: ListQuery<SlackSyncChangeSort>;
  kind: SlackChangeKind | null;
  counts: Record<SlackChangeKind | "all", number>;
  page: Page<ChangeListing>;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const pathname = usePathname();
  const params = useSearchParams();

  /** This page with another filter, the search kept and back to its first page. */
  function kindHref(next: SlackChangeKind | null) {
    const qs = new URLSearchParams(params.toString());
    qs.delete("page");
    if (next) qs.set("kind", next);
    else qs.delete("kind");
    const s = qs.toString();
    return s ? `${pathname}?${s}` : pathname;
  }

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
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-medium tracking-tight">
          Sync of {formatWhen(run.startedAt)}
          {run.dryRun && <Badge variant="secondary">Dry run</Badge>}
        </h2>
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">
            {SCOPE_LABELS[run.scope]}, {run.trigger === "schedule" ? "on the schedule" : `by ${run.triggeredBy ?? "someone since removed"}`}
            {run.dryRun && ": nothing was changed or sent, and each row says what would have been"}
          </p>
          <RunResult run={run} />
        </div>
      </motion.div>

      {run.notes.length > 0 && run.status !== "skipped" && (
        <motion.ul variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
          {run.notes.map((note) => (
            <li key={note} className="flex items-start gap-2 px-5 py-3 text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {note}
            </li>
          ))}
        </motion.ul>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <nav aria-label="Show" className="inline-flex flex-wrap rounded-lg border bg-card p-0.5 shadow-xs">
          {KINDS.map(({ kind: k, label }) => (
            <Link
              key={label}
              href={kindHref(k)}
              scroll={false}
              aria-current={kind === k ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                kind === k ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="tabular-nums text-muted-foreground">{counts[k ?? "all"].toLocaleString()}</span>
            </Link>
          ))}
        </nav>
        <TableSearch
          value={query.q}
          placeholder="Search by channel, person, action or message"
          label="Search this run"
          className="min-w-56 flex-1"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="action" {...sortProps}>
                  Action
                </SortHeader>
                <SortHeader column="channelName" {...sortProps}>
                  To
                </SortHeader>
                <SortHeader column="email" {...sortProps}>
                  Person
                </SortHeader>
                <PlainHeader>Message or detail</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((c) => (
                <tr key={c.id} className="border-b align-top last:border-b-0">
                  <td className={cn("whitespace-nowrap px-5 py-2.5", c.action === "failed" && "text-destructive")}>
                    {ACTIONS[c.action][run.dryRun ? "dry" : "live"]}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5">
                    <Target change={c} />
                  </td>
                  <td className="px-5 py-2.5">
                    {c.email ? (
                      <>
                        <span className="font-medium">{c.fullName || c.email}</span>
                        {c.fullName && <span className="block text-muted-foreground">{c.email}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-120 px-5 py-2.5 text-muted-foreground wrap-break-word">
                    {c.action === "messaged" && c.detail ? <SlackMessage text={c.detail} /> : (c.detail ?? "")}
                  </td>
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q || kind
                      ? "Nothing matches."
                      : run.dryRun
                        ? "This run would have changed and sent nothing."
                        : "This run changed and sent nothing."}
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
