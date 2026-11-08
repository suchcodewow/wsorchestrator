"use client";

/**
 * One person on Reporting → Live Sessions. On top, what their manager sees: who
 * they are, then INT (once they have been) above BTC, scores rounded to whole
 * numbers. Below, the Administration View, for Assessments only: every
 * assessment behind those scores, with an administrator's Edit switch, whose
 * Save Changes saves every form changed and Discard drops them, once confirmed.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Pencil, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { riseChild, staggerParent } from "@/lib/motion";
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

/** Records, once per opening, that the reader opened this card: the eye on the list names them. */
function useRecordView(key: string) {
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (recorded.current === key) return;
    recorded.current = key;
    void fetch(`/api/reporting/bootcamp/people/${encodeURIComponent(key)}/views`, { method: "POST" }).catch(() => undefined);
  }, [key]);
}

export function PersonView({ person, canEdit, back }: { person: ViewPerson; canEdit: boolean; back: string }) {
  const { employee, records } = person;
  useRecordView(person.key);
  const [editing, setEditing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const session = useEditSession();

  async function saveChanges() {
    if (await session.saveAll()) setEditing(false);
  }

  function stopEditing() {
    setDiscarding(false);
    session.clearProblem();
    setEditing(false);
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-4xl space-y-6">
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
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                Started {formatDate(employee.startDate)}
              </span>
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

      {records && (
        <motion.section variants={riseChild} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-medium tracking-tight">Administration View</h3>
              <p className="text-sm text-muted-foreground">
                {records.submissions.length} {records.submissions.length === 1 ? "assessment" : "assessments"}
              </p>
            </div>
            {canEdit &&
              (editing ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={session.saving}
                    onClick={() => (session.changed > 0 ? setDiscarding(true) : stopEditing())}
                  >
                    <Undo2 />
                    Discard
                  </Button>
                  <Button variant="brand" size="sm" disabled={session.saving} onClick={() => void saveChanges()}>
                    {session.saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Save Changes
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit
                </Button>
              ))}
          </div>
          {editing && session.problem && (
            <p role="alert" className="text-sm text-destructive">
              {session.problem}
            </p>
          )}

          <EditSessionProvider value={session.register}>
            <SubmissionGroups
              personKey={person.key}
              submissions={records.submissions}
              reviews={records.reviews}
              editing={editing}
            />
          </EditSessionProvider>
          {records.submissions.length === 0 && (
            <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-sm">
              No assessments on file.
            </p>
          )}
        </motion.section>
      )}

      <Dialog open={discarding} onOpenChange={setDiscarding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              {session.changed === 1 ? "One form has" : `${session.changed} forms have`} changes that have not been
              saved. Discarding puts them back as they were saved. Participation marks moved while editing were saved as
              they moved, and stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={stopEditing}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
