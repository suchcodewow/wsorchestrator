"use client";

/**
 * The Records: a row per person with a sitting, their level in each subject,
 * or a radar per person against every Participant. Choosing someone opens
 * their sittings in a pane below; choosing them again closes it.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import type { CohortSummary } from "@/lib/iris/cohort";
import type { RecordRow } from "@/lib/iris/participants";
import { LEVEL_LABELS, SUBJECTS, OPEN_SUBJECT_KEYS, bandOf } from "@/lib/iris/subjects";
import type { IrisRecordSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { Radar } from "@/app/(app)/diagnostic/radar";
import { PersonView, type Detail } from "./person-view";
import { ScoreMenu } from "./score-menu";

type Row = Omit<RecordRow, "addedAt" | "finishedAt"> & { addedAt: string | null; finishedAt: string | null };

const COLUMNS = 6 + OPEN_SUBJECT_KEYS.length;

const AXES = OPEN_SUBJECT_KEYS.map((k) => SUBJECTS[k].short);
const valuesOf = (r: Row) => OPEN_SUBJECT_KEYS.map((k) => r.placements[k] ?? null);

const day = (iso: string) => new Date(iso).toLocaleDateString();

/** This page's URL with `person` set, or taken off for null. */
function usePersonHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (userId: string | null) => {
    const next = new URLSearchParams(params);
    if (userId) next.set("person", userId);
    else next.delete("person");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
}

