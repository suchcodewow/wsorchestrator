"use client";

/**
 * One person's bootcamp history row, laid out in one card: who they are, then
 * BTC and INT side by side, then when the row was last changed. Opened from
 * Cohorts → Previous, which says where its back link goes.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import type { HistoryDetail } from "@/lib/evals/bootcamp-history";
import { riseChild, staggerParent } from "@/lib/motion";
import { historyClass } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatWhen } from "../../../cohort-settings/format";
import { ClassCard, Field, TRACK_LABELS } from "../../../reporting/bootcamp/class-card";

type Detail = Omit<HistoryDetail, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

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
            summary={historyClass(detail.btcDate, detail.btcScore, detail.btcIndividualScores)}
          />
          <ClassCard
            name="Intermediate"
            code="INT"
            summary={historyClass(detail.intDate, detail.intScore, detail.intIndividualScores)}
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
