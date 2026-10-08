"use client";

/**
 * Reporting → Canary Wire History: each rep's share of their own Canary Wire
 * lineup finished, month by month over the last six months, under the same
 * scope, filters and series links as the Canary Wire tab.
 *
 * The grid scrolls with the page, its headers pinned in a strip under the top
 * bar, as the Canary Wire's heat map does and for the same reason: a table in
 * a scroll box of its own keeps the wheel at its last row.
 */

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, Download, ExternalLink } from "lucide-react";
import { PillSwitch } from "@/components/pill-switch";
import type { CanaryWireHistory, HistoryRep, MonthMark, MonthRate } from "@/lib/canary-wire/history";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { RolePills, SearchBox } from "../canary-wire/filters";
import { HEAD, MGR_BG, PILL, PIN_LEFT, ROW_BG, TABLE } from "../canary-wire/ui";

/** Green only for everything done; amber from half; red below. */
function tone(pct: number | null): string {
  if (pct === null) return "bg-muted text-muted-foreground";
  if (pct >= 100) return "bg-emerald-500 text-white";
  if (pct >= 50) return "bg-amber-400 text-amber-950";
  return "bg-red-500 text-white";
}

const LEGEND: [string, string][] = [
  [tone(100), "100%"],
  [tone(75), "50–99%"],
  [tone(0), "Under 50%"],
  [tone(null), "Didn't count that month, or owed nothing"],
];

const pctText = (pct: number | null) => (pct === null ? "—" : `${Math.round(pct)}%`);

function Mark({ mark, month }: { mark: MonthMark; month: string }) {
  const title = mark.exempt
    ? `${month}: not accountable yet (pre-bootcamp, or a new hire)`
    : mark.pct === null
      ? `${month}: nothing assigned`
      : `${month}: ${mark.completed} of ${mark.assigned} modules finished`;
  return (
    <span title={title} className={cn("inline-flex min-w-14 justify-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums", tone(mark.pct))}>
      {pctText(mark.pct)}
    </span>
  );
}

/**
 * A team's month: the share of its reps who finished everything they owed.
 * The badge is centred in its column exactly as a rep's is, and the count
 * hangs off its right edge, outside the centring, so a column of badges lines
 * up from the manager's row down through the reps'.
 */
function Rate({ rate, month }: { rate: MonthRate; month: string }) {
  const title = rate.learners ? `${month}: ${rate.finished} of ${rate.learners} finished everything` : `${month}: nobody owed anything`;
  return (
    <span title={title} className="relative inline-flex">
      <span className={cn("inline-flex min-w-14 justify-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums opacity-80", tone(rate.pct))}>
        {pctText(rate.pct)}
      </span>
      {rate.learners > 0 && (
        <span className="absolute top-1/2 left-full ml-1.5 -translate-y-1/2 text-[11px] whitespace-nowrap tabular-nums text-muted-foreground">
          {`${rate.finished}/${rate.learners}`}
        </span>
      )}
    </span>
  );
}

const COL = { name: 288, month: 136 };

function Columns({ months }: { months: string[] }) {
  return (
    <colgroup>
      <col style={{ width: COL.name }} />
      {months.map((m) => (
        <col key={m} style={{ width: COL.month }} />
      ))}
    </colgroup>
  );
}

export function HistoryReport({ history, canSwitchScope }: { history: CanaryWireHistory; canSwitchScope: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { months } = history;
  const yourOrg = history.scope === "org";
  const scopeParam = canSwitchScope && !yourOrg ? "?scope=everyone" : "";
  const csv = `/api/evals/canary-wire/history?format=csv${scopeParam ? "&scope=everyone" : ""}`;
  const latest = months.length ? history.totals[months.length - 1]! : null;
  const latestMonth = months[months.length - 1] ?? "";

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Canary Wire History</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {latest && months.length ? (
            <>
              <span className="font-medium text-foreground">
                {latest.finished.toLocaleString()} of {latest.learners.toLocaleString()} reps
              </span>{" "}
              finished {latestMonth}
              {yourOrg ? " in your org" : ""}, over {months.length} {months.length === 1 ? "month" : "months"} from {months[0]}.
            </>
          ) : history.hasSnapshot ? (
            <>No Canary Wire months yet.</>
          ) : (
            <>No pull from Mindtickle yet.</>
          )}
        </p>
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-2">
        <a href={csv} download className={PILL}>
          <Download />
          Export CSV
        </a>
        {history.seriesLinks.map((s) => (
          <a key={s.edition} href={s.url} target="_blank" rel="noopener noreferrer" title={`Open the ${s.edition} series in Mindtickle`} className={PILL}>
            {s.label} series
            <ExternalLink />
          </a>
        ))}
        <span className="grow" />
        {/* As on the Canary Wire tab: shown to everyone, greyed out on
            Everyone for someone with no one reporting to them. */}
        <PillSwitch
          label="Everyone"
          title={
            !canSwitchScope
              ? "Nobody reports to you in HiBob, so there is no org to narrow to: this shows everyone in the Canary Wire."
              : yourOrg
                ? "Showing your org: you and everyone under you. Switch on to see everyone in the Canary Wire."
                : "Showing everyone in the Canary Wire. Switch off for your org: you and everyone under you."
          }
          on={!yourOrg}
          disabled={!canSwitchScope}
          onChange={(everyone) => router.push(`${pathname}${canSwitchScope && everyone ? "?scope=everyone" : ""}`)}
        />
      </motion.div>

      {months.length > 0 && (
        <motion.div variants={riseChild}>
          <Grid history={history} />
        </motion.div>
      )}
    </motion.div>
  );
}

