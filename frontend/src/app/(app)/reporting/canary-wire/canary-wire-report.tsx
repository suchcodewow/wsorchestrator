"use client";

/**
 * Reporting → Canary Wire: one month of Mindtickle completion, as totals, per
 * role, and a heat map by manager. The month lives in the URL; everything
 * else on the page filters the month already loaded.
 */

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPct } from "@/lib/canary-wire/report";
import type { CanaryWireView } from "@/lib/canary-wire/view";
import { cn } from "@/lib/utils";
import { HeatMap } from "./heat-map";

const SELECT_CLASS = cn(
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
);

const UPLOAD_ERRORS: Record<string, string> = {
  no_file: "Choose the snapshot.json file to upload.",
  not_json: "That file isn't JSON. Upload the output/snapshot.json the Canary Wire tool writes.",
  invalid: "That file isn't a Canary Wire pull.",
  too_large: "That file is over 10 MB.",
  forbidden: "Your own role changed — reload the page.",
};

export function CanaryWireReport({ view }: { view: CanaryWireView }) {
  const router = useRouter();
  const pathname = usePathname();
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withData = new Set(view.monthsWithData);
  const csv = `/api/evals/canary-wire?month=${encodeURIComponent(view.month)}&format=csv`;

  async function upload(chosen: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", chosen);
      const res = await fetch("/api/evals/canary-wire/snapshot", { method: "POST", body });
      if (!res.ok) {
        const out = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        const message = UPLOAD_ERRORS[out.error ?? ""] ?? `Could not upload it (${res.status}).`;
        setError(out.detail ? `${message} (${out.detail})` : message);
        return;
      }
      // The newest month with activity may have moved, so open the default.
      router.push(pathname);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }

  const notes = [...view.notes];
  if (!view.hasSnapshot) {
    notes.unshift("No Mindtickle data yet. Upload the output/snapshot.json from the Canary Wire tool to fill this in.");
  } else if (!view.hasData) {
    notes.unshift(`No modules found for ${view.month}. Either it wasn't run, or its module names don't start with "${view.month} - ".`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Month"
          value={view.month}
          onChange={(e) => router.push(`${pathname}?month=${encodeURIComponent(e.target.value)}`)}
          className={SELECT_CLASS}
        >
          {view.months.map((m) => (
            <option key={m} value={m}>
              {withData.has(m) ? m : `${m} (no data)`}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" asChild>
          <a href={csv} download>
            <Download />
            Export CSV
          </a>
        </Button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) void upload(chosen);
          }}
        />
        <Button variant="outline" size="sm" disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          Upload pull
        </Button>
        {view.seriesLinks.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Series
            {view.seriesLinks.map((s) => (
              <a
                key={s.edition}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open the ${s.edition} series in Mindtickle`}
                className="rounded-md border px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted"
              >
                {s.label}
              </a>
            ))}
          </span>
        )}
        <span className="grow" />
        <Freshness view={view} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {notes.length > 0 && (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <ul className="list-disc space-y-1 pl-5">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {view.totals && <Scores view={view} />}
      {view.roles.length > 0 && <Roles view={view} />}
      {view.hasSnapshot && <HeatMap view={view} />}
    </div>
  );
}

/**
 * The newest completion Mindtickle recorded in this month's content: if
 * someone finished a module at 10:30, the numbers are demonstrably right as of
 * 10:30. It can't tell a quiet week from a stale pull, so the pull time rides
 * in the tooltip, first.
 */
function Freshness({ view }: { view: CanaryWireView }) {
  if (!view.hasSnapshot) return <span className="text-xs text-muted-foreground">No data pulled yet</span>;
  const pulled =
    `Data pulled at ${view.fetchedAtPt}\n\n` +
    "Mindtickle calculates completion state when asked, so the numbers are current as of the pull — there is no reporting lag behind it.";
  const la = view.lastActivity;
  if (!la.atPt) {
    return (
      <span className="text-xs text-muted-foreground" title={pulled}>
        {view.hasData ? "No completions recorded yet" : "Nothing assigned this month"}
      </span>
    );
  }
  const title =
    `${pulled}\n\nShowing when the last completion was recorded: ${la.who} finished "${la.module}" then` +
    (la.role ? ` (${la.role})` : "") +
    ". It is a floor, not a freshness field: a quiet stretch looks the same as a stale pull, which is what the pull time is for.";
  return (
    <span className="text-xs text-muted-foreground" title={title}>
      Data last updated <b className="font-semibold text-foreground">{la.atPt}</b>
    </span>
  );
}

function Scores({ view }: { view: CanaryWireView }) {
  const t = view.totals!;
  const nMods = view.labels.length;
  const cards: [string, string, string][] = [
    [
      "Canary Wire complete",
      formatPct(t.pct),
      // The IC rate is what most people mean by "are the reps doing it", so it rides along here.
      `${t.completed} of ${t.assigned} module assignments` + (t.icAssigned ? ` · ${formatPct(t.icPct)} among ICs` : ""),
    ],
    [
      "Accountable learners",
      String(t.learners),
      `${nMods} module${nMods === 1 ? "" : "s"} this month` + (t.exempt ? ` · ${t.exempt} pre-bootcamp, not counted` : ""),
    ],
    ["Finished everything", String(t.fullyComplete), t.learners ? `${((t.fullyComplete / t.learners) * 100).toFixed(1)}% of learners` : ""],
    ["Managers", String(view.teams.length), t.notActivated ? `${t.notActivated} never activated Mindtickle` : "with someone accountable"],
  ];
  return (
    <div className="grid overflow-hidden rounded-2xl border bg-card shadow-sm sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x">
      {cards.map(([k, v, sub]) => (
        <div key={k} className="px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{k}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{v}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

const IC_TIP =
  "The same rate over individual contributors only — people nobody reports to. Worked out from who is named as someone else's manager, so a manager whose reports all sit outside the Canary Wire groups counts as an IC here.";

function Roles({ view }: { view: CanaryWireView }) {
  const th = "px-5 py-2.5 font-medium uppercase tracking-wider";
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <h2 className="border-b px-5 py-3 text-sm font-medium">By role</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left text-[11px] text-muted-foreground">
              <th className={th}>Role</th>
              <th className={cn(th, "text-right")} title="People in this role group who owe the training this month.">
                Learners
              </th>
              <th className={cn(th, "text-right")}>Assigned</th>
              <th className={cn(th, "text-right")}>Completed</th>
              <th className={cn(th, "text-right")} title="Everyone in the role, managers included.">
                Completion
              </th>
              <th className={cn(th, "text-right")} title={IC_TIP}>
                IC completion
              </th>
              <th className={th}>Modules</th>
            </tr>
          </thead>
          <tbody>
            {view.roles.map((r) => (
              <tr key={r.role} className="border-b last:border-b-0">
                <td className="px-5 py-3 font-medium">{r.role}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.learners}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.assigned}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.completed}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatPct(r.pct)}</td>
                <td
                  className="px-5 py-3 text-right tabular-nums"
                  title={
                    r.icAssigned
                      ? `${r.icCompleted} of ${r.icAssigned} modules, ${r.icLearners} ICs`
                      : "No individual contributors owe modules in this role this month"
                  }
                >
                  {formatPct(r.icPct)}
                </td>
                <td className="px-5 py-3 text-muted-foreground">{r.modules.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
