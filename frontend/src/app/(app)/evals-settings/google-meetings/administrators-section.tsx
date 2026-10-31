"use client";

/**
 * Whom the sync adds to each occurrence a cohort member is on: a row of the
 * Google Meetings card that folds open to add and remove them. A change
 * reaches the calendar at the next live sync.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { EmployeePicker } from "@/components/employee-picker";
import { MEETING_ADMINISTRATORS_MAX } from "@/db/schema";
import type { MeetingAdministrator } from "@/lib/evals/google-meetings";
import { cn } from "@/lib/utils";

export function AdministratorsSection({ administrators }: { administrators: MeetingAdministrator[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: MeetingAdministrator[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/evals/google-meetings/administrators", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ administrators: next }),
      });
      if (!res.ok) {
        setError(`Could not save that (${res.status}).`);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(email: string, fullName?: string): Promise<boolean> {
    if (administrators.some((a) => a.email === email.toLowerCase())) {
      setError(`${fullName ?? email} is already on the list.`);
      return false;
    }
    if (administrators.length >= MEETING_ADMINISTRATORS_MAX) {
      setError(`The list holds at most ${MEETING_ADMINISTRATORS_MAX} people.`);
      return false;
    }
    return save([...administrators, { email, fullName: fullName ?? "" }]);
  }

  const count = administrators.length;
  return (
    <div className="space-y-3 px-5 py-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 text-left font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        {count.toLocaleString()} Assessments {count === 1 ? "Administrator" : "Administrators"}
      </button>
      {open && (
        <div className="space-y-3">
          <EmployeePicker id="gm-administrator" label="Add someone" placeholder="Search by name" busy={busy} onAdd={add} />
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {count > 0 ? (
            <ul className="divide-y rounded-xl border">
              {administrators.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 wrap-break-word">
                    {a.fullName && <span className="font-medium">{a.fullName} </span>}
                    <span className="text-muted-foreground">{a.email}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.fullName || a.email}`}
                    disabled={busy}
                    onClick={() => void save(administrators.filter((x) => x.email !== a.email))}
                    className="cursor-pointer rounded-md p-1 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">Nobody yet, so invites go to the cohort alone.</p>
          )}
        </div>
      )}
    </div>
  );
}
