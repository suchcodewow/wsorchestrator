"use client";

/**
 * The Additional Slack Contacts: a field to find an employee by name, or type
 * any email, and add them; then a page of those added, searched and sorted by
 * the database.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVALS_SLACK_CONTACT_LIMITS } from "@/db/schema";
import type { SlackContactSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatWhen } from "../../cohort-settings/format";

export type SlackContactListing = {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  addedBy: string | null;
};

type Candidate = { email: string; fullName: string };

/** How long the name field waits after the last keystroke before it searches. */
const SEARCH_DEBOUNCE_MS = 300;

/** Close enough to an email to send as one; the server has the final word. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COLUMNS: { column: SlackContactSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "addedBy", label: "Added by" },
  { column: "createdAt", label: "Added" },
];

const ERRORS: Record<string, string> = {
  invalid: "Pick someone from the list, or type a full email address.",
  duplicate: "That person is already an Additional Slack Contact.",
  not_found: "That contact was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

export function SlackContactsView({
  query,
  page,
  count,
}: {
  query: ListQuery<SlackContactSort>;
  page: Page<SlackContactListing>;
  count: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  async function send(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return null;
      }
      router.refresh();
      return body ?? {};
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Additional Slack Contacts</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            {count.toLocaleString()} {count === 1 ? "contact" : "contacts"}
          </span>{" "}
          added to every team&apos;s Slack message at the end of a bootcamp.
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <AddContactField
          busy={busy === "add"}
          onAdd={async (email) => {
            const body = await send("add", "/api/evals/slack-contacts", {
              method: "POST",
              body: JSON.stringify({ email }),
            });
            if (!body) return false;
            setNotice(`Added ${body.fullName || body.email}.`);
            return true;
          }}
        />
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}
      {notice && (
        <motion.p variants={riseChild} role="status" className="text-sm text-muted-foreground">
          {notice}
        </motion.p>
      )}

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name, email or who added them" label="Search contacts" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map(({ column, label }) => (
                  <SortHeader key={column} column={column} {...sortProps}>
                    {label}
                  </SortHeader>
                ))}
                <PlainHeader className="w-16" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No contacts match that search." : "No contacts yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((c) => (
                <tr key={c.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{c.fullName || "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.email}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.addedBy ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatWhen(c.createdAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${c.fullName || c.email}`}
                        disabled={busy === c.id}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={async () => {
                          const body = await send(c.id, `/api/evals/slack-contacts/${c.id}`, { method: "DELETE" });
                          if (body) setNotice(`Removed ${c.fullName || c.email}.`);
                        }}
                      >
                        {busy === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="contacts" />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Type a name to pick an employee, or a whole email for anyone else. */
function AddContactField({ busy, onAdd }: { busy: boolean; onAdd: (email: string) => Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [matches, setMatches] = useState<Candidate[]>([]);

  // Ask the employee list, one page of it, rather than shipping everyone here.
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

  const email = selected?.email ?? (LOOKS_LIKE_EMAIL.test(q) ? q : "");

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
      <label htmlFor="slack-contact" className="text-sm font-medium">
        Add a contact
      </label>
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <Input
            id="slack-contact"
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
            placeholder="Search employees by name, or type an email"
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
