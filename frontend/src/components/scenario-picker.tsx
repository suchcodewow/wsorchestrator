"use client";

/**
 * The scenario checkboxes, shared by the booking dialog and the run page.
 *
 * Both places offer the same list and the same interaction, and the only real
 * difference is when: the dialog picks scenarios for a challenge that has not
 * been built, the run page turns them on and off against one that has. Keeping
 * one component means an added scenario shows up in both without anyone
 * remembering the second.
 */

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { scenariosForClouds, type Cloud, type ScenarioId } from "@/db/schema";

export function ScenarioPicker({
  clouds,
  selected,
  onToggle,
  disabled = false,
  legend = "Scenarios",
  hint,
}: {
  clouds: readonly Cloud[];
  selected: readonly ScenarioId[];
  onToggle: (id: ScenarioId) => void;
  disabled?: boolean;
  legend?: string;
  hint?: string;
}) {
  const available = scenariosForClouds(clouds);

  // Nothing to offer until a cloud is chosen, and no cloud has scenarios on
  // every deployment — an empty fieldset would just be a stray heading.
  if (available.length === 0) return null;

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid gap-2">
        {available.map((scenario) => {
          const on = selected.includes(scenario.id);
          return (
            <motion.button
              key={scenario.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onToggle(scenario.id)}
              whileTap={disabled ? undefined : { scale: 0.99 }}
              transition={SPRING_SNAPPY}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                disabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:border-brand-border/60 hover:bg-accent/40",
                on && "border-brand-border bg-brand/8",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                  on
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-input",
                )}
              >
                {on && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={SPRING_SNAPPY}
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </motion.span>
                )}
              </span>
              <span className="grid gap-0.5">
                <span className="font-medium">{scenario.label}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {scenario.description}
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>
      {hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </fieldset>
  );
}
