"use client";

/**
 * Everything Assessments sees behind a person's INT and BTC: each class's
 * overall feedback and exams first, then each assessment, with every
 * criterion's score and comment and both feedback boxes, each closed until
 * opened.
 * With Edit on, each opens to a form and an Assessments Administrator corrects
 * any of it in place; Save Changes saves every form changed, and Discard drops
 * them all. One with no criteria, as the old bootcamp history left, has its
 * score set directly. The running bootcamp's Participation
 * assessment shows its marks, and with Edit on they move as they do in the
 * popup, taking a generated score with them.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AiCommentsButton } from "@/components/ai-comments-button";
import { ParticipationMarks } from "@/components/participation/participation-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BOOTCAMP_EXAM, BOOTCAMP_SCORE, EVALS_ASSESSMENT_LIMITS } from "@/db/schema";
import {
  CONSTRUCTIVE_REQUIRED_NOTE,
  CRITERION_SCORES,
  POSITIVE_REQUIRED_NOTE,
  STAGE_LABELS,
  averageScore,
  requiredFeedback,
  wholeScore,
} from "@/lib/evals/assessment-values";
import { examAverage, examScore, type OverallSide, type ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { cn } from "@/lib/utils";
import { formatDate, formatScore, formatWhen } from "../../../cohort-settings/format";
import { Field } from "../class-card";
import type { ViewReview, ViewSubmission } from "./person-view";

const SAVE_ERRORS: Record<string, string> = {
  conflict: "Someone changed this since the page loaded. Reload to see their version.",
  feedback_required: "This average needs the feedback marked required.",
  invalid: "Something here isn't valid; check each field.",
  not_found: "This has been removed.",
};

/** Saves `body` to `url`, keeping the error to show, if any; the edit session reloads the page's data once all are in. */
function useSave() {
  const [error, setError] = useState<string | null>(null);

  async function save(url: string, body: unknown, method: "PATCH" | "PUT" = "PATCH"): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError((code && SAVE_ERRORS[code]) || `Could not save (${res.status})`);
        return false;
      }
      return true;
    } catch {
      setError("Could not save");
      return false;
    }
  }

  return { save, error };
}

/** A form with unsaved changes: whether they can be saved as they stand, and how. */
type PendingEdit = { valid: boolean; save: () => Promise<boolean> };

const EditRegistry = createContext<((id: string, edit: PendingEdit | null) => void) | null>(null);

/**
 * The Administration View's one save: every form with changes registers here,
 * and `saveAll` saves each in turn, then reloads the page's data once. A form
 * that cannot be saved as it stands holds up all of them.
 */
export function useEditSession() {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, PendingEdit>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const register = useCallback((id: string, edit: PendingEdit | null) => {
    setEdits((all) => {
      if (!edit && !(id in all)) return all;
      const next = { ...all };
      if (edit) next[id] = edit;
      else delete next[id];
      return next;
    });
  }, []);

  async function saveAll(): Promise<boolean> {
    const list = Object.values(edits);
    if (list.some((e) => !e.valid)) {
      setProblem("Some changes can't be saved yet; check the fields marked in each.");
      return false;
    }
    setSaving(true);
    setProblem(null);
    let failed = 0;
    for (const edit of list) if (!(await edit.save())) failed++;
    setSaving(false);
    if (list.length > 0) router.refresh();
    if (failed > 0) {
      setProblem(`${failed} of ${list.length} could not be saved; each says why.`);
      return false;
    }
    return true;
  }

  return { register, changed: Object.keys(edits).length, saving, problem, saveAll, clearProblem: () => setProblem(null) };
}

export const EditSessionProvider = EditRegistry.Provider;

/**
 * Tells the edit session whether this form has changes, and how to save them.
 * `save` is read when Save Changes runs, so it may change every render.
 */
function usePendingEdit(id: string, changed: boolean, valid: boolean, save: () => Promise<boolean>) {
  const register = useContext(EditRegistry);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!register) return;
    register(id, changed ? { valid, save: () => saveRef.current() } : null);
    return () => register(id, null);
  }, [register, id, changed, valid]);
}

