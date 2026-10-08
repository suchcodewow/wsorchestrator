/**
 * The front door, for everyone: Mimir first, since everyone can use it, then
 * a card for every page this person can reach, grouped as the sidebar groups
 * them — so a guest judge finds eVals here, and someone with no role yet
 * finds Mimir and their own account.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Library } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { MimirArt } from "@/components/mimir-art";
import { Button } from "@/components/ui/button";
import { progressSummary, resumePoint } from "@/lib/mimir/progress";
import { WELCOME_HREF, visibleSections } from "@/lib/nav";
import { canUseMimir, hasNoAccess } from "@/lib/roles";

export const metadata: Metadata = { title: "Welcome" };

const MIMIR_HREF = "/mimir";

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  const { access } = session.user;

  const mimir = canUseMimir(access);
  const [resume, summary] = mimir
    ? await Promise.all([resumePoint(session.user.id), progressSummary(session.user.id)])
    : [null, null];
  const sections = visibleSections(access)
    .map((s) => ({ ...s, items: s.items.filter((i) => i.href !== WELCOME_HREF && i.href !== MIMIR_HREF) }))
    .filter((s) => s.items.length > 0);
  const firstName = session.user.name?.split(" ")[0];
  const continueHref = resume && `/mimir/library/${encodeURIComponent(resume.id)}`;

  return (
    <div className="space-y-10">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-medium tracking-tight">Welcome{firstName ? `, ${firstName}` : ""}</h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{session.user.email}</span>
        </p>
      </div>

      {mimir && (
        <section
          aria-labelledby="welcome-mimir"
          className="grid max-w-3xl overflow-hidden rounded-2xl border bg-card shadow-sm sm:grid-cols-[16rem_minmax(0,1fr)]"
        >
          <Link href={continueHref ?? MIMIR_HREF} tabIndex={-1} aria-hidden>
            <MimirArt className="h-full w-full" title="Mimir at the well of wisdom" />
          </Link>
          <div className="flex flex-col justify-center gap-3 p-5">
            <p className="text-xs font-medium tracking-wide text-brand uppercase">Training · open to everyone</p>
            <h2 id="welcome-mimir" className="text-xl font-medium tracking-tight">
              Mimir
            </h2>
            <p className="text-muted-foreground">Learn Harness with Mimir.</p>
            {summary && summary.viewed > 0 && (
              <p className="text-sm text-muted-foreground tnum">
                <span className="font-medium text-foreground">{summary.mastered}</span> of {summary.total} mastered ·{" "}
                {summary.practiced} practiced · {summary.viewed} opened
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {resume && continueHref ? (
                <>
                  <Button variant="brand" asChild>
                    <Link href={continueHref}>
                      Continue: <span className="max-w-56 truncate">{resume.title}</span>
                      <ArrowRight />
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/mimir/library">
                      <Library />
                      Browse the library
                    </Link>
                  </Button>
                </>
              ) : (
                <Button variant="brand" asChild>
                  <Link href={MIMIR_HREF}>
                    Open Mimir
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.heading} aria-labelledby={`welcome-${section.heading}`} className="space-y-3">
          <h2 id={`welcome-${section.heading}`} className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {section.heading}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map(({ href, label, description, Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-sm transition-colors hover:border-brand-border/70 hover:bg-accent/30"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                  <Icon className="size-4.5" />
                </span>
                <span className="min-w-0 space-y-0.5">
                  <span className="block font-medium group-hover:underline">{label}</span>
                  <span className="block text-sm text-muted-foreground">{description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {hasNoAccess(access) && !access.judging && !access.manager && (
        <p className="max-w-prose text-sm text-muted-foreground">Other areas open up when an administrator gives you a role.</p>
      )}
    </div>
  );
}
