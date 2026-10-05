"use client";

/**
 * The Canary Wire by manager: a collapsible group per manager, best first,
 * with a square per module for each of their directs. The filters narrow the
 * month already loaded; the toolbar, legend and column headers stay in view
 * while the rows scroll inside the card.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPct, moduleUrl, slackReport, stateClass, when, type StateClass } from "@/lib/canary-wire/report";
import type { CanaryWireView, Cell, Rep, Team } from "@/lib/canary-wire/view";
import { cn } from "@/lib/utils";
import { copyRich } from "./clipboard";
import { ExemptionsDialog } from "./exemptions-dialog";

const FILL: Record<StateClass, string> = {
  completed: "bg-emerald-600",
  progress: "bg-amber-500",
  notstarted: "bg-red-500",
  blank: "bg-muted",
};

/**
 * Work we can see but don't count — another role's module, or a rep who is
 * pre-bootcamp — shares one treatment, because to a reader both mean "this
 * happened, and it isn't in the rate": the counted square's hue, washed out
 * and dashed. The tooltip still says which, since the follow-up differs.
 */
const UNCOUNTED: Record<StateClass, string> = {
  completed: "border-2 border-dashed border-emerald-400/80 bg-emerald-500/10",
  progress: "border-2 border-dashed border-amber-400/80 bg-amber-500/10",
  notstarted: "border-2 border-dashed border-muted-foreground/30 bg-background",
  blank: "border-2 border-dashed border-muted-foreground/30 bg-background",
};

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

function barColor(v: number | null): string {
  if (v === null) return "bg-muted";
  if (v < 50) return "bg-red-500";
  if (v < 80) return "bg-amber-500";
  return "bg-emerald-600";
}

function Meter({ value }: { value: number | null }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <b className="min-w-12 text-right font-semibold tabular-nums">{formatPct(value)}</b>
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
        <i className={cn("block h-full", barColor(value))} style={{ width: `${value ?? 0}%` }} />
      </span>
    </span>
  );
}

function exemptTitle(rep: Rep): string {
  if (rep.exemptSource === "manual") {
    return rep.exemptFrom
      ? `Exempt by hand until ${rep.exemptFrom}. Shown for visibility, counted in no rate.`
      : "Exempt by hand: not accountable yet. Shown for visibility, counted in no rate.";
  }
  if (rep.exemptSource === "bootcamp") {
    return `Accountable from ${rep.exemptFrom}, the month after their bootcamp. Shown for visibility, counted in no rate.`;
  }
  return "No bootcamp date in Bootcamp History, so not accountable yet. Shown for visibility, counted in no rate.";
}

function Square({ rep, label, cell, template }: { rep: Rep; label: string; cell: Cell | undefined; template: string }) {
  let tip = rep.exempt ? `${label}\nNot accountable — pre-bootcamp` : `${label}\nNot in the ${rep.role} lineup`;
  if (cell) {
    tip = `${label}\n${cell.state}${when(cell)}`;
    if (cell.exempt) tip += "\nDone ahead of bootcamp — credit to them, but not counted";
    else if (!cell.accountable) tip += `\nThis is the ${cell.edition} module — off-role, not counted`;
  }
  const dot = cn("relative inline-flex size-[22px] items-center justify-center rounded-[5px] align-middle", dotClass(cell));
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
          "transition-transform group-hover/dot:scale-[1.18] group-hover/dot:ring-2 group-hover/dot:ring-foreground/70 group-hover/dot:ring-offset-1 group-hover/dot:ring-offset-background",
          "group-focus-visible/dot:scale-[1.18] group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-foreground/70",
        )}
        title={`${tip}\nClick to open in Mindtickle`}
      >
        <span
          className={cn(
            "text-[11px] font-bold not-italic opacity-0 group-hover/dot:opacity-100 group-focus-visible/dot:opacity-100",
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
        "ml-3 rounded-md border px-2 py-0.5 text-[11px] font-normal text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100",
        done === null ? "opacity-0 group-hover:opacity-100" : "opacity-100",
        done === true && "border-emerald-400 text-emerald-700 dark:text-emerald-400",
        done === false && "border-destructive text-destructive",
      )}
    >
      {done === null ? "Copy for Slack" : done ? "Copied" : "Copy failed"}
    </button>
  );
}

