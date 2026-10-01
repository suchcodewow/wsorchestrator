"use client";

/**
 * The Automation tab: one search box to find or add a title, then a page of
 * each list's titles. The search goes to the URL, so the database does the
 * matching; see `components/data-table.tsx`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, useListParams } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVALS_TITLE_LIMITS, EVALS_TITLE_LISTS, type EvalsTitleList } from "@/db/schema";
import { cleanTitle, TITLE_LIST_LABELS, TITLE_LIST_SLUGS } from "@/lib/evals/title-lists";
import type { TitleSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

export type ListedTitle = {
  id: string;
  title: string;
  addedBy: string | null;
  /** How many people in the org hold it. */
  holders: number;
};

/** One list's page of titles, the query it answers, and how many the list holds in all. */
export type ListedTitles = {
  query: ListQuery<TitleSort>;
  page: Page<ListedTitle>;
  count: number;
};

/** How long the search box waits after the last keystroke before it queries. */
const SEARCH_DEBOUNCE_MS = 300;

const INTRO: Record<EvalsTitleList, { heading: string; button: string }> = {
  sales: {
    heading: "Automatic Sales Titles",
    button: "Add Sales Title",
  },
  engineer: {
    heading: "Automatic Engineer Titles",
    button: "Add Engineer Title",
  },
  ignored: {
    heading: "Ignored Titles",
    button: "Add to Ignored Titles",
  },
};

const ERRORS: Record<string, string> = {
  invalid: "A title can't be blank.",
  not_found: "That title was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
  not_an_employee: "That email isn't in the imported employee list.",
};

function describeExisting(existing: { title: string; list: EvalsTitleList }[]) {
  return existing.map((e) => `${e.title} (${TITLE_LIST_LABELS[e.list]})`).join(", ");
}

export type LeaderCandidate = { email: string; fullName: string };

