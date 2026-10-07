"use client";

/**
 * Reporting → Canary Wire: one month of Mindtickle completion, as totals, per
 * role, and a heat map by manager. The month lives in the URL; everything
 * else on the page filters the month already loaded.
 */

import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Download, ExternalLink } from "lucide-react";
import { HEADER_ROW, PlainHeader } from "@/components/data-table";
import type { PullSummary } from "@/lib/canary-wire/pull";
import type { CanaryWireView } from "@/lib/canary-wire/view";
import { riseChild, staggerParent } from "@/lib/motion";
import { PillSwitch } from "@/components/pill-switch";
import { HeatMap } from "./heat-map";
import { RefreshControl } from "./refresh-control";
import { Meter, PILL, SELECT_PILL } from "./ui";
import { formatPct } from "@/lib/canary-wire/report";

export function CanaryWireReport({
  view,
  pull,
  configured,
  canSwitchScope,
  canRefresh,
}: {
  view: CanaryWireView;
  pull: PullSummary | null;
  configured: boolean;
  /** A manager: My org, or everyone. */
  canSwitchScope: boolean;
  /** Refresh now, for testing: platform administrators. */
  canRefresh: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const withData = new Set(view.monthsWithData);
  // The scope rides in the URL only when it isn't the caller's default, so a
  // shared link opens on the sharer's month without forcing their view.
  const scopeParam = canSwitchScope && view.scope === "everyone" ? "&scope=everyone" : "";
  const go = (month: string, everyone = view.scope === "everyone") =>
    router.push(`${pathname}?month=${encodeURIComponent(month)}${canSwitchScope && everyone ? "&scope=everyone" : ""}`);
  const csv = `/api/evals/canary-wire?month=${encodeURIComponent(view.month)}&format=csv${scopeParam}`;
  const yourOrg = view.scope === "org";
  const t = view.totals;

  const notes = [...view.notes];
  if (!view.hasSnapshot) {
    notes.unshift(
      configured
        ? `No Mindtickle data yet. It is pulled every two hours${canRefresh ? ", or use Refresh now; a pull takes about 15 minutes" : ""}.`
        : "No Mindtickle data yet, and Mindtickle isn't configured on this server: MT_API_KEY or MT_SECRET_KEY is unset.",
    );
  } else if (!view.hasData) {
    notes.unshift(`No modules found for ${view.month}. Either it wasn't run, or its module names don't start with "${view.month} - ".`);
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Canary Wire</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t && view.hasData ? (
              <>
                <span className="font-medium text-foreground">{formatPct(t.pct)} complete</span> in {view.month}, across{" "}
                {t.learners.toLocaleString()} accountable {t.learners === 1 ? "learner" : "learners"}
                {yourOrg ? " in your org" : ""}.
              </>
            ) : view.hasSnapshot ? (
              <>Nothing assigned in {view.month}.</>
            ) : (
              <>No pull from Mindtickle yet.</>
            )}
          </p>
        </div>
        <Freshness view={view} />
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Month"
          value={view.month}
          onChange={(e) => go(e.target.value)}
          className={SELECT_PILL}
        >
          {view.months.map((m) => (
            <option key={m} value={m}>
              {withData.has(m) ? m : `${m} (no data)`}
            </option>
          ))}
        </select>
        <a href={csv} download className={PILL}>
          <Download />
          Export CSV
        </a>
        {view.seriesLinks.map((s) => (
          <a
            key={s.edition}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open the ${s.edition} series in Mindtickle`}
            className={PILL}
          >
            {s.label} series
            <ExternalLink />
          </a>
        ))}
        <span className="grow" />
        {canSwitchScope && (
          <PillSwitch
            label="Everyone"
            title={yourOrg ? "Showing your org: you and everyone under you. Switch on to see everyone in the Canary Wire." : "Showing everyone in the Canary Wire. Switch off for your org: you and everyone under you."}
            on={!yourOrg}
            onChange={(everyone) => go(view.month, everyone)}
          />
        )}
        {canRefresh && <RefreshControl configured={configured} initial={pull} />}
      </motion.div>

      {notes.length > 0 && (
        <motion.div
          variants={riseChild}
          className="rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
        >
          <ul className="list-disc space-y-1 pl-5">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </motion.div>
      )}

      {t && view.hasData && (
        <motion.div variants={riseChild}>
          <Scores view={view} />
        </motion.div>
      )}
      {view.hasData && view.roles.length > 0 && (
        <motion.div variants={riseChild}>
          <Roles view={view} />
        </motion.div>
      )}
      {view.hasSnapshot && (
        <motion.div variants={riseChild}>
          <HeatMap view={view} />
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * When the last completion in this month's content was logged, with the pull
 * time on hover. Mindtickle's API lags behind what learners have done, so a
 * pull at 2 PM may not hold everything done by 2 PM; the last completion is
 * what shows how current the numbers really are.
 */
function Freshness({ view }: { view: CanaryWireView }) {
  if (!view.hasSnapshot) return null;
  const pulled = `Data last pulled ${view.fetchedAtPt}`;
  const la = view.lastActivity;
  return (
    <p className="cursor-help text-xs text-muted-foreground" title={pulled}>
      {la.atPt ? (
        <>
          Last completion logged <span className="font-medium text-foreground">{la.atPt}</span>
        </>
      ) : view.hasData ? (
        "No completions logged yet"
      ) : (
        "Nothing assigned this month"
      )}
    </p>
  );
}

function Scores({ view }: { view: CanaryWireView }) {
  const t = view.totals!;
  const tiles: { label: string; value: string }[] = [
    { label: "Complete", value: formatPct(t.pct) },
    { label: "Accountable learners", value: t.learners.toLocaleString() },
    { label: "Finished everything", value: t.finished.toLocaleString() },
  ];
  return (
    <div className="grid divide-y overflow-hidden rounded-2xl border bg-card shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {tiles.map((tile) => (
        <div key={tile.label} className="px-5 py-4">
          <div className="text-2xl font-medium tabular-nums">{tile.value}</div>
          <div className="text-xs text-muted-foreground">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}

const IC_TIP = "The same rate over individual contributors only: people nobody at Harness reports to, by HiBob.";

function Roles({ view }: { view: CanaryWireView }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className={HEADER_ROW}>
              <PlainHeader>Role</PlainHeader>
              <PlainHeader className="text-right">Learners</PlainHeader>
              <PlainHeader className="text-right">Completed</PlainHeader>
              <PlainHeader className="w-36 text-right">Completion</PlainHeader>
              <PlainHeader className="w-36 text-right">
                <span title={IC_TIP} className="cursor-help underline decoration-dotted underline-offset-2">
                  IC completion
                </span>
              </PlainHeader>
              <PlainHeader>Modules</PlainHeader>
            </tr>
          </thead>
          <tbody>
            {view.roles.map((r) => (
              <tr key={r.role} className="border-b last:border-b-0">
                <td className="px-5 py-3 font-medium whitespace-nowrap">{r.role}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.learners}</td>
                <td className="px-5 py-3 text-right tabular-nums">{r.finished}</td>
                <td className="px-5 py-3">
                  <Meter value={r.pct} />
                </td>
                <td className="px-5 py-3" title={r.icLearners ? `${r.icFinished} of ${r.icLearners} ICs finished` : "No individual contributors owe anything in this role this month"}>
                  <Meter value={r.icPct} />
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{r.modules.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
