"use client";

/**
 * The Automation tab: one search box to find or add a title, then a page of
 * each list's titles. The search goes to the URL, so the database does the
 * matching; see `components/data-table.tsx`.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, useListParams } from "@/components/data-table";
import { EmployeeMatches, useEmployeeSearch, type EmployeeCandidate } from "@/components/employee-picker";
import { useAnchoredToParent } from "@/components/use-anchored";
import { useDebouncedSearch } from "@/components/use-debounced-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFERRAL_DAYS_LIMITS, EVALS_TITLE_LIMITS, EVALS_TITLE_LISTS, type EvalsTitleList } from "@/db/schema";
import type { CandidateCutoffs } from "@/lib/evals/settings";
import { cleanTitle, TITLE_LIST_LABELS, TITLE_LIST_SLUGS } from "@/lib/evals/title-lists";
import type { TitleSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatDate } from "./format";

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

export type LeaderCandidate = EmployeeCandidate;

/** Who counts as a candidate on the Current tab, by HiBob's dates; see `getCandidateCutoffs`. */
const CUTOFF_FIELDS: { field: keyof CandidateCutoffs; label: string }[] = [
  { field: "startDateOnOrAfter", label: "Start date on or after" },
  { field: "activeEffectiveDateAfter", label: "Active effective date after" },
];

export function AutomationView({
  q: searched,
  lists,
  suggestions,
  imported,
  orgLeaderEmail,
  orgLeader,
  cutoffs,
  deferral,
}: {
  /** The search the lists were queried with. */
  q: string;
  lists: Record<EvalsTitleList, ListedTitles>;
  suggestions: { title: string; count: number }[];
  imported: boolean;
  orgLeaderEmail: string;
  /** The Organization Leader as the employee list has them, if it does. */
  orgLeader: LeaderCandidate | null;
  cutoffs: CandidateCutoffs;
  /** The deferral window in days, and the start of the bootcamp it counts back from, if one is coming. */
  deferral: { days: number; bootcampStart: string | null };
}) {
  const router = useRouter();
  const { set: setList, pending: searching } = useListParams();
  const [query, setQuery] = useDebouncedSearch(searched, (q) => setList({ q }));
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
  const suggestionsRef = useAnchoredToParent<HTMLDivElement>(searchOpen && q.length > 0 && shownSuggestions.length > 0);

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

      <motion.div variants={riseChild} className="flex flex-wrap gap-x-6 gap-y-4">
        {CUTOFF_FIELDS.map(({ field, label }) => (
          // Keyed on the saved day too, so a save starts the field afresh from it.
          <CutoffField
            key={`${field}:${cutoffs[field]}`}
            id={`cutoff-${field}`}
            label={label}
            value={cutoffs[field]}
            busy={busy === `cutoff:${field}`}
            onSave={async (value) => {
              const ok = await send(`cutoff:${field}`, "/api/evals/candidate-cutoffs", {
                method: "PUT",
                body: JSON.stringify({ [field]: value }),
              });
              if (ok) setNotice(`${label} ${value ? "saved" : "turned off"}.`);
            }}
          />
        ))}
        <DeferralField
          key={deferral.days}
          days={deferral.days}
          bootcampStart={deferral.bootcampStart}
          busy={busy === "deferral"}
          onSave={async (days) => {
            const body = await send("deferral", "/api/evals/deferral-days", {
              method: "PUT",
              body: JSON.stringify({ days }),
            });
            if (body) {
              const people = `${body.retracked} ${body.retracked === 1 ? "person" : "people"}`;
              setNotice(`${days ? `Deferral window set to ${days} days` : "Deferral turned off"}; ${people} retracked.`);
            }
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
            <div ref={suggestionsRef} className="absolute top-0 left-0 z-20 overflow-y-auto rounded-md border bg-popover shadow-md">
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

  const q = query.trim();
  const searching = q.length > 0 && q !== shown && !selected;
  const { matches } = useEmployeeSearch(q, searching);

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
          {open && searching && <EmployeeMatches matches={matches} onChoose={choose} />}
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

/** A day, or blank for no cutoff. */
function CutoffField({
  id,
  label,
  value,
  busy,
  onSave,
}: {
  id: string;
  label: string;
  value: string | null;
  busy: boolean;
  onSave: (value: string | null) => Promise<void>;
}) {
  const [day, setDay] = useState(value ?? "");
  const dirty = day !== (value ?? "");

  return (
    <div className="w-56 space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-start gap-2">
        <Input id={id} type="date" value={day} onChange={(e) => setDay(e.target.value)} className="flex-1" />
        <Button variant="brand" disabled={!dirty || busy} onClick={() => onSave(day || null)}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          Save
        </Button>
      </div>
    </div>
  );
}

/** Whole days before the next bootcamp; 0 turns deferral off. */
function DeferralField({
  days,
  bootcampStart,
  busy,
  onSave,
}: {
  days: number;
  bootcampStart: string | null;
  busy: boolean;
  onSave: (days: number) => Promise<void>;
}) {
  const [value, setValue] = useState(String(days));
  const parsed = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= DEFERRAL_DAYS_LIMITS.min &&
    parsed <= DEFERRAL_DAYS_LIMITS.max;
  const dirty = valid && parsed !== days;

  return (
    <div className="w-56 space-y-1.5">
      <label htmlFor="deferral-days" className="text-sm font-medium">
        Defer if started within (days)
      </label>
      <div className="flex items-start gap-2">
        <Input
          id="deferral-days"
          type="number"
          inputMode="numeric"
          min={DEFERRAL_DAYS_LIMITS.min}
          max={DEFERRAL_DAYS_LIMITS.max}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!valid}
          aria-describedby="deferral-days-next"
          className="flex-1"
        />
        <Button variant="brand" disabled={!dirty || busy} onClick={() => onSave(parsed)}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          Save
        </Button>
      </div>
      <p id="deferral-days-next" className="text-xs text-muted-foreground">
        {days <= 0 ? "Off" : bootcampStart ? `Of the bootcamp on ${formatDate(bootcampStart)}` : "No bootcamp coming"}
      </p>
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
