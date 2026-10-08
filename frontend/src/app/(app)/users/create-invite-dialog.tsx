"use client";

/**
 * Makes an invite link for the roles the viewer administers. Platform
 * administration is never on offer: it is granted by name, on the table.
 */

import { useState } from "react";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ASSESSMENTS_ROLES, EVENT_ROLES, INVITE_TTL_MINUTES, TRAINING_ROLES } from "@/db/schema";
import {
  ASSESSMENTS_ROLE_DESCRIPTIONS,
  ASSESSMENTS_ROLE_LABELS,
  EVENT_ROLE_DESCRIPTIONS,
  EVENT_ROLE_LABELS,
  NO_ASSESSMENTS_ACCESS_LABEL,
  NO_TRAINING_ACCESS_LABEL,
  TRAINING_ROLE_DESCRIPTIONS,
  TRAINING_ROLE_LABELS,
  canManageRoles,
  type Access,
} from "@/lib/roles";
import { cn } from "@/lib/utils";

/** The radio value for "grant nothing in this area". */
const NONE = "none";

const ERRORS: Record<string, string> = {
  empty: "Choose at least one role.",
  forbidden: "Your own role changed — reload the page.",
};

type Created = { url: string; expiresAt: Date };

export function CreateInviteDialog({ viewerAccess }: { viewerAccess: Access }) {
  const offersEvent = canManageRoles(viewerAccess, "event");
  const offersTraining = canManageRoles(viewerAccess, "training");
  const offersAssessments = canManageRoles(viewerAccess, "assessments");

  const [open, setOpen] = useState(false);
  const [eventRole, setEventRole] = useState<string>(offersEvent ? "operator" : NONE);
  const [trainingRole, setTrainingRole] = useState<string>(NONE);
  const [assessmentsRole, setAssessmentsRole] = useState<string>(NONE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEventRole(offersEvent ? "operator" : NONE);
    setTrainingRole(NONE);
    setAssessmentsRole(NONE);
    setError(null);
    setCreated(null);
    setCopied(false);
  }

  async function create() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/users/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventRole: eventRole === NONE ? null : eventRole,
          trainingRole: trainingRole === NONE ? null : trainingRole,
          assessmentsRole: assessmentsRole === NONE ? null : assessmentsRole,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(ERRORS[body?.error] ?? `Could not create the invite (${res.status})`);
      }
      setCreated({
        url: new URL(body.path, window.location.origin).toString(),
        expiresAt: new Date(body.expiresAt),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invite");
    } finally {
      setPending(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  }

  const grantsSomething =
    eventRole !== NONE || trainingRole !== NONE || assessmentsRole !== NONE;

  return (
    <>
      <Button
        variant="outline"
        className="shrink-0"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Link2 />
        Create invite
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created ? "Invite link ready" : "Create an invite link"}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {`Anyone who opens the link in the next ${INVITE_TTL_MINUTES} minutes and signs in `}
              gets these roles, as long as they don&apos;t have access already. It
              works only for addresses allowed to sign in.
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="grid gap-2">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={created.url}
                  aria-label="Invite link"
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="outline" className="shrink-0" onClick={() => void copy(created.url)}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expires at{" "}
                {created.expiresAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
                This is the only time the link is shown.
              </p>
            </div>
          ) : (
            <div className="grid gap-5">
              {offersEvent && (
                <RoleChoice
                  legend="Event role"
                  name="invite-event-role"
                  value={eventRole}
                  onChange={setEventRole}
                  options={EVENT_ROLES.map((r) => ({
                    value: r,
                    label: EVENT_ROLE_LABELS[r],
                    description: EVENT_ROLE_DESCRIPTIONS[r],
                  }))}
                />
              )}
              {offersTraining && (
                <RoleChoice
                  legend="Training role"
                  name="invite-training-role"
                  value={trainingRole}
                  onChange={setTrainingRole}
                  options={[
                    {
                      value: NONE,
                      label: NO_TRAINING_ACCESS_LABEL,
                      description: "Cannot see the training.",
                    },
                    ...TRAINING_ROLES.map((r) => ({
                      value: r,
                      label: TRAINING_ROLE_LABELS[r],
                      description: TRAINING_ROLE_DESCRIPTIONS[r],
                    })),
                  ]}
                />
              )}
              {offersAssessments && (
                <RoleChoice
                  legend="Assessments role"
                  name="invite-assessments-role"
                  value={assessmentsRole}
                  onChange={setAssessmentsRole}
                  options={[
                    {
                      value: NONE,
                      label: NO_ASSESSMENTS_ACCESS_LABEL,
                      description: "Cannot see eVals or Iris.",
                    },
                    ...ASSESSMENTS_ROLES.map((r) => ({
                      value: r,
                      label: ASSESSMENTS_ROLE_LABELS[r],
                      description: ASSESSMENTS_ROLE_DESCRIPTIONS[r],
                    })),
                  ]}
                />
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            {created ? (
              <>
                <Button variant="ghost" onClick={reset}>
                  Create another
                </Button>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="brand"
                  disabled={pending || !grantsSomething}
                  onClick={() => void create()}
                >
                  {pending && <Loader2 className="animate-spin" />}
                  Create link
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoleChoice({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; description: string }[];
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {legend}
      </legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/40",
            value === o.value && "border-brand/50 bg-brand/5",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-0.5 size-4 shrink-0 accent-brand"
          />
          <span className="grid gap-0.5">
            <span className="font-medium">{o.label}</span>
            <span className="text-xs text-muted-foreground">{o.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
