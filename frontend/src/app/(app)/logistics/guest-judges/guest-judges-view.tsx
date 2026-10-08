"use client";

/**
 * Guest judges: everyone who has judged a cohort, a row for each cohort with
 * the sessions they ran on it, from the Scheduler or from the guest speaker
 * history kept here; then the sales and sales engineering leaders HiBob has
 * who have done neither. Judges are grouped by cohort, newest first, with a
 * space for each upcoming cohort set aside before anyone is down for it.
 * Each section folds away, and opens of itself for a search. Training
 * administrators add to and remove from the history and its cohorts.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarPlus, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { EmployeeMatches, useEmployeeSearch } from "@/components/employee-picker";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GUEST_SPEAKER_PROGRAMS, GUEST_SPEAKER_ROLES, type GuestSpeakerProgram, type GuestSpeakerRole } from "@/db/schema";
import type { GuestJudgeSort, JudgeProspectSort } from "@/lib/list-specs";
import {
  GUEST_JUDGE_DEPARTMENTS,
  GUEST_SPEAKER_LIMITS,
  PROGRAM_LABELS,
  groupByCohort,
  PROSPECTS,
  ROLE_LABELS,
} from "@/lib/logistics/guest-judge-values";
import type { GuestJudgeCounts, GuestJudgeRow, JudgedSession, JudgeProspectRow } from "@/lib/logistics/guest-judges";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { TRACK_LABELS, formatClock } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatDate, formatWhen } from "../../cohort-settings/format";

const SELECT = cn(
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50",
);

const roleLabel = (role: NonNullable<JudgedSession["role"]>) => (role === "lead" ? "lead" : ROLE_LABELS[role].toLowerCase());

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A history cohort, kept as the first of its month, as "June 2026". */
const formatMonth = (day: string) => MONTH.format(new Date(`${day}T00:00:00Z`));

const departments = new Intl.ListFormat("en-US", { type: "conjunction" }).format(GUEST_JUDGE_DEPARTMENTS);

