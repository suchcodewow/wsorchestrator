import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  Check,
  CircleCheck,
  Cloud,
  PlayCircle,
  Rocket,
  Timer,
  Trash2,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works — Harness Events",
  description:
    "From a calendar invite to three clouds and back to nothing: how a workshop provisions attendee accounts and cloud environments at its start time, and tears them down when it ends.",
};

/** The four stages a visitor sees, top to bottom. */
const STAGES: {
  n: string;
  Icon: LucideIcon;
  tag: string;
  auto: boolean;
  title: string;
  body: string;
}[] = [
  {
    n: "01",
    Icon: CalendarClock,
    tag: "Organizer",
    auto: false,
    title: "Schedule",
    body: "An organizer books a workshop or challenge on a calendar — date, size and clouds. Nothing is provisioned or billed until it starts.",
  },
  {
    n: "02",
    Icon: Boxes,
    tag: "Automatic · at start",
    auto: true,
    title: "Provision",
    body: "About two hours ahead of the start it builds itself: a Google account per attendee, a Harness org, and the requested cloud environments via Terraform — ready when the room opens.",
  },
  {
    n: "03",
    Icon: Users,
    tag: "Attendees",
    auto: false,
    title: "Run",
    body: "Each attendee signs in to their own ready-made environment and works through the labs. Time can be extended a day at a time.",
  },
  {
    n: "04",
    Icon: Timer,
    tag: "Automatic · at end",
    auto: true,
    title: "Clean up",
    body: "When the timer runs out, every account, project and org is torn down on a schedule — nothing is left running by accident.",
  },
];

/** What Terraform builds in each cloud during `applying`. Kept in step with the runner. */
const CLOUDS: {
  name: string;
  dot: string;
  k8s: string;
  builds: string[];
}[] = [
  {
    name: "Google Cloud",
    dot: "#4285F4",
    k8s: "GKE",
    builds: [
      "Ephemeral project",
      "Billing linked, APIs enabled",
      "GKE cluster",
      "Attendees granted Editor",
    ],
  },
  {
    name: "AWS",
    dot: "#FF9900",
    k8s: "EKS",
    builds: [
      "Member account",
      "An IAM user each",
      "EKS cluster",
      "PowerUser access",
    ],
  },
  {
    name: "Azure",
    dot: "#0078D4",
    k8s: "AKS",
    builds: [
      "Resource group",
      "An Entra user each",
      "AKS cluster",
      "Contributor access",
    ],
  },
];

type LifeNode = {
  Icon: LucideIcon;
  title: string;
  desc: string;
  kind: "up" | "milestone" | "live" | "down";
  /** A subtle right-hand pill, e.g. to mark the step that runs for every event. */
  pill?: string;
  /** Only the `applying` step fans out into the per-cloud grid. */
  fanout?: boolean;
};

/**
 * The run lifecycle, build-up through teardown. The lowercase titles that match
 * a real `workshop_runs.status` are deliberate; "Harness org" and "in session"
 * are conceptual steps within `provisioning`/`applying` and `ready`.
 */
const LIFECYCLE: LifeNode[] = [
  {
    Icon: CalendarClock,
    title: "scheduled",
    kind: "up",
    desc: "On the calendar, waiting. Nothing exists yet — no accounts, no cloud spend — until about two hours before the start, when the scheduler picks it up.",
  },
  {
    Icon: UserPlus,
    title: "provisioning",
    kind: "up",
    desc: "A Google Workspace org-unit is created, then one attendee account per seat, each with a generated temporary password to hand out.",
  },
  {
    Icon: Boxes,
    title: "Harness org",
    kind: "up",
    pill: "every event",
    desc: "Regardless of cloud, a Harness organization is created with one project per attendee — each attendee admins their own and can view the rest.",
  },
  {
    Icon: Cloud,
    title: "applying",
    kind: "up",
    fanout: true,
    desc: "Terraform builds every requested cloud. In challenge mode each competitor gets their own project, account or resource group instead of a shared one.",
  },
  {
    Icon: Rocket,
    title: "ready",
    kind: "milestone",
    desc: "Outputs are published and the expiry timer is set. The organizer hands out credentials and the room is open.",
  },
  {
    Icon: PlayCircle,
    title: "in session",
    kind: "live",
    desc: "Attendees work in their own environments. The organizer can extend the deadline a day at a time from the event's page.",
  },
  {
    Icon: Trash2,
    title: "destroying",
    kind: "down",
    desc: "In reverse, on a timer: clouds first (they hold the access), then the Harness projects and org, then the attendee accounts, then the org-unit.",
  },
  {
    Icon: CircleCheck,
    title: "destroyed",
    kind: "down",
    desc: "Everything is gone. Nothing left running, nothing left billing.",
  },
];

