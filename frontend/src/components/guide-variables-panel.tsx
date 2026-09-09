"use client";

/** Where a reader tells a guide who they are, so it fills its blanks in for them. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearGuideContextCookie,
  guideVariable,
  writeGuideContextCookie,
  type GuideContext,
  type GuideValues,
  type GuideVariableName,
} from "@/lib/guide-variables";
import { cn } from "@/lib/utils";

export function GuideVariablesPanel({
  used,
  values,
  provided,
  missing,
  event,
  context,
}: {
  /** The variables this guide actually uses, in the order it first uses them. */
  used: GuideVariableName[];
  values: GuideValues;
  provided: GuideValues;
  missing: GuideVariableName[];
  event: { name: string; email: string } | null;
  context: GuideContext;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GuideValues>(() => pick(values, used));

  if (used.length === 0) return null;

  function edit() {
    setDraft(pick(values, used));
    setOpen(true);
  }

  function save() {
    // Only what differs from the run is kept, so a value the event provisions
    // stays live rather than being frozen into the cookie at first read.
    const typed: GuideValues = { ...context.typed };
    for (const name of used) {
      const value = (draft[name] ?? "").trim();
      if (value.length > 0 && value !== provided[name]) typed[name] = value;
      else delete typed[name];
    }

    writeGuideContextCookie({ ...context, typed });
    setOpen(false);
    router.refresh();
  }

  function forget() {
    clearGuideContextCookie();
    setOpen(false);
    router.refresh();
  }

  const known = used.length - missing.length;
  const anything =
    context.runId !== null || Object.keys(context.typed).length > 0;

  if (!open) {
    return (
      <Summary
        blanks={missing}
        known={known}
        event={event}
        onEdit={edit}
        onForget={anything ? forget : undefined}
      />
    );
  }

  return (
    <section
      aria-label="Your details"
      className="mb-8 rounded-xl border bg-card/60 p-4"
    >
      <p className="text-sm font-medium">Your details</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {event
          ? `Filled in from ${event.name}. Anything you change here is kept for you.`
          : "This guide writes these into its steps and commands wherever it needs them."}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {used.map((name) => {
          const variable = guideVariable(name);
          return (
            <label key={name} className="block">
              <span className="mb-1 flex items-baseline gap-1.5">
                <span className="text-xs font-medium">{variable.label}</span>
                <code className="text-[11px] text-muted-foreground">
                  {`{{${name}}}`}
                </code>
              </span>
              <Input
                value={draft[name] ?? ""}
                placeholder={variable.example}
                maxLength={300}
                aria-label={variable.label}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, [name]: e.target.value }))
                }
              />
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {variable.hint}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="brand" onClick={save}>
          <Check />
          Use these
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        {anything && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={forget}
            className="ml-auto text-muted-foreground"
          >
            Forget me
          </Button>
        )}
      </div>
    </section>
  );
}

function Summary({
  blanks,
  known,
  event,
  onEdit,
  onForget,
}: {
  blanks: GuideVariableName[];
  known: number;
  event: { name: string; email: string } | null;
  onEdit: () => void;
  onForget?: () => void;
}) {
  const waiting = blanks.length > 0;

  return (
    <section
      aria-label="Your details"
      className={cn(
        "mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm",
        waiting ? "border-brand-border/60 bg-brand/5" : "bg-card/60",
      )}
    >
      <UserRound
        aria-hidden
        className={cn("size-4 shrink-0", waiting ? "text-brand" : "text-muted-foreground")}
      />

      <p className="min-w-0 leading-relaxed">
        {waiting ? (
          <>
            This guide can fill in{" "}
            <span className="font-medium">{listOf(blanks)}</span> for you.
          </>
        ) : event ? (
          <>
            Written for{" "}
            <span className="font-medium">{event.email}</span> on {event.name}.
          </>
        ) : (
          <>
            Using the {known === 1 ? "detail" : `${known} details`} you entered.
          </>
        )}
      </p>

      <Button
        type="button"
        size="sm"
        variant={waiting ? "brand" : "ghost"}
        onClick={onEdit}
        className="ml-auto"
      >
        <Pencil />
        {waiting ? "Fill these in" : "Change"}
      </Button>

      {!waiting && onForget && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onForget}
          className="text-muted-foreground"
        >
          Forget me
        </Button>
      )}
    </section>
  );
}

function pick(values: GuideValues, names: GuideVariableName[]): GuideValues {
  return Object.fromEntries(
    names.map((name) => [name, values[name] ?? ""]),
  ) as GuideValues;
}

function listOf(names: GuideVariableName[]): string {
  const labels = names.map((name) => guideVariable(name).label);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
