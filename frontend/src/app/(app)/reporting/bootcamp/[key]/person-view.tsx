"use client";

/**
 * One person on Reporting → Live Sessions. On top, what their manager sees: who
 * they are, then INT (once they have been) above BTC, scores rounded to whole
 * numbers. Below, the Administration View, for Assessments only: every
 * assessment behind those scores, with an administrator's Edit switch.
 */

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { riseChild, staggerParent } from "@/lib/motion";
import type { PersonEmployee, PersonSubmission } from "@/lib/reporting/bootcamp";
import type { ClassSummary, ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { formatDate } from "../../../cohort-settings/format";
import { ClassCard, Field, TRACK_LABELS } from "../class-card";
import { SubmissionGroups } from "./assessments";

export type ViewSubmission = Omit<PersonSubmission, "submittedAt" | "updatedAt"> & {
  submittedAt: string;
  updatedAt: string;
};

export type ViewPerson = {
  email: string;
  employee: PersonEmployee | null;
  classes: Record<ReleaseStage, ClassSummary>;
  records: { submissions: ViewSubmission[] } | null;
};

export function PersonView({ person, canEdit, back }: { person: ViewPerson; canEdit: boolean; back: string }) {
  const { employee, records } = person;
  const [editing, setEditing] = useState(false);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-8">
      <motion.div variants={riseChild}>
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Live Sessions
        </Link>
      </motion.div>

      <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <motion.section variants={riseChild} className="space-y-4 px-5 py-4">
          <div className="space-y-1">
            <h2 className="text-xl font-medium tracking-tight">{employee?.fullName ?? person.email}</h2>
            {(!employee || employee.title) && (
              <p className="text-sm text-muted-foreground">
                {employee ? employee.title : "Not in the employee list from the last HiBob sync."}
              </p>
            )}
          </div>
          {employee && (
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Department">{employee.department || "—"}</Field>
              <Field label="Site">{employee.site || "—"}</Field>
              <Field label="Manager">{employee.reportsToName || "—"}</Field>
              <Field label="Started">{formatDate(employee.startDate)}</Field>
              <Field label="Track">{employee.track ? TRACK_LABELS[employee.track] : "—"}</Field>
            </dl>
          )}
        </motion.section>

        {person.classes.intermediate.date !== null && (
          <motion.div variants={riseChild}>
            <ClassCard name="Intermediate" code="INT" summary={person.classes.intermediate} whole />
          </motion.div>
        )}
        <motion.div variants={riseChild}>
          <ClassCard name="Bootcamp" code="BTC" summary={person.classes.bootcamp} whole />
        </motion.div>
      </motion.div>

      {records && (
        <motion.section variants={riseChild} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-medium tracking-tight">Administration View</h3>
              <p className="text-sm text-muted-foreground">
                {records.submissions.length} {records.submissions.length === 1 ? "assessment" : "assessments"}
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
          {records.submissions.length === 0 && (
            <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
              No assessments on file.
            </p>
          )}
        </motion.section>
      )}
    </motion.div>
  );
}
