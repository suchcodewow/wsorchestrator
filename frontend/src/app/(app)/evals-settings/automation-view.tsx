"use client";

/** The Automation tab: one search box to find or add a title, then each list's titles. */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVALS_TITLE_LIMITS, EVALS_TITLE_LISTS, type EvalsTitleList } from "@/db/schema";
import { cleanTitle, TITLE_LIST_LABELS, TITLE_LIST_SLUGS } from "@/lib/evals/title-lists";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type ListedTitle = {
  id: string;
  title: string;
  addedBy: string | null;
  /** How many people in the org hold it. */
  holders: number;
};

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
};

function describeExisting(existing: { title: string; list: EvalsTitleList }[]) {
  return existing.map((e) => `${e.title} (${TITLE_LIST_LABELS[e.list]})`).join(", ");
}

export function AutomationView({
  titles,
  suggestions,
  imported,
}: {
  titles: Record<EvalsTitleList, ListedTitle[]>;
  suggestions: { title: string; count: number }[];
  imported: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
            className="pl-9"
          />
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
        const listTitles = titles[list];
        const shown = listTitles.filter((t) => t.title.toLowerCase().includes(q));
        return (
          <motion.div key={list} id={TITLE_LIST_SLUGS[list]} variants={riseChild} className="space-y-3">
            <h3 className="text-lg font-medium tracking-tight">{INTRO[list].heading}</h3>

            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-160 text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-2.5 font-medium">Title · {listTitles.length}</th>
                      <th className="px-5 py-2.5 font-medium">In the org</th>
                      <th className="px-5 py-2.5 font-medium">Added by</th>
                      <th className="w-24 px-5 py-2.5" />
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
                          {listTitles.length === 0
                            ? `No ${TITLE_LIST_LABELS[list]} titles yet.`
                            : "No titles match."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
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
