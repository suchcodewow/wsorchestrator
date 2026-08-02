"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Lock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SPRING_SNAPPY } from "@/lib/motion";
import {
  CLOUDS,
  CLOUD_LABELS,
  limitsFor,
  type Cloud,
  type WorkshopRun,
} from "@/db/schema";

const ERRORS: Record<string, string> = {
  locked: "This event can no longer be changed.",
  shrink_not_allowed:
    "A running event can only grow — attendee accounts are already in use.",
  cloud_removal_not_allowed:
    "A cloud already provisioned for a running event can't be removed.",
  invalid_body: "Check the attendee count and cloud selection.",
  exceeds_mode_limits:
    "That user count or cloud selection is outside what this event kind allows.",
  not_found: "This event no longer exists.",
};

export function RunConfig({
  run,
  editability,
  onSaved,
}: {
  run: WorkshopRun;
  editability: "full" | "grow" | "locked";
  onSaved: () => void;
}) {
  const [userCount, setUserCount] = useState(String(run.userCount));
  const [clouds, setClouds] = useState<Cloud[]>(run.clouds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-sync when a save or a poll brings back a newer version of the run.
  //
  // Keyed on the values rather than on `run` itself: the parent replaces the
  // whole payload every few seconds while a run is active, so `run.clouds` is a
  // fresh array on each poll even when nothing about it changed. Adjusting
  // during render rather than in an effect also means the form never paints the
  // superseded values for a frame on the way to the new ones.
  const serverState = `${run.userCount}:${run.clouds.join(",")}`;
  const [syncedFrom, setSyncedFrom] = useState(serverState);
  // An in-flight save is the one case where the server is behind the form.
  if (serverState !== syncedFrom && !pending) {
    setSyncedFrom(serverState);
    setUserCount(String(run.userCount));
    setClouds(run.clouds);
  }

  const locked = editability === "locked";
  const growOnly = editability === "grow";
  const limits = limitsFor(run.mode);
  const singleCloud = limits.maxClouds === 1;

  const count = Number(userCount);
  const dirty =
    count !== run.userCount ||
    clouds.length !== run.clouds.length ||
    clouds.some((c) => !run.clouds.includes(c));

  function toggleCloud(cloud: Cloud) {
    // A provisioned cloud can't be taken away from a live event.
    if (growOnly && run.clouds.includes(cloud)) return;
    // A single-cloud event swaps its choice instead of accumulating them.
    if (singleCloud) {
      setClouds([cloud]);
      return;
    }
    setClouds((prev) =>
      prev.includes(cloud) ? prev.filter((c) => c !== cloud) : [...prev, cloud],
    );
  }

  async function save() {
    if (!Number.isInteger(count) || count < 1 || count > limits.maxUsers) {
      setError(`Enter a number of users between 1 and ${limits.maxUsers}.`);
      return;
    }
    if (clouds.length < limits.minClouds) {
      setError(singleCloud ? "Pick a cloud." : "Pick at least one cloud.");
      return;
    }

    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/runs/${run.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCount: count, clouds }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(ERRORS[body?.error] ?? `Could not save (${res.status})`);
      }
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {locked ? (
          <p className="text-sm text-muted-foreground">
            {run.status === "destroyed" || run.status === "failed"
              ? `This ${run.mode} has finished — its configuration is fixed.`
              : "Provisioning is in progress. Configuration can be changed once it is ready."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {growOnly
              ? `This ${run.mode} is live. You can add users${
                  singleCloud ? "" : " and clouds"
                }; existing ones can't be removed.`
              : `This ${run.mode} hasn't been provisioned yet, so anything can change.`}
          </p>
        )}

        <div className="grid gap-1.5">
          <label htmlFor="cfg-users" className="text-sm font-medium">
            Users
          </label>
          <Input
            id="cfg-users"
            type="number"
            inputMode="numeric"
            min={growOnly ? run.userCount : 1}
            max={limits.maxUsers}
            step={1}
            value={userCount}
            disabled={locked || pending}
            onChange={(e) => setUserCount(e.target.value)}
            className="max-w-32 tnum"
          />
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">
            {singleCloud ? "Cloud" : "Clouds"}
          </legend>
          {/* Same selectable cards as the create dialog, so the two forms that
              choose clouds do not look like they came from different apps. */}
          <div className="grid gap-2">
            {CLOUDS.map((cloud) => {
              const provisioned = growOnly && run.clouds.includes(cloud);
              const selected = clouds.includes(cloud);
              const disabled = locked || pending || provisioned;

              return (
                <motion.button
                  key={cloud}
                  type="button"
                  role={singleCloud ? "radio" : "checkbox"}
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => toggleCloud(cloud)}
                  whileTap={disabled ? undefined : { scale: 0.99 }}
                  transition={SPRING_SNAPPY}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    selected ? "border-brand-border bg-brand/8" : "",
                    disabled
                      ? "cursor-not-allowed opacity-70"
                      : cn(
                          "cursor-pointer",
                          !selected && "hover:border-brand-border/60 hover:bg-accent/40",
                        ),
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4.5 shrink-0 items-center justify-center border transition-colors",
                      singleCloud ? "rounded-full" : "rounded-[5px]",
                      selected
                        ? "border-brand bg-brand text-brand-foreground"
                        : "border-input",
                    )}
                  >
                    {selected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="font-medium">{CLOUD_LABELS[cloud]}</span>
                  {provisioned && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" /> provisioned
                    </span>
                  )}
                  {cloud !== "gcp" && !provisioned && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      not yet provisioned
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </fieldset>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && !dirty && !error && (
          <p className="text-sm text-emerald-600">Saved.</p>
        )}

        {!locked && (
          <div>
            <Button variant="brand" onClick={save} disabled={!dirty || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />}
              {pending ? "Saving…" : "Save changes"}
            </Button>
            {growOnly && dirty && (
              <p className="mt-2 text-xs text-muted-foreground">
                Saving re-runs provisioning to create the additions. Existing
                accounts keep their credentials.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
