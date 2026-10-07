/** The landing page's two paths: a workshop from booking to first green build, and a bootcamp from rooms to scores. */

import { cn } from "@/lib/utils";
import {
  Activity,
  Building2,
  CalendarDays,
  CalendarRange,
  Check,
  FlaskConical,
  Layers,
  Rocket,
  type LucideIcon,
} from "lucide-react";

type Stage = {
  Icon: LucideIcon;
  when: string;
  title: string;
  body: string;
  Detail: () => React.ReactNode;
};

const WORKSHOP_STAGES: Stage[] = [
  {
    Icon: CalendarDays,
    when: "Weeks ahead",
    title: "Plan",
    body: "Book a workshop or a challenge on the calendar, with its seats and clouds. Nothing is billed until it starts.",
    Detail: PlanDetail,
  },
  {
    Icon: Layers,
    when: "Before it starts",
    title: "Set up",
    body: "Write the lab guides once. Accounts, projects and a Harness org build themselves, and each guide fills in the reader's own.",
    Detail: SetUpDetail,
  },
  {
    Icon: Activity,
    when: "While it runs",
    title: "Track",
    body: "Watch every account, cluster and project build, and see who has claimed which seat. It all comes down at the end.",
    Detail: TrackDetail,
  },
  {
    Icon: Rocket,
    when: "Within minutes",
    title: "Learn 🎉",
    body: "Everyone sits down to a ready account and a guide that already knows their project, so the first build goes green in minutes, not after a morning of setup.",
    Detail: LearnDetail,
  },
];

const TRAINING_STAGES: Stage[] = [
  {
    Icon: Building2,
    when: "Weeks ahead",
    title: "Facilities",
    body: "Add the places bootcamps are held and how many each room seats, once. Every schedule picks its rooms from them.",
    Detail: FacilitiesDetail,
  },
  {
    Icon: CalendarRange,
    when: "Before it starts",
    title: "Plan",
    body: "Build each day from your session types, schedule the bootcamp and intermediate assessments, and give every session a leader and a room.",
    Detail: ScheduleDetail,
  },
  {
    Icon: Activity,
    when: "While it runs",
    title: "Track",
    body: "Follow the active bootcamp through the day: which sessions are done, what is next and where, and what is left on the checklist.",
    Detail: ProgressDetail,
  },
  {
    Icon: FlaskConical,
    when: "Afterwards",
    title: "Assess",
    body: "Record when each person took bootcamp and intermediate, how they scored, and who is exempt.",
    Detail: AssessDetail,
  },
];

const PATHS = {
  workshops: { heading: "Workshops and challenges", stages: WORKSHOP_STAGES },
  training: { heading: "Training", stages: TRAINING_STAGES },
} as const;

