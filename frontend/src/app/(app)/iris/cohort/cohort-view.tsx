"use client";

/** The cohort table: one row per person, their level in each subject, and their weighted overall score. */

import Link from "next/link";
import { motion } from "framer-motion";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import type { CohortRow } from "@/lib/iris/cohort";
import { SUBJECTS, SUBJECT_KEYS, bandOf } from "@/lib/iris/subjects";
import type { IrisCohortSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { LevelBadge } from "../level-badge";

type Row = Omit<CohortRow, "finishedAt"> & { finishedAt: string };

const COLUMNS = 6 + SUBJECT_KEYS.length;

export function CohortView({ query, page }: { query: ListQuery<IrisCohortSort>; page: Page<Row> }) {
  const sortProps = { sort: query.sort, dir: query.dir };
  const rowLink = useRowLink();

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name or email" label="Search the cohort" />
      </motion.div>

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
    </motion.div>
  );
}
