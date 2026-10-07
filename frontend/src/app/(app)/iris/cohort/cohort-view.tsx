"use client";

/** The cohort as a table, a row per person with their level in each subject, or as a radar per person against the whole cohort. */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import type { CohortRow, CohortSummary } from "@/lib/iris/cohort";
import { LEVEL_LABELS, SUBJECTS, SUBJECT_KEYS, bandOf } from "@/lib/iris/subjects";
import type { IrisCohortSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { LevelBadge } from "../level-badge";
import { Radar } from "../radar";

type Row = Omit<CohortRow, "finishedAt"> & { finishedAt: string };

const COLUMNS = 6 + SUBJECT_KEYS.length;

const AXES = SUBJECT_KEYS.map((k) => SUBJECTS[k].short);
const valuesOf = (r: Row) => SUBJECT_KEYS.map((k) => r.placements[k] ?? null);

export function CohortView({
  query,
  view,
  summary,
  page,
}: {
  query: ListQuery<IrisCohortSort>;
  view: "table" | "charts";
  summary: CohortSummary | null;
  page: Page<Row>;
}) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const rowLink = useRowLink();

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TableSearch value={query.q} placeholder="Search by name or email" label="Search the cohort" />
        </div>
        <ViewSwitch view={view} />
      </motion.div>

      {view === "charts" && summary ? (
        <motion.div variants={riseChild} className="space-y-4">
          <CohortCharts rows={page.rows} summary={summary} q={query.q} />
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm empty:hidden">
            <Pager page={page} noun="people" />
          </div>
        </motion.div>
      ) : (
        <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-260 text-sm">
              <thead>
                <tr className={HEADER_ROW}>
                  <SortHeader column="person" {...sortProps}>
                    Person
                  </SortHeader>
                  <SortHeader column="track" {...sortProps}>
                    Track
                  </SortHeader>
                  <SortHeader column="completed" {...sortProps}>
                    Done
                  </SortHeader>
                  <PlainHeader>Overall</PlainHeader>
                  {SUBJECT_KEYS.map((k) => (
                    <PlainHeader key={k}>{SUBJECTS[k].short}</PlainHeader>
                  ))}
                  <SortHeader column="finishedAt" {...sortProps}>
                    Last finished
                  </SortHeader>
                  <PlainHeader />
                </tr>
              </thead>
              <tbody>
                {page.rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS} className="px-5 py-8 text-center text-muted-foreground">
                      {query.q ? <>No one matches &ldquo;{query.q}&rdquo;.</> : "Nobody has finished a test yet."}
                    </td>
                  </tr>
                )}
                {page.rows.map((r) => {
                  const href = `/iris/cohort/${encodeURIComponent(r.userId)}`;
                  return (
                    <tr key={r.userId} className={LINK_ROW} onClick={rowLink(href)}>
                      <td className="px-5 py-3">
                        <Link href={href} className="block font-medium group-hover:underline">
                          {r.name || r.email}
                        </Link>
                        {r.name && <span className="block truncate text-xs text-muted-foreground">{r.email}</span>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{r.track ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground tnum">
                        {r.completed} of {SUBJECT_KEYS.length}
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
                      {SUBJECT_KEYS.map((k) => (
                        <td key={k} className="px-3 py-3">
                          {r.placements[k] ? (
                            <LevelBadge level={r.placements[k]} />
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-5 py-3 whitespace-nowrap text-muted-foreground tnum">
                        {new Date(r.finishedAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3 text-right text-xs whitespace-nowrap text-muted-foreground">View path</td>
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
    <div className="flex rounded-lg border p-0.5 text-sm" role="group" aria-label="Show the cohort as">
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

/** The whole cohort first, every shape over the median, then a radar per person against that median. */
function CohortCharts({ rows, summary, q }: { rows: Row[]; summary: CohortSummary; q: string }) {
  const medians = SUBJECT_KEYS.map((k) => summary.subjects[k].median);
  const lowest = summary.weakest.length ? summary.subjects[summary.weakest[0]!].median : null;

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
        {q ? <>No one matches &ldquo;{q}&rdquo;.</> : "Nobody has finished a test yet."}
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
          <span className="w-3.5 border-t-2 border-dashed border-muted-foreground" /> Cohort median
        </span>
        <span>Rings: Beginner · Intermediate · Advanced</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-brand/30 bg-brand-subtle/30 p-4 text-sm shadow-sm">
          <p className="font-medium">Whole cohort</p>
          <p className="text-xs text-muted-foreground tnum">
            {summary.people} {summary.people === 1 ? "person" : "people"}
            {q && <> matching &ldquo;{q}&rdquo;</>}
          </p>
          <p className="text-xs text-muted-foreground">
            {lowest && lowest < 3
              ? `Weakest: ${summary.weakest.map((k) => SUBJECTS[k].short).join(", ")} (median ${LEVEL_LABELS[lowest]})`
              : "Advanced in every subject"}
          </p>
          <div className="mx-auto mt-3 max-w-72 px-2">
            <Radar
              axes={AXES}
              size={260}
              series={[
                ...rows.map((r) => ({ values: valuesOf(r), variant: "faint" as const })),
                { values: medians, variant: "median" as const },
              ]}
              label="Every placement on this page stacked, with the cohort median"
            />
          </div>
        </div>

        {rows.map((r) => {
          const href = `/iris/cohort/${encodeURIComponent(r.userId)}`;
          return (
            <Link
              key={r.userId}
              href={href}
              className="group rounded-2xl border bg-card p-4 text-sm shadow-sm transition-colors hover:bg-muted/30"
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
                {r.completed} of {SUBJECT_KEYS.length} done
              </p>
              <div className="mx-auto mt-3 max-w-72 px-2">
                <Radar
                  axes={AXES}
                  size={260}
                  series={[
                    { values: medians, variant: "median" },
                    { values: valuesOf(r), variant: "person" },
                  ]}
                  label={`${r.name || r.email}'s placement in each subject, against the cohort median`}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