export function RecordsView({
  query,
  view,
  summary,
  total,
  page,
  detail,
  detailSummary,
}: {
  query: ListQuery<IrisRecordSort>;
  view: "table" | "charts";
  summary: CohortSummary;
  total: number;
  page: Page<Row>;
  detail: Detail | null;
  detailSummary: CohortSummary;
}) {
  const router = useRouter();
  const sortProps = { sort: query.sort, dir: query.dir };
  const rowLink = useRowLink();
  const personHref = usePersonHref();
  const pane = useRef<HTMLDivElement>(null);
  const open = detail?.userId ?? null;
  // Choosing someone again closes them.
  const hrefFor = (userId: string) => personHref(open === userId ? null : userId);

  useEffect(() => {
    if (open) pane.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TableSearch value={query.q} placeholder="Search by name or email" label="Search the Records" />
        </div>
        <ViewSwitch view={view} />
      </motion.div>

      {view === "charts" ? (
        <motion.div variants={riseChild} className="space-y-4">
          <RecordCharts rows={page.rows} summary={summary} q={query.q} open={open} hrefFor={hrefFor} />
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm empty:hidden">
            <Pager page={page} noun="people" />
          </div>
        </motion.div>
      ) : (
        <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-280 text-sm">
              <thead>
                <tr className={HEADER_ROW}>
                  <SortHeader column="person" {...sortProps}>
                    Person · {total.toLocaleString()}
                  </SortHeader>
                  <SortHeader column="added" {...sortProps}>
                    Enrolled
                  </SortHeader>
                  <SortHeader column="track" {...sortProps}>
                    Track
                  </SortHeader>
                  <SortHeader column="completed" {...sortProps}>
                    Done
                  </SortHeader>
                  <PlainHeader>Overall</PlainHeader>
                  {OPEN_SUBJECT_KEYS.map((k) => (
                    <PlainHeader key={k}>{SUBJECTS[k].short}</PlainHeader>
                  ))}
                  <SortHeader column="finishedAt" {...sortProps}>
                    Last finished
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {page.rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS} className="px-5 py-8 text-center text-muted-foreground">
                      {query.q ? <>No one matches &ldquo;{query.q}&rdquo;.</> : "No one has started a test yet."}
                    </td>
                  </tr>
                )}
                {page.rows.map((r) => {
                  const href = hrefFor(r.userId);
                  return (
                    <tr
                      key={r.userId}
                      aria-selected={open === r.userId}
                      className={cn(LINK_ROW, open === r.userId && "bg-brand-subtle/50 hover:bg-brand-subtle/50")}
                      onClick={rowLink(() => router.push(href, { scroll: false }))}
                    >
                      <td className="px-5 py-3">
                        <Link href={href} scroll={false} className="block font-medium group-hover:underline">
                          {r.name || r.email}
                        </Link>
                        {r.name && <span className="block truncate text-xs text-muted-foreground">{r.email}</span>}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                        {!r.enrolled ? "Not a Participant" : r.manual ? (r.addedBy ?? "—") : "Bootcamp"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{r.track ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground tnum">
                        {r.completed} of {OPEN_SUBJECT_KEYS.length}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {r.composite === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span className="font-medium tnum">{r.composite}</span>{" "}
                            <span className="text-xs text-muted-foreground">{bandOf(r.composite)}</span>
                          </>
                        )}
                      </td>
                      {OPEN_SUBJECT_KEYS.map((k) => (
                        <td key={k} className="px-3 py-3">
                          {r.placements[k] ? (
                            <ScoreMenu
                              userId={r.userId}
                              subject={k}
                              form="A"
                              level={r.placements[k]}
                              who={r.name || r.email}
                            />
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-5 py-3 whitespace-nowrap text-muted-foreground tnum">
                        {r.finishedAt ? day(r.finishedAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t empty:hidden">
            <Pager page={page} noun="people" />
          </div>
        </motion.div>
      )}

      <div ref={pane} className="scroll-mt-6">
        {detail && (
          <div className="rounded-2xl border bg-muted/20 p-5">
            <PersonView detail={detail} summary={detailSummary} closeHref={personHref(null)} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Table or charts, kept in the URL beside the search and the page. */
function ViewSwitch({ view }: { view: "table" | "charts" }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (v: "table" | "charts") => {
    const next = new URLSearchParams(params);
    if (v === "charts") next.set("view", "charts");
    else next.delete("view");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <div className="flex rounded-lg border p-0.5 text-sm" role="group" aria-label="Show the Records as">
      {(["table", "charts"] as const).map((v) => (
        <Link
          key={v}
          href={href(v)}
          aria-current={view === v ? "true" : undefined}
          className={cn(
            "rounded-md px-3 py-1 transition-colors",
            view === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "table" ? "Table" : "Charts"}
        </Link>
      ))}
    </div>
  );
}

/** Every Participant first, every shape over the median, then a radar per person against that median. */
function RecordCharts({
  rows: all,
  summary,
  q,
  open,
  hrefFor,
}: {
  rows: Row[];
  summary: CohortSummary;
  q: string;
  open: string | null;
  hrefFor: (userId: string) => string;
}) {
  // Someone with nothing finished has no shape to draw.
  const rows = all.filter((r) => r.completed > 0);
  const medians = OPEN_SUBJECT_KEYS.map((k) => summary.subjects[k].median);
  const lowest = summary.weakest.length ? summary.subjects[summary.weakest[0]!].median : null;

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
        {q ? <>No one matches &ldquo;{q}&rdquo;.</> : "No one on this page has finished a test yet."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand" /> Their placement
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 border-t-2 border-dashed border-muted-foreground" /> Participants&apos; median
        </span>
        <span>Rings: 101 · 201 · 301</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-brand/30 bg-brand-subtle/30 p-4 text-sm shadow-sm">
          <p className="font-medium">Every Participant</p>
          <p className="text-xs text-muted-foreground tnum">
            {summary.people} {summary.people === 1 ? "person" : "people"}
            {q && <> matching &ldquo;{q}&rdquo;</>}
          </p>
          <p className="text-xs text-muted-foreground">
            {lowest && lowest < 3
              ? `Weakest: ${summary.weakest.map((k) => SUBJECTS[k].short).join(", ")} (median ${LEVEL_LABELS[lowest]})`
              : "301 in every subject"}
          </p>
          <div className="mx-auto mt-3 max-w-72 px-2">
            <Radar
              axes={AXES}
              size={260}
              series={[
                ...rows.map((r) => ({ values: valuesOf(r), variant: "faint" as const })),
                { values: medians, variant: "median" as const },
              ]}
              label="Every placement on this page stacked, with the Participants' median"
            />
          </div>
        </div>

        {rows.map((r) => (
          <Link
            key={r.userId}
            href={hrefFor(r.userId)}
            scroll={false}
            aria-current={open === r.userId ? "true" : undefined}
            className={cn(
              "group rounded-2xl border bg-card p-4 text-sm shadow-sm transition-colors hover:bg-muted/30",
              open === r.userId && "border-brand-border bg-brand-subtle/40",
            )}
          >
            <p className="truncate font-medium group-hover:underline">{r.name || r.email}</p>
            <p className="text-xs text-muted-foreground tnum">
              {r.track ?? "No track"}
              {r.composite !== null && (
                <>
                  {" "}
                  · {r.composite}, {bandOf(r.composite)}
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground tnum">
              {r.completed} of {OPEN_SUBJECT_KEYS.length} done
              {!r.enrolled && <> · not a Participant</>}
            </p>
            <div className="mx-auto mt-3 max-w-72 px-2">
              <Radar
                axes={AXES}
                size={260}
                series={[
                  { values: medians, variant: "median" },
                  { values: valuesOf(r), variant: "person" },
                ]}
                label={`${r.name || r.email}'s placement in each subject, against the Participants' median`}
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