function Grid({ history }: { history: CanaryWireHistory }) {
  const { months } = history;
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const needle = useDeferredValue(search).trim().toLowerCase();
  const headStrip = useRef<HTMLDivElement>(null);
  const minWidth = COL.name + COL.month * months.length;
  const short = (edition: string) => history.seriesLinks.find((s) => s.edition === edition)?.label ?? edition;

  const shown = useMemo(
    () =>
      history.teams
        .map((team) => {
          const managerMatches = !needle || team.manager.toLowerCase().includes(needle);
          const directs = team.directs.filter((d) => {
            if (role && d.role !== role) return false;
            if (managerMatches) return true;
            return [d.name, d.email, d.title].some((v) => v.toLowerCase().includes(needle));
          });
          return { team, directs };
        })
        .filter((t) => t.directs.length > 0),
    [history.teams, needle, role],
  );

  const toggle = (manager: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(manager)) next.delete(manager);
      else next.add(manager);
      return next;
    });

  // A team row's rates follow the filters, so they describe the reps listed under it.
  const ratesFor = (directs: HistoryRep[]): MonthRate[] =>
    months.map((_, i) => {
      const owing = directs.filter((d) => !d.marks[i]!.exempt && d.marks[i]!.assigned > 0);
      const finished = owing.filter((d) => d.marks[i]!.completed >= d.marks[i]!.assigned).length;
      return { learners: owing.length, finished, pct: owing.length ? Math.round((finished / owing.length) * 1000) / 10 : null };
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} label="Search the history" />
        <RolePills roles={history.teams.flatMap((t) => t.directs.map((d) => d.role))} short={short} value={role} onChange={setRole} />
      </div>

      {/* Clipped rather than hidden, so the header strip can stick. */}
      <div className="overflow-clip rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 text-xs text-muted-foreground">
          {LEGEND.map(([cls, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <i className={cn("inline-block size-3.5 rounded", cls)} />
              {label}
            </span>
          ))}
          <span className="grow" />
          <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => setCollapsed(new Set(history.teams.map((t) => t.manager)))}>
            Collapse all
          </button>
          <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{history.teams.length ? "Nothing matches those filters." : "No one to show."}</p>
        ) : (
          <>
            <div ref={headStrip} className="sticky top-[57px] z-30 overflow-hidden lg:top-0" aria-hidden="true">
              <table className={TABLE} style={{ minWidth }}>
                <Columns months={months} />
                <thead>
                  <tr className="text-left">
                    <th className={cn(HEAD, PIN_LEFT, "z-30 pl-5 shadow-[inset_-1px_-1px_0_var(--border)]")}>Manager / direct</th>
                    {months.map((m) => (
                      <th key={m} className={cn(HEAD, "z-20 text-center tracking-normal normal-case text-foreground shadow-[inset_0_-1px_0_var(--border)]")}>
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
            <div
              className="overflow-x-auto overscroll-x-contain"
              onScroll={(e) => {
                if (headStrip.current) headStrip.current.scrollLeft = e.currentTarget.scrollLeft;
              }}
            >
              <table className={TABLE} style={{ minWidth }}>
                <Columns months={months} />
                <caption className="sr-only">{`Canary Wire completion by manager, month by month: ${months.join(", ")}`}</caption>
                {shown.map(({ team, directs }) => {
                  const closed = collapsed.has(team.manager);
                  const Caret = closed ? ChevronRight : ChevronDown;
                  return (
                    <tbody key={team.manager}>
                      <tr className="group cursor-pointer" onClick={() => toggle(team.manager)}>
                        <td className={cn(PIN_LEFT, MGR_BG, "h-9 border-b py-1 pr-3 pl-3")}>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Caret className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium" title={team.manager}>
                              {team.manager}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground" title={team.roles.join(", ")}>
                              {team.roles.map(short).join(" · ")}
                            </span>
                          </span>
                        </td>
                        {ratesFor(directs).map((rate, i) => (
                          <td key={months[i]} className={cn(MGR_BG, "border-b px-3 text-center")}>
                            <Rate rate={rate} month={months[i]!} />
                          </td>
                        ))}
                      </tr>
                      {!closed &&
                        directs.map((d) => (
                          <tr key={d.email} className="group">
                            <td className={cn(PIN_LEFT, ROW_BG, "h-9 border-b border-border/60 py-1 pr-3 pl-9")}>
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 flex-1 truncate" title={d.title || undefined}>
                                  {d.name || d.email}
                                </span>
                                <span className="shrink-0 text-[11px] text-muted-foreground" title={d.role}>
                                  {short(d.role)}
                                </span>
                              </span>
                            </td>
                            {d.marks.map((mark, i) => (
                              <td key={months[i]} className={cn(ROW_BG, "border-b border-border/60 text-center")}>
                                <Mark mark={mark} month={months[i]!} />
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
