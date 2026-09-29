"use client";

/**
 * Bootcamp history: a row per person with their BTC and INT results, added
 * and edited in place. The old sheet can still be uploaded into it.
 */

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, ChevronRight, Loader2, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BOOTCAMP_HISTORY_LIMITS, EXEMPT_DATE } from "@/db/schema";
import type { HistoryProblem } from "@/lib/evals/bootcamp-history-file";
import { normalEmail } from "@/lib/evals/history-values";
import { riseChild, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatHistoryDate, formatScore } from "../format";

export type HistoryRow = {
  id: string;
  email: string;
  name: string | null;
  btcDate: string | null;
  intDate: string | null;
  btcScore: number | null;
  intScore: number | null;
  btcIndividualScores: Record<string, number> | null;
  intIndividualScores: Record<string, number> | null;
  updatedAt: string;
};

type Values = Pick<HistoryRow, "email" | "btcDate" | "intDate" | "btcScore" | "intScore">;

type Summary = {
  added: number;
  updated: number;
  problems: HistoryProblem[];
  ignoredColumns: string[];
};

const ERRORS: Record<string, string> = {
  no_file: "Choose a file first.",
  too_large: "That file is over 5 MB.",
  unreadable: "That isn't a readable .xlsx or .csv file.",
  empty: "That sheet is empty.",
  no_email_column: "The sheet needs an “email” column.",
  too_many_rows: "That sheet has more rows than can be imported at once.",
  invalid: "Check the email, dates and scores.",
  duplicate: "Someone with that email is already listed — edit their row instead.",
  not_found: "That row was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

const PROBLEMS_SHOWN = 20;

const NEW = "new";

const EMPTY: Values = { email: "", btcDate: null, intDate: null, btcScore: null, intScore: null };

export function AttendeeTrackingView({
  rows,
  employeesImported,
}: {
  rows: HistoryRow[];
  employeesImported: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.email.includes(q) || r.name?.toLowerCase().includes(q));
  }, [rows, query]);

  /** Sends one request; true when it worked, with any error shown otherwise. */
  async function send(key: string, url: string, init: RequestInit, failure: string): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `${failure} (${res.status}).`);
        return false;
      }
      if (key === "upload") setSummary(body);
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setSummary(null);
    const form = new FormData();
    form.set("file", file);
    await send("upload", "/api/evals/attendee-tracking/import", { method: "POST", body: form }, "Could not import");
    if (input.current) input.current.value = "";
  }

  async function save(id: string, values: Values) {
    const json = { headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) };
    const saved =
      id === NEW
        ? await send(id, "/api/evals/attendee-tracking", { method: "POST", ...json }, "Could not add")
        : await send(id, `/api/evals/attendee-tracking/${id}`, { method: "PATCH", ...json }, "Could not save");
    if (saved) setEditing(null);
  }

  async function remove(row: HistoryRow) {
    await send(row.id, `/api/evals/attendee-tracking/${row.id}`, { method: "DELETE" }, "Could not remove");
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Attendee tracking</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Who has been through bootcamp (BTC) and INT, and how they scored. This list is the record — add people
          and edit their results here. Someone with no BTC date is due for BTC; someone with BTC but no INT date is
          due for INT. Exempt people are marked with a date of 2000-01-01.
        </p>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search attendee history"
            className="pl-9"
          />
        </div>
        <Button
          variant="brand"
          disabled={editing === NEW}
          onClick={() => {
            setError(null);
            setEditing(NEW);
          }}
        >
          <Plus />
          Add person
        </Button>
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="w-10 px-3 py-2.5" />
                <th className="px-5 py-2.5 font-medium">Person · {rows.length}</th>
                <th className="px-5 py-2.5 font-medium">BTC date</th>
                <th className="px-5 py-2.5 font-medium">BTC score</th>
                <th className="px-5 py-2.5 font-medium">INT date</th>
                <th className="px-5 py-2.5 font-medium">INT score</th>
                <th className="w-24 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {editing === NEW && (
                <EditRow
                  values={EMPTY}
                  busy={busy === NEW}
                  onSave={(values) => save(NEW, values)}
                  onCancel={() => setEditing(null)}
                />
              )}
              {shown.map((row) => {
                if (editing === row.id) {
                  return (
                    <EditRow
                      key={row.id}
                      values={row}
                      busy={busy === row.id}
                      onSave={(values) => save(row.id, values)}
                      onCancel={() => setEditing(null)}
                    />
                  );
                }
                const expandable = row.btcIndividualScores !== null || row.intIndividualScores !== null;
                const expanded = open.has(row.id);
                return (
                  <Fragment key={row.id}>
                    <tr className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                      <td className="px-3 py-2">
                        {expandable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={expanded ? "Hide individual scores" : "Show individual scores"}
                            aria-expanded={expanded}
                            onClick={() => toggle(row.id)}
                          >
                            <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
                          </Button>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{row.name ?? row.email}</div>
                        {row.name ? (
                          <div className="text-xs text-muted-foreground">{row.email}</div>
                        ) : (
                          employeesImported && <div className="text-xs text-muted-foreground">Not in HiBob</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{formatHistoryDate(row.btcDate)}</td>
                      <td className="px-5 py-2.5 tabular-nums">{formatScore(row.btcScore)}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{formatHistoryDate(row.intDate)}</td>
                      <td className="px-5 py-2.5 tabular-nums">{formatScore(row.intScore)}</td>
                      <td className="px-5 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${row.email}`}
                            disabled={busy !== null}
                            className="text-muted-foreground"
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
                            aria-label={`Remove ${row.email}`}
                            disabled={busy !== null}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => remove(row)}
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
                    {expanded && (
                      <tr className="border-b bg-muted/20 last:border-b-0">
                        <td />
                        <td colSpan={6} className="px-5 py-3">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Scores label="BTC" scores={row.btcIndividualScores} />
                            <Scores label="INT" scores={row.intIndividualScores} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {shown.length === 0 && editing !== NEW && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                    {rows.length === 0 ? "No one yet — add a person, or upload the old sheet below." : "No one matches."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      <motion.div variants={riseChild}>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">Upload a sheet</p>
              <p className="text-muted-foreground">
                An .xlsx or .csv shaped like the old Bootcamp_History: an <code>email</code> column, and any of{" "}
                <code>BTCDate</code>, <code>INTDate</code>, <code>BTCScore</code>, <code>INTScore</code>,{" "}
                <code>BTCIndividualScores</code> and <code>INTIndividualScores</code>. Rows are matched by email and
                only the file&apos;s columns are written — a blank cell clears that value. People not in the file
                are left alone.
              </p>
            </div>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button variant="outline" disabled={busy !== null} onClick={() => input.current?.click()}>
              {busy === "upload" ? <Loader2 className="animate-spin" /> : <Upload />}
              {busy === "upload" ? "Importing…" : "Choose file"}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {summary && (
        <motion.div variants={riseChild} role="status" className="space-y-2 text-sm">
          <p>
            <span className="font-medium">
              {summary.added.toLocaleString()} added, {summary.updated.toLocaleString()} updated.
            </span>
            {summary.ignoredColumns.length > 0 && (
              <span className="text-muted-foreground"> Ignored columns: {summary.ignoredColumns.join(", ")}.</span>
            )}
          </p>
          {summary.problems.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <p className="font-medium">
                {summary.problems.length} row{summary.problems.length === 1 ? "" : "s"} needed attention:
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {summary.problems.slice(0, PROBLEMS_SHOWN).map((p) => (
                  <li key={`${p.row}:${p.message}`}>
                    Row {p.row}: {p.message}
                  </li>
                ))}
                {summary.problems.length > PROBLEMS_SHOWN && (
                  <li>…and {summary.problems.length - PROBLEMS_SHOWN} more.</li>
                )}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

/** A score box's text as a number, null when blank, or undefined when not a number. */
function readScore(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function EditRow({
  values,
  busy,
  onSave,
  onCancel,
}: {
  values: Values;
  busy: boolean;
  onSave: (values: Values) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(values.email);
  const [btcDate, setBtcDate] = useState(values.btcDate);
  const [intDate, setIntDate] = useState(values.intDate);
  const [btcScore, setBtcScore] = useState(values.btcScore?.toString() ?? "");
  const [intScore, setIntScore] = useState(values.intScore?.toString() ?? "");

  const btc = readScore(btcScore);
  const int = readScore(intScore);
  const valid = normalEmail(email) !== null && btc !== undefined && int !== undefined;

  function submit() {
    if (!valid || busy) return;
    onSave({ email, btcDate, intDate, btcScore: btc!, intScore: int! });
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr className="border-b bg-muted/20 align-top last:border-b-0">
      <td />
      <td className="px-3 py-2">
        <Input
          autoFocus
          type="email"
          value={email}
          maxLength={BOOTCAMP_HISTORY_LIMITS.email}
          placeholder="name@harness.io"
          aria-label="Email"
          className="min-w-56"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={keys}
        />
      </td>
      <td className="px-3 py-2">
        <DateField label="BTC" value={btcDate} onChange={setBtcDate} onKeyDown={keys} />
      </td>
      <td className="px-3 py-2">
        <ScoreField label="BTC" value={btcScore} invalid={btc === undefined} onChange={setBtcScore} onKeyDown={keys} />
      </td>
      <td className="px-3 py-2">
        <DateField label="INT" value={intDate} onChange={setIntDate} onKeyDown={keys} />
      </td>
      <td className="px-3 py-2">
        <ScoreField label="INT" value={intScore} invalid={int === undefined} onChange={setIntScore} onKeyDown={keys} />
      </td>
      <td className="px-3 py-2">
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

/** A date box with an Exempt switch, which stands for the 2000-01-01 marker. */
function DateField({
  label,
  value,
  onChange,
  onKeyDown,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const exempt = value === EXEMPT_DATE;
  return (
    <div className="space-y-1.5">
      <Input
        type="date"
        value={exempt ? "" : (value ?? "")}
        disabled={exempt}
        aria-label={`${label} date`}
        className="w-36"
        onChange={(e) => onChange(e.target.value || null)}
        onKeyDown={onKeyDown}
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={exempt}
          onChange={(e) => onChange(e.target.checked ? EXEMPT_DATE : null)}
          className="accent-primary"
        />
        Exempt
      </label>
    </div>
  );
}

function ScoreField({
  label,
  value,
  invalid,
  onChange,
  onKeyDown,
}: {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    <Input
      inputMode="decimal"
      value={value}
      aria-label={`${label} score`}
      aria-invalid={invalid}
      className="w-20"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

function Scores({ label, scores }: { label: string; scores: Record<string, number> | null }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      {scores && Object.keys(scores).length > 0 ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
          {Object.entries(scores).map(([name, value]) => (
            <Fragment key={name}>
              <dt className="text-muted-foreground">{name.replace(/^Score-/, "")}</dt>
              <dd className="tabular-nums">{formatScore(value)}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}
