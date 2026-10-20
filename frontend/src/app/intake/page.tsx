/**
 * Everything whoever is signed in has been asked to fill in: their
 * registration form while they are in the current cohort, and each daily
 * survey the scheduler has sent them. The ones still to do come first.
 *
 * `?preview=` and `?form=` belong to the registration form, which this page
 * used to be, so links made before it moved are sent on to it.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ChevronRight, ClipboardList, MessageSquareText } from "lucide-react";
import { auth, signInPath } from "@/auth";
import { listMyForms, type MyForm } from "@/lib/surveys/my-forms";
import { IntakeNotice, IntakeShell } from "./intake-shell";

export const metadata: Metadata = {
  title: "My forms",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const { preview, form } = await searchParams;
  if (typeof preview === "string" || typeof form === "string") {
    const query = new URLSearchParams();
    if (typeof preview === "string") query.set("preview", preview);
    if (typeof form === "string") query.set("form", form);
    redirect(`/intake/registration?${query}`);
  }

  const forms = session.user.email ? await listMyForms(session.user.email) : [];
  const todo = forms.filter((f) => !f.completedAt);
  const done = forms.filter((f) => f.completedAt);

  return (
    <IntakeShell session={session}>
      {forms.length === 0 ? (
        <IntakeNotice heading="My forms">
          There is nothing for {session.user.email ?? "this account"} to fill in. Registration forms are for people in the
          current bootcamp or intermediate cohort, and surveys arrive here as the training team sends them.
        </IntakeNotice>
      ) : (
        <div className="space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-medium tracking-tight">My forms</h1>
            <p className="text-sm text-muted-foreground">
              {todo.length === 0 ? "All done" : `${todo.length} to do`}
              {done.length > 0 && `, ${done.length} completed`}
            </p>
          </div>
          {todo.length > 0 && <FormList heading="To do" forms={todo} />}
          {done.length > 0 && <FormList heading="Completed" forms={done} />}
        </div>
      )}
    </IntakeShell>
  );
}

function FormList({ heading, forms }: { heading: string; forms: MyForm[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{heading}</h2>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        {forms.map((f) => {
          const Icon = f.kind === "registration" ? ClipboardList : MessageSquareText;
          return (
            <li key={`${f.kind}-${f.id}`}>
              <Link href={f.href} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium group-hover:underline">{f.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{f.detail}</p>
                </div>
                {f.completedAt ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-4 text-brand" />
                    {new Date(f.completedAt).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs font-medium text-brand">Start</span>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
