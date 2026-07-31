import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { LearningScene } from "@/components/learning-scene";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { ArrowRight, CalendarClock, Cloud, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LandingHero } from "./landing-hero";

export const metadata: Metadata = {
  title: "Event Orchestrator — cloud environments for teaching",
  description:
    "Book a workshop or a challenge. Attendee accounts and cloud projects build themselves at the start time, and clean themselves up when it ends.",
};

const CAPABILITIES = [
  {
    Icon: CalendarClock,
    title: "Booked on a calendar",
    body: "Pick a date and a start time. Nothing is provisioned — and nothing is billed — until the session actually begins.",
  },
  {
    Icon: Users,
    title: "An account each",
    body: "Every attendee gets their own sign-in, created ahead of the room and handed over ready to use.",
  },
  {
    Icon: Cloud,
    title: "Cleaned up after",
    body: "Projects and accounts are torn down on a timer when the session ends, so nothing is left running by accident.",
  },
] as const;

/**
 * The public front door. Unlike everything under `(app)`, this renders for
 * signed-out visitors — the session is read only to decide where the primary
 * action points, never to gate the page.
 */
export default async function Home() {
  const session = await auth();
  const signedIn = Boolean(session?.user);
  const appHref = signedIn ? "/events" : "/signin";

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} />

      <main>
        <LandingHero>
          <section className="mx-auto max-w-6xl px-6 pt-16 pb-4 text-center sm:pt-24">
            <span
              data-anim
              className="inline-flex items-center gap-2 rounded-full border border-brand-border/70 bg-brand/8 px-3 py-1 text-xs font-medium text-brand"
            >
              <span className="size-1.5 rounded-full bg-brand" />
              Workshops and challenges, provisioned on demand
            </span>

            <h1 data-anim className="mx-auto mt-6 max-w-3xl text-4xl font-medium tracking-tight text-balance sm:text-5xl">
              Cloud environments for teaching, gone by morning.
            </h1>

            <p data-anim className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground">
              Book a workshop or a challenge. Attendee accounts and cloud projects build themselves at the start time, and clean
              themselves up when it ends.
            </p>

            <div data-anim className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="brand" size="lg" className="group">
                <Link href={appHref}>
                  {signedIn ? "Open orchestrator" : "Get started"}
                  <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#how">See how it works</a>
              </Button>
            </div>
          </section>

          {/*
            The splash. Wider than the copy above it, and it fades out into the
            page on its own — there is no bottom edge here for the next section
            to align against.
          */}
          <div className="mx-auto -mt-2 max-w-6xl px-6">
            <LearningScene />
          </div>
        </LandingHero>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-14 pb-24">
          <div className="grid gap-6 sm:grid-cols-3">
            {CAPABILITIES.map(({ Icon, title, body }) => (
              <div key={title} className="rounded-2xl border bg-card/60 p-6 backdrop-blur-sm">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
                  <Icon className="size-4.5" />
                </span>
                <h2 className="mt-4 text-sm font-medium">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground">
          <span>Harness Events</span>
          <Link
            href={appHref}
            className="rounded-md underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {signedIn ? "Open orchestrator" : "Organizer sign in"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