export function HeatMap({ view }: { view: CanaryWireView }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [exemptionsOpen, setExemptionsOpen] = useState(false);
  const [exemptionsKey, setExemptionsKey] = useState(0);
  const needle = useDeferredValue(search).trim().toLowerCase();
  const labels = view.labels;
  // The series' short label, "AE", in the narrow Role column; the full edition is the tooltip.
  const short = (edition: string) => view.seriesLinks.find((s) => s.edition === edition)?.label ?? edition;

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

  const th = "sticky top-0 z-10 bg-card px-2.5 py-2 text-[11px] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]";

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <h2 className="text-sm font-medium">By manager</h2>
        <span className="grow" />
        <div className="relative w-full max-w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, manager, title"
            aria-label="Filter the heat map"
            className="h-8 pl-9"
          />
        </div>
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">All roles</option>
          {view.roles.map((r) => (
            <option key={r.role} value={r.role}>
              {r.role}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
          Incomplete only
        </label>
        <Button variant="link" size="sm" className="h-8 px-1.5" onClick={() => {
            setExemptionsKey((k) => k + 1);
            setExemptionsOpen(true);
          }}>
          Bootcamp exemptions
        </Button>
        <Button variant="link" size="sm" className="h-8 px-1.5" onClick={() => setCollapsed(new Set(view.teams.map((t) => t.manager)))}>
          Collapse all
        </Button>
        <Button variant="link" size="sm" className="h-8 px-1.5" onClick={() => setCollapsed(new Set())}>
          Expand all
        </Button>
      </div>

      {/* Always every entry, even in a month where nothing is uncounted: a
          legend that comes and goes teaches nobody what a pale dashed square
          means, and that is the one a manager will ask about. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-5 py-2.5 text-xs text-muted-foreground">
        {LEGEND.map(([cls, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <i className={cn("inline-block size-3.5 rounded-[3px]", cls)} />
            {label}
          </span>
        ))}
        <span className="italic opacity-80">Not in their lineup = another role&apos;s module, or the rep is pre-bootcamp</span>
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          {view.teams.length ? "Nothing matches those filters." : `No one to show for ${view.month}.`}
        </p>
      ) : (
        // Its own scroll box, so the column headers can stick inside it.
        // Sideways overscroll is contained, so a trackpad swipe across the
        // module columns doesn't navigate back.
        <div className="max-h-[75vh] overflow-auto overscroll-x-contain">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr className="text-left">
                <th className={cn(th, "min-w-60 pl-5")}>Manager / direct</th>
                <th className={cn(th, "min-w-16")}>Role</th>
                {labels.map((l) => (
                  <th key={l} title={l} className={cn(th, "w-26 min-w-26 text-center leading-tight whitespace-normal text-foreground")}>
                    {l}
                  </th>
                ))}
                <th className={cn(th, "w-16 text-right")}>Done</th>
                <th className={cn(th, "w-36 pr-5 text-right")}>Complete</th>
              </tr>
            </thead>
            {shown.map(({ team, directs }) => {
              const closed = collapsed.has(team.manager);
              const tAssigned = directs.reduce((n, d) => n + d.assigned, 0);
              const tDone = directs.reduce((n, d) => n + d.completed, 0);
              const Caret = closed ? ChevronRight : ChevronDown;
              return (
                <tbody key={team.manager}>
                  <tr className="group cursor-pointer bg-muted/30 hover:bg-muted/60" onClick={() => toggle(team.manager)}>
                    <td className="h-[30px] border-b py-1 pl-3 pr-2.5 whitespace-nowrap">
                      <Caret className="mr-1 inline size-3.5 text-muted-foreground" />
                      <span className="font-semibold">{team.manager}</span>
                      {/* The one note a manager row keeps: nothing in the grid can
                          tell a never-activated rep from one ignoring the training. */}
                      {team.notActivated > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">{team.notActivated} never activated</span>
                      )}
                      <CopyButton team={team} directs={directs} view={view} />
                    </td>
                    <td title={team.roles.join(", ")} className="border-b px-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {team.roles.map(short).join(", ")}
                    </td>
                    {labels.map((l) => {
                      const owed = directs.filter((d) => d.cells[l]?.accountable);
                      const got = owed.filter((d) => stateClass(d.cells[l]!.state) === "completed");
                      return (
                        <td key={l} className="border-b px-2.5 text-center text-xs tabular-nums text-muted-foreground">
                          {owed.length ? `${got.length}/${owed.length}` : "—"}
                        </td>
                      );
                    })}
                    <td className="border-b px-2.5 text-right tabular-nums">{`${tDone}/${tAssigned}`}</td>
                    <td className="border-b pl-2.5 pr-5">
                      <Meter value={tAssigned ? Math.round((tDone / tAssigned) * 1000) / 10 : null} />
                    </td>
                  </tr>
                  {!closed &&
                    directs.map((d) => (
                      <tr key={d.email} className="hover:bg-muted/30">
                        <td className={cn("h-[30px] border-b border-border/60 py-1 pl-10 pr-2.5 whitespace-nowrap", d.exempt && "text-muted-foreground")}>
                          {d.name || d.email}
                          {/* Capped, so a long title can't push the rate columns out of view. */}
                          {d.title && (
                            <small title={d.title} className="ml-2 inline-block max-w-44 truncate align-bottom text-xs text-muted-foreground">
                              {d.title}
                            </small>
                          )}
                          {d.exempt && (
                            <Badge variant="secondary" className="ml-2 uppercase" title={exemptTitle(d)}>
                              pre-bootcamp
                            </Badge>
                          )}
                          {d.notActivated && !d.exempt && (
                            <Badge
                              variant="outline"
                              className="ml-2 uppercase text-muted-foreground"
                              title="Account exists and content is assigned, but this person has never activated Mindtickle — so they cannot have completed anything."
                            >
                              never activated
                            </Badge>
                          )}
                        </td>
                        <td title={d.role} className="border-b border-border/60 px-2.5 text-xs whitespace-nowrap text-muted-foreground">
                          {short(d.role)}
                        </td>
                        {labels.map((l) => (
                          <td key={l} className="border-b border-border/60 text-center">
                            <Square rep={d} label={l} cell={d.cells[l]} template={view.moduleUrlTemplate} />
                          </td>
                        ))}
                        <td className="border-b border-border/60 px-2.5 text-right tabular-nums">{`${d.completed}/${d.assigned}`}</td>
                        <td className="border-b border-border/60 pl-2.5 pr-5">
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

      <ExemptionsDialog key={exemptionsKey} open={exemptionsOpen} onOpenChange={setExemptionsOpen} />
    </div>
  );
}