export function EventTimeline({ path, className }: { path: keyof typeof PATHS; className?: string }) {
  const { heading, stages } = PATHS[path];
  const headingId = `timeline-${path}`;

  return (
    <section data-timeline="path" aria-labelledby={headingId} className={className}>
      <div data-timeline="heading" className="mb-6 flex items-center gap-3 sm:mb-8">
        <span className="size-1.5 rounded-full bg-brand" />
        <h2 id={headingId} className="text-lg font-medium tracking-tight">
          {heading}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-linear-to-r from-border to-transparent" />
      </div>

      <ol className="relative grid gap-6 lg:grid-cols-4 lg:gap-5">
        <div aria-hidden className="absolute top-3 bottom-0 left-3 w-px -translate-x-1/2 lg:hidden">
          <div className="absolute inset-0 bg-border" />
          <div data-timeline="rail" className="absolute inset-0 origin-top bg-brand/70" />
        </div>

        {stages.map(({ Icon, when, title, body, Detail }, i) => (
          <li key={title} data-timeline="stage" className="relative grid grid-cols-[1.5rem_1fr] gap-x-3 lg:flex lg:flex-col">
            <div className="flex h-6 items-center gap-3">
              <span className="relative z-10 flex size-6 shrink-0 items-center justify-center">
                <span
                  data-timeline="dot"
                  className="size-3 rounded-full border-2 border-brand bg-brand shadow-[0_0_0_4px_var(--background)]"
                />
              </span>
              <span className="hidden font-mono text-[11px] tracking-wider text-muted-foreground uppercase lg:inline">{when}</span>
              <span
                aria-hidden
                className={cn(
                  "relative hidden h-px flex-1 lg:block",
                  i < stages.length - 1 ? "-mr-5" : "mask-[linear-gradient(to_right,black,transparent)]",
                )}
              >
                <span className="absolute inset-0 bg-border" />
                <span data-timeline="segment" className="absolute inset-0 origin-left bg-brand/70" />
              </span>
            </div>

            <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col">
              <p className="flex h-6 items-center font-mono text-[11px] tracking-wider text-muted-foreground uppercase lg:hidden">
                {when}
              </p>
              <article
                data-timeline="card"
                className="mt-2 flex flex-col rounded-2xl border bg-card/60 p-5 text-left backdrop-blur-sm lg:mt-4 lg:flex-1 dark:bg-card"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
                    <Icon className="size-4" />
                  </span>
                  <h3 className="text-base font-medium">{title}</h3>
                </div>
                <p className="mt-3 mb-5 text-sm leading-relaxed text-pretty text-muted-foreground">{body}</p>
                <div aria-hidden className="mt-auto rounded-xl border bg-background/70 p-3 text-xs select-none">
                  <Detail />
                </div>
              </article>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const DAYS = [
  { d: "Mon", n: 12 },
  { d: "Tue", n: 13 },
  { d: "Wed", n: 14 },
  { d: "Thu", n: 15 },
  { d: "Fri", n: 16 },
] as const;

function PlanDetail() {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">October</span>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-400/15 dark:text-violet-300">
          Scheduled
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-5 gap-1 text-center">
        {DAYS.map(({ d, n }) => (
          <div key={d} className="text-[10px] text-muted-foreground">
            {d}
            <div className="mt-0.5 font-mono text-foreground tabular-nums">{n}</div>
          </div>
        ))}
        <div className="col-span-3 col-start-1 mt-1 truncate rounded-md bg-brand/15 px-1.5 py-1 text-left text-[10px] font-medium text-brand ring-1 ring-brand/25">
          CI/CD workshop
        </div>
        <div className="col-span-2 col-start-4 mt-1 truncate rounded-md bg-muted px-1.5 py-1 text-left text-[10px] text-muted-foreground">
          Challenge
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="tabular-nums">24 seats</span>
        <span>·</span>
        <span className="rounded border px-1 font-mono">AWS</span>
        <span className="rounded border px-1 font-mono">GCP</span>
      </div>
    </>
  );
}

function SetUpDetail() {
  return (
    <>
      <p className="font-medium">3. Set your project</p>
      <div className="mt-2 overflow-hidden rounded-lg bg-muted/70 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed">
        <span className="text-muted-foreground">$ </span>export PROJECT=
        <wbr />
        <span className="inline-grid align-bottom *:col-start-1 *:row-start-1">
          <span data-timeline="var-from" className="text-violet-600 opacity-0 dark:text-violet-300">
            {"{{project}}"}
          </span>
          <span data-timeline="var-to" className="rounded bg-brand/15 px-0.5 text-brand">
            ws-cicd-07
          </span>
        </span>
      </div>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground">{"{{project}}"}, for seat 7</p>
    </>
  );
}

const RESOURCES = [
  { name: "Harness org", count: "1 / 1" },
  { name: "Projects", count: "24 / 24" },
  { name: "GKE cluster", count: "1 / 1" },
] as const;

function TrackDetail() {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">CI/CD workshop</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Ready
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {RESOURCES.map(({ name, count }) => (
          <li key={name} className="flex items-center gap-1.5">
            <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span>{name}</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Seats claimed</span>
        <span className="font-mono tabular-nums">19 of 24</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div data-timeline="fill" className="h-full w-[79%] origin-left rounded-full bg-brand" />
      </div>
    </>
  );
}

const MILESTONES = [
  { step: "Signed in", at: "2m" },
  { step: "Pipeline created", at: "6m" },
  { step: "Build green", at: "11m" },
] as const;

function LearnDetail() {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">Lab 1 · First pipeline</span>
        <span
          data-timeline="cheer"
          className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
        >
          🎉 Done
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {MILESTONES.map(({ step, at }) => (
          <li key={step} data-timeline="tick" className="flex items-center gap-1.5">
            <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
            <span>{step}</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">{at}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Seat 7, first green build</span>
        <span className="font-mono text-brand tabular-nums">11 min</span>
      </div>
    </>
  );
}

const ROOMS = [
  { name: "Main hall", seats: 60 },
  { name: "Breakout A", seats: 16 },
  { name: "Breakout B", seats: 12 },
] as const;

function FacilitiesDetail() {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">Austin office</span>
        <span className="text-[10px] text-muted-foreground">{ROOMS.length} rooms</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {ROOMS.map(({ name, seats }) => (
          <li key={name} className="grid grid-cols-[4.5rem_1fr_1.5rem] items-center gap-x-2">
            <span className="truncate">{name}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                data-timeline="fill"
                className="block h-full origin-left rounded-full bg-brand/70"
                style={{ width: `${(seats / ROOMS[0].seats) * 100}%` }}
              />
            </span>
            <span className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">{seats}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Seats</span>
        <span className="font-mono tabular-nums">{ROOMS.reduce((n, r) => n + r.seats, 0)}</span>
      </div>
    </>
  );
}

const SESSIONS = [
  { at: "09:00", name: "Kickoff", bar: "bg-blue-500" },
  { at: "09:30", name: "CI fundamentals", bar: "bg-violet-500" },
  { at: "11:00", name: "Breakouts", bar: "bg-teal-500" },
  { at: "13:00", name: "Bootcamp assessment", bar: "bg-amber-500" },
] as const;

function ScheduleDetail() {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">Day 1</span>
        <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">BTC</span>
      </div>
      <ul className="mt-2 space-y-1">
        {SESSIONS.map(({ at, name, bar }) => (
          <li key={name} data-timeline="tick" className="flex items-center gap-2">
            <span className="w-8 font-mono text-[10px] text-muted-foreground tabular-nums">{at}</span>
            <span className={cn("h-3.5 w-0.5 shrink-0 rounded-full", bar)} />
            <span className="truncate">{name}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ProgressDetail() {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">Bootcamp · Day 2</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Live
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        <li className="flex items-center gap-1.5 text-muted-foreground">
          <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
          <span>CI pipelines</span>
          <span className="ml-auto text-[10px]">Main hall</span>
        </li>
        <li className="flex items-center gap-1.5 font-mono text-[10px] text-brand">
          <span data-timeline="fill" className="h-px flex-1 origin-left bg-brand" />
          10:40
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-full border border-brand/60" />
          <span>Breakouts</span>
          <span className="ml-auto text-[10px] text-muted-foreground">4 rooms</span>
        </li>
      </ul>
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Checklist</span>
        <span className="font-mono tabular-nums">7 of 9</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div data-timeline="fill" className="h-full w-[78%] origin-left rounded-full bg-brand" />
      </div>
    </>
  );
}

const SCORES = [
  { who: "Priya N.", btc: "86", int: "92" },
  { who: "Marcus O.", btc: "78", int: null },
  { who: "Lena K.", btc: "94", int: "exempt" },
] as const;

function AssessDetail() {
  return (
    <>
      <div className="grid grid-cols-[1fr_2.25rem_2.25rem] items-center gap-x-1 text-[10px] text-muted-foreground">
        <span className="text-xs font-medium text-foreground">Scores</span>
        <span className="text-right font-mono">BTC</span>
        <span className="text-right font-mono">INT</span>
      </div>
      <ul className="mt-2 space-y-1">
        {SCORES.map(({ who, btc, int }) => (
          <li key={who} className="grid grid-cols-[1fr_2.25rem_2.25rem] items-center gap-x-1">
            <span className="flex items-center gap-1.5 truncate">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[8px] font-medium text-brand">
                {who[0]}
              </span>
              {who}
            </span>
            <span className="text-right font-mono tabular-nums">{btc}</span>
            {int === "exempt" ? (
              <span className="justify-self-end rounded bg-muted px-1 text-[9px] text-muted-foreground">Exempt</span>
            ) : (
              <span className="text-right font-mono text-muted-foreground tabular-nums">{int ?? "—"}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
