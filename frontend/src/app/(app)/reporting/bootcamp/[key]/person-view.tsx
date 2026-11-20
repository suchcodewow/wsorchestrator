"use client";

/**
 * One person on Reporting → Live Sessions. On top, what their manager sees: who
 * they are, then INT (once they have been) above BTC, scores rounded to whole
 * numbers. For Assessments, an administrator's Edit button, top right, swaps
 * that for the Administration View: every assessment behind those scores, as
 * forms that save themselves as they change. Close saves what is waiting and
 * returns. Anyone who reads the assessments without editing sees them below.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Pencil, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { PersonEmployee, PersonReview, PersonSubmission } from "@/lib/reporting/bootcamp";
import type { ClassSummary, ReleaseStage } from "@/lib/reporting/bootcamp-values";
import type { PersonCoachCanary, PersonDiagnostic } from "@/lib/reporting/person-training";
import { formatDate } from "../../../cohort-settings/format";
import { ClassCard, Field, TRACK_LABELS } from "../class-card";
import { EditSessionProvider, SubmissionGroups, useEditSession } from "./assessments";
import { SlackButton } from "./slack-button";
import { CoachCanaryLine, DiagnosticLine } from "./training-lines";

export type ViewSubmission = Omit<PersonSubmission, "submittedAt" | "updatedAt"> & {
  submittedAt: string;
  updatedAt: string;
};

export type ViewReview = Omit<PersonReview, "updatedAt"> & { updatedAt: string };

export type ViewPerson = {
  /** Their employee id, while they have one. */
  key: string;
  email: string;
  employee: PersonEmployee | null;
  classes: Record<ReleaseStage, ClassSummary>;
  records: { submissions: ViewSubmission[]; reviews: ViewReview[] } | null;
  diagnostic: PersonDiagnostic | null;
  coachCanary: PersonCoachCanary | null;
};

/** One of the previous/next buttons; dimmed and inert at the end of the list. */
function StepLink({ href, label, Icon }: { href: string | null; label: string; Icon: LucideIcon }) {
  const style = "inline-flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-sm";
  if (!href) {
    return (
      <span aria-label={label} aria-disabled="true" className={cn(style, "opacity-40")}>
        <Icon className="size-4" />
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} className={cn(style, "transition-colors hover:text-foreground")}>
      <Icon className="size-4" />
    </Link>
  );
}

/** Records, once per opening, that the reader opened this card: the eye on the list names them. */
function useRecordView(key: string) {
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (recorded.current === key) return;
    recorded.current = key;
    void fetch(`/api/reporting/bootcamp/people/${encodeURIComponent(key)}/views`, { method: "POST" }).catch(() => undefined);
  }, [key]);
}

export function PersonView({
  person,
  canEdit,
  back,
  steps,
}: {
  person: ViewPerson;
  canEdit: boolean;
  back: string;
  /** The previous and next person in the table they were opened from, or null at an end. */
  steps: { prev: string | null; next: string | null };
}) {
  const { employee, records } = person;
  useRecordView(person.key);
  const [editing, setEditing] = useState(false);
  const session = useEditSession();

  async function close() {
    if (await session.saveAll()) {
      session.clearProblem();
      setEditing(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-6">
      <motion.div variants={riseChild} className="flex items-center justify-between gap-4">
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Live Sessions
        </Link>
        <div className="flex items-center gap-3">
          {!editing && (steps.prev || steps.next) && (
            <div className="flex gap-1">
              <StepLink href={steps.prev} label="Previous person" Icon={ChevronLeft} />
              <StepLink href={steps.next} label="Next person" Icon={ChevronRight} />
            </div>
          )}
          {canEdit && records && (
            <>
              {editing && (
                <span aria-live="polite" className="text-sm text-muted-foreground">
                  {session.saving || session.changed > 0 ? "Saving…" : "All changes saved"}
                </span>
              )}
              {editing ? (
                <Button variant="outline" size="sm" disabled={session.saving} onClick={() => void close()}>
                  {session.saving ? <Loader2 className="animate-spin" /> : <X />}
                  Close
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit
                </Button>
              )}
            </>
          )}
        </div>
      </motion.div>

      {!(editing && records) && (
        <motion.div variants={staggerParent(0.04)} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
          <motion.section variants={riseChild} className="space-y-3 bg-black/3 px-5 py-3 dark:bg-white/4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-xl font-medium tracking-tight">{employee?.fullName ?? person.email}</h2>
                  <SlackButton personKey={person.key} />
                </div>
                {(!employee || employee.title) && (
                  <p className="text-sm text-muted-foreground">
                    {employee ? employee.title : "Not in the employee list from the last HiBob sync."}
                  </p>
                )}
              </div>
              {employee && (
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">Started {formatDate(employee.startDate)}</span>
              )}
            </div>
            {employee && (
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Department">{employee.department || "—"}</Field>
                <Field label="Track">{employee.track ? TRACK_LABELS[employee.track] : "—"}</Field>
                <Field label="Site">{employee.site || "—"}</Field>
                <Field label="Manager">{employee.reportsToName || "—"}</Field>
              </dl>
            )}
          </motion.section>

          {person.classes.intermediate.date !== null && (
            <motion.div variants={riseChild}>
              <ClassCard name="Intermediate" summary={person.classes.intermediate} whole />
            </motion.div>
          )}
          <motion.div variants={riseChild}>
            <ClassCard
              name="Bootcamp"
              summary={person.classes.bootcamp}
              whole
              // Once they have been to INT, their BTC is history: closed until opened.
              collapsible={person.classes.intermediate.date !== null}
            />
          </motion.div>
          {person.diagnostic && (
            <motion.div variants={riseChild}>
              <DiagnosticLine diagnostic={person.diagnostic} />
            </motion.div>
          )}
          {person.coachCanary && (
            <motion.div variants={riseChild}>
              <CoachCanaryLine canary={person.coachCanary} />
            </motion.div>
          )}
        </motion.div>
      )}

      {records && (editing || !canEdit) && (
        <motion.section variants={riseChild} className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-medium tracking-tight">{employee?.fullName ?? person.email}</h3>
            <p className="text-sm text-muted-foreground">
              {records.submissions.length} {records.submissions.length === 1 ? "assessment" : "assessments"}
            </p>
          </div>
          {editing && session.problem && (
            <p role="alert" className="text-sm text-destructive">
              {session.problem}
            </p>
          )}

          <EditSessionProvider value={session.register}>
            <SubmissionGroups personKey={person.key} submissions={records.submissions} reviews={records.reviews} editing={editing} />
          </EditSessionProvider>
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
