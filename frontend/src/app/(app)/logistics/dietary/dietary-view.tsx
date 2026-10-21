"use client";

/**
 * Attendees' dietary needs from both intake forms, bootcamp and intermediate
 * together or either alone: what was marked critical, most-checked first, and
 * who wrote in "Other" and marked it critical; then the same for what was not
 * marked critical; then who has yet to register. Critical is what the attendee
 * marked as a medical need, so it is red wherever it shows.
 */

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import {
  CRITICAL_WRITE_IN_PREFIX,
  DIETARY_STAGES,
  UNREGISTERED_PREFIX,
  WRITE_IN_PREFIX,
  type DietaryStage,
  type UnregisteredSort,
  type WriteInSort,
} from "@/lib/list-specs";
import { DIETARY_OTHER } from "@/lib/logistics/intake-values";
import type { IntakeFormId } from "@/db/schema";
import type {
  DietaryCounts,
  DietaryItemCount,
  UnregisteredRow,
  WriteInRow,
} from "@/lib/logistics/responses";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

/** Which group someone is with: both are there at once and catered for together. */
const PROGRAMS: Record<IntakeFormId, string> = { bootcamp: "Bootcamp", intermediate: "Intermediate" };

const STAGE_LABELS: Record<DietaryStage, string> = { all: "All", bootcamp: "Bootcamp", intermediate: "Intermediate" };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function DietaryView({
  stage,
  counts,
  criticalQuery,
  criticalWriteIns,
  otherQuery,
  otherWriteIns,
  unregisteredQuery,
  unregistered,
}: {
  stage: DietaryStage;
  counts: DietaryCounts;
  /** Who wrote in "Other" and marked it critical, with their own sort and page. */
  criticalQuery: ListQuery<WriteInSort>;
  criticalWriteIns: Page<WriteInRow>;
  /** Who wrote in "Other" without marking it critical. */
  otherQuery: ListQuery<WriteInSort>;
  otherWriteIns: Page<WriteInRow>;
  /** Who in the current cohort has yet to register, with its own sort and page. */
  unregisteredQuery: ListQuery<UnregisteredSort>;
  unregistered: Page<UnregisteredRow>;
}) {
  // The not-registered group starts folded, so the needs sit together near the top; a search, sort or page turn opens it.
  const [unregisteredToggled, setShowUnregistered] = useState(
    unregisteredQuery.page > 1 || unregisteredQuery.sort !== "name",
  );
  const showUnregistered = unregisteredToggled || unregisteredQuery.q !== "";
  const otherCount = (items: DietaryItemCount[]) => items.find((c) => c.item === DIETARY_OTHER)?.count ?? 0;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-6">
      <motion.div variants={riseChild} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-medium tracking-tight">Dietary needs</h2>
          <StageToggle stage={stage} />
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="text-base font-semibold text-foreground">
            {plural(counts.responded, "attendee", "attendees")}
          </span>{" "}
          registered · <span className="font-medium text-foreground">{counts.withNeeds.toLocaleString()}</span> with
          dietary restrictions, of whom{" "}
          <span className="font-medium text-foreground">{counts.withCritical.toLocaleString()}</span> marked something
          critical
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

      <ItemsCard
        title="Marked critical"
        items={counts.critical}
        critical
        empty="No one has marked anything critical."
        writeIns={{
          title: "Wrote in “Other” and marked it critical",
          count: otherCount(counts.critical),
          page: criticalWriteIns,
          query: criticalQuery,
          prefix: CRITICAL_WRITE_IN_PREFIX,
        }}
      />

      <ItemsCard
        title="Not marked critical"
        items={counts.notCritical}
        empty="No one has checked anything that is not critical."
        writeIns={{
          title: "Wrote in “Other” without marking it critical",
          count: otherCount(counts.notCritical),
          page: otherWriteIns,
          query: otherQuery,
          prefix: WRITE_IN_PREFIX,
        }}
      />

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
              <div className="px-5 py-3">
                <TableSearch
                  value={unregisteredQuery.q}
                  placeholder="Search by name or email"
                  label="Search people not registered yet"
                />
              </div>
              <div className="overflow-x-auto border-t">
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

/**
 * All, Bootcamp or Intermediate: which attendees every number and list on the
 * page is for. It is the `stage` in the URL, and a different one starts each
 * list from its first page.
 */
function StageToggle({ stage }: { stage: DietaryStage }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(next: DietaryStage) {
    const query = new URLSearchParams(params.toString());
    if (next === "all") query.delete("stage");
    else query.set("stage", next);
    for (const key of [...query.keys()]) if (key === "page" || key.endsWith(".page")) query.delete(key);
    const qs = query.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div role="group" aria-label="Attendees" className="flex gap-2">
      {DIETARY_STAGES.map((s) => {
        const on = stage === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            disabled={pending}
            onClick={() => pick(s)}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait",
              on
                ? "border-brand-border bg-brand-subtle text-foreground"
                : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {STAGE_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

/** One group of items with how many people checked each, then who wrote in "Other" among them. */
function ItemsCard({
  title,
  items,
  critical = false,
  empty,
  writeIns,
}: {
  title: string;
  items: DietaryItemCount[];
  critical?: boolean;
  empty: string;
  writeIns: {
    title: string;
    count: number;
    page: Page<WriteInRow>;
    query: ListQuery<WriteInSort>;
    prefix: string;
  };
}) {
  const most = Math.max(1, ...items.map((c) => c.count));
  return (
    <motion.section variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="space-y-3 px-5 py-4">
        <h3 className={cn("flex items-center gap-1.5 text-sm font-medium", critical && "text-destructive")}>
          {critical && <TriangleAlert className="size-4 shrink-0" aria-hidden />}
          {title}
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map(({ item, count }) => (
              <li
                key={item}
                title={`${plural(count, "attendee", "attendees")}: ${item}`}
                className="grid grid-cols-[11rem_1fr_2.5rem] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-muted/40"
              >
                <span className="truncate">{item}</span>
                <span className="h-3 overflow-hidden rounded-r bg-muted/40">
                  <span
                    className={cn("block h-full rounded-r", critical ? "bg-destructive" : "bg-brand")}
                    style={{ width: `max(4px, ${(count / most) * 100}%)` }}
                  />
                </span>
                <span className="text-right font-medium tabular-nums">{count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {writeIns.count > 0 && <WriteIns {...writeIns} />}
    </motion.section>
  );
}

/** Who wrote in "Other", and what they wrote. */
function WriteIns({
  title,
  count,
  page,
  query,
  prefix,
}: {
  title: string;
  count: number;
  page: Page<WriteInRow>;
  query: ListQuery<WriteInSort>;
  prefix: string;
}) {
  return (
    <div>
      <h4 className="px-5 py-3 text-xs font-medium">
        {title} · {plural(count, "person", "people")}
      </h4>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-sm">
          <thead>
            <tr className={HEADER_ROW}>
              <SortHeader column="name" sort={query.sort} dir={query.dir} prefix={prefix}>
                Name
              </SortHeader>
              <SortHeader column="stage" sort={query.sort} dir={query.dir} prefix={prefix}>
                Program
              </SortHeader>
              <PlainHeader>What they wrote</PlainHeader>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((r) => (
              <tr key={r.email} className="border-b last:border-b-0">
                <td className="px-5 py-3">
                  <span className="font-medium">{r.name || "—"}</span>
                  <span className="block text-xs text-muted-foreground">{r.email}</span>
                </td>
                <td className="px-5 py-3">{PROGRAMS[r.stage]}</td>
                <td className="px-5 py-3 whitespace-pre-line">{r.text}</td>
              </tr>
            ))}
            {page.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-muted-foreground">
                  No one has written anything in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t empty:hidden">
        <Pager page={page} noun="people" prefix={prefix} />
      </div>
    </div>
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
