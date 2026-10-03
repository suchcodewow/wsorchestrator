"use client";

/**
 * A field that finds an employee by name and adds them. It asks the employee
 * list one page at a time rather than shipping everyone to the browser, so the
 * caller needs `canSearchEmployees`. With `allowAnyEmail`, a whole email typed
 * by hand is accepted too, for people who are not employees.
 */

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVALS_SLACK_CONTACT_LIMITS } from "@/db/schema";

type Candidate = { email: string; fullName: string };

/** How long the field waits after the last keystroke before it searches. */
const SEARCH_DEBOUNCE_MS = 300;

/** Close enough to an email to send as one; the server has the final word. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmployeePicker({
  id,
  label,
  placeholder,
  busy,
  allowAnyEmail = false,
  onAdd,
}: {
  id: string;
  label: string;
  placeholder: string;
  busy: boolean;
  allowAnyEmail?: boolean;
  onAdd: (email: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [matches, setMatches] = useState<Candidate[]>([]);

  const q = query.trim();
  const searching = q.length > 0 && !selected;
  useEffect(() => {
    if (!searching) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/evals/employees?${new URLSearchParams({ q })}`, { signal: ctrl.signal });
        const body = res.ok ? await res.json() : null;
        setMatches(((body?.people ?? []) as Candidate[]).map((e) => ({ email: e.email, fullName: e.fullName })));
      } catch {
        // Aborted by the next keystroke, or offline: the list just stays as it was.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, searching]);

  const email = selected?.email ?? (allowAnyEmail && LOOKS_LIKE_EMAIL.test(q) ? q : "");

  function choose(e: Candidate) {
    setQuery(`${e.fullName} <${e.email}>`);
    setSelected(e);
    setOpen(false);
  }

  async function submit() {
    if (!email || busy) return;
    if (await onAdd(email)) {
      setQuery("");
      setSelected(null);
      setMatches([]);
    }
  }

  return (
    <div className="max-w-md space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            value={query}
            maxLength={EVALS_SLACK_CONTACT_LIMITS.email}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
          />
          {open && searching && matches.length > 0 && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md">
              {matches.slice(0, 8).map((e) => (
                <button
                  key={e.email}
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => choose(e)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <span>{e.fullName}</span>
                  <span className="text-xs text-muted-foreground">{e.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button variant="brand" disabled={!email || busy} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          Add
        </Button>
      </div>
    </div>
  );
}
