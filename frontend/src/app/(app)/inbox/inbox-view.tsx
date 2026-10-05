"use client";

/**
 * Two lists under one search: the checklist items this person owns, which
 * they tick here, and everywhere they are tagged — a session comment, a
 * checklist item, or an eVals score's comment. Each sorts and pages on its
 * own (`items.*` and `mentions.*` in the URL); the Open, Done and All pills
 * narrow the checklist.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { MentionText } from "@/components/mention-text";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { CHECKLIST_STATUSES, type ChecklistStatus, type MyChecklistSort, type MyMentionSort } from "@/lib/list-specs";
import type { MyMentionRow } from "@/lib/mention-store";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { MyChecklistRow } from "@/lib/scheduler/checklist";
import { checklistDayLabel } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatDate, formatWhen } from "../cohort-settings/format";

const STATUS_LABELS: Record<ChecklistStatus, string> = { open: "Open", done: "Done", all: "All" };

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dateLabel = (iso: string) => WEEKDAY.format(new Date(`${iso}T00:00:00Z`));
const when = (at: Date | string) => formatWhen(new Date(at).toISOString());

/** Where a tag was made: the session, checklist or eVals score, then the bootcamp. */
function mentionContext(m: MyMentionRow): string {
  const day = m.track && m.day !== null ? checklistDayLabel(m.track, m.day) : null;
  const where =
    m.kind === "comment"
      ? [m.sessionName, day]
      : m.kind === "checklist"
        ? ["Checklist", day]
        : [m.assessmentName, m.criterionName, m.attendeeName];
  return [...where.filter(Boolean), `bootcamp starting ${formatDate(m.bootcampStartDate)}`].join(" · ");
}

