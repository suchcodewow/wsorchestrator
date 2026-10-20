"use client";

/**
 * Attendees' dietary needs from both intake forms, bootcamp and intermediate
 * together: how many are at each level of criticality, then everyone in the
 * current cohort who has registered, those with restrictions first, the most
 * critical first. A 5 is an allergy or a religious restriction, so it is
 * marked wherever it shows.
 */

import { Fragment, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { UNREGISTERED_PREFIX, type DietarySort, type UnregisteredSort } from "@/lib/list-specs";
import { DIETARY_LEVELS } from "@/lib/logistics/intake-values";
import type { IntakeFormId } from "@/db/schema";
import type { DietaryCounts, DietaryRow, UnregisteredRow } from "@/lib/logistics/responses";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

const COLUMNS: { column: DietarySort; label: string; className?: string }[] = [
  { column: "critical", label: "Critical", className: "w-28" },
  { column: "name", label: "Name" },
  { column: "email", label: "Email" },
];

/** What a 5 means; the other levels are only their number. */
const TOP_LABEL = "Allergy or religious";

/** Which group someone is with, from the form they answered: both are there at once and catered for together. */
const PROGRAMS: Record<IntakeFormId, string> = { bootcamp: "Bootcamp", intermediate: "Intermediate" };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function DietaryView({
  query,
  page,
  counts,
  unregisteredQuery,
  unregistered,
}: {
  query: ListQuery<DietarySort>;
  page: Page<DietaryRow>;
  counts: DietaryCounts;
  /** Who in the current cohort has yet to register, with its own sort and page. */
  unregisteredQuery: ListQuery<UnregisteredSort>;
  unregistered: Page<UnregisteredRow>;
}) {
  const bars = [
    ...DIETARY_LEVELS.map((level) => ({ key: String(level), level, n: counts.byLevel[level] })),
    { key: "unrated", level: null, n: counts.unrated },
  ];
  const most = Math.max(1, ...bars.map((b) => b.n));
  // The two groups that need no catering for start folded, so the restrictions and the
  // not-registered count sit together near the top; a search, sort or page turn opens them.
  const [noneToggled, setShowNone] = useState(query.page > 1);
  const [unregisteredToggled, setShowUnregistered] = useState(
    unregisteredQuery.page > 1 || unregisteredQuery.sort !== "name",
  );
  // A search shows every match, folded or not.
  const showNone = noneToggled || query.q !== "";
  const showUnregistered = unregisteredToggled || query.q !== "";

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Dietary needs</h2>
        <p className="text-base">
          <span className="font-semibold">{plural(counts.responded, "attendee", "attendees")}</span>{" "}
          <span className="text-muted-foreground">registered:</span>{" "}
          <span className="font-medium">{counts.respondedByStage.bootcamp.toLocaleString()}</span>{" "}
          <span className="text-muted-foreground">Bootcamp,</span>{" "}
          <span className="font-medium">{counts.respondedByStage.intermediate.toLocaleString()}</span>{" "}
          <span className="text-muted-foreground">Intermediate</span>
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{counts.withNeeds.toLocaleString()}</span> with dietary
          restrictions, of whom <span className="font-medium text-foreground">{counts.byLevel[5].toLocaleString()}</span>{" "}
          rated their needs 5
          {counts.notRegistered > 0 && (
            <>
              {" "}
              ·{" "}
              <a
                href="#not-registered"
                onClick={() => setShowUnregistered(true)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {plural(counts.notRegistered, "more", "more")} in the current cohort{" "}
                {counts.notRegistered === 1 ? "hasn't" : "haven't"} registered yet
              </a>
            </>
          )}
        </p>
      </motion.div>

      <motion.figure variants={riseChild} className="space-y-3 rounded-2xl border bg-card px-5 py-4 shadow-sm">
        <figcaption className="text-sm font-medium">Attendees by how critical their needs are</figcaption>
        <ul className="space-y-1.5">
          {bars.map(({ key, level, n }) => {
            const label = level === null ? "No level given" : level === 5 ? `5 · ${TOP_LABEL}` : String(level);
            const top = level === 5;
            return (
              <li
                key={key}
                title={`${plural(n, "attendee", "attendees")}: ${label}`}
                className="grid grid-cols-[11rem_1fr_2.5rem] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-muted/40"
              >
                <span className={cn("flex items-center gap-1.5 truncate", top ? "font-medium" : "text-muted-foreground")}>
                  {top && <TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />}
                  {label}
                </span>
                <span className="h-3 overflow-hidden rounded-r bg-muted/40">
                  <span
                    className={cn("block h-full rounded-r", top ? "bg-destructive" : level === null ? "bg-muted-foreground/40" : "bg-brand")}
                    style={{ width: n ? `max(4px, ${(n / most) * 100}%)` : 0 }}
                  />
                </span>
                <span className="text-right font-medium tabular-nums">{n.toLocaleString()}</span>
              </li>
            );
          })}
        </ul>
      </motion.figure>

      <motion.div variants={riseChild}>
        <TableSearch
          value={query.q}
          placeholder="Search by name, email or need"
          label="Search dietary needs"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label, className }) => (
                  <SortHeader key={column} column={column} sort={query.sort} dir={query.dir} className={className}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader>Dietary needs</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r, i) => (
                <Fragment key={r.email}>
                  {/* A heading where each group starts on this page: those with restrictions come first. */}
                  {(i === 0 || page.rows[i - 1]!.restricted !== r.restricted) && (
                    <tr className="border-b bg-muted/40">
                      <th colSpan={4} scope="rowgroup" className="px-5 py-2 text-left text-xs font-medium">
                        {r.restricted ? (
                          `Dietary restrictions · ${plural(counts.withNeeds, "person", "people")}`
                        ) : (
                          <GroupToggle open={showNone} onToggle={() => setShowNone((o) => !o)}>
                            No dietary restrictions · {plural(counts.responded - counts.withNeeds, "person", "people")}
                          </GroupToggle>
                        )}
                      </th>
                    </tr>
                  )}
                {(r.restricted || showNone) && (
                <tr className={cn("border-b last:border-b-0", r.critical === 5 && "bg-destructive/5")}>
                  <td className="px-5 py-3">
                    {r.restricted ? <Level level={r.critical} /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-medium">{r.name || "—"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {PROGRAMS[r.stage]}
                      {r.form !== r.stage && ` · from their ${PROGRAMS[r.form]} registration`}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.email}</td>
                  <td className="px-5 py-3 whitespace-pre-line">
                    {!r.restricted ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      r.needs || <span className="text-muted-foreground">Not described</span>
                    )}
                  </td>
                </tr>
                )}
                </Fragment>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No one matches that search." : "No one in the current cohort has sent a registration form yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} noun="attendees" />
      </motion.div>

      {counts.notRegistered > 0 && (
        <motion.section
          id="not-registered"
          variants={riseChild}
          className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
        >
          <h3 className={cn("px-5 py-3 text-sm font-medium", showUnregistered && "border-b")}>
            <GroupToggle open={showUnregistered} onToggle={() => setShowUnregistered((o) => !o)}>
              Not registered yet · {plural(counts.notRegistered, "person", "people")}
            </GroupToggle>
          </h3>
          {showUnregistered && (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEADER_ROW}>
                  <SortHeader column="name" sort={unregisteredQuery.sort} dir={unregisteredQuery.dir} prefix={UNREGISTERED_PREFIX}>
                    Name
                  </SortHeader>
                  <SortHeader column="stage" sort={unregisteredQuery.sort} dir={unregisteredQuery.dir} prefix={UNREGISTERED_PREFIX}>
                    Program
                  </SortHeader>
                  <SortHeader column="email" sort={unregisteredQuery.sort} dir={unregisteredQuery.dir} prefix={UNREGISTERED_PREFIX}>
                    Email
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {unregistered.rows.map((u) => (
                  <tr key={u.email} className="border-b last:border-b-0">
                    <td className="px-5 py-3 font-medium">{u.name || "—"}</td>
                    <td className="px-5 py-3">{PROGRAMS[u.stage]}</td>
                    <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                  </tr>
                ))}
                {unregistered.rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-center text-muted-foreground">
                      No one still to register matches that search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t empty:hidden">
            <Pager page={unregistered} noun="people" prefix={UNREGISTERED_PREFIX} />
          </div>
          </>
          )}
        </motion.section>
      )}
    </motion.div>
  );
}

/** A group's heading that folds its rows away and back, its chevron saying which. */
function GroupToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="-mx-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 text-left outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      {children}
    </button>
  );
}

/** A level 1 to 5, with a 5 marked as critical; a dash where none was given. */
function Level({ level }: { level: number | null }) {
  if (level === null) return <span className="text-muted-foreground">—</span>;
  if (level === 5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <TriangleAlert className="size-3" aria-hidden />5 Critical
      </span>
    );
  }
  return <span className="tabular-nums">{level}</span>;
}
