"use client";

/**
 * Adds someone from the employee list as an account, with the roles chosen,
 * before they first sign in. A platform administrator's, so platform
 * administration is on offer too.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmployeeMatches, useEmployeeSearch, type EmployeeCandidate } from "@/components/employee-picker";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ASSESSMENTS_ROLES, EVENT_ROLES, TRAINING_ROLES } from "@/db/schema";
import {
  ASSESSMENTS_ROLE_DESCRIPTIONS,
  ASSESSMENTS_ROLE_LABELS,
  EVENT_ROLE_DESCRIPTIONS,
  EVENT_ROLE_LABELS,
  NO_ASSESSMENTS_ACCESS_LABEL,
  NO_TRAINING_ACCESS_LABEL,
  PLATFORM_ADMIN_LABEL,
  TRAINING_ROLE_DESCRIPTIONS,
  TRAINING_ROLE_LABELS,
  asAssessmentsRole,
  asEventRole,
  asTrainingRole,
} from "@/lib/roles";
import { cn } from "@/lib/utils";
import { RoleChoice } from "./create-invite-dialog";

/** The radio value for "grant nothing in this area". */
const NONE = "none";

const ERRORS: Record<string, string> = {
  not_employee: "That person is no longer in the employee list. Choose someone else.",
  exists: "They already have an account. Set their roles in the table.",
  forbidden: "Only a platform administrator can add users.",
  unauthorized: "Sign in again to do this.",
};

export function AddUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [person, setPerson] = useState<EmployeeCandidate | null>(null);
  const [eventRole, setEventRole] = useState<string>("operator");
  const [trainingRole, setTrainingRole] = useState<string>(NONE);
  const [assessmentsRole, setAssessmentsRole] = useState<string>(NONE);
  const [platform, setPlatform] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim();
  const searching = q.length > 0 && !person;
  const { matches } = useEmployeeSearch(q, searching);

  function reset() {
    setQuery("");
    setPerson(null);
    setEventRole("operator");
    setTrainingRole(NONE);
    setAssessmentsRole(NONE);
    setPlatform(false);
    setError(null);
  }

  function choose(e: EmployeeCandidate) {
    setPerson(e);
    setQuery(`${e.fullName} <${e.email}>`);
    setListOpen(false);
    setError(null);
  }

  async function submit() {
    if (!person || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: person.email,
          // A platform administrator's area roles are hidden, so none are kept
          // to come back into force if the flag is later taken away.
          eventRole: platform ? "none" : (asEventRole(eventRole) ?? "none"),
          trainingRole: platform ? null : asTrainingRole(trainingRole),
          assessmentsRole: platform ? null : asAssessmentsRole(assessmentsRole),
          isPlatformAdmin: platform,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(ERRORS[body?.error] ?? `Could not add them (${res.status})`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add them");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="brand"
        className="shrink-0"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <UserPlus />
        Add user
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a user</DialogTitle>
            <DialogDescription>
              They appear in the table now with these roles, and keep them when
              they first sign in with Google.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor="add-user-employee" className="text-sm font-medium">
              Employee
            </label>
            <div className="relative">
              <Input
                id="add-user-employee"
                autoFocus
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder="Search employees by name or email"
                className={cn(person && "pr-9")}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPerson(null);
                  setListOpen(true);
                }}
                onFocus={() => setListOpen(true)}
                onBlur={() => setListOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && listOpen) {
                    e.stopPropagation();
                    setListOpen(false);
                  }
                }}
              />
              {person && (
                <button
                  type="button"
                  aria-label="Choose someone else"
                  onClick={() => {
                    setPerson(null);
                    setQuery("");
                  }}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
              {listOpen && searching && <EmployeeMatches matches={matches} onChoose={choose} />}
            </div>
          </div>

          <DialogBody className="grid gap-5">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/40">
              <input
                type="checkbox"
                checked={platform}
                onChange={(e) => setPlatform(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{PLATFORM_ADMIN_LABEL}</span>
                <span className="text-xs text-muted-foreground">
                  An administrator in every area, who also manages users and the platform.
                </span>
              </span>
            </label>

            {!platform && (
              <>
                <RoleChoice
                  legend="Event role"
                  name="add-user-event-role"
                  value={eventRole}
                  onChange={setEventRole}
                  options={EVENT_ROLES.map((r) => ({
                    value: r,
                    label: EVENT_ROLE_LABELS[r],
                    description: EVENT_ROLE_DESCRIPTIONS[r],
                  }))}
                />
                <RoleChoice
                  legend="Training role"
                  name="add-user-training-role"
                  value={trainingRole}
                  onChange={setTrainingRole}
                  options={[
                    { value: NONE, label: NO_TRAINING_ACCESS_LABEL, description: "Cannot see the training." },
                    ...TRAINING_ROLES.map((r) => ({
                      value: r,
                      label: TRAINING_ROLE_LABELS[r],
                      description: TRAINING_ROLE_DESCRIPTIONS[r],
                    })),
                  ]}
                />
                <RoleChoice
                  legend="Assessments role"
                  name="add-user-assessments-role"
                  value={assessmentsRole}
                  onChange={setAssessmentsRole}
                  options={[
                    {
                      value: NONE,
                      label: NO_ASSESSMENTS_ACCESS_LABEL,
                      description: "Cannot see eVals or Diagnostic.",
                    },
                    ...ASSESSMENTS_ROLES.map((r) => ({
                      value: r,
                      label: ASSESSMENTS_ROLE_LABELS[r],
                      description: ASSESSMENTS_ROLE_DESCRIPTIONS[r],
                    })),
                  ]}
                />
              </>
            )}
          </DialogBody>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={!person || pending} onClick={() => void submit()}>
              {pending && <Loader2 className="animate-spin" />}
              Add user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
