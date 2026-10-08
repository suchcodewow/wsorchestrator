"use client";

/**
 * Where you are with Mimir: the role and coaching style the coach tailors
 * itself to, how many items you've viewed, practiced and mastered, and each
 * item with its tier, a page at a time.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { MIMIR_REP_ROLES, type MimirCoachStyle, type MimirRepRole } from "@/db/schema";
import type { MimirProgressSort } from "@/lib/list-specs";
import { KIND_LABELS } from "@/lib/mimir/kinds";
import type { MimirProfile, ProgressRow, ProgressSummary } from "@/lib/mimir/progress";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import { TierBadge } from "../tier";

type Row = Omit<ProgressRow, "lastVisitAt"> & { lastVisitAt: string | null };

const COLUMNS: { column: MimirProgressSort; label: string }[] = [
  { column: "title", label: "Item" },
  { column: "kind", label: "Kind" },
  { column: "tier", label: "Progress" },
  { column: "lastVisit", label: "Last opened" },
];

export function ProgressView({
  query,
  summary,
  profile,
  page,
}: {
  query: ListQuery<MimirProgressSort>;
  summary: ProgressSummary;
  profile: MimirProfile;
  page: Page<Row>;
}) {
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  const score = summary.total ? Math.round((summary.mastered / summary.total) * 100) : 0;
  const tiles = [
    { label: "Viewed", value: `${summary.viewed} / ${summary.total}` },
    { label: "Practiced", value: String(summary.practiced) },
    { label: "Mastered", value: String(summary.mastered) },
    { label: "Mastery score", value: `${score}%` },
  ];

  return (
    <motion.div variants={staggerParent(0.04)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Your progress</h2>
        <p className="text-sm text-muted-foreground tnum">
          <span className="font-medium text-foreground">{summary.mastered}</span> of {summary.total} mastered
        </p>
      </motion.div>

      <motion.div variants={riseChild} className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-2xl border bg-card shadow-sm sm:grid-cols-4 sm:divide-y-0">
        {tiles.map((t) => (
          <div key={t.label} className="px-5 py-4">
            <p className="text-2xl font-medium tracking-tight tnum">{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </motion.div>

      <motion.div variants={riseChild}>
        <ProfileForm profile={profile} />
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name" label="Search your progress" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} {...sortProps}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader>Takeaway</PlainHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "Nothing matches that search." : "There is nothing in the library yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((r) => {
                const href = `/mimir/library/${encodeURIComponent(r.id)}`;
                return (
                  <tr key={r.id} className={LINK_ROW} onClick={rowLink(href)}>
                    <td className="px-5 py-3 font-medium">
                      <Link href={href} className="inline-flex items-center gap-2 group-hover:underline">
                        {r.emoji && <span aria-hidden>{r.emoji}</span>}
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{KIND_LABELS[r.kind].one}</td>
                    <td className="px-5 py-3">
                      <TierBadge tier={r.tier}>
                        {r.tier === "practiced" && r.exchanges > 0 ? `Practiced · ${r.exchanges}` : undefined}
                      </TierBadge>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{formatWhen(r.lastVisitAt)}</td>
                    <td className="max-w-xs truncate px-5 py-3 text-muted-foreground italic">{r.reflection}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="items" />
        </div>
      </motion.div>
    </motion.div>
  );
}

const STYLES: { value: MimirCoachStyle; label: string; hint: string }[] = [
  { value: "socratic", label: "Socratic", hint: "Questions that make you work it out" },
  { value: "direct", label: "Direct", hint: "Short feedback, one question at a time" },
];

/** The role and coaching style the coach is told about at the start of each conversation. */
function ProfileForm({ profile }: { profile: MimirProfile }) {
  const router = useRouter();
  const [role, setRole] = useState<MimirRepRole | null>(profile.role);
  const [style, setStyle] = useState<MimirCoachStyle>(profile.coachStyle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: { role: MimirRepRole | null; coachStyle: MimirCoachStyle }) {
    setRole(next.role);
    setStyle(next.coachStyle);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mimir/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const option = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50",
      active ? "border-brand bg-brand-subtle text-brand" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
    );

  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="font-medium">Your role</p>
          <p className="text-muted-foreground">The coach pitches its challenges at it.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...MIMIR_REP_ROLES, null].map((r) => (
            <button
              key={r ?? "none"}
              type="button"
              disabled={busy}
              aria-pressed={role === r}
              className={option(role === r)}
              onClick={() => void save({ role: r, coachStyle: style })}
            >
              {r ?? "Not set"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="font-medium">Coaching style</p>
          <p className="text-muted-foreground">{STYLES.find((s) => s.value === style)?.hint}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={busy}
              aria-pressed={style === s.value}
              className={option(style === s.value)}
              onClick={() => void save({ role, coachStyle: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="px-5 py-3 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
