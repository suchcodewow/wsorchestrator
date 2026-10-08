"use client";

/**
 * A field that finds an employee by name and adds them. It asks the employee
 * list one page at a time rather than shipping everyone to the browser, so the
 * caller needs `canSearchEmployees`. With `allowAnyEmail`, a whole email typed
 * by hand is accepted too, for people who are not employees. It is safe
 * inside a form: neither Enter nor Add submits it.
 */

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAnchoredToParent } from "@/components/use-anchored";
import { SEARCH_DEBOUNCE_MS } from "@/components/use-debounced-search";
import { EVALS_SLACK_CONTACT_LIMITS } from "@/db/schema";

/** An employee as a picker offers them. */
export type EmployeeCandidate = { email: string; fullName: string };

/** How many matches the dropdown lists; the rest are a sharper search away. */
const SHOWN_MATCHES = 8;

/** Close enough to an email to send as one; the server has the final word. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The employees matching `q`, fetched once typing pauses while `enabled`.
 * Each keystroke aborts the request before it, so a slow answer never
 * overwrites a newer one.
 */
export function useEmployeeSearch(q: string, enabled: boolean) {
  const [matches, setMatches] = useState<EmployeeCandidate[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        // Name and email only: a manager's name would otherwise bring up their whole team.
        const res = await fetch(`/api/evals/employees?${new URLSearchParams({ q, match: "person" })}`, {
          signal: ctrl.signal,
        });
        const body = res.ok ? ((await res.json()) as { people?: EmployeeCandidate[] }) : null;
        setMatches((body?.people ?? []).map(({ email, fullName }) => ({ email, fullName })));
      } catch {
        // Aborted by the next keystroke, or offline: the list just stays as it was.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, enabled]);

  return { matches, clear: () => setMatches([]) };
}

/**
 * The dropdown under a picker's field, or over it when there is no room
 * below. Render it inside the `relative` box around the field. Choosing keeps
 * focus in the field.
 */
export function EmployeeMatches({
  matches,
  onChoose,
}: {
  matches: EmployeeCandidate[];
  onChoose: (employee: EmployeeCandidate) => void;
}) {
  const ref = useAnchoredToParent<HTMLUListElement>(matches.length > 0);
  if (matches.length === 0) return null;

  return (
    <ul ref={ref} className="absolute top-0 left-0 z-20 overflow-y-auto rounded-md border bg-popover shadow-md">
      {matches.slice(0, SHOWN_MATCHES).map((e) => (
        <li key={e.email}>
          <button
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onChoose(e)}
            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
          >
            <span>{e.fullName}</span>
            <span className="text-xs text-muted-foreground">{e.email}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

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
  /** `fullName` is set when they were picked from the list. */
  onAdd: (email: string, fullName?: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EmployeeCandidate | null>(null);

  const q = query.trim();
  const searching = q.length > 0 && !selected;
  const { matches, clear } = useEmployeeSearch(q, searching);

  const email = selected?.email ?? (allowAnyEmail && LOOKS_LIKE_EMAIL.test(q) ? q : "");

  function choose(e: EmployeeCandidate) {
    setQuery(`${e.fullName} <${e.email}>`);
    setSelected(e);
    setOpen(false);
  }

  async function submit() {
    if (!email || busy) return;
    if (await onAdd(email, selected?.fullName)) {
      setQuery("");
      setSelected(null);
      clear();
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
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
          />
          {open && searching && <EmployeeMatches matches={matches} onChoose={choose} />}
        </div>
        <Button type="button" variant="brand" disabled={!email || busy} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          Add
        </Button>
      </div>
    </div>
  );
}