/** Shows only `status`, from the checklist's first page. */
function useStatusFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function show(status: ChecklistStatus) {
    const next = new URLSearchParams(params.toString());
    if (status === "open") next.delete("status");
    else next.set("status", status);
    next.delete("items.page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { show, pending };
}

export function InboxView({
  itemQuery,
  mentionQuery,
  status,
  items,
  open,
  mentions,
  mentionTotal,
  viewerEmail,
  canOpenSchedules,
  scoringBootcampId,
}: {
  itemQuery: ListQuery<MyChecklistSort>;
  mentionQuery: ListQuery<MyMentionSort>;
  status: ChecklistStatus;
  items: Page<MyChecklistRow>;
  /** Items still to do, whatever the search. */
  open: number;
  mentions: Page<MyMentionRow>;
  /** Tags of this person, whatever the search. */
  mentionTotal: number;
  viewerEmail: string;
  /** Whether the schedules these come from are open to this person. */
  canOpenSchedules: boolean;
  /** The active bootcamp, if this person can score at it: only its eVals scores can still be opened. */
  scoringBootcampId: string | null;
}) {
  const router = useRouter();
  const { show, pending } = useStatusFilter();
  const [ticking, setTicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function tick(item: MyChecklistRow) {
    setTicking(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/scheduler/bootcamps/${item.bootcampId}/checklist/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !item.done }),
      });
      if (!res.ok) setError(res.status === 404 ? "That item was removed." : `That did not save (${res.status}).`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setTicking(null);
    }
  }

  const schedule = (bootcampId: string, label: string) =>
    canOpenSchedules ? (
      <Link href={`/scheduler/${bootcampId}`} className="underline-offset-2 hover:underline">
        {label}
      </Link>
    ) : (
      label
    );

  /** Where a tag opens, if this person can open it. */
  const mentionHref = (m: MyMentionRow): string | null => {
    if (m.kind !== "score") return canOpenSchedules ? `/scheduler/${m.bootcampId}` : null;
    if (m.bootcampId !== scoringBootcampId || !m.stage || !m.assessmentId || !m.employeeId) return null;
    return `/evals/${m.stage}/${m.assessmentId}/${encodeURIComponent(m.employeeId)}`;
  };

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-5xl space-y-8">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">My inbox</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{open.toLocaleString()}</span> checklist item
          {open === 1 ? "" : "s"} to do ·{" "}
          <span className="font-medium text-foreground tabular-nums">{mentionTotal.toLocaleString()}</span> tag
          {mentionTotal === 1 ? "" : "s"} of {viewerEmail || "you"}
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={itemQuery.q} placeholder="Search items and tags" label="Search your inbox" />
      </motion.div>

      <motion.section variants={riseChild} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Checklist</h2>
          <div role="radiogroup" aria-label="Show" className="flex gap-1.5">
            {CHECKLIST_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                disabled={pending}
                onClick={() => show(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors disabled:cursor-wait",
                  status === s ? "border-brand-border bg-brand/8 font-medium" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEADER_ROW}>
                  <PlainHeader className="w-12">
                    <span className="sr-only">Done</span>
                  </PlainHeader>
                  <SortHeader column="name" sort={itemQuery.sort} dir={itemQuery.dir} prefix="items">
                    Item
                  </SortHeader>
                  <SortHeader column="date" sort={itemQuery.sort} dir={itemQuery.dir} prefix="items">
                    Before
                  </SortHeader>
                  <SortHeader column="createdBy" sort={itemQuery.sort} dir={itemQuery.dir} prefix="items">
                    Added by
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {items.rows.map((item) => (
                  <tr key={item.id} className="border-b last:border-b-0">
                    <td className="px-5 py-2.5 align-top">
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={ticking === item.id}
                        onChange={() => void tick(item)}
                        aria-label={`${item.done ? "Untick" : "Tick"} ${item.name}`}
                        className="mt-0.5 size-4 accent-brand"
                      />
                    </td>
                    <td className="px-5 py-2.5 align-top">
                      <div className={cn("wrap-break-word", item.done && "text-muted-foreground line-through")}>
                        <MentionText text={item.name} mentions={item.mentions} viewerEmail={viewerEmail} />
                      </div>
                      {item.done && item.doneAt && (
                        <div className="text-xs text-muted-foreground">
                          Done by {item.doneByName || "someone"} {when(item.doneAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-2.5 align-top whitespace-nowrap">
                      <div>{schedule(item.bootcampId, checklistDayLabel(item.track, item.day))}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{dateLabel(item.date)}</div>
                    </td>
                    <td className="px-5 py-2.5 align-top text-muted-foreground">
                      <div>{item.createdByName || item.createdByEmail || "Someone removed"}</div>
                      <div className="text-xs">{when(item.createdAt)}</div>
                    </td>
                  </tr>
                ))}
                {items.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                      {itemQuery.q
                        ? "No item matches."
                        : items.page > 1
                          ? "No items on this page."
                          : status === "open"
                            ? "Nothing to do."
                            : status === "done"
                              ? "Nothing done yet."
                              : "No checklist item is yours."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t empty:hidden">
            <Pager page={items} noun="items" prefix="items" />
          </div>
        </div>
      </motion.section>

      <motion.section variants={riseChild} className="space-y-3">
        <h2 className="text-lg font-medium">Tagged in</h2>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEADER_ROW}>
                  <SortHeader column="createdAt" sort={mentionQuery.sort} dir={mentionQuery.dir} prefix="mentions" className="w-40">
                    When
                  </SortHeader>
                  <SortHeader column="author" sort={mentionQuery.sort} dir={mentionQuery.dir} prefix="mentions" className="w-44">
                    From
                  </SortHeader>
                  <PlainHeader>Where</PlainHeader>
                  <PlainHeader className="w-10" />
                </tr>
              </thead>
              <tbody>
                {mentions.rows.map((m) => {
                  const href = mentionHref(m);
                  const context = mentionContext(m);
                  return (
                    <tr key={m.mentionId} className="border-b last:border-b-0">
                      <td className="px-5 py-2.5 align-top whitespace-nowrap text-muted-foreground">{when(m.createdAt)}</td>
                      <td className="px-5 py-2.5 align-top">{m.taggedByName || m.taggedByEmail || "Someone removed"}</td>
                      <td className="px-5 py-2.5 align-top">
                        <p className="whitespace-pre-wrap wrap-break-word">
                          <MentionText text={m.text} mentions={m.mentions} viewerEmail={viewerEmail} />
                        </p>
                        <div className="mt-1 text-xs text-muted-foreground">{context}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {href && (
                          <Link
                            href={href}
                            aria-label={`Open ${context}`}
                            className="flex justify-end text-muted-foreground hover:text-foreground"
                          >
                            <ChevronRight className="size-4" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {mentions.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                      {mentionQuery.q ? "No tag matches." : mentions.page > 1 ? "No tags on this page." : "No one has tagged you yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t empty:hidden">
            <Pager page={mentions} noun="tags" prefix="mentions" />
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
