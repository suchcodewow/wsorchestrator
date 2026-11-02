"use client";

/**
 * The participation popup: every descriptor for one attendee, its shared
 * counter from 0 to 3 with arrows, who has moved it, and their 1 to 4 score
 * below. With more than one person it lists them beside the counters, for a
 * judge marking the rest of an evaluation group. It is a dialog over the page,
 * so a recording or unsaved scores behind it carry on.
 *
 * Marks save as they are clicked. An administrator on Reporting also sees what
 * was generated; each mark carries through to the saved score, and the AI
 * comments button beside it writes the comments again from the marks as they are now.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, MessageSquarePlus, Users } from "lucide-react";
import { AiCommentsButton } from "@/components/ai-comments-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PARTICIPATION_LIMITS, type EvalsAssessmentStage, type ParticipationPolarity } from "@/db/schema";
import type { GroupPerson, ParticipationSheet } from "@/lib/evals/participation";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  no_bootcamp: "No bootcamp is active, so nobody can be marked.",
  no_class: "The active bootcamp has no intermediate class.",
  not_found: "This person is not in the active bootcamp's cohort.",
  forbidden: "You can no longer mark participation — reload the page.",
  no_assessment: "This class has no Participation assessment.",
  no_marks: "Mark them first: there is nothing to write comments from.",
  unconfigured: "Claude is not set up on this deployment.",
  upstream: "Claude could not write them just now. Try again.",
};

const SECTIONS: { polarity: ParticipationPolarity; label: string; className: string }[] = [
  { polarity: "positive", label: "Positive", className: "text-green-600 dark:text-green-400" },
  { polarity: "negative", label: "Constructive", className: "text-orange-500 dark:text-orange-400" },
];

function errorFor(status: number, code: string | undefined): string {
  return (code && ERRORS[code]) || `Something went wrong (${status}).`;
}

/** With no `onAdjust` the count is only shown, with no arrows. */
function Counter({
  row,
  disabled,
  onAdjust,
}: {
  row: ParticipationSheet["descriptors"][number];
  disabled: boolean;
  onAdjust?: (delta: 1 | -1) => void;
}) {
  const adjustments = row.adjustments.map((a) => `${a.name} ${a.net > 0 ? "+" : "−"}${Math.abs(a.net)}`).join(" · ");
  return (
    <li className="flex items-center gap-3 py-0.5">
      <div className="flex min-h-6 shrink-0 items-center gap-0.5">
        {onAdjust && (
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            aria-label={`Lower ${row.name}`}
            disabled={disabled || row.count === 0}
            onClick={() => onAdjust(-1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
        )}
        <span className="w-5 text-center text-sm font-medium tabular-nums" aria-label={`${row.name} count`}>
          {row.count}
        </span>
        {onAdjust && (
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            aria-label={`Raise ${row.name}`}
            disabled={disabled || row.count >= PARTICIPATION_LIMITS.maxCount}
            onClick={() => onAdjust(1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        )}
      </div>
      <span className="min-w-0 text-sm wrap-break-word">{row.name}</span>
      {adjustments && (
        <span className="ml-auto max-w-[45%] shrink-0 truncate text-right text-xs text-muted-foreground" title={adjustments}>
          {adjustments}
        </span>
      )}
    </li>
  );
}

/** Reads one attendee's marks, and moves them; each move saves their score and clears that side's comment. */
function useParticipationSheet(employeeId: string, onMoved?: () => void) {
  const [sheet, setSheet] = useState<ParticipationSheet | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const res = await fetch(`/api/evals/participation/${encodeURIComponent(employeeId)}`);
        const body = await res.json().catch(() => null);
        if (!current) return;
        if (res.ok) setSheet(body as ParticipationSheet);
        else setError(errorFor(res.status, body?.error));
      } catch {
        if (current) setError("Could not reach the server.");
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [employeeId]);

  async function adjust(descriptorId: string, delta: 1 | -1) {
    setSaving(descriptorId);
    setError(null);
    try {
      const res = await fetch(`/api/evals/participation/${encodeURIComponent(employeeId)}/marks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptorId, delta }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFor(res.status, body?.error));
        return;
      }
      setSheet(body as ParticipationSheet);
      onMoved?.();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(null);
    }
  }

  return { sheet, setSheet, saving, error, adjust };
}

function Loading() {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Loading marks…
    </div>
  );
}

function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

/** Every descriptor, positive then constructive. */
function Counters({
  sheet,
  disabled,
  onAdjust,
}: {
  sheet: ParticipationSheet;
  disabled: boolean;
  /** Leave out to show the marks with no arrows. */
  onAdjust?: (descriptorId: string, delta: 1 | -1) => void;
}) {
  return (
    <>
      {sheet.descriptors.length === 0 && <p className="text-sm text-muted-foreground">No descriptors are set up yet.</p>}
      {SECTIONS.map(({ polarity, label, className }) => {
        const rows = sheet.descriptors.filter((x) => x.polarity === polarity);
        if (rows.length === 0) return null;
        return (
          <section key={polarity}>
            <h3 className={cn("text-xs font-medium", className)}>{label}</h3>
            <ul>
              {rows.map((row) => (
                <Counter
                  key={row.id}
                  row={row}
                  disabled={disabled}
                  onAdjust={onAdjust && ((delta) => onAdjust(row.id, delta))}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/**
 * The popup's marks inside the Administration View. With `onMoved` they have
 * arrows, and each move carries through to a saved score, as an edit does.
 */
export function ParticipationMarks({
  employeeId,
  stage,
  onMoved,
  onScore,
}: {
  employeeId: string;
  /** The class of the assessment they sit in; a person's marks in another class are not its marks. */
  stage: EvalsAssessmentStage;
  onMoved?: () => void;
  /** Told the score the marks give whenever they are read or move, for a form whose saved score is still blank. */
  onScore?: (score: number | null) => void;
}) {
  const { sheet, saving, error, adjust } = useParticipationSheet(employeeId, onMoved);
  const runningScore = sheet && sheet.attendee.stage === stage ? sheet.runningScore : null;
  useEffect(() => {
    onScore?.(runningScore);
  }, [onScore, runningScore]);
  if (!sheet) return error ? <ErrorLine error={error} /> : <Loading />;
  if (sheet.attendee.stage !== stage) return null;
  return (
    <div className="space-y-1.5">
      <Counters sheet={sheet} disabled={saving !== null} onAdjust={onMoved && adjust} />
      {error && <ErrorLine error={error} />}
    </div>
  );
}

/** Has Claude write this person's comments again from the marks they have now. */
function useAiComments(employeeId: string, onDone: (sheet: ParticipationSheet) => void) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reporting/bootcamp/participation/${encodeURIComponent(employeeId)}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorFor(res.status, body?.error));
        return;
      }
      onDone(body as ParticipationSheet);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return { pending, error, run };
}

function SheetPanel({ employeeId, canRegenerate }: { employeeId: string; canRegenerate: boolean }) {
  const router = useRouter();
  // An administrator's marks carry through to the saved score, as they do in the Administration View.
  const { sheet, setSheet, saving, error, adjust } = useParticipationSheet(employeeId, () => router.refresh());
  const comments = useAiComments(employeeId, setSheet);
  if (!sheet) return error ? <ErrorLine error={error} /> : <Loading />;
  const score = sheet.saved?.averageScore ?? sheet.runningScore;

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="min-w-0 text-sm wrap-break-word">
        <span className="font-medium">{sheet.attendee.fullName}</span>{" "}
        <span className="text-muted-foreground">· {STAGE_LABELS[sheet.attendee.stage]}</span>
      </p>

      <Counters sheet={sheet} disabled={saving !== null} onAdjust={adjust} />
      {error && <ErrorLine error={error} />}

      {score !== null && (
        <section className="space-y-1.5 border-t pt-2">
          <div className="flex min-h-8 items-center gap-2">
            <p className="text-sm" aria-live="polite">
              <span className="text-muted-foreground">Score</span>{" "}
              <span className="font-medium tabular-nums">{score}</span>
            </p>
            {canRegenerate && <AiCommentsButton pending={comments.pending} onClick={comments.run} />}
          </div>
          {comments.error && <ErrorLine error={comments.error} />}
          {sheet.saved?.positiveFeedback && <p className="text-sm whitespace-pre-line">{sheet.saved.positiveFeedback}</p>}
          {sheet.saved?.constructiveFeedback && (
            <p className="text-sm whitespace-pre-line">{sheet.saved.constructiveFeedback}</p>
          )}
        </section>
      )}
    </div>
  );
}

export function ParticipationDialog({
  open,
  onOpenChange,
  people,
  initialId,
  canRegenerate = false,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: GroupPerson[];
  initialId: string;
  /** Whether the viewer may have this person's comments written again. */
  canRegenerate?: boolean;
  /** Whether the group is still being read. */
  loading?: boolean;
}) {
  const [picked, setPicked] = useState(initialId);
  const many = people.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("gap-2 p-4", many ? "sm:max-w-3xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle>Participation</DialogTitle>
          <DialogDescription className="sr-only">Raise or lower each descriptor for this attendee.</DialogDescription>
        </DialogHeader>
        <div className={cn("gap-4", many && "grid sm:grid-cols-[12rem_minmax(0,1fr)]")}>
          {(many || loading) && (
            <nav aria-label="Evaluation group" className="min-w-0 space-y-0.5">
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-current={p.id === picked}
                  onClick={() => setPicked(p.id)}
                  className={cn(
                    "w-full cursor-pointer rounded-md px-2 py-1 text-left text-sm wrap-break-word transition-colors",
                    p.id === picked ? "bg-brand/10 font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {p.fullName}
                </button>
              ))}
            </nav>
          )}
          <SheetPanel key={picked} employeeId={picked} canRegenerate={canRegenerate} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Opens the popup for one attendee, from a row in a table. */
export function ParticipationButton({
  employeeId,
  fullName,
  canRegenerate = false,
  labelled = false,
}: {
  employeeId: string;
  fullName: string;
  canRegenerate?: boolean;
  /** Icon only, with a border shown only on hover. */
  labelled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    // React bubbles the dialog's clicks through its portal, so they stop here rather than opening the row.
    <span onClick={(ev) => ev.stopPropagation()}>
      {labelled ? (
        <button
          type="button"
          aria-label={`Participation for ${fullName}`}
          onClick={() => setOpen(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2 py-1 outline-none transition-colors hover:border-input hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <MessageSquarePlus className="size-4 text-muted-foreground" />
        </button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Participation for ${fullName}`}
          title="Participation"
          onClick={() => setOpen(true)}
        >
          <MessageSquarePlus />
        </Button>
      )}
      {open && (
        <ParticipationDialog
          open
          onOpenChange={setOpen}
          people={[{ id: employeeId, fullName }]}
          initialId={employeeId}
          canRegenerate={canRegenerate}
        />
      )}
    </span>
  );
}

/** Opens the popup on an attendee being scored, with the rest of their evaluation group beside them. */
export function ParticipationGroupButton({
  assessmentId,
  employeeId,
  fullName,
}: {
  assessmentId: string;
  employeeId: string;
  fullName: string;
}) {
  const self: GroupPerson = { id: employeeId, fullName };
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<GroupPerson[]>([self]);
  const [loading, setLoading] = useState(false);

  async function show() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/evals/scoring/${assessmentId}/${encodeURIComponent(employeeId)}/group`);
      const body = await res.json().catch(() => null);
      const group: GroupPerson[] = res.ok ? (body?.people ?? []) : [];
      setPeople(group.some((p) => p.id === employeeId) ? group : [self, ...group]);
    } catch {
      setPeople([self]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={show}>
        <Users />
        Participation
      </Button>
      {open && (
        <ParticipationDialog
          open
          onOpenChange={setOpen}
          people={people}
          initialId={employeeId}
          loading={loading}
        />
      )}
    </>
  );
}
