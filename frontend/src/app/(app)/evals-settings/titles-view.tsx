"use client";

/** One title list: paste to add, edit or move in place, and the org's unlisted titles to pick from. */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EVALS_TITLE_LIMITS, EVALS_TITLE_LISTS, type EvalsTitleList } from "@/db/schema";
import { cleanTitle, splitTitles, TITLE_LIST_LABELS } from "@/lib/evals/title-lists";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type ListedTitle = {
  id: string;
  title: string;
  addedBy: string | null;
  /** How many people in the org hold it. */
  holders: number;
};

const INTRO: Record<EvalsTitleList, { heading: string; body: string }> = {
  sales: {
    heading: "Automatic Sales Titles",
    body: "Someone in the org with one of these titles is scheduled as Sales.",
  },
  engineer: {
    heading: "Automatic Engineer Titles",
    body: "Someone in the org with one of these titles is scheduled as an Engineer.",
  },
  ignored: {
    heading: "Ignored Titles",
    body: "Someone with one of these titles is left off the BTC and INT rosters altogether.",
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

export function TitlesView({
  list,
  titles,
  suggestions,
  imported,
}: {
  list: EvalsTitleList;
  titles: ListedTitle[];
  suggestions: { title: string; count: number }[];
  imported: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const label = TITLE_LIST_LABELS[list];
  const pasted = splitTitles(text);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => titles.filter((t) => t.title.toLowerCase().includes(q)), [titles, q]);
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

  async function add(key: string, titlesToAdd: string[]) {
    const body = await send(key, "/api/evals/titles", {
      method: "POST",
      body: JSON.stringify({ list, titles: titlesToAdd }),
    });
    if (!body) return false;
    const added: string[] = body.added ?? [];
    const existing: { title: string; list: EvalsTitleList }[] = body.existing ?? [];
    const parts = [];
    if (added.length > 0) parts.push(`Added ${added.length === 1 ? `“${added[0]}”` : `${added.length} titles`}.`);
    if (existing.length > 0) parts.push(`Already listed, so left as they were: ${describeExisting(existing)}.`);
    setNotice(parts.join(" ") || null);
    return true;
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">{INTRO[list].heading}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {INTRO[list].body} Titles match whatever their case, and a title sits on one list at most.
        </p>
      </motion.div>

      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="space-y-3 py-5">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Add titles</span>
              <textarea
                value={text}
                rows={3}
                placeholder={"One per line — paste a column straight from the sheet"}
                onChange={(e) => setText(e.target.value)}
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {pasted.length > EVALS_TITLE_LIMITS.perRequest
                  ? `At most ${EVALS_TITLE_LIMITS.perRequest} at a time.`
                  : pasted.length > 0
                    ? `${pasted.length} title${pasted.length === 1 ? "" : "s"}`
                    : null}
              </p>
              <Button
                variant="brand"
                disabled={pasted.length === 0 || pasted.length > EVALS_TITLE_LIMITS.perRequest || busy !== null}
                onClick={async () => {
                  if (await add("paste", pasted)) setText("");
                }}
              >
                {busy === "paste" ? <Loader2 className="animate-spin" /> : <Plus />}
                Add to {label}
              </Button>
            </div>
          </CardContent>
        </Card>
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

      <motion.div variants={riseChild} className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles"
          aria-label="Search titles"
          className="pl-9"
        />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Title · {titles.length}</th>
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
                    {titles.length === 0 ? `No ${label} titles yet.` : "No titles match."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {shownSuggestions.length > 0 && (
        <motion.div variants={riseChild} className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Titles in the org on no list</h3>
            <p className="text-xs text-muted-foreground">
              People with these titles get no role automatically. Most common first.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {shownSuggestions.map((s) => (
              <button
                key={s.title}
                type="button"
                disabled={busy !== null}
                onClick={() => add(`suggest:${s.title}`, [s.title])}
                className="group inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs transition-colors hover:border-foreground/30 disabled:opacity-50"
                title={`Add “${s.title}” to ${label}`}
              >
                {busy === `suggest:${s.title}` ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Plus className="size-3 text-muted-foreground group-hover:text-foreground" />
                )}
                {s.title}
                <span className="tabular-nums text-muted-foreground">{s.count}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
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
