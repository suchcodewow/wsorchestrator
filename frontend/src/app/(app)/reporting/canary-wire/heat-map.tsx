"use client";

/**
 * The Canary Wire by manager: a collapsible group per manager, best first,
 * with a square per module for each of their directs. The filters narrow the
 * month already loaded.
 *
 * A month can carry any number of modules, so the grid scrolls sideways
 * inside its card, as the Scheduler's board does: who a row is stays pinned
 * on the left and their rate on the right, and only the module columns move.
 * Pinned cells paint their own opaque background, or the scrolled squares
 * would show through them.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, ListChecks, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { moduleUrl, slackReport, stateClass, when } from "@/lib/canary-wire/report";
import type { CanaryWireView, Cell, Rep, Team } from "@/lib/canary-wire/view";
import { cn } from "@/lib/utils";
import { copyRich } from "./clipboard";
import { CHIP, FILL, Meter, PILL, PILL_ON, UNCOUNTED } from "./ui";

function dotClass(cell: Cell | undefined): string {
  if (!cell) return FILL.blank;
  const state = stateClass(cell.state);
  return cell.exempt || !cell.accountable ? UNCOUNTED[state] : FILL[state];
}

const LEGEND: [string, string][] = [
  [FILL.completed, "Completed"],
  [FILL.progress, "In progress"],
  [FILL.notstarted, "Not started"],
  [FILL.blank, "Not in their lineup"],
  [UNCOUNTED.completed, "Completed, not in their lineup"],
  [UNCOUNTED.progress, "In progress, not in their lineup"],
];

// Opaque, so a pinned cell hides the squares scrolling under it.
const MGR_BG = "bg-[color-mix(in_oklab,var(--muted)_70%,var(--card))]";
const ROW_BG = "bg-card group-hover:bg-[color-mix(in_oklab,var(--muted)_55%,var(--card))]";
const PIN_LEFT = "sticky left-0 z-10 w-72 max-w-72 min-w-72 shadow-[inset_-1px_0_0_var(--border)]";
const PIN_DONE = "sticky right-32 z-10 w-16 min-w-16 shadow-[inset_1px_0_0_var(--border)]";
const PIN_RATE = "sticky right-0 z-10 w-32 min-w-32";
const HEAD = "sticky top-0 bg-card px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
const AMBER_CHIP = cn(CHIP, "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300");

function exemptTitle(rep: Rep): string {
  if (rep.exemptSource === "first_month") {
    return `SDRs count from their first full month at Harness: ${rep.exemptFrom}. Shown for visibility, counted in no rate.`;
  }
  if (rep.exemptSource === "bootcamp") {
    return `Accountable from ${rep.exemptFrom}, the month after their bootcamp. Shown for visibility, counted in no rate.`;
  }
  return "No bootcamp date in Bootcamp History, and joined after it began, so not accountable yet. Shown for visibility, counted in no rate.";
}

function Square({ rep, label, cell, template }: { rep: Rep; label: string; cell: Cell | undefined; template: string }) {
  const why = rep.exemptSource === "first_month" ? `new hire, counts from ${rep.exemptFrom}` : "pre-bootcamp";
  let tip = rep.exempt ? `${label}\nNot accountable — ${why}` : `${label}\nNot in the ${rep.role} lineup`;
  if (cell) {
    tip = `${label}\n${cell.state}${when(cell)}`;
    if (cell.exempt) tip += `\nDone before they count (${why}) — credit to them, but not counted`;
    else if (!cell.accountable) tip += `\nThis is the ${cell.edition} module — off-role, not counted`;
  }
  const dot = cn("relative inline-flex size-5 items-center justify-center rounded-md align-middle", dotClass(cell));
  const href = moduleUrl(cell, template);
  if (!href) return <i className={dot} title={tip} />;
  // Hover and focus lift the square, ring it and show ↗, all at once, since
  // any one alone is easy to miss scanning a few hundred rows; a link icon
  // beside each square would bury the colour the grid exists to show.
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="group/dot inline-block rounded-md leading-none outline-none">
      <i
        className={cn(
          dot,
          "transition-transform group-hover/dot:scale-115 group-hover/dot:ring-2 group-hover/dot:ring-brand group-hover/dot:ring-offset-1 group-hover/dot:ring-offset-card",
          "group-focus-visible/dot:scale-115 group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-brand",
        )}
        title={`${tip}\nClick to open in Mindtickle`}
      >
        <span
          className={cn(
            "text-[10px] font-bold not-italic opacity-0 group-hover/dot:opacity-100 group-focus-visible/dot:opacity-100",
            cell && (cell.exempt || !cell.accountable) ? "text-foreground" : "text-white",
          )}
        >
          ↗
        </span>
      </i>
    </a>
  );
}

function CopyButton({ team, directs, view }: { team: Team; directs: Rep[]; view: CanaryWireView }) {
  const [done, setDone] = useState<boolean | null>(null);
  return (
    <button
      type="button"
      title="Copy this team's completion report, for Slack"
      onClick={async (e) => {
        // The row folds on click, so the button keeps its click to itself.
        e.stopPropagation();
        const ok = await copyRich(slackReport(team, directs, view.labels, view.month, view.seriesLinks, view.moduleUrlTemplate));
        setDone(ok);
        setTimeout(() => setDone(null), 1600);
      }}
      className={cn(
        "absolute top-1/2 right-2 inline-flex -translate-y-1/2 cursor-pointer items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-opacity outline-none",
        "hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3",
        done === null ? "opacity-0 group-hover:opacity-100" : "opacity-100",
        done === true && "border-emerald-300 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-300",
        done === false && "border-destructive/50 text-destructive",
      )}
    >
      {done ? <Check /> : <Copy />}
      {done === null ? "Copy for Slack" : done ? "Copied" : "Copy failed"}
    </button>
  );
}

export function HeatMap({ view }: { view: CanaryWireView }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const needle = useDeferredValue(search).trim().toLowerCase();
  const labels = view.labels;
  // The series' short label, "AE", beside a name; the full edition is the tooltip.
  const short = (edition: string) => view.seriesLinks.find((s) => s.edition === edition)?.label ?? edition;

  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of view.teams) for (const d of t.directs) counts.set(d.role, (counts.get(d.role) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [view.teams]);
  const everyone = roleCounts.reduce((n, [, c]) => n + c, 0);
  const rolePills: [string, string, number][] = [["", "All", everyone], ...roleCounts.map(([r, n]): [string, string, number] => [r, short(r), n])];

  const shown = useMemo(
    () =>
      view.teams
        .map((team) => {
          const managerMatches = !needle || team.manager.toLowerCase().includes(needle);
          const directs = team.directs.filter((d) => {
            if (role && d.role !== role) return false;
            // A follow-up list: drop anyone finished, and anyone who owes nothing.
            if (incompleteOnly && (d.exempt || (d.assigned && d.completed >= d.assigned))) return false;
            if (managerMatches) return true;
            return [d.name, d.email, d.title].some((v) => v.toLowerCase().includes(needle));
          });
          return { team, directs };
        })
        .filter((t) => t.directs.length > 0),
    [view.teams, needle, role, incompleteOnly],
  );

  const toggle = (manager: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(manager)) next.delete(manager);
      else next.add(manager);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64 min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, manager or title"
            aria-label="Search the heat map"
            className="rounded-full pl-9"
          />
        </div>
        <div role="group" aria-label="Role" className="flex flex-wrap gap-2">
          {rolePills.map(([value, label, n]) => (
            <button
              key={value || "all"}
              type="button"
              title={value || "Every role"}
              aria-pressed={role === value}
              onClick={() => setRole(value)}
              className={cn(PILL, role === value && PILL_ON)}
            >
              {label}
              <span className="font-medium tabular-nums text-foreground">{n}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={incompleteOnly}
          title="Only the people who still owe something this month"
          onClick={() => setIncompleteOnly((v) => !v)}
          className={cn(PILL, incompleteOnly && PILL_ON)}
        >
          <ListChecks />
          Incomplete only
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 text-xs text-muted-foreground">
          {/* Always every entry, even in a month where nothing is uncounted: a
              legend that comes and goes teaches nobody what a pale dashed
              square means, and that is the one a manager will ask about. */}
          {LEGEND.map(([cls, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <i className={cn("inline-block size-3.5 rounded", cls)} />
              {label}
            </span>
          ))}
          <span className="grow" />
          <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => setCollapsed(new Set(view.teams.map((t) => t.manager)))}>
            Collapse all
          </button>
          <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {view.teams.length ? "Nothing matches those filters." : `No one to show for ${view.month}.`}
          </p>
        ) : (
          // Its own scroll box, so the headers can stick inside it. Sideways
          // overscroll is contained, so a trackpad swipe across the module
          // columns doesn't navigate back.
          <div className="max-h-[75vh] overflow-auto overscroll-x-contain">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className={cn(HEAD, PIN_LEFT, "z-30 pl-5 shadow-[inset_-1px_-1px_0_var(--border)]")}>Manager / direct</th>
                  {labels.map((l) => (
                    <th
                      key={l}
                      title={l}
                      className={cn(HEAD, "z-20 w-28 min-w-28 text-center align-bottom leading-tight tracking-normal normal-case text-foreground shadow-[inset_0_-1px_0_var(--border)]")}
                    >
                      {/* In full, however many lines it takes: a cut-off name is a guess at which module it is. */}
                      {l}
                    </th>
                  ))}
                  <th className={cn(HEAD, PIN_DONE, "z-30 text-right shadow-[inset_1px_-1px_0_var(--border)]")}>Done</th>
                  <th className={cn(HEAD, PIN_RATE, "z-30 pr-5 text-right shadow-[inset_0_-1px_0_var(--border)]")}>Complete</th>
                </tr>
              </thead>
              {shown.map(({ team, directs }) => {
                const closed = collapsed.has(team.manager);
                const tAssigned = directs.reduce((n, d) => n + d.assigned, 0);
                const tDone = directs.reduce((n, d) => n + d.completed, 0);
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
                          {/* The one note a manager row keeps: nothing in the grid can
                              tell a never-activated rep from one ignoring the training. */}
                          {team.notActivated > 0 && (
                            <span className={AMBER_CHIP} title="Reps on this team who have never activated Mindtickle">
                              {team.notActivated} never activated
                            </span>
                          )}
                        </span>
                        <CopyButton team={team} directs={directs} view={view} />
                      </td>
                      {labels.map((l) => {
                        const owed = directs.filter((d) => d.cells[l]?.accountable);
                        const got = owed.filter((d) => stateClass(d.cells[l]!.state) === "completed");
                        return (
                          <td key={l} className={cn(MGR_BG, "border-b px-3 text-center text-xs tabular-nums text-muted-foreground")}>
                            {owed.length ? `${got.length}/${owed.length}` : "—"}
                          </td>
                        );
                      })}
                      <td className={cn(PIN_DONE, MGR_BG, "border-b px-3 text-right tabular-nums")}>{`${tDone}/${tAssigned}`}</td>
                      <td className={cn(PIN_RATE, MGR_BG, "border-b pr-5 pl-3")}>
                        <Meter value={tAssigned ? Math.round((tDone / tAssigned) * 1000) / 10 : null} />
                      </td>
                    </tr>
                    {!closed &&
                      directs.map((d) => (
                        <tr key={d.email} className="group">
                          <td className={cn(PIN_LEFT, ROW_BG, "h-9 border-b border-border/60 py-1 pr-3 pl-9")}>
                            <span className="flex min-w-0 items-center gap-2">
                              {/* The title is the tooltip: beside the name it left no room for either. */}
                              <span className={cn("min-w-0 flex-1 truncate", d.exempt && "text-muted-foreground")} title={d.title || undefined}>
                                {d.name || d.email}
                              </span>
                              {d.exempt && (
                                <span className={cn(CHIP, "bg-slate-100 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300")} title={exemptTitle(d)}>
                                  {d.exemptSource === "first_month" ? "New hire" : "Pre-bootcamp"}
                                </span>
                              )}
                              {d.notActivated && !d.exempt && (
                                <span
                                  className={AMBER_CHIP}
                                  title="Account exists and content is assigned, but this person has never activated Mindtickle — so they cannot have completed anything."
                                >
                                  Never activated
                                </span>
                              )}
                              <span className="shrink-0 text-[11px] text-muted-foreground" title={d.role}>
                                {short(d.role)}
                              </span>
                            </span>
                          </td>
                          {labels.map((l) => (
                            <td key={l} className={cn(ROW_BG, "border-b border-border/60 text-center")}>
                              <Square rep={d} label={l} cell={d.cells[l]} template={view.moduleUrlTemplate} />
                            </td>
                          ))}
                          <td className={cn(PIN_DONE, ROW_BG, "border-b border-border/60 px-3 text-right tabular-nums text-muted-foreground")}>
                            {`${d.completed}/${d.assigned}`}
                          </td>
                          <td className={cn(PIN_RATE, ROW_BG, "border-b border-border/60 pr-5 pl-3")}>
                            <Meter value={d.pct} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
