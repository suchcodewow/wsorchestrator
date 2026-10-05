"use client";

/** Paste a Harness token to save it; the account comes from the token itself. */

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_HARNESS_TOKENS_PER_USER } from "@/db/schema";

export function TokenEntryForm({
  disabled,
  full,
  saving,
  onSave,
}: {
  /** No encryption key, so nothing can be stored. */
  disabled: boolean;
  /** At `MAX_HARNESS_TOKENS_PER_USER` already. */
  full: boolean;
  saving: boolean;
  /** Resolves true once saved, which clears the field. */
  onSave: (token: string) => Promise<boolean>;
}) {
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);
  const trimmed = token.trim();
  const closed = disabled || full;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (trimmed.length === 0 || closed || saving) return;
    if (await onSave(trimmed)) {
      setToken("");
      setReveal(false);
    }
  }

  return (
    <Card>
      <CardContent className="py-5">
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1">
              <Input
                type={reveal ? "text" : "password"}
                value={token}
                autoComplete="off"
                spellCheck={false}
                placeholder="pat.xxxxxxxx.xxxxxxxx.xxxxxxxx"
                aria-label="Harness platform token"
                disabled={closed}
                className="pr-9 font-mono"
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? "Hide token" : "Show token"}
                className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              >
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>

            <Button type="submit" disabled={closed || saving || trimmed.length === 0}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Save
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {full
              ? `${MAX_HARNESS_TOKENS_PER_USER} saved tokens is the limit — remove one first.`
              : "Nothing else to fill in — the account comes from the token."}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
