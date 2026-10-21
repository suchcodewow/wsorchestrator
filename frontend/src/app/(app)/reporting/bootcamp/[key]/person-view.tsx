"use client";

/**
 * One person on Reporting → Bootcamp. On top, what their manager sees: who
 * they are, then BTC and INT side by side. Below, for Assessments only, every
 * assessment behind those scores, with an administrator's Edit switch.
 */

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { riseChild, staggerParent } from "@/lib/motion";
import type { PersonEmployee, PersonHistory, PersonSubmission } from "@/lib/reporting/bootcamp";
import type { ClassSummary, ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { formatDate } from "../../../cohort-settings/format";
import { ClassCard, Field, TRACK_LABELS } from "../class-card";
import { HistoryRecord, SubmissionGroups } from "./assessments";

export type ViewSubmission = Omit<PersonSubmission, "submittedAt" | "updatedAt"> & {
  submittedAt: string;
  updatedAt: string;
};
export type ViewHistory = Omit<PersonHistory, "createdAt" | "updatedAt"> & { createdAt: string | null; updatedAt: string | null };

export type ViewPerson = {
  email: string;
  employee: PersonEmployee | null;
  classes: Record<ReleaseStage, ClassSummary>;
  records: { history: ViewHistory | null; submissions: ViewSubmission[] } | null;
};

export function PersonView({ person, canEdit, back }: { person: ViewPerson; canEdit: boolean; back: string }) {
  const { employee, records } = person;
  const role = [employee?.title, employee?.department].filter(Boolean).join(" · ");
  const [editing, setEditing] = useState(false);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-8">
      <motion.div variants={riseChild} className="space-y-4">
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Bootcamp
        </Link>
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">{employee?.fullName ?? person.email}</h2>
          <p className="text-sm text-muted-foreground">
            {employee ? (
              <>
                <span className="text-foreground">{person.email}</span>
                {role && <> · {role}</>}
              </>
            ) : (
              <>{person.email} is not in the employee list from the last HiBob sync.</>
            )}
          </p>
        </div>
      </motion.div>

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        {employee && (
          <motion.section variants={riseChild} className="px-5 py-4">
            <h3 className="mb-4 text-sm font-medium text-muted-foreground">Employee</h3>
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
          <ClassCard name="Bootcamp" code="BTC" summary={person.classes.bootcamp} />
          <ClassCard name="Intermediate" code="INT" summary={person.classes.intermediate} />
        </motion.div>
      </motion.div>

      {records && (
        <motion.section variants={riseChild} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-medium tracking-tight">Assessments</h3>
              <p className="text-sm text-muted-foreground">
                {records.submissions.length} {records.submissions.length === 1 ? "assessment" : "assessments"}
                {records.history && " · a bootcamp history"}
              </p>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing((on) => !on)} aria-pressed={editing}>
                {editing ? <Eye /> : <Pencil />}
                {editing ? "Done editing" : "Edit"}
              </Button>
            )}
          </div>

          <SubmissionGroups submissions={records.submissions} editing={editing} />
          {records.history && <HistoryRecord history={records.history} editing={editing} />}
          {records.submissions.length === 0 && !records.history && (
            <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
              No assessments on file.
            </p>
          )}
        </motion.section>
      )}
    </motion.div>
  );
}
