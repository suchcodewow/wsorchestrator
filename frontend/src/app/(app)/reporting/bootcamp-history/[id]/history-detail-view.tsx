"use client";

/**
 * One person's bootcamp history row, laid out in one card: who they are, then
 * BTC and INT side by side, then when the row was last changed. Shown from
 * Bootcamp History and from Cohorts → Previous, so the page that opened it
 * says where its back link goes.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BOOTCAMP_SCORE, EXEMPT_DATE } from "@/db/schema";
import type { HistoryDetail } from "@/lib/evals/bootcamp-history";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatDate, formatScore, formatWhen } from "../../../cohort-settings/format";

type Detail = Omit<HistoryDetail, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

const TRACK_LABELS = { sales: "Sales", engineer: "Engineer", ignored: "Ignored title", exempt: "Exempt", deferred: "Deferred" } as const;

export function HistoryDetailView({
  detail,
  back,
  nested = false,
}: {
  detail: Detail;
  /** The list this was opened from, as it was left. */
  back: { href: string; label: string };
  /** Under a page that has its own `<h1>`, so the name is an `<h2>`. */
  nested?: boolean;
}) {
  const { employee } = detail;
  const Heading = nested ? "h2" : "h1";
  const role = [employee?.title, employee?.department].filter(Boolean).join(" · ");

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-8">
      <motion.div variants={riseChild} className="space-y-4">
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {back.label}
        </Link>
        <div className="space-y-1.5">
          <Heading className={cn("font-medium tracking-tight", nested ? "text-xl" : "text-3xl")}>
            {employee?.fullName ?? detail.email}
          </Heading>
          <p className="text-sm text-muted-foreground">
            {employee ? (
              <>
                <span className="text-foreground">{detail.email}</span>
                {role && <> · {role}</>}
              </>
            ) : (
              <>{detail.email} is not in the employee list from the last HiBob sync.</>
            )}
          </p>
        </div>
      </motion.div>

      <motion.div
        variants={staggerParent(0.04)}
        className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        {employee && (
          <motion.section variants={riseChild} className="px-5 py-4">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">Employee</h2>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Title">{employee.title || "—"}</Field>
              <Field label="Department">{employee.department || "—"}</Field>
              <Field label="Site">{employee.site || "—"}</Field>
              <Field label="Manager">
                {employee.reportsToName || employee.reportsToEmail || "—"}
                {employee.reportsToName && employee.reportsToEmail && (
                  <span className="block text-xs text-muted-foreground">{employee.reportsToEmail}</span>
                )}
              </Field>
              <Field label="Started">{formatDate(employee.startDate)}</Field>
              <Field label="Track">{employee.track ? TRACK_LABELS[employee.track] : "—"}</Field>
            </dl>
          </motion.section>
        )}

        <motion.div variants={riseChild} className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
          <ClassCard
            name="Bootcamp"
            code="BTC"
            date={detail.btcDate}
            score={detail.btcScore}
            individual={detail.btcIndividualScores}
          />
          <ClassCard
            name="Intermediate"
            code="INT"
            date={detail.intDate}
            score={detail.intScore}
            individual={detail.intIndividualScores}
          />
        </motion.div>

        <motion.section variants={riseChild} className="px-5 py-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Record</h2>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <Field label="Created">{formatWhen(detail.createdAt)}</Field>
            <Field label="Last changed">{formatWhen(detail.updatedAt)}</Field>
            <Field label="Last changed by">{detail.updatedByName ?? "—"}</Field>
          </dl>
        </motion.section>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm wrap-break-word">{children}</dd>
    </div>
  );
}

function ClassCard({
  name,
  code,
  date,
  score,
  individual,
}: {
  name: string;
  code: string;
  date: string | null;
  score: number | null;
  individual: Record<string, number> | null;
}) {
  const exempt = date === EXEMPT_DATE;
  const scores = Object.entries(individual ?? {});

  return (
    <section className="flex flex-col gap-5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">{name}</h2>
          <p className="text-xs text-muted-foreground">{code}</p>
        </div>
        {exempt ? (
          <Badge variant="secondary">Exempt</Badge>
        ) : date ? (
          <span className="text-sm tabular-nums text-muted-foreground">{formatDate(date)}</span>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not attended
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Overall score</span>
          <span className="text-2xl font-medium tabular-nums">
            {formatScore(score)}
            {score !== null && <span className="text-sm text-muted-foreground"> / {BOOTCAMP_SCORE.max}</span>}
          </span>
        </div>
        <ScoreBar score={score} />
      </div>

      {scores.length > 0 && (
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-xs text-muted-foreground">By exercise</h3>
          <ul className="space-y-3">
            {scores.map(([key, value]) => (
              <li key={key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 wrap-break-word">{exerciseName(key)}</span>
                  <span className="tabular-nums">{formatScore(value)}</span>
                </div>
                <ScoreBar score={value} thin />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** How far a score sits between nothing and the top of the scale. */
function ScoreBar({ score, thin = false }: { score: number | null; thin?: boolean }) {
  const pct = score === null ? 0 : Math.max(0, Math.min(1, score / BOOTCAMP_SCORE.max)) * 100;
  return (
    <div className={cn("overflow-hidden rounded-full bg-muted", thin ? "h-1" : "h-1.5")}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** "Score-First Call / EMD" as the Sheet's column was named, less its prefix. */
function exerciseName(key: string): string {
  return key.replace(/^score-\s*/i, "") || key;
}
