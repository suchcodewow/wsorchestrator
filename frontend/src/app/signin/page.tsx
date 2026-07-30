import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, Cloud, Users } from "lucide-react";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { BrandMark } from "@/components/brand-mark";
import { SignInHero } from "./signin-hero";

/** The three things the product does, shown rather than described. */
const CAPABILITIES = [
  { Icon: CalendarClock, text: "Schedule events on a calendar" },
  { Icon: Users, text: "Accounts provisioned per attendee" },
  { Icon: Cloud, text: "Cloud environments torn down on a timer" },
];

export default async function SignInPage() {
  const session = await auth();
  if (session) redirect("/events");

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-6">
      {/* The drifting blooms replace the single static glow this page used to
          carry — one ambient system rather than two overlapping ones. */}
      <AmbientBackdrop className="absolute inset-0" />

      <SignInHero>
        <div
          data-anim-card
          className="relative w-full max-w-sm rounded-2xl border bg-card/90 p-8 shadow-xl backdrop-blur-xl"
        >
          <div data-anim className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-medium tracking-tight">Event Orchestrator</span>
          </div>

          <h1
            data-anim
            className="mt-7 text-3xl font-medium tracking-tight text-balance"
          >
            Ephemeral cloud events, on a schedule.
          </h1>

          <p data-anim className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Book a workshop or a challenge. Accounts and cloud projects build
            themselves at the start time, and clean themselves up after.
          </p>

          <ul data-anim className="mt-7 space-y-3">
            {CAPABILITIES.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/15">
                  <Icon className="size-3.5" />
                </span>
                <span className="text-muted-foreground">{text}</span>
              </li>
            ))}
          </ul>

          <form
            data-anim
            className="mt-8"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/events" });
            }}
          >
            <Button type="submit" variant="brand" size="lg" className="group w-full">
              Continue with Google
              <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Button>
          </form>

          <p data-anim className="mt-4 text-center text-xs text-muted-foreground">
            Organizers sign in with their Workspace account.
          </p>
        </div>
      </SignInHero>
    </main>
  );
}
