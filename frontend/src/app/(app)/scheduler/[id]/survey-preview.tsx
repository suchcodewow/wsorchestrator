"use client";

/**
 * A read-only look at the survey a track-day's "Assign Surveys" sends, as an
 * attendee would see it: each session of the day on the stage's tracks that
 * their group is taught, then the two questions about the day. Open to
 * anyone who can view the schedule; nothing in it can be answered or saved.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Feedback, Rating } from "@/app/intake/surveys/[id]/survey-form";
import type { SessionRow } from "@/lib/scheduler/schedule";
import { TRACK_LABELS, formatClock, stageOf } from "@/lib/scheduler/timeline";
import {
  SURVEY_AUDIENCE_LABELS,
  SURVEY_QUESTIONS,
  SURVEY_STAGE_LABELS,
  surveyAudiencesOf,
  surveyDate,
  surveySessions,
} from "@/lib/surveys/survey-values";
import type { BoardColumn } from "./board";

const noop = () => {};

export function SurveyPreview({
  column,
  sessions,
  sent,
  onClose,
}: {
  column: BoardColumn | null;
  /** Every session on the schedule, of any track and day. */
  sessions: SessionRow[];
  /** Whether this day's surveys have already gone out, with the sessions they were sent with. */
  sent: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={column !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {column && <Body key={column.key} column={column} sessions={sessions} sent={sent} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ column, sessions, sent }: { column: BoardColumn; sessions: SessionRow[]; sent: boolean }) {
  const stage = stageOf(column.track);
  const audiences = surveyAudiencesOf(column.track);
  const [audience, setAudience] = useState(audiences[0]!);
  const asked = surveySessions(
    sessions.filter((s) => s.day === column.day),
    stage,
    audience,
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Day {column.day} survey preview</DialogTitle>
        <DialogDescription>
          {SURVEY_STAGE_LABELS[stage]} · {TRACK_LABELS[column.track]} · {surveyDate(column.date)}
        </DialogDescription>
      </DialogHeader>

      {audiences.length > 1 && (
        <div className="flex gap-2" role="group" aria-label="Who the survey is for">
          {audiences.map((a) => (
            <Button
              key={a}
              type="button"
              size="sm"
              variant={a === audience ? "default" : "outline"}
              aria-pressed={a === audience}
              onClick={() => setAudience(a)}
            >
              {SURVEY_AUDIENCE_LABELS[a]}
            </Button>
          ))}
        </div>
      )}

      <div className="max-h-[60vh] divide-y overflow-y-auto rounded-2xl border bg-card">
        {asked.map((s) => (
          <div key={s.id} className="space-y-4 px-5 py-4">
            <div className="space-y-0.5">
              <p className="text-base font-medium">
                {s.emoji && <span className="mr-1.5">{s.emoji}</span>}
                {s.name}
              </p>
              <p className="text-xs text-muted-foreground">{formatClock(s.start)}</p>
            </div>
            <Rating name={`preview-${s.id}`} question={SURVEY_QUESTIONS.sessionRating} value={undefined} missing={false} onChange={noop} disabled />
            <Feedback question={SURVEY_QUESTIONS.sessionFeedback} value="" onChange={noop} disabled />
          </div>
        ))}
        <div className="space-y-4 px-5 py-4">
          <p className="text-base font-medium">The day overall</p>
          <Rating name="preview-day" question={SURVEY_QUESTIONS.dayRating} value={undefined} missing={false} onChange={noop} disabled />
          <Feedback question={SURVEY_QUESTIONS.dayChange} value="" onChange={noop} disabled />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {asked.length === 0
          ? "No sessions are taught to this group that day, so no one would be sent a survey."
          : `${asked.length} session${asked.length === 1 ? "" : "s"} asked about.`}
        {sent && " The surveys already sent keep the sessions they were sent with, whatever the schedule says now."}
      </p>
    </>
  );
}