/**
 * A class's assessment averages as saved, their mean, and its overall score,
 * the exams counted as one more assessment as in the manager's view.
 */
function classScores(items: ViewSubmission[], review: ViewReview | null) {
  const scored = items.flatMap((s) => (s.averageScore === null ? [] : [s.averageScore]));
  const exams = review ? examAverage(review.entranceExam, review.exitExam) : null;
  return {
    scored,
    average: averageScore(scored),
    overall: averageScore(exams === null ? scored : [...scored, examScore(exams)]),
  };
}

/** One card per class someone was assessed in: INT before BTC, each newest bootcamp first, as fetched. */
export function SubmissionGroups({
  personKey,
  submissions,
  reviews,
  editing,
}: {
  personKey: string;
  submissions: ViewSubmission[];
  reviews: ViewReview[];
  editing: boolean;
}) {
  const groups: { key: string; first: ViewSubmission; items: ViewSubmission[] }[] = [];
  const ordered = [
    ...submissions.filter((s) => s.stage === "intermediate"),
    ...submissions.filter((s) => s.stage !== "intermediate"),
  ];
  for (const s of ordered) {
    const key = `${s.bootcamp.id}:${s.stage}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.items.push(s);
    else groups.push({ key, first: s, items: [s] });
  }

  // Once they have been to INT, their BTC is history: its cards start closed.
  const atIntermediate = submissions.some((s) => s.stage === "intermediate");

  return (
    <>
      {groups.map(({ key, first, items }) => (
        <ClassGroup
          key={key}
          personKey={personKey}
          first={first}
          items={items}
          review={reviews.find((r) => r.bootcampId === first.bootcamp.id && r.stage === first.stage) ?? null}
          editing={editing}
          collapsible={atIntermediate && first.stage === "bootcamp"}
        />
      ))}
    </>
  );
}

/**
 * One class at one bootcamp: its review, then each assessment. A collapsible
 * one starts closed, showing only its overall score, the exams counted as in
 * the manager's view; closed, its forms stay in the page with what was typed.
 */
function ClassGroup({
  personKey,
  first,
  items,
  review,
  editing,
  collapsible,
}: {
  personKey: string;
  first: ViewSubmission;
  items: ViewSubmission[];
  review: ViewReview | null;
  editing: boolean;
  collapsible: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const { scored, average, overall } = classScores(items, review);
  const bodyId = `class-${first.bootcamp.id}-${first.stage}`;
  const toggle = () => setOpen((was) => !was);

  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div
        onClick={collapsible ? toggle : undefined}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 px-5 py-3",
          collapsible && "cursor-pointer transition-colors hover:bg-muted/30",
        )}
      >
        <div className="flex items-start gap-2">
          {collapsible && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={`${STAGE_LABELS[first.stage]} details`}
              onClick={(ev) => {
                ev.stopPropagation();
                toggle();
              }}
              className="-mx-1 mt-1 cursor-pointer rounded-md px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
            </button>
          )}
          <div className="space-y-0.5">
            <h4 className="font-medium">
              {STAGE_LABELS[first.stage]} · {formatDate(first.bootcamp.startDate)}
            </h4>
            {open && (
              <p className="text-xs text-muted-foreground">
                {STAGE_LABELS[first.stage]} average {formatScore(average)} over {scored.length}{" "}
                {scored.length === 1 ? "assessment" : "assessments"}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {open &&
            (first.released ? (
              <Badge variant="secondary">Released to managers</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not released
              </Badge>
            ))}
          <span className="text-xl font-medium tabular-nums">
            {formatScore(overall)}
            {overall !== null && <span className="text-sm text-muted-foreground"> / {BOOTCAMP_SCORE.max}</span>}
          </span>
        </div>
      </div>
      <div id={bodyId} hidden={!open} className="divide-y">
        {editing ? (
          <ClassReviewForm
            key={review?.updatedAt ?? "new"}
            personKey={personKey}
            bootcampId={first.bootcamp.id}
            stage={first.stage}
            review={review}
            sources={{
              positive: items.some((s) => s.positiveFeedback.trim()),
              constructive: items.some((s) => s.constructiveFeedback.trim()),
            }}
          />
        ) : (
          <ClassReviewRow review={review} />
        )}
        {items.map((s) =>
          editing ? (
            <EditableSubmission key={s.id} submission={s} personKey={personKey} />
          ) : (
            <SubmissionRow key={s.id} submission={s} personKey={personKey} />
          ),
        )}
      </div>
    </div>
  );
}

/** Marks are kept only for the running bootcamp, so only its Participation assessment has any to show. */
const hasMarks = (s: ViewSubmission) => s.builtIn === "participation" && s.bootcamp.status === "active";

function SubmissionHeading({ submission: s, average }: { submission: ViewSubmission; average: number | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <h5 className="font-medium wrap-break-word">{s.assessmentName}</h5>
        <p className="text-xs text-muted-foreground">
          {s.ownerName ?? "Unknown judge"} · {formatWhen(s.updatedAt)}
        </p>
      </div>
      <span className="text-xl font-medium tabular-nums">{formatScore(average)}</span>
    </div>
  );
}

/**
 * An assessment's heading, which opens and closes what is behind it. Closed,
 * that stays in the page, so a form keeps whatever has been typed.
 */
function Collapsible({
  submission: s,
  average,
  open,
  onToggle,
  children,
}: {
  submission: ViewSubmission;
  average: number | null;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const detailsId = `assessment-${s.id}`;
  return (
    <section>
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-start gap-2 px-5 py-4 transition-colors hover:bg-muted/30"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${s.assessmentName} details`}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggle();
          }}
          className="-mx-1 mt-0.5 cursor-pointer rounded-md px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          <SubmissionHeading submission={s} average={average} />
        </div>
      </div>
      <div id={detailsId} hidden={!open} className="space-y-4 px-5 pb-4">
        {children}
      </div>
    </section>
  );
}

