"use client";

/** The preferences a person sets for themselves; for now, whether page tours play for them again. */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PreferencesView({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveName() {
    setNameBusy(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredName: name }),
      });
      if (res.status === 409) throw new Error("You have no employee record to apply a preferred name to.");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const first = name.trim().split(/\s+/)[0] ?? "";
      setName(first);
      setSavedName(first);
      setNameSaved(true);
    } catch (e) {
      setNameError(e instanceof Error ? e.message : "Could not save the preferred name.");
    } finally {
      setNameBusy(false);
    }
  }

  async function resetTours() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/tours/seen", { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { reset?: number } | null;
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setDone(body?.reset ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the tours.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="divide-y rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
        <label htmlFor="preferred-name" className="text-sm font-medium">
          Preferred name
          {nameSaved && (
            <span role="status" className="ml-2 font-normal text-muted-foreground">
              Saved.
            </span>
          )}
          {nameError && (
            <span role="alert" className="ml-2 font-normal text-destructive">
              {nameError}
            </span>
          )}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="preferred-name"
            className="w-48"
            value={name}
            maxLength={100}
            placeholder="First name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name !== savedName && !nameBusy && saveName()}
          />
          <Button variant="outline" size="sm" disabled={nameBusy || name === savedName} onClick={saveName}>
            {nameBusy && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
        <div className="text-sm">
          <span className="font-medium">Page tours</span>
          {done !== null && (
            <span role="status" className="ml-2 text-muted-foreground">
              {done === 1 ? "1 tour" : `${done} tours`} will play again.
            </span>
          )}
          {error && (
            <span role="alert" className="ml-2 text-destructive">
              {error}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={resetTours}>
          {busy && <Loader2 className="animate-spin" />}
          Reset all tours
        </Button>
      </div>
    </div>
  );
}
