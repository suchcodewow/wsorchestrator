/** The public front page. */

import { auth } from "@/auth";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { EventTimeline } from "@/components/event-timeline";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LandingHero } from "./landing-hero";

export const metadata: Metadata = {
  title: "Harness Events — workshops and training",
  description:
    "Plan a workshop or a challenge and have its labs and cloud environments ready when people arrive. Schedule bootcamps across your facilities, follow them as they run, and record how everyone scored.",
};

export default async function Home() {
  if (await auth()) redirect("/events");

  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={null} />

      <main>
        <LandingHero>
          <section className="mx-auto max-w-6xl px-6 pt-16 text-center sm:pt-24">
            <span
              data-anim
              className="inline-flex items-center gap-2 rounded-full border border-brand-border/70 bg-brand/8 px-3 py-1 text-xs font-medium text-brand"
            >
              <span className="size-1.5 rounded-full bg-brand" />
              Workshops, Challenges, and Training
            </span>

            <h1 data-anim className="mx-auto mt-6 max-w-3xl text-4xl font-medium tracking-tight text-balance sm:text-5xl">
              Event Planning, Management, and Scoring.
            </h1>

            <div data-anim className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="brand" size="lg" className="group">
                <Link href="/signin">
                  Get started
                  <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/how-it-works">See how it works</Link>
              </Button>
            </div>
          </section>

          <div className="mx-auto max-w-6xl space-y-20 px-6 pt-16 pb-24 sm:pt-20">
            <EventTimeline path="workshops" />
            <EventTimeline path="training" />
          </div>
        </LandingHero>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground">
          <span>Harness Events</span>
          <Link
            href="/signin"
            className="rounded-md underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Organizer sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
