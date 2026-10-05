"use client";

/**
 * One row per day BTC or INT was held, with how many attended each. A row
 * opens in place to who attended: bootcamp on one side, intermediate on the
 * other, each fetched a page at a time the first time it is opened. The open
 * days are kept in the URL, and a person's page is opened under Cohorts with
 * that URL's parameters, so its back link and Back both return here as it was.
 */

import { Fragment, useEffect, useEffectEvent, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, GraduationCap, Loader2, Users, type LucideIcon } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PreviousSession, SessionAttendee, SessionDetail, SessionStage } from "@/lib/evals/bootcamp-history";
import type { PreviousSessionSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import { listParam, withParams, type ListQuery, type Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatDate } from "../../cohort-settings/format";
import { OPEN_PARAM, parseOpen } from "./open";

/** `short` is the label on a phone, where both full ones would push Intermediate out of the card. */
const COLUMNS: { column: PreviousSessionSort; label: string; short?: string }[] = [
  { column: "date", label: "Date" },
  { column: "bootcamp", label: "Bootcamp", short: "BTC" },
  { column: "intermediate", label: "Intermediate", short: "INT" },
];

/** Every cell's side padding, narrower on a phone. */
const CELL_X = "px-3 sm:px-5";

const SIDES: { stage: SessionStage; label: string; Icon: LucideIcon }[] = [
  { stage: "bootcamp", label: "Bootcamp", Icon: Users },
  { stage: "intermediate", label: "Intermediate", Icon: GraduationCap },
];

/** A day's attendees as far as they have been fetched, or why they could not be. */
type Opened = { detail: SessionDetail | null; loading: SessionStage | "both" | null; error: string | null };

async function fetchSession(date: string, pages: Partial<Record<SessionStage, number>> = {}): Promise<SessionDetail> {
  const qs = new URLSearchParams();
  for (const [stage, page] of Object.entries(pages)) qs.set(listParam("page", stage), String(page));
  const res = await fetch(`/api/cohorts/previous/${date}${qs.size ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(res.status === 404 ? "No one attended on this day any more — reload the page." : `Could not load (${res.status}).`);
  return res.json();
}

export function PreviousView({
  query,
  page,
  total,
  first,
  opened: preopened,
  canOpenHistory,
}: {
  query: ListQuery<PreviousSessionSort>;
  page: Page<PreviousSession>;
  /** Every session, whatever page is shown. */
  total: number;
  first: string | null;
  /** The days the URL named as open, already fetched. */
  opened: SessionDetail[];
  /** Whether the viewer may open a person's Bootcamp History record. */
  canOpenHistory: boolean;
}) {
  const [opened, setOpened] = useState<Record<string, Opened>>(() =>
    Object.fromEntries(preopened.map((detail) => [detail.date, { detail, loading: null, error: null }])),
  );
  const pathname = usePathname();
  const params = useSearchParams();

  /** Records which days are open in the URL, without a navigation, so Back returns to them. */
  function rememberOpen(dates: string[]) {
    const next = new URLSearchParams(params.toString());
    if (dates.length) next.set(OPEN_PARAM, dates.join(","));
    else next.delete(OPEN_PARAM);
    window.history.replaceState(null, "", withParams(pathname, next));
  }

  /** Changes an opened day; a fetch that lands after its day was closed again changes nothing. */
  function patch(date: string, change: Partial<Opened>) {
    setOpened((all) => (all[date] ? { ...all, [date]: { ...all[date], ...change } } : all));
  }

  async function toggle(date: string) {
    const others = Object.keys(opened).filter((d) => d !== date);
    if (opened[date]) {
      rememberOpen(others);
      setOpened((all) => {
        const rest = { ...all };
        delete rest[date];
        return rest;
      });
      return;
    }
    rememberOpen([...others, date]);
    await load(date);
  }

  /** Opens `date` and fetches the first page of each side. */
  async function load(date: string) {
    setOpened((all) => ({ ...all, [date]: { detail: null, loading: "both", error: null } }));
    try {
      patch(date, { detail: await fetchSession(date), loading: null });
    } catch (e) {
      patch(date, { error: (e as Error).message, loading: null });
    }
  }

  // Back restores this tab from the router's cache as it was first rendered,
  // before any day was opened, so the days the URL has since named are fetched here.
  const restoreOpenDays = useEffectEvent(() => {
    const loaded = new Set(preopened.map((d) => d.date));
    for (const date of parseOpen(params.get(OPEN_PARAM) ?? undefined)) {
      if (!loaded.has(date)) void load(date);
    }
  });
  // Only on arrival: after that, the URL follows what is open rather than the other way round.
  useEffect(() => restoreOpenDays(), []);

  /** The next page of one side, added to what that side already shows. */
  async function more(date: string, stage: SessionStage) {
    const shown = opened[date]?.detail;
    if (!shown) return;
    patch(date, { loading: stage, error: null });
    try {
      const next = await fetchSession(date, { [stage]: shown[stage].page + 1 });
      setOpened((all) => {
        const current = all[date]?.detail;
        if (!current) return all;
        const side = { rows: [...current[stage].rows, ...next[stage].rows], page: next[stage].page, hasMore: next[stage].hasMore };
        return { ...all, [date]: { detail: { ...current, [stage]: side }, loading: null, error: null } };
      });
    } catch (e) {
      patch(date, { error: (e as Error).message, loading: null });
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Previous</h2>
        {first && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {total.toLocaleString()} {total === 1 ? "session" : "sessions"}
            </span>{" "}
            since {formatDate(first)}.
          </p>
        )}
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm lg:max-w-4xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <PlainHeader className="w-10 pl-3 pr-0 sm:pl-5" />
                {COLUMNS.map((c) => (
                  <SortHeader key={c.column} column={c.column} sort={query.sort} dir={query.dir} className={CELL_X}>
                    {c.short ? (
                      <>
                        <span className="sm:hidden">{c.short}</span>
                        <span className="hidden sm:inline">{c.label}</span>
                      </>
                    ) : (
                      c.label
                    )}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((s) => {
                const open = opened[s.date];
                const panel = `session-${s.date}`;
                return (
                  <Fragment key={s.date}>
                    <tr
                      onClick={() => toggle(s.date)}
                      className={cn("cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/30", open && "bg-muted/20")}
                    >
                      <td className="py-2.5 pl-3 pr-0 sm:pl-5">
                        {open?.loading === "both" ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                        )}
                      </td>
                      <td className={cn("whitespace-nowrap py-2.5 font-medium tabular-nums", CELL_X)}>
                        <button
                          type="button"
                          aria-expanded={!!open}
                          aria-controls={open ? panel : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(s.date);
                          }}
                          className="cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {formatDate(s.date)}
                        </button>
                      </td>
                      <td className={cn("py-2.5 tabular-nums text-muted-foreground", CELL_X)}>{s.bootcamp.toLocaleString()}</td>
                      <td className={cn("py-2.5 tabular-nums text-muted-foreground", CELL_X)}>{s.intermediate.toLocaleString()}</td>
                    </tr>
                    {open && open.loading !== "both" && (
                      <tr id={panel} className="border-b bg-muted/10 last:border-b-0">
                        <td colSpan={COLUMNS.length + 1} className={cn("py-4", CELL_X)}>
                          {open.error && (
                            <p role="alert" className="mb-3 text-sm text-destructive">
                              {open.error}
                            </p>
                          )}
                          {open.detail && (
                            <div className="grid gap-4 sm:grid-cols-2">
                              {SIDES.map(({ stage, label, Icon }) => (
                                <AttendeeList
                                  key={stage}
                                  label={label}
                                  Icon={Icon}
                                  count={s[stage]}
                                  attendees={open.detail![stage]}
                                  loading={open.loading === stage}
                                  personHref={canOpenHistory ? (id) => withParams(`${pathname}/${id}`, params) : null}
                                  onMore={() => more(s.date, stage)}
                                />
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                    {page.page > 1 ? "No sessions on this page." : "No bootcamp history yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="sessions" />
        </div>
      </motion.div>
    </motion.div>
  );
}

function AttendeeList({
  label,
  Icon,
  count,
  attendees,
  loading,
  personHref,
  onMore,
}: {
  label: string;
  Icon: LucideIcon;
  count: number;
  attendees: Page<SessionAttendee>;
  loading: boolean;
  /** Where a person's record opens, or null when the viewer may not open one. */
  personHref: ((id: string) => string) | null;
  onMore: () => void;
}) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-xl border bg-card">
      <h3 className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
        <span className="tabular-nums text-foreground">{count.toLocaleString()}</span>
      </h3>
      {attendees.rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No one.</p>
      ) : (
        <ul className="divide-y">
          {attendees.rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {personHref ? (
                    <Link
                      href={personHref(a.id)}
                      className="underline-offset-2 outline-none hover:underline focus-visible:underline"
                    >
                      {a.fullName ?? a.email}
                    </Link>
                  ) : (
                    (a.fullName ?? a.email)
                  )}
                </span>
                {a.fullName && <span className="block truncate text-xs text-muted-foreground">{a.email}</span>}
              </span>
              {!a.active && (
                <Badge variant="secondary" title="Not in the employee list from the last HiBob sync">
                  Inactive
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      {attendees.hasMore && (
        <div className="border-t px-4 py-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={onMore}>
            {loading && <Loader2 className="animate-spin" />}
            Show more
          </Button>
        </div>
      )}
    </section>
  );
}