/** One assessment, closed until opened; one with nothing behind its heading does not open. */
function SubmissionRow({ submission: s, personKey }: { submission: ViewSubmission; personKey: string }) {
  const [open, setOpen] = useState(false);
  const hasFeedback = Boolean(s.positiveFeedback || s.constructiveFeedback);

  if (s.scores.length === 0 && !hasFeedback && !hasMarks(s)) {
    return (
      <section className="px-5 py-4">
        <SubmissionHeading submission={s} average={s.averageScore} />
      </section>
    );
  }

  return (
    <Collapsible submission={s} average={s.averageScore} open={open} onToggle={() => setOpen((was) => !was)}>
      {hasMarks(s) && open && <ParticipationMarks employeeId={personKey} stage={s.stage} />}
      {s.scores.length > 0 && (
        <ul className="space-y-3">
          {s.scores.map((c) => (
            <li key={c.criterionId} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 wrap-break-word">{c.criterionName}</span>
                <span className="tabular-nums">{c.score}</span>
              </div>
              {c.comment && (
                <p className="whitespace-pre-line text-sm text-muted-foreground wrap-break-word">{c.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasFeedback && (
        <dl className={cn("grid gap-4", (s.scores.length > 0 || hasMarks(s)) && "border-t pt-4")}>
          <Field label="Positive feedback">
            <span className="whitespace-pre-line">{s.positiveFeedback || "—"}</span>
          </Field>
          <Field label="Constructive feedback">
            <span className="whitespace-pre-line">{s.constructiveFeedback || "—"}</span>
          </Field>
        </dl>
      )}
    </Collapsible>
  );
}

/**
 * Holds whether the form is open, so saving, which rebuilds the form from what
 * was saved, leaves it open. A move of a mark saves at once, so a form with
 * marks is not rebuilt, or it would lose the comments being typed.
 */
function EditableSubmission({ submission: s, personKey }: { submission: ViewSubmission; personKey: string }) {
  const [open, setOpen] = useState(false);
  return (
    <SubmissionForm
      key={hasMarks(s) ? "marks" : s.updatedAt}
      submission={s}
      personKey={personKey}
      open={open}
      onToggle={() => setOpen((was) => !was)}
    />
  );
}

function SubmissionForm({
  submission: s,
  personKey,
  open,
  onToggle,
}: {
  submission: ViewSubmission;
  personKey: string;
  open: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const { save, error } = useSave();
  const [scores, setScores] = useState(() => s.scores.map((c) => ({ ...c })));
  const [positive, setPositive] = useState(s.positiveFeedback);
  const [constructive, setConstructive] = useState(s.constructiveFeedback);
  // An assessment with no criteria, as the old bootcamp history left, takes its score as typed.
  const direct = s.scores.length === 0;
  const [typed, setTyped] = useState(s.averageScore === null ? "" : String(s.averageScore));
  // A Participation score comes from its marks, as an average comes from its criteria; before Generate gives it
  // one, saving gives it the score its marks make now.
  const [marksScore, setMarksScore] = useState<number | null>(null);
  const fromMarks = hasMarks(s) && (s.averageScore !== null || marksScore !== null);

  const typedScore = fromMarks ? (s.averageScore ?? marksScore!) : Number(typed);
  const typedValid =
    fromMarks ||
    (typed.trim() !== "" &&
      Number.isFinite(typedScore) &&
      typedScore >= BOOTCAMP_SCORE.min &&
      typedScore <= BOOTCAMP_SCORE.max &&
      Number(typedScore.toFixed(1)) === typedScore);
  const average = direct ? (typedValid ? typedScore : null) : averageScore(scores.map((c) => c.score));
  const needed = direct || average === null ? null : requiredFeedback(wholeScore(average));
  const missing =
    (direct && !typedValid) ||
    (needed === "positive" && !positive.trim()) ||
    (needed === "constructive" && !constructive.trim());
  const changed =
    positive !== s.positiveFeedback ||
    constructive !== s.constructiveFeedback ||
    (direct && typedScore !== s.averageScore) ||
    scores.some((c, i) => c.score !== s.scores[i]!.score || c.comment !== s.scores[i]!.comment);

  usePendingEdit(`submission-${s.id}`, changed, !missing, () =>
    save(`/api/reporting/bootcamp/submissions/${s.id}`, {
      scores: scores.map(({ criterionId, score, comment }) => ({ criterionId, score, comment })),
      positiveFeedback: positive,
      constructiveFeedback: constructive,
      ...(direct && { averageScore: typedScore }),
      revises: s.updatedAt,
    }),
  );

  function set(i: number, change: Partial<{ score: number; comment: string }>) {
    setScores((all) => all.map((c, j) => (j === i ? { ...c, ...change } : c)));
  }

  return (
    <Collapsible submission={s} average={average} open={open} onToggle={onToggle}>
      {hasMarks(s) && open && (
        <ParticipationMarks employeeId={personKey} stage={s.stage} onMoved={() => router.refresh()} onScore={setMarksScore} />
      )}
      {direct && !fromMarks && (
        <label className="flex flex-wrap items-center justify-between gap-3 text-sm">
          Score
          <Input
            type="number"
            inputMode="decimal"
            min={BOOTCAMP_SCORE.min}
            max={BOOTCAMP_SCORE.max}
            step={0.1}
            value={typed}
            aria-invalid={!typedValid}
            onChange={(e) => setTyped(e.target.value)}
            className="w-24 shrink-0"
          />
        </label>
      )}
      <ul className="space-y-4">
        {scores.map((c, i) => (
          <li key={c.criterionId} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 text-sm wrap-break-word">{c.criterionName}</span>
              <div role="radiogroup" aria-label={`Score for ${c.criterionName}`} className="flex gap-1.5">
                {CRITERION_SCORES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={c.score === n}
                    onClick={() => set(i, { score: n })}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                      c.score === n
                        ? "border-brand bg-brand text-brand-foreground"
                        : "border-input bg-field hover:bg-muted/50",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              aria-label={`Comment on ${c.criterionName}`}
              placeholder="Comment (optional)"
              value={c.comment}
              maxLength={EVALS_ASSESSMENT_LIMITS.comment}
              onChange={(e) => set(i, { comment: e.target.value })}
              className="min-h-14"
            />
          </li>
        ))}
      </ul>
      <div className="grid gap-4 border-t pt-4">
        <FeedbackBox
          id={`${s.id}-positive`}
          label="Positive feedback"
          value={positive}
          onChange={setPositive}
          note={needed === "positive" ? POSITIVE_REQUIRED_NOTE : null}
        />
        <FeedbackBox
          id={`${s.id}-constructive`}
          label="Constructive feedback"
          value={constructive}
          onChange={setConstructive}
          note={needed === "constructive" ? CONSTRUCTIVE_REQUIRED_NOTE : null}
        />
      </div>
      {direct && !typedValid && (
        <p className="text-sm text-muted-foreground">
          Scores run from {BOOTCAMP_SCORE.min} to {BOOTCAMP_SCORE.max}, to one decimal place.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Collapsible>
  );
}

function FeedbackBox({
  id,
  label,
  value,
  onChange,
  note,
  action,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Set when the average makes this box required. */
  note: string | null;
  /** Beside the label, such as the button that has Claude write it. */
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {note && <span className="text-destructive"> *</span>}
        </label>
        {action}
      </div>
      {note && <p className="text-xs text-amber-600 dark:text-amber-500">{note}</p>}
      <Textarea
        id={id}
        value={value}
        required={note !== null}
        aria-invalid={note !== null && !value.trim()}
        maxLength={EVALS_ASSESSMENT_LIMITS.feedback}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const percent = (n: number | null) => (n === null ? "—" : `${n}%`);

/** The exams' average, and at the right where it falls on the scale, sized as an assessment's score; dashes until both are in. */
function ExamAverage({ entrance, exit }: { entrance: number | null; exit: number | null }) {
  const average = examAverage(entrance, exit);
  return (
    <div className="flex items-start justify-between gap-4">
      <Field label="Exam average">
        <span className="tabular-nums">{percent(average)}</span>
      </Field>
      <span className="text-xl font-medium tabular-nums">{average === null ? "—" : examScore(average)}</span>
    </div>
  );
}

/** A class's overall feedback and exams, as entered. */
function ClassReviewRow({ review }: { review: ViewReview | null }) {
  return (
    <section className="space-y-3 px-5 py-3">
      <dl className="grid gap-3">
        <Field label="Overall positive feedback">
          <span className="whitespace-pre-line">{review?.positiveFeedback || "—"}</span>
        </Field>
        <Field label="Overall constructive feedback">
          <span className="whitespace-pre-line">{review?.constructiveFeedback || "—"}</span>
        </Field>
        <Field label="Other notes">
          <span className="whitespace-pre-line">{review?.otherNotes || "—"}</span>
        </Field>
      </dl>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Field label="Entrance exam">
          <span className="tabular-nums">{percent(review?.entranceExam ?? null)}</span>
        </Field>
        <Field label="Exit exam">
          <span className="tabular-nums">{percent(review?.exitExam ?? null)}</span>
        </Field>
        <ExamAverage entrance={review?.entranceExam ?? null} exit={review?.exitExam ?? null} />
      </dl>
    </section>
  );
}

/** What is typed as an exam: null when blank, NaN when it is no percentage to one decimal place. */
function parseExam(typed: string): number | null {
  if (typed.trim() === "") return null;
  const n = Number(typed);
  return Number.isFinite(n) && n >= BOOTCAMP_EXAM.min && n <= BOOTCAMP_EXAM.max && Number(n.toFixed(BOOTCAMP_EXAM.decimals)) === n
    ? n
    : NaN;
}

const SUGGEST_ERRORS: Record<string, string> = {
  no_feedback: "No assessment in this class has feedback on that side to sum up.",
  not_found: "This person was not assessed in this class.",
  unconfigured: "Claude is not set up on this deployment.",
  upstream: "Claude could not write this just now. Try again.",
};

/**
 * A class's overall feedback and both exams, as an administrator enters them;
 * saving rebuilds it from what was saved. Each feedback box's sparkle has
 * Claude sum up that side of every assessment's saved feedback into the box,
 * for the administrator to edit and save.
 */
function ClassReviewForm({
  personKey,
  bootcampId,
  stage,
  review,
  sources,
}: {
  personKey: string;
  bootcampId: string;
  stage: ReleaseStage;
  review: ViewReview | null;
  /** Whether any assessment here has saved feedback on each side. */
  sources: Record<OverallSide, boolean>;
}) {
  const { save, error } = useSave();
  const [writing, setWriting] = useState<OverallSide | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [positive, setPositive] = useState(review?.positiveFeedback ?? "");
  const [constructive, setConstructive] = useState(review?.constructiveFeedback ?? "");
  const [notes, setNotes] = useState(review?.otherNotes ?? "");
  const [entranceTyped, setEntranceTyped] = useState(review?.entranceExam == null ? "" : String(review.entranceExam));
  const [exitTyped, setExitTyped] = useState(review?.exitExam == null ? "" : String(review.exitExam));
  const entrance = parseExam(entranceTyped);
  const exit = parseExam(exitTyped);
  const valid = !Number.isNaN(entrance) && !Number.isNaN(exit);
  const changed =
    positive !== (review?.positiveFeedback ?? "") ||
    constructive !== (review?.constructiveFeedback ?? "") ||
    notes !== (review?.otherNotes ?? "") ||
    entrance !== (review?.entranceExam ?? null) ||
    exit !== (review?.exitExam ?? null);
  const id = `${bootcampId}-${stage}`;

  usePendingEdit(`review-${id}`, changed, valid, () =>
    save(
      `/api/reporting/bootcamp/people/${encodeURIComponent(personKey)}/review`,
      {
        bootcampId,
        stage,
        positiveFeedback: positive,
        constructiveFeedback: constructive,
        otherNotes: notes,
        entranceExam: entrance,
        exitExam: exit,
        revises: review?.updatedAt ?? null,
      },
      "PUT",
    ),
  );

  async function suggest(side: OverallSide) {
    setWriting(side);
    setSuggestError(null);
    try {
      const res = await fetch(`/api/reporting/bootcamp/people/${encodeURIComponent(personKey)}/review/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bootcampId, stage, side }),
      });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || typeof body.text !== "string") {
        setSuggestError((body.error && SUGGEST_ERRORS[body.error]) || `Could not generate (${res.status})`);
        return;
      }
      (side === "positive" ? setPositive : setConstructive)(body.text);
    } catch {
      setSuggestError("Could not reach the server.");
    } finally {
      setWriting(null);
    }
  }

  const sparkle = (side: OverallSide) => (
    <AiCommentsButton
      pending={writing === side}
      disabled={!sources[side] || (writing !== null && writing !== side)}
      reason={sources[side] ? undefined : `No assessment here has ${side} feedback to sum up`}
      label={`Generate overall ${side} feedback from every assessment`}
      onClick={() => void suggest(side)}
    />
  );

  return (
    <section className="space-y-3 px-5 py-3">
      <FeedbackBox
        id={`${id}-overall-positive`}
        label="Overall positive feedback"
        value={positive}
        onChange={setPositive}
        note={null}
        action={sparkle("positive")}
      />
      <FeedbackBox
        id={`${id}-overall-constructive`}
        label="Overall constructive feedback"
        value={constructive}
        onChange={setConstructive}
        note={null}
        action={sparkle("constructive")}
      />
      {suggestError && (
        <p role="alert" className="text-sm text-destructive">
          {suggestError}
        </p>
      )}
      <FeedbackBox
        id={`${id}-other-notes`}
        label="Other notes"
        value={notes}
        onChange={setNotes}
        note={null}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <ExamInput id={`${id}-entrance`} label="Entrance exam" value={entranceTyped} onChange={setEntranceTyped} />
        <ExamInput id={`${id}-exit`} label="Exit exam" value={exitTyped} onChange={setExitTyped} />
        <dl className="self-end">
          <ExamAverage entrance={valid ? entrance : null} exit={valid ? exit : null} />
        </dl>
      </div>
      {!valid && (
        <p className="text-sm text-muted-foreground">
          Exams run from {BOOTCAMP_EXAM.min} to {BOOTCAMP_EXAM.max}%, to one decimal place.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function ExamInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={BOOTCAMP_EXAM.min}
          max={BOOTCAMP_EXAM.max}
          step={0.1}
          value={value}
          aria-invalid={Number.isNaN(parseExam(value))}
          onChange={(e) => onChange(e.target.value)}
          className="w-24"
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
    </div>
  );
}