export function GuestJudgesView({
  judgeQuery,
  judges,
  prospectQuery,
  prospects,
  counts,
  emptyCohorts,
  syncedAt,
  canEdit,
}: {
  judgeQuery: ListQuery<GuestJudgeSort>;
  judges: Page<GuestJudgeRow>;
  prospectQuery: ListQuery<JudgeProspectSort>;
  prospects: Page<JudgeProspectRow>;
  counts: GuestJudgeCounts;
  /** Months set aside for a cohort with no one in them yet, `YYYY-MM-01`. */
  emptyCohorts: string[];
  syncedAt: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  /** The month the add dialog opens on, `YYYY-MM`, or null while it is closed; "" for none chosen. */
  const [adding, setAdding] = useState<string | null>(null);
  const [addingCohort, setAddingCohort] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const judgeSort = { sort: judgeQuery.sort, dir: judgeQuery.dir };
  const prospectSort = { sort: prospectQuery.sort, dir: prospectQuery.dir, prefix: PROSPECTS };
  // A search, a sort or a page turn means someone is looking: show what they asked for.
  const judgesAsked = judgeQuery.q !== "" || judgeQuery.page > 1 || judgeQuery.sort !== "cohort";
  const prospectsAsked = prospectQuery.q !== "" || prospectQuery.page > 1 || prospectQuery.sort !== "name";

  const groups = groupByCohort(judges.rows, emptyCohorts, {
    first: judges.page === 1,
    last: !judges.hasMore,
    newestFirst: !(judgeQuery.sort === "cohort" && judgeQuery.dir === "asc"),
    searching: judgeQuery.q !== "",
  });
  const columns = canEdit ? 3 : 2;

  async function removeCohort(month: string) {
    if (!window.confirm(`Take ${formatMonth(month)} off the list of cohorts?`)) return;
    setBusy(month);
    setError(null);
    try {
      const res = await fetch(`/api/logistics/guest-speakers/cohorts?${new URLSearchParams({ cohort: month })}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) setError(`Could not remove it (${res.status}).`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(j: GuestJudgeRow) {
    if (!j.person || !window.confirm(`Remove ${j.fullName} from ${formatMonth(j.cohort)}?`)) return;
    setBusy(j.id);
    setError(null);
    try {
      const res = await fetch(`/api/logistics/guest-speakers?${new URLSearchParams({ cohort: j.cohort, person: j.person })}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) setError(`Could not remove them (${res.status}).`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <TableSearch
          value={judgeQuery.q}
          placeholder="Search by name, email, title, session or location"
          label="Search guest judges"
          className="min-w-56 flex-1"
        />
        {canEdit && (
          <>
            <Button variant="outline" onClick={() => setAddingCohort(true)}>
              <CalendarPlus />
              Add cohort
            </Button>
            <Button variant="brand" onClick={() => setAdding("")}>
              <Plus />
              Add guest speaker
            </Button>
          </>
        )}
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <Section
        title="Guest judges"
        summary={
          <>
            <span className="font-medium text-foreground">{counts.judges.toLocaleString()}</span>{" "}
            {counts.judges === 1 ? "person has" : "people have"} judged across {counts.cohorts.toLocaleString()}{" "}
            {counts.cohorts === 1 ? "cohort" : "cohorts"}
          </>
        }
        openFor={judgesAsked}
      >
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className={HEADER_ROW}>
              <SortHeader column="name" {...judgeSort}>
                Judge
              </SortHeader>
              <SortHeader column="sessions" {...judgeSort}>
                Sessions
              </SortHeader>
              {canEdit && <PlainHeader className="w-14" />}
            </tr>
          </thead>
          {groups.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={columns} className="px-5 py-8 text-center text-muted-foreground">
                  {judgeQuery.q ? "No guest judge matches that search." : "No one has been a guest judge yet."}
                </td>
              </tr>
            </tbody>
          )}
          {groups.map((g) => {
            const bootcamps = [...new Map(g.rows.filter((j) => j.bootcampId).map((j) => [j.bootcampId!, j])).values()];
            return (
              <tbody key={g.month} className="border-b last:border-b-0">
                <tr className="bg-muted/40">
                  <th colSpan={columns} scope="rowgroup" className="px-5 py-2 text-left font-normal">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{formatMonth(g.month)} cohort</span>
                      <span className="text-xs text-muted-foreground">
                        {g.rows.length === 0 ? "No one yet" : `${g.rows.length} ${g.rows.length === 1 ? "person" : "people"}`}
                      </span>
                      {bootcamps.map((b) => (
                        <Link key={b.bootcampId} href={`/scheduler/${b.bootcampId}`} className="text-xs text-brand hover:underline">
                          Bootcamp of {formatDate(b.cohort)} in the Scheduler
                          {b.status && b.status !== "complete" && (
                            <Badge variant="outline" className="ml-1.5 capitalize">
                              {b.status}
                            </Badge>
                          )}
                        </Link>
                      ))}
                      {canEdit && (
                        <span className="ml-auto flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setAdding(g.month.slice(0, 7))}>
                            <Plus />
                            Add
                          </Button>
                          {g.rows.length === 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Take ${formatMonth(g.month)} off the list`}
                              disabled={busy === g.month}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeCohort(g.month)}
                            >
                              {busy === g.month ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            </Button>
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                </tr>
                {g.rows.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="px-5 py-6 text-center text-sm text-muted-foreground">
                      {canEdit ? "No guest speakers yet. Add them as they confirm." : "No guest speakers yet."}
                    </td>
                  </tr>
                )}
                {g.rows.map((j) => (
                  <tr key={j.id} className="border-t align-top">
                    <td className="px-5 py-3">
                      <span className="font-medium">{j.fullName}</span>
                      <span className="block text-xs text-muted-foreground">{j.title ?? "Not in HiBob"}</span>
                    </td>
                    <td className="px-5 py-3">
                      {j.sessions.every((s) => !s.name) ? (
                        <span className="text-muted-foreground">On no session</span>
                      ) : (
                        <ul className="space-y-1">
                          {j.sessions
                            .filter((s) => s.name)
                            .map((s, i) => (
                              <li key={i}>
                                {s.name}
                                {s.role && <span className="text-muted-foreground"> ({roleLabel(s.role)})</span>}
                                <span className="block text-xs text-muted-foreground">
                                  {TRACK_LABELS[s.track]}
                                  {s.day !== null && `, Day ${s.day}`}
                                  {s.start !== null && `, ${formatClock(s.start)}`}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        {j.source === "history" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${j.fullName} from ${formatMonth(j.cohort)}`}
                            disabled={busy === j.id}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => remove(j)}
                          >
                            {busy === j.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          </Button>
                        ) : (
                          <span className="sr-only">Change in the Scheduler</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
        <div className="border-t empty:hidden">
          <Pager page={judges} noun="judges" />
        </div>
      </Section>

      <Section
        title="Leaders who have not judged"
        summary={
          <>
            <span className="font-medium text-foreground">{counts.prospects.toLocaleString()}</span> with direct
            reports in {departments}
            {syncedAt ? <>, as of the HiBob sync on {formatWhen(syncedAt)}</> : <>; HiBob has not been synced yet</>}
          </>
        }
        openFor={prospectsAsked}
      >
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className={HEADER_ROW}>
              <SortHeader column="name" {...prospectSort}>
                Name
              </SortHeader>
              <PlainHeader>Title</PlainHeader>
              <SortHeader column="department" {...prospectSort}>
                Department
              </SortHeader>
              <SortHeader column="location" {...prospectSort}>
                Location
              </SortHeader>
              <PlainHeader>Reports to</PlainHeader>
            </tr>
          </thead>
          <tbody>
            {prospects.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                  {prospectQuery.q ? "No leader matches that search." : "Every leader has judged."}
                </td>
              </tr>
            )}
            {prospects.rows.map((p) => (
              <tr key={p.email} className="border-b last:border-b-0">
                <td className="px-5 py-3">
                  <span className="font-medium">{p.fullName}</span>
                  <span className="block text-xs text-muted-foreground">{p.email}</span>
                </td>
                <td className="px-5 py-3">{p.title || "—"}</td>
                <td className="px-5 py-3">{p.department}</td>
                <td className="px-5 py-3">
                  {p.location || p.site || "—"}
                  {p.location && p.site && <span className="block text-xs text-muted-foreground">{p.site}</span>}
                </td>
                <td className="px-5 py-3 text-muted-foreground">{p.reportsToName || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t empty:hidden">
          <Pager page={prospects} noun="leaders" prefix={PROSPECTS} />
        </div>
      </Section>

      {canEdit && (
        <>
          <AddGuestSpeakerDialog month={adding} onClose={() => setAdding(null)} />
          <AddCohortDialog open={addingCohort} onClose={() => setAddingCohort(false)} />
        </>
      )}
    </motion.div>
  );
}

/**
 * A heading that folds its table away. Closed to start with, so the two
 * sections read as a summary; open whenever `openFor` says someone searched,
 * sorted or paged it.
 */
function Section({
  title,
  summary,
  openFor,
  children,
}: {
  title: string;
  summary: React.ReactNode;
  openFor: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(openFor);
  const [was, setWas] = useState(openFor);
  if (openFor !== was) {
    setWas(openFor);
    if (openFor) setOpen(true);
  }

  return (
    <motion.section variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/30"
      >
        <ChevronRight className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="space-y-1">
          <span className="block text-lg font-medium tracking-tight">{title}</span>
          <span className="block text-sm text-muted-foreground">{summary}</span>
        </span>
      </button>
      {open && <div className="overflow-x-auto border-t">{children}</div>}
    </motion.section>
  );
}

/** Adds someone to the history: found in the employee list, or any name typed in for someone who is not. */
function AddGuestSpeakerDialog({ month, onClose }: { month: string | null; onClose: () => void }) {
  const open = month !== null;
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [cohort, setCohort] = useState("");
  const [program, setProgram] = useState<GuestSpeakerProgram>("bootcamp");
  const [session, setSession] = useState("");
  const [role, setRole] = useState<GuestSpeakerRole>("judge");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { matches, clear } = useEmployeeSearch(name.trim(), focused && !email && name.trim().length > 1);

  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) {
      setName("");
      setEmail(null);
      setCohort(month ?? "");
      setSession("");
      setError(null);
    }
  }

  async function save() {
    if (!name.trim() || !cohort) return setError("Give their name and the cohort's month.");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/guest-speakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, program, session, role, fullName: name.trim(), email }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) return setError(out?.error === "invalid" ? "Check the name and the month." : `Could not add them (${res.status}).`);
      if (!out?.added) return setError("They are already down for that session at that cohort.");
      onClose();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add guest speaker</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="speaker-name" className="text-sm font-medium">
              Name
            </label>
            <div className="relative">
              <Input
                id="speaker-name"
                value={name}
                autoComplete="off"
                autoFocus
                maxLength={GUEST_SPEAKER_LIMITS.name}
                placeholder="Find them in HiBob, or type any name"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) => {
                  setName(e.target.value);
                  setEmail(null);
                }}
              />
              {focused && (
                <EmployeeMatches
                  matches={matches}
                  onChoose={(e) => {
                    setName(e.fullName);
                    setEmail(e.email);
                    clear();
                  }}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {email ?? "Not matched to HiBob: they are kept by name, and stay on the leaders list if they are on it."}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="speaker-cohort" className="text-sm font-medium">
                Cohort
              </label>
              <Input id="speaker-cohort" type="month" value={cohort} onChange={(e) => setCohort(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="speaker-program" className="text-sm font-medium">
                Program
              </label>
              <select
                id="speaker-program"
                value={program}
                onChange={(e) => setProgram(e.target.value as GuestSpeakerProgram)}
                className={SELECT}
              >
                {GUEST_SPEAKER_PROGRAMS.map((p) => (
                  <option key={p} value={p}>
                    {PROGRAM_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="speaker-session" className="text-sm font-medium">
                Session
              </label>
              <Input
                id="speaker-session"
                value={session}
                maxLength={GUEST_SPEAKER_LIMITS.session}
                placeholder="TSQ"
                onChange={(e) => setSession(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="speaker-role" className="text-sm font-medium">
                Role
              </label>
              <select id="speaker-role" value={role} onChange={(e) => setRole(e.target.value as GuestSpeakerRole)} className={SELECT}>
                {GUEST_SPEAKER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
              Add guest speaker
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Sets a month aside for a cohort, a space to fill in as guest speakers confirm. */
function AddCohortDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [cohort, setCohort] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) {
      setCohort("");
      setError(null);
    }
  }

  async function save() {
    if (!cohort) return setError("Choose the cohort's month.");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/logistics/guest-speakers/cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort }),
      });
      if (!res.ok) return setError(`Could not add it (${res.status}).`);
      onClose();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add cohort</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="cohort-month" className="text-sm font-medium">
              Month
            </label>
            <Input id="cohort-month" type="month" value={cohort} autoFocus onChange={(e) => setCohort(e.target.value)} />
          </div>
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
              Add cohort
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