/** Eyebrow + heading used to open each section. */
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <span className="text-xs font-semibold tracking-[0.18em] text-brand uppercase">
        {eyebrow}
      </span>
      <h2 className="mt-3 text-2xl font-medium tracking-tight text-balance sm:text-3xl">
        {title}
      </h2>
    </div>
  );
}

/** Colour of the node marker on the lifecycle spine, by phase. */
const MARKER: Record<LifeNode["kind"], string> = {
  up: "border-brand-border bg-brand/10 text-brand",
  milestone: "border-transparent bg-brand text-brand-foreground shadow-sm",
  live: "border-border bg-card text-foreground",
  down: "border-border bg-muted text-muted-foreground",
};

export default async function HowItWorks() {
  const session = await auth();
  const signedIn = Boolean(session?.user);
  const appHref = signedIn ? "/events" : "/signin";

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />
      <SiteHeader session={session} />

      <main className="mx-auto max-w-6xl px-6 pb-24">
        {/* hero */}
        <section className="pt-16 pb-14 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-border/70 bg-brand/8 px-3 py-1 text-xs font-medium text-brand">
            <span className="size-1.5 rounded-full bg-brand" />
            How it works
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            From a calendar invite to three clouds — and back to nothing.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground">
            Book a workshop or a challenge. Attendee accounts and cloud
            environments build themselves at the start time, and clean
            themselves up when it ends. Here is the whole path.
          </p>
        </section>

        {/* four stages */}
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map(({ n, Icon, tag, auto, title, body }) => (
            <div
              key={n}
              className="relative overflow-hidden rounded-2xl border bg-card/60 p-6 backdrop-blur-sm"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -top-2 right-3 text-6xl font-extrabold text-brand/8 select-none"
              >
                {n}
              </span>
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15">
                <Icon className="size-5" />
              </span>
              <span
                className={
                  "mt-5 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase " +
                  (auto
                    ? "bg-brand text-brand-foreground"
                    : "bg-muted text-muted-foreground")
                }
              >
                {tag}
              </span>
              <h3 className="mt-3 text-lg font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </section>

        {/* under the hood — the lifecycle flowchart */}
        <section className="mt-24">
          <SectionHeading
            eyebrow="Under the hood"
            title="A run's lifecycle, build-up to teardown"
          />

          <ol className="relative mx-auto mt-14 max-w-3xl space-y-9">
            {/* the spine */}
            <span
              aria-hidden
              className="absolute top-3 bottom-3 left-5.25 w-px bg-linear-to-b from-brand/50 via-border to-border"
            />

            {LIFECYCLE.map((node) => (
              <li key={node.title} className="relative flex gap-5">
                <span
                  className={
                    "relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full border " +
                    MARKER[node.kind]
                  }
                >
                  <node.Icon className="size-5" />
                </span>

                <div className="min-w-0 flex-1 pt-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium tracking-tight">{node.title}</h3>
                    {node.kind === "milestone" && (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand ring-1 ring-brand/20">
                        environments live
                      </span>
                    )}
                    {node.pill && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {node.pill}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {node.desc}
                  </p>

                  {node.fanout && (
                    <div className="mt-4">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <span className="h-px flex-1 bg-border" />
                        Terraform, one state per cloud
                        <span className="h-px flex-1 bg-border" />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {CLOUDS.map((c) => (
                          <div
                            key={c.name}
                            className="rounded-xl border bg-card/70 p-4 backdrop-blur-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <span
                                  className="size-2.5 rounded-full"
                                  style={{ backgroundColor: c.dot }}
                                />
                                {c.name}
                              </span>
                              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                                {c.k8s}
                              </span>
                            </div>
                            <ul className="mt-3 space-y-1.5">
                              {c.builds.map((b) => (
                                <li
                                  key={b}
                                  className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
                                >
                                  <Check className="mt-0.5 size-3.5 shrink-0 text-brand" />
                                  {b}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        A workshop can also request{" "}
                        <span className="font-medium text-foreground">no cloud</span>{" "}
                        — attendees share a long-lived sandbox project, so there
                        is nothing throwaway to build or destroy.
                      </p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <p className="mx-auto mt-10 max-w-3xl border-t pt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Any step can end in{" "}
            <span className="font-medium text-foreground">failed</span> — the run
            stops and stays on the calendar, flagged, so nothing is half-built in
            the dark. It’s retried or reaped from there.
          </p>
        </section>

        {/* CTA */}
        <section className="mt-24">
          <div className="mx-auto max-w-3xl rounded-3xl border bg-card/60 px-8 py-12 text-center backdrop-blur-sm">
            <h2 className="text-2xl font-medium tracking-tight text-balance">
              Ready to run one?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Pick a date, a size and the clouds. The orchestrator takes it from
              there.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="brand" size="lg" className="group">
                <Link href={appHref}>
                  {signedIn ? "Open orchestrator" : "Get started"}
                  <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
