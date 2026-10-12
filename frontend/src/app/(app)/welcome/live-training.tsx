/**
 * "Running a Live Training Session": the steps of a bootcamp from scheduling
 * it to scoring it, each a card with where it stands now and a link to the
 * page that does it. Drawn as the landing page's Training path is, with real
 * numbers in place of its examples.
 */

import Link from "next/link";
import {
  AlertTriangle,
  CalendarPlus,
  CalendarRange,
  Check,
  FlaskConical,
  MessageSquareText,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { SCHEDULE_TRACKS } from "@/db/schema";
import type { LiveTraining } from "@/lib/live-training";
import { TRACK_LABELS } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatDate } from "../cohort-settings/format";

type Step = {
  Icon: LucideIcon;
  title: string;
  body: string;
  /** Null for a step with nowhere to go yet. */
  href: string | null;
  detail: React.ReactNode;
};

/** Tailwind needs whole class names, so one per number of steps a viewer can see. */
const COLUMNS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
};

export function LiveTrainingSteps({ training, assessments }: LiveTraining) {
  const steps: Step[] = [];
  if (training) {
    const { active, attendees, sessions, issues } = training;
    steps.push(
      {
        Icon: CalendarPlus,
        title: "Schedule a training session",
        body: "Set the bootcamp's dates and facility in the Scheduler, and make it Active once it is the one under way.",
        href: "/scheduler",
        detail: active ? (
          <>
            <Ticked>Session is active</Ticked>
            <Footer label="Starts" value={formatDate(active.startDate)} />
          </>
        ) : (
          <p className="text-muted-foreground">No session is active.</p>
        ),
      },
      {
        Icon: UserPlus,
        title: "Add Attendees",
        body: "The current cohort comes from the HiBob sync. Check who is in it, and on which track, on Cohorts.",
        href: "/cohorts/current",
        detail:
          attendees.bootcamp + attendees.intermediate > 0 ? (
            <Rows
              rows={[
                { label: "Bootcamp", value: attendees.bootcamp },
                { label: "Intermediate", value: attendees.intermediate },
              ]}
            />
          ) : (
            <p className="text-muted-foreground">No one is in the current cohort yet.</p>
          ),
      },
      {
        Icon: CalendarRange,
        title: "Build your session",
        body: "Lay out each day of the active bootcamp from your session types, and give every session a leader and a room.",
        ...(sessions && issues !== null
          ? {
              href: "/scheduler/active",
              detail: (
                <>
                  <Rows rows={SCHEDULE_TRACKS.map((t) => ({ label: TRACK_LABELS[t], value: sessions[t] ?? "—" }))} />
                  <div className="mt-2.5 border-t pt-2">
                    {issues > 0 ? (
                      <span className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
                        <AlertTriangle className="size-3" />
                        <span className="tabular-nums">{issues}</span> {issues === 1 ? "alert" : "alerts"}
                      </span>
                    ) : (
                      <Ticked>No alerts</Ticked>
                    )}
                  </div>
                </>
              ),
            }
          : { href: "/scheduler", detail: <p className="font-medium text-brand">Schedule a session now</p> }),
      },
    );
  }
  if (assessments) {
    steps.push({
      Icon: FlaskConical,
      title: "Assess Attendees",
      body: "Score each attendee on the assessments for their stage in eVals, during the bootcamp's breakouts.",
      href: "/evals",
      detail: (
        <ul className="space-y-2">
          {SCHEDULE_TRACKS.map((t) => {
            const { scored, total } = assessments[t];
            return (
              <li key={t} className="space-y-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{TRACK_LABELS[t]}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {scored} / {total}
                  </span>
                </span>
                <span className="block h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-brand/70"
                    style={{ width: `${total > 0 ? (scored / total) * 100 : 0}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      ),
    });
  }
  steps.push({
    Icon: MessageSquareText,
    title: "Provide Feedback",
    body: "Send each attendee their results and feedback in Slack.",
    href: null,
    detail: (
      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Coming soon</span>
    ),
  });

  return (
    <section aria-labelledby="welcome-live-training">
      <div className="mb-6 flex items-center gap-3">
        <span className="size-1.5 rounded-full bg-brand" />
        <h2 id="welcome-live-training" className="text-lg font-medium tracking-tight">
          Running a Live Training Session
        </h2>
        <span aria-hidden className="h-px flex-1 bg-linear-to-r from-border to-transparent" />
      </div>

      <ol className={cn("relative grid gap-6 xl:gap-4", COLUMNS[steps.length])}>
        <div aria-hidden className="absolute top-3 bottom-0 left-3 w-px -translate-x-1/2 bg-brand/70 xl:hidden" />

        {steps.map((step, i) => (
          <li key={step.title} className="relative grid grid-cols-[1.5rem_1fr] gap-x-3 xl:flex xl:flex-col">
            <div className="flex h-6 items-center gap-3">
              <span className="relative z-10 flex size-6 shrink-0 items-center justify-center">
                <span className="size-3 rounded-full border-2 border-brand bg-brand shadow-[0_0_0_4px_var(--background)]" />
              </span>
              <span className="hidden font-mono text-[11px] tracking-wider text-muted-foreground uppercase xl:inline">
                Step {i + 1}
              </span>
              <span
                aria-hidden
                className={cn(
                  "hidden h-px flex-1 bg-brand/70 xl:block",
                  i < steps.length - 1 ? "-mr-4" : "mask-[linear-gradient(to_right,black,transparent)]",
                )}
              />
            </div>

            <div className="min-w-0 xl:flex xl:flex-1 xl:flex-col">
              <p className="flex h-6 items-center font-mono text-[11px] tracking-wider text-muted-foreground uppercase xl:hidden">
                Step {i + 1}
              </p>
              <StepCard step={step} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepCard({ step: { Icon, title, body, href, detail } }: { step: Step }) {
  const inner = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
          <Icon className="size-4" />
        </span>
        <h3 className={cn("text-base font-medium", href && "group-hover:underline")}>{title}</h3>
      </div>
      <p className="mt-3 mb-5 text-sm leading-relaxed text-pretty text-muted-foreground">{body}</p>
      <div className="mt-auto rounded-xl border bg-background/70 p-3 text-xs">{detail}</div>
    </>
  );
  const className = "mt-2 flex flex-col rounded-2xl border bg-card p-5 text-left shadow-sm xl:mt-4 xl:flex-1";
  if (!href) return <article className={className}>{inner}</article>;
  return (
    <Link href={href} className={cn(className, "group transition-colors hover:border-brand-border/70 hover:bg-accent/30")}>
      {inner}
    </Link>
  );
}

function Ticked({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
      <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
      {children}
    </span>
  );
}

function Rows({ rows }: { rows: { label: string; value: number | string }[] }) {
  return (
    <ul className="space-y-1">
      {rows.map(({ label, value }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className="truncate">{label}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function Footer({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
