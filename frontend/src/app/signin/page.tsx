import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarClock, Cloud, Users } from "lucide-react";
import { auth, googleHostedDomain, signIn } from "@/auth";
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

/**
 * Where to land after signing in.
 *
 * Only a path on this site is ever accepted. A value beginning `//` is
 * protocol-relative and a `/\` is read as scheme-relative by some parsers —
 * both would send the visitor to another origin, so anything that is not a
 * plain single-slash path falls back to the app.
 */
function safeCallback(value: string | undefined): string {
  if (!value || !value.startsWith("/")) return "/events";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/events";
  return value;
}

/**
 * Why a sign-in attempt came back here. Auth.js sends its errors to the page
 * named by `pages.error` — this one — as `?error=<type>`. Only the types that
 * a visitor can actually cause are worded for them; anything else is a
 * deployment problem they can do nothing about, so it says so plainly.
 */
function errorMessage(error: string | undefined): string | null {
  if (!error) return null;
  switch (error) {
    case "AccessDenied":
      return "That account isn't allowed to sign in. Use your organization's account, or ask an administrator to have your domain added.";
    case "OAuthAccountNotLinked":
      return "That address already signed in with a different provider. Use the one you used the first time.";
    case "Verification":
      return "That sign-in link has expired or was already used. Try again.";
    default:
      return "Sign-in isn't working right now. If this keeps happening, tell an administrator.";
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const target = safeCallback(params.callbackUrl);
  const problem = errorMessage(params.error);

  const session = await auth();
  if (session) redirect(target);

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

          {problem && (
            <div
              data-anim
              role="alert"
              className="mt-7 flex gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm leading-relaxed text-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{problem}</span>
            </div>
          )}

          <form
            data-anim
            className={problem ? "mt-5" : "mt-8"}
            action={async () => {
              "use server";
              // Read inside the action, not at render: this is what is in force
              // when the button is pressed, and the settings page can have
              // changed the list since the page was served.
              const hd = await googleHostedDomain();
              await signIn(
                "google",
                { redirectTo: target },
                hd ? { hd } : undefined,
              );
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
