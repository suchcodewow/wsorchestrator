"use client";

/**
 * How many candidates are in each stage, then a page of each: bootcamp
 * candidates, then intermediate ones. One search box serves both tables. An
 * undecided track opens a choice of list for the person's title.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CircleHelp, GraduationCap, Loader2, Upload, Users, type LucideIcon } from "lucide-react";
import { HEADER_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EvalsTitleList } from "@/db/schema";
import type { CandidateStage, CurrentCohortMember } from "@/lib/evals/current-cohort";
import type { CandidateCutoffs } from "@/lib/evals/settings";
import { TITLE_LIST_LABELS } from "@/lib/evals/title-lists";
import type { CurrentCohortSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { ActiveBootcamp } from "@/lib/scheduler/bootcamps";
import { formatDate, formatWhen } from "../../cohort-settings/format";

type StageList = { query: ListQuery<CurrentCohortSort>; page: Page<CurrentCohortMember> };

const CARDS: { key: CandidateStage | "undecided"; label: string; Icon: LucideIcon }[] = [
  { key: "bootcamp", label: "Bootcamp candidates", Icon: Users },
  { key: "intermediate", label: "Intermediate candidates", Icon: GraduationCap },
  { key: "undecided", label: "Undecided", Icon: CircleHelp },
];

const STAGES: Record<CandidateStage, { heading: string; load: string; columns: { column: CurrentCohortSort; label: string }[] }> = {
  bootcamp: {
    heading: "Bootcamp candidates",
    load: "Load Final Bootcamp Scores",
    columns: [
      { column: "fullName", label: "Name" },
      { column: "email", label: "Email" },
      { column: "title", label: "Title" },
      { column: "department", label: "Department" },
      { column: "reportsToName", label: "Manager" },
      { column: "track", label: "Track" },
    ],
  },
  intermediate: {
    heading: "Intermediate candidates",
    load: "Load Final Intermediate Scores",
    columns: [
      { column: "fullName", label: "Name" },
      { column: "email", label: "Email" },
      { column: "title", label: "Title" },
      { column: "department", label: "Department" },
      { column: "reportsToName", label: "Manager" },
      { column: "track", label: "Track" },
      { column: "btcDate", label: "BTC date" },
    ],
  },
};

const TRACK_LABELS = { sales: "Sales", engineer: "Engineer", undecided: "Undecided" } as const;

const SORT_CHOICES: { list: EvalsTitleList; label: string }[] = [
  { list: "sales", label: "Sales" },
  { list: "engineer", label: "Engineer" },
  { list: "ignored", label: "Ignore this title" },
];

const ERRORS: Record<string, string> = {
  not_found: "That person is no longer in the org — reload the page.",
  not_undecided: "Someone already gave that person a track — reload the page.",
  no_title: "HiBob gives that person no title to sort.",
  forbidden: "Your own role changed — reload the page.",
};

export function CurrentCohortView({
  stages,
  counts,
  syncedAt,
  cutoffs,
  activeBootcamp,
  canSort,
}: {
  stages: Record<CandidateStage, StageList>;
  /** Everyone in each stage, and everyone undecided, whatever the search. */
  counts: Record<CandidateStage | "undecided", number>;
  syncedAt: string | null;
  cutoffs: CandidateCutoffs;
  activeBootcamp: ActiveBootcamp | null;
  /** Whether the viewer may put an undecided title on a list. */
  canSort: boolean;
}) {
  const router = useRouter();
  const [sorting, setSorting] = useState<CurrentCohortMember | null>(null);
  const [busy, setBusy] = useState<EvalsTitleList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const total = counts.bootcamp + counts.intermediate;

  async function sortTitle(member: CurrentCohortMember, list: EvalsTitleList) {
    setBusy(list);
    setError(null);
    try {
      const res = await fetch("/api/cohorts/current/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: member.email, list }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return;
      }
      const label = TITLE_LIST_LABELS[body.list as EvalsTitleList];
      const people = `${body.retracked} ${body.retracked === 1 ? "person" : "people"}`;
      setNotice(
        body.added
          ? `Added “${body.title}” to ${label}; ${people} sorted.`
          : `“${body.title}” was already on ${label}; ${people} sorted.`,
      );
      setSorting(null);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="grid gap-4 sm:grid-cols-3 lg:max-w-4xl">
        {CARDS.map(({ key, label, Icon }) => (
          <div key={key} className="flex items-center gap-4 rounded-2xl border bg-card px-5 py-4 shadow-sm">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-5 text-muted-foreground" />
            </span>
            <div>
              <div className="text-3xl font-medium tabular-nums">{counts[key].toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">{label}</div>
            </div>
          </div>
        ))}
      </motion.div>

      <motion.div variants={riseChild} className="space-y-1.5 pt-4">
        <h2 className="text-xl font-medium tracking-tight">Current</h2>
        {syncedAt && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{total.toLocaleString()} people</span> still to train, as of
            the HiBob sync on {formatWhen(syncedAt)}
            {cutoffs.startDateOnOrAfter && <>, started on or after {formatDate(cutoffs.startDateOnOrAfter)}</>}
            {cutoffs.activeEffectiveDateAfter && (
              <>
                {cutoffs.startDateOnOrAfter ? " and" : ","} in their position since after{" "}
                {formatDate(cutoffs.activeEffectiveDateAfter)}
              </>
            )}
            .
          </p>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          {activeBootcamp ? (
            <>
              Active bootcamp:{" "}
              <span className="font-medium text-foreground">{formatDate(activeBootcamp.startDate)}</span>,{" "}
              {activeBootcamp.btcDays} days
              {activeBootcamp.intDays !== null && `, with ${activeBootcamp.intDays} days of intermediate`}.
            </>
          ) : (
            <>
              No bootcamp is active.{" "}
              <Link href="/scheduler" className="underline underline-offset-2 hover:text-foreground">
                Scheduler
              </Link>
            </>
          )}
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch
          value={stages.bootcamp.query.q}
          placeholder="Search by name, title, manager or track"
          label="Search the candidates"
        />
      </motion.div>

      {notice && (
        <motion.p variants={riseChild} role="status" className="text-sm text-muted-foreground">
          {notice}
        </motion.p>
      )}

      {(Object.keys(STAGES) as CandidateStage[]).map((stage) => {
        const { heading, load, columns } = STAGES[stage];
        const { query, page } = stages[stage];
        const sortProps = { sort: query.sort, dir: query.dir, prefix: stage };
        return (
          <motion.div key={stage} variants={riseChild} className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-medium tracking-tight">
                {heading} · {counts[stage].toLocaleString()}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Waits for eVals judging</span>
                <Button variant="secondary" disabled>
                  <Upload />
                  {load}
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-200 text-sm">
                  <thead>
                    <tr className={HEADER_ROW}>
                      {columns.map((c) => (
                        <SortHeader key={c.column} column={c.column} {...sortProps}>
                          {c.label}
                        </SortHeader>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((m) => (
                      <tr key={m.email} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                        <td className="px-5 py-2.5 font-medium">{m.fullName}</td>
                        <td className="px-5 py-2.5 text-muted-foreground">{m.email}</td>
                        <td className="px-5 py-2.5">{m.title || "—"}</td>
                        <td className="px-5 py-2.5 text-muted-foreground">{m.department || "—"}</td>
                        <td className="px-5 py-2.5 text-muted-foreground">
                          {m.reportsToName || m.reportsToEmail || "—"}
                        </td>
                        <td className="px-5 py-2.5">
                          {m.track === "undecided" && canSort ? (
                            <button
                              type="button"
                              onClick={() => {
                                setError(null);
                                setSorting(m);
                              }}
                              className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              aria-label={`Choose a track for ${m.fullName}`}
                            >
                              <Badge variant="outline" className="cursor-pointer border-dashed hover:bg-accent">
                                Undecided
                              </Badge>
                            </button>
                          ) : m.track === "undecided" ? (
                            <Badge variant="outline" className="border-dashed">
                              Undecided
                            </Badge>
                          ) : (
                            TRACK_LABELS[m.track]
                          )}
                        </td>
                        {stage === "intermediate" && (
                          <td className="px-5 py-2.5 tabular-nums text-muted-foreground">{formatDate(m.btcDate)}</td>
                        )}
                      </tr>
                    ))}
                    {page.rows.length === 0 && (
                      <tr>
                        <td colSpan={columns.length} className="px-5 py-8 text-center text-muted-foreground">
                          {counts[stage] ? "No one matches." : `No ${heading.toLowerCase()}.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t empty:hidden">
                <Pager page={page} noun="people" prefix={stage} />
              </div>
            </div>
          </motion.div>
        );
      })}

      <Dialog open={sorting !== null} onOpenChange={(open) => !open && busy === null && setSorting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sorting?.title ? `Sort “${sorting.title}”` : "No title to sort"}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {sorting?.title
                ? `${sorting.fullName}, and everyone else in the org with this title, follows the list you pick.`
                : `HiBob gives ${sorting?.fullName ?? "this person"} no title.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {SORT_CHOICES.map(({ list, label }) => (
              <Button
                key={list}
                variant={list === "ignored" ? "outline" : "brand"}
                disabled={!sorting?.title || busy !== null}
                onClick={() => sorting && sortTitle(sorting, list)}
              >
                {busy === list && <Loader2 className="animate-spin" />}
                {label}
              </Button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setSorting(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
