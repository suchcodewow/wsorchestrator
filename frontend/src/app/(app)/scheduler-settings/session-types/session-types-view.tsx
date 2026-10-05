"use client";

/**
 * The session types: quick starts that fill in a new session's kind, name,
 * icon, color, length and description. A page at a time, with the dialog
 * that adds or changes one.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  HEADER_ROW,
  LINK_ROW,
  Pager,
  PlainHeader,
  SortHeader,
  TableSearch,
  useRowLink,
} from "@/components/data-table";
import { SessionLookFields, type SessionLook } from "@/components/session-look-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SessionTypeSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { SESSION_STYLES } from "@/lib/scheduler/session-style";
import type { SessionTypeRow } from "@/lib/scheduler/session-types";
import { KIND_LABELS, formatLength } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  invalid: "Give it a name, and a length in whole quarter hours.",
  duplicate: "Another session type has that name.",
  too_many: "There are as many session types as there can be. Remove one first.",
  not_found: "That session type was removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

const BLANK: SessionLook = { kind: "main", name: "", emoji: "", color: "slate", minutes: 60, description: "" };

export function SessionTypesView({ query, page }: { query: ListQuery<SessionTypeSort>; page: Page<SessionTypeRow> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SessionTypeRow | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rowLink = useRowLink();
  const [error, setError] = useState<string | null>(null);
  const sortProps = { sort: query.sort, dir: query.dir };

  async function remove(t: SessionTypeRow) {
    if (!window.confirm(`Remove the ${t.name} session type? Sessions started from it keep what they took from it.`)) return;
    setBusy(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/scheduler/session-types/${t.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) setError(`Could not remove it (${res.status}).`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function move(t: SessionTypeRow, by: -1 | 1) {
    const i = page.rows.findIndex((r) => r.id === t.id);
    const other = page.rows[i + by];
    if (!other) return;
    setBusy(t.id);
    setError(null);
    try {
      // Swap the two; when they share a position, step this one past the other instead.
      const writes: [string, number][] =
        other.position === t.position
          ? [[t.id, Math.max(0, t.position + by)]]
          : [
              [t.id, other.position],
              [other.id, t.position],
            ];
      for (const [id, position] of writes) {
        const res = await fetch(`/api/scheduler/session-types/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position }),
        });
        if (!res.ok) {
          setError(`Could not reorder (${res.status}).`);
          break;
        }
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const ordered = query.sort === "position" && !query.q;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-medium tracking-tight">Session types</h2>
        <Button variant="brand" onClick={() => setEditing("new")}>
          <Plus />
          Add session type
        </Button>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by name or description" label="Search session types" />
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="position" {...sortProps}>
                  Order
                </SortHeader>
                <SortHeader column="name" {...sortProps}>
                  Name
                </SortHeader>
                <SortHeader column="kind" {...sortProps}>
                  Kind
                </SortHeader>
                <SortHeader column="minutes" {...sortProps}>
                  Length
                </SortHeader>
                <PlainHeader>Description</PlainHeader>
                <PlainHeader className="w-24" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No session types match that search." : "No session types yet."}
                  </td>
                </tr>
              )}
              {page.rows.map((t, i) => (
                <tr key={t.id} className={LINK_ROW} onClick={rowLink(() => setEditing(t))}>
                  <td className="px-5 py-2">
                    {ordered ? (
                      <div className="flex">
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${t.name} up`} disabled={i === 0 || busy !== null} onClick={() => move(t, -1)}>
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Move ${t.name} down`}
                          disabled={i === page.rows.length - 1 || busy !== null}
                          onClick={() => move(t, 1)}
                        >
                          ↓
                        </Button>
                      </div>
                    ) : (
                      <span className="tabular-nums text-muted-foreground">{t.position + 1}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("inline-flex items-center gap-2 rounded-md border border-l-4 px-2 py-0.5 font-medium", SESSION_STYLES[t.color].card)}>
                      {t.emoji && <span aria-hidden>{t.emoji}</span>}
                      {t.name}
                    </span>
                  </td>
                  <td className="px-5 py-3">{KIND_LABELS[t.kind]}</td>
                  <td className="px-5 py-3 tabular-nums">{formatLength(t.minutes)}</td>
                  <td className="max-w-80 truncate px-5 py-3 text-muted-foreground">{t.description || "—"}</td>
                  <td className="px-5 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} disabled={busy === t.id} onClick={() => setEditing(t)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${t.name}`}
                        disabled={busy === t.id}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remove(t)}
                      >
                        {busy === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="session types" />
        </div>
      </motion.div>

      <SessionTypeDialog editing={editing} onClose={() => setEditing(null)} />
    </motion.div>
  );
}

function SessionTypeDialog({ editing, onClose }: { editing: SessionTypeRow | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const existing = editing && editing !== "new" ? editing : null;
  const [look, setLook] = useState<SessionLook>(BLANK);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [was, setWas] = useState(editing);
  if (editing !== was) {
    setWas(editing);
    if (editing) {
      setLook(existing ? { ...existing } : BLANK);
      setError(null);
    }
  }

  async function save() {
    if (!look.name.trim()) return setError("Give it a name.");
    setPending(true);
    setError(null);
    try {
      const { kind, name, emoji, color, minutes, description } = look;
      const res = await fetch(existing ? `/api/scheduler/session-types/${existing.id}` : "/api/scheduler/session-types", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: name.trim(), emoji: emoji.trim(), color, minutes, description }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) return setError(ERRORS[out?.error ?? ""] ?? `Could not save (${res.status}).`);
      onClose();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : "Add session type"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-5"
        >
          <SessionLookFields id="type" value={look} onChange={setLook} autoFocus />
          {existing && <p className="text-xs text-muted-foreground">Sessions already started from it keep what they have.</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {existing ? "Save" : "Add session type"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
