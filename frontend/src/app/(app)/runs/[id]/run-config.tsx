"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CLOUDS,
  CLOUD_LABELS,
  MAX_USERS,
  type Cloud,
  type WorkshopRun,
} from "@/db/schema";

const ERRORS: Record<string, string> = {
  locked: "This workshop can no longer be changed.",
  shrink_not_allowed:
    "A running workshop can only grow — attendee accounts are already in use.",
  cloud_removal_not_allowed:
    "A cloud already provisioned for a running workshop can't be removed.",
  invalid_body: "Check the attendee count and cloud selection.",
  not_found: "This workshop no longer exists.",
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

  // Re-sync when the poll brings back a newer version of the run.
  useEffect(() => {
    if (pending) return;
    setUserCount(String(run.userCount));
    setClouds(run.clouds);
  }, [run.userCount, run.clouds, pending]);

  const locked = editability === "locked";
  const growOnly = editability === "grow";

  const count = Number(userCount);
  const dirty =
    count !== run.userCount ||
    clouds.length !== run.clouds.length ||
    clouds.some((c) => !run.clouds.includes(c));

  function toggleCloud(cloud: Cloud) {
    // A provisioned cloud can't be taken away from a live workshop.
    if (growOnly && run.clouds.includes(cloud)) return;
    setClouds((prev) =>
      prev.includes(cloud) ? prev.filter((c) => c !== cloud) : [...prev, cloud],
    );
  }

  async function save() {
    if (!Number.isInteger(count) || count < 1 || count > MAX_USERS) {
      setError(`Enter a number of users between 1 and ${MAX_USERS}.`);
      return;
    }
    if (clouds.length === 0) {
      setError("Pick at least one cloud.");
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
              ? "This workshop has finished — its configuration is fixed."
              : "Provisioning is in progress. Configuration can be changed once it is ready."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {growOnly
              ? "This workshop is live. You can add attendees and clouds; existing ones can't be removed."
              : "This workshop hasn't been provisioned yet, so anything can change."}
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
            max={MAX_USERS}
            step={1}
            value={userCount}
            disabled={locked || pending}
            onChange={(e) => setUserCount(e.target.value)}
            className="max-w-32"
          />
        </div>

        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">Clouds</legend>
          <div className="grid gap-2 pt-1">
            {CLOUDS.map((cloud) => {
              const provisioned = growOnly && run.clouds.includes(cloud);
              return (
                <label
                  key={cloud}
                  htmlFor={`cfg-cloud-${cloud}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    id={`cfg-cloud-${cloud}`}
                    type="checkbox"
                    checked={clouds.includes(cloud)}
                    disabled={locked || pending || provisioned}
                    onChange={() => toggleCloud(cloud)}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {CLOUD_LABELS[cloud]}
                  {provisioned && (
                    <span className="text-xs text-muted-foreground">
                      (provisioned)
                    </span>
                  )}
                  {cloud !== "gcp" && !provisioned && (
                    <span className="text-xs text-muted-foreground">
                      (not yet provisioned)
                    </span>
                  )}
                </label>
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
            <Button onClick={save} disabled={!dirty || pending}>
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
