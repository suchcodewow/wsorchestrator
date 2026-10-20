/**
 * The frame every /intake page sits in: the site header over a narrow column,
 * outside the app's sidebar, since most who come here use nothing else.
 */

import type { Session } from "next-auth";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AmbientBackdrop } from "@/components/ambient-backdrop";
import { SiteHeader } from "@/components/site-header";

const SHELL = "max-w-2xl";

export function IntakeShell({
  session,
  back = false,
  children,
}: {
  session: Session;
  /** Whether to lead with a link back to the list of forms. */
  back?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen">
      <AmbientBackdrop className="fixed inset-0 -z-10" />

      <SiteHeader session={session} width={SHELL} />

      <main className={`relative mx-auto ${SHELL} px-6 py-10`}>
        {back && (
          <Link
            href="/intake"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            My forms
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}

export function IntakeNotice({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl border bg-card px-5 py-8 text-center shadow-sm">
      <h1 className="text-xl font-medium tracking-tight">{heading}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
