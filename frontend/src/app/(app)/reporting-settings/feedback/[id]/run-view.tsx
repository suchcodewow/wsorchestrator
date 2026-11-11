"use client";

/**
 * Who one release message run messaged, or in a preview or dry run would
 * have, with the message as Slack shows it; filtered to the messages or the
 * problems. While it is sending, the page keeps itself current, so the
 * rows appear as each goes out.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import type { ReleaseNoticeAction } from "@/db/schema";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import type { ReleaseNoticeMessageSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { ReleaseNoticeKind } from "@/lib/reporting/release-notice";
import { cn } from "@/lib/utils";
import { SlackMessage } from "../../../cohort-settings/slack/[id]/run-view";
import { formatWhen } from "../../../cohort-settings/format";
import { NoticeResult, runKind, useRefreshWhile, type NoticeRun } from "../feedback-view";

export type NoticeMessageListing = {
  id: string;
  action: ReleaseNoticeAction;
  email: string;
  fullName: string | null;
  detail: string | null;
  at: string;
};

const ACTIONS: Record<ReleaseNoticeAction, { live: string; dry: string }> = {
  messaged: { live: "Sent a direct message", dry: "Would send a direct message" },
  not_in_slack: { live: "No Slack account", dry: "No Slack account" },
  failed: { live: "Failed", dry: "Failed" },
};

const KINDS: { kind: ReleaseNoticeKind | null; label: string }[] = [
  { kind: null, label: "Everyone" },
  { kind: "messages", label: "Messages" },
  { kind: "problems", label: "Problems" },
];

export function NoticeRunView({
  run,
  query,
  kind,
  counts,
  page,
}: {
  run: NoticeRun;
  query: ListQuery<ReleaseNoticeMessageSort>;
  kind: ReleaseNoticeKind | null;
  counts: Record<ReleaseNoticeKind | "all", number>;
  page: Page<NoticeMessageListing>;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const pathname = usePathname();
  const params = useSearchParams();
  useRefreshWhile(run.status === "running");

  /** This page with another filter, the search kept and back to its first page. */
  function kindHref(next: ReleaseNoticeKind | null) {
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
          href="/reporting-settings/feedback"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Feedback Management
        </Link>
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-medium tracking-tight">
          {STAGE_LABELS[run.stage]} {runKind(run).toLowerCase()} of {formatWhen(run.startedAt)}
          {run.dryRun && <Badge variant="secondary">Dry run</Badge>}
        </h2>
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">
            By {run.triggeredBy ?? "someone since removed"}, to {run.recipients.toLocaleString()}{" "}
            {run.recipients === 1 ? "person" : "people"}
            {run.preview
              ? ": a preview, so nothing was released or sent, and each row says what would have been"
              : run.dryRun
                ? ": Slack is in dry run, so nothing was sent, and each row says what would have been"
                : ""}
          </p>
          <NoticeResult run={run} />
        </div>
      </motion.div>

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
          placeholder="Search by person, action or message"
          label="Search this run"
          className="min-w-56 flex-1"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="at" {...sortProps}>
                  At
                </SortHeader>
                <SortHeader column="action" {...sortProps}>
                  Action
                </SortHeader>
                <SortHeader column="email" {...sortProps}>
                  Person
                </SortHeader>
                <PlainHeader>Message or detail</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((m) => (
                <tr key={m.id} className="border-b align-top last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">{formatWhen(m.at)}</td>
                  <td className={cn("whitespace-nowrap px-5 py-2.5", m.action === "failed" && "text-destructive")}>
                    {ACTIONS[m.action][run.dryRun ? "dry" : "live"]}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className="font-medium">{m.fullName || m.email}</span>
                    {m.fullName && <span className="block text-muted-foreground">{m.email}</span>}
                  </td>
                  <td className="max-w-120 px-5 py-2.5 text-muted-foreground wrap-break-word">
                    {m.action === "messaged" && m.detail ? <SlackMessage text={m.detail} /> : (m.detail ?? "")}
                  </td>
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q || kind ? "Nothing matches." : run.status === "running" ? "Starting…" : "Nobody was messaged."}
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
