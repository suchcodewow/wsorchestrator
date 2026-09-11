"use client";

/**
 * A quiet line saying this guide filled its blanks in for the reader, which
 * opens the form where they change or clear those values.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
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

export function GuideVariablesPanel({
  used,
  values,
  provided,
  event,
  context,
}: {
  /** The variables this guide actually uses, in the order it first uses them. */
  used: GuideVariableName[];
  values: GuideValues;
  provided: GuideValues;
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

  function clear() {
    clearGuideContextCookie();
    setOpen(false);
    router.refresh();
  }

  const filled = used.some((name) => (values[name] ?? "").length > 0);
  const anything =
    context.runId !== null || Object.keys(context.typed).length > 0;

  if (!open) {
    return (
      <p className="mb-8 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={edit}
          className="rounded-sm underline decoration-dotted underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {filled
            ? "This page loaded custom values for you."
            : "This page can fill in values for you."}
        </button>
      </p>
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
            onClick={clear}
            className="ml-auto text-muted-foreground"
          >
            Clear values
          </Button>
        )}
      </div>
    </section>
  );
}

function pick(values: GuideValues, names: GuideVariableName[]): GuideValues {
  return Object.fromEntries(
    names.map((name) => [name, values[name] ?? ""]),
  ) as GuideValues;
}