export function AutomationView({
  q: searched,
  lists,
  suggestions,
  imported,
  orgLeaderEmail,
  orgLeader,
}: {
  /** The search the lists were queried with. */
  q: string;
  lists: Record<EvalsTitleList, ListedTitles>;
  suggestions: { title: string; count: number }[];
  imported: boolean;
  orgLeaderEmail: string;
  /** The Organization Leader as the employee list has them, if it does. */
  orgLeader: LeaderCandidate | null;
}) {
  const router = useRouter();
  const { set: setList, pending: searching } = useListParams();
  const [query, setQuery] = useState(searched);
  const sent = useRef(searched);
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Follow the URL when it changes underneath us (back button, a link).
  useEffect(() => {
    if (searched !== sent.current) {
      sent.current = searched;
      setQuery(searched);
    }
  }, [searched]);

  useEffect(() => {
    const next = query.trim();
    if (next === sent.current) return;
    const t = setTimeout(() => {
      sent.current = next;
      setList({ q: next });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `setList` changes identity every render; the text is what drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const q = query.trim().toLowerCase();
  const shownSuggestions = useMemo(
    () => suggestions.filter((s) => s.title.toLowerCase().includes(q)),
    [suggestions, q],
  );

  async function send(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          body?.error === "duplicate" && body.list
            ? `That title is already on the ${TITLE_LIST_LABELS[body.list as EvalsTitleList]} list.`
            : (ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`),
        );
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

  async function addTo(list: EvalsTitleList, raw: string) {
    const title = cleanTitle(raw);
    if (!title) return false;
    const body = await send(`add:${list}`, "/api/evals/titles", {
      method: "POST",
      body: JSON.stringify({ list, titles: [title] }),
    });
    if (!body) return false;
    const added: string[] = body.added ?? [];
    const existing: { title: string; list: EvalsTitleList }[] = body.existing ?? [];
    if (added.length > 0) setNotice(`Added “${added[0]}” to ${TITLE_LIST_LABELS[list]}.`);
    else if (existing.length > 0) setNotice(`Already listed, so left as it was: ${describeExisting(existing)}.`);
    return true;
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-10">
      <motion.div variants={riseChild}>
        <h2 className="text-xl font-medium tracking-tight">Automation</h2>
      </motion.div>

      <motion.div variants={riseChild}>
        <OrgLeaderField
          current={orgLeader}
          orgLeaderEmail={orgLeaderEmail}
          busy={busy === "org-leader"}
          onSave={async (email) => {
            const ok = await send("org-leader", "/api/evals/org-leader", {
              method: "PUT",
              body: JSON.stringify({ email }),
            });
            if (ok) setNotice("Organization Leader saved.");
          }}
        />
      </motion.div>

      <motion.div variants={riseChild} className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            maxLength={EVALS_TITLE_LIMITS.title}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            placeholder="Search titles, or type one to add"
            aria-label="Search titles"
            className="pl-9 pr-9"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
          {searchOpen && q.length > 0 && shownSuggestions.length > 0 && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md">
              {shownSuggestions.slice(0, 8).map((s) => (
                <button
                  key={s.title}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery(s.title);
                    setSearchOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                  title={`${s.title} is in the org, on no list yet`}
                >
                  <span className="flex items-center gap-1.5">
                    <Plus className="size-3 text-muted-foreground" />
                    {s.title}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {EVALS_TITLE_LISTS.map((list) => (
            <Button
              key={list}
              variant="brand"
              disabled={q.length === 0 || busy !== null}
              onClick={async () => {
                if (await addTo(list, query)) setQuery("");
              }}
            >
              {busy === `add:${list}` ? <Loader2 className="animate-spin" /> : <Plus />}
              {INTRO[list].button}
            </Button>
          ))}
        </div>
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

      {EVALS_TITLE_LISTS.map((list) => {
        const { query: listQuery, page, count } = lists[list];
        const shown = page.rows;
        const sortProps = { sort: listQuery.sort, dir: listQuery.dir, prefix: list };
        return (
          <motion.div key={list} id={TITLE_LIST_SLUGS[list]} variants={riseChild} className="space-y-3">
            <h3 className="text-lg font-medium tracking-tight">{INTRO[list].heading}</h3>

            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-160 text-sm">
                  <thead>
                    <tr className={HEADER_ROW}>
                      <SortHeader column="title" {...sortProps}>
                        Title · {count.toLocaleString()}
                      </SortHeader>
                      <PlainHeader>In the org</PlainHeader>
                      <SortHeader column="addedBy" {...sortProps}>
                        Added by
                      </SortHeader>
                      <PlainHeader className="w-24" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) =>
                      editing === row.id ? (
                        <EditRow
                          key={row.id}
                          row={row}
                          list={list}
                          busy={busy === row.id}
                          onCancel={() => setEditing(null)}
                          onSave={async (values) => {
                            const ok = await send(row.id, `/api/evals/titles/${row.id}`, {
                              method: "PATCH",
                              body: JSON.stringify(values),
                            });
                            if (ok) setEditing(null);
                          }}
                        />
                      ) : (
                        <tr key={row.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                          <td className="px-5 py-2.5 font-medium">{row.title}</td>
                          <td className="px-5 py-2.5 tabular-nums text-muted-foreground">
                            {imported ? row.holders : "—"}
                          </td>
                          <td className="px-5 py-2.5 text-muted-foreground">{row.addedBy ?? "—"}</td>
                          <td className="px-5 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${row.title}`}
                                disabled={busy === row.id}
                                onClick={() => {
                                  setError(null);
                                  setEditing(row.id);
                                }}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${row.title}`}
                                disabled={busy === row.id}
                                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => send(row.id, `/api/evals/titles/${row.id}`, { method: "DELETE" })}
                              >
                                {busy === row.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5" />
                                )}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                          {count === 0 ? `No ${TITLE_LIST_LABELS[list]} titles yet.` : "No titles match."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t empty:hidden">
                <Pager page={page} noun="titles" prefix={list} />
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

function OrgLeaderField({
  current,
  orgLeaderEmail,
  busy,
  onSave,
}: {
  current: LeaderCandidate | null;
  orgLeaderEmail: string;
  busy: boolean;
  onSave: (email: string) => Promise<void>;
}) {
  const shown = current ? `${current.fullName} <${current.email}>` : orgLeaderEmail;
  const [query, setQuery] = useState(shown);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(orgLeaderEmail);
  const [matches, setMatches] = useState<LeaderCandidate[]>([]);

  // Ask the employee list, one page of it, rather than shipping everyone here.
  const q = query.trim();
  const searching = q.length > 0 && q !== shown && !selected;
  useEffect(() => {
    if (!searching) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/evals/employees?${new URLSearchParams({ q })}`, { signal: ctrl.signal });
        const body = res.ok ? await res.json() : null;
        setMatches(
          ((body?.people ?? []) as LeaderCandidate[]).map((e) => ({ email: e.email, fullName: e.fullName })),
        );
      } catch {
        // Aborted by the next keystroke, or offline: the list just stays as it was.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, searching]);

  const dirty = selected.toLowerCase() !== orgLeaderEmail.toLowerCase();

  function choose(e: LeaderCandidate) {
    setQuery(`${e.fullName} <${e.email}>`);
    setSelected(e.email);
    setOpen(false);
  }

  return (
    <div className="max-w-sm space-y-1.5">
      <label htmlFor="org-leader" className="text-sm font-medium">
        Organization Leader
      </label>
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <Input
            id="org-leader"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected("");
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            placeholder="Search employees by name or email"
            aria-label="Organization Leader"
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
        <Button
          variant="brand"
          disabled={!dirty || selected === "" || busy}
          onClick={() => onSave(selected)}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          Save
        </Button>
      </div>
    </div>
  );
}

function EditRow({
  row,
  list,
  busy,
  onSave,
  onCancel,
}: {
  row: ListedTitle;
  list: EvalsTitleList;
  busy: boolean;
  onSave: (values: { title: string; list: EvalsTitleList }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(row.title);
  const [target, setTarget] = useState<EvalsTitleList>(list);

  const valid = cleanTitle(title) !== "";

  function submit() {
    if (!valid || busy) return;
    onSave({ title, list: target });
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr className="border-b bg-muted/20 last:border-b-0">
      <td className="px-5 py-2">
        <Input
          autoFocus
          value={title}
          maxLength={EVALS_TITLE_LIMITS.title}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={keys}
        />
      </td>
      <td className="px-5 py-2" colSpan={2}>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          List
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as EvalsTitleList)}
            onKeyDown={keys}
            className={cn(
              "h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground shadow-xs outline-none",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
            )}
          >
            {EVALS_TITLE_LISTS.map((l) => (
              <option key={l} value={l}>
                {TITLE_LIST_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
      </td>
      <td className="px-5 py-2">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label="Save" disabled={!valid || busy} onClick={submit}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Cancel" disabled={busy} onClick={onCancel}>
            <X className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
