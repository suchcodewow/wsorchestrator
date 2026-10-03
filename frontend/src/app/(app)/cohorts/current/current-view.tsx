"use client";

/**
 * The candidates in one table, under two rows of counters: one by stage
 * (bootcamp or intermediate) and one by track. A counter narrows the table to
 * its stage or track, at most one from each row, and counts within whatever
 * the other row has picked. An administrator sets anyone's track from the
 * Track column, and it holds through every sync until they hand it back to
 * the rules.
 */

import { HEADER_ROW, Pager, SortHeader, TableSearch } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  CandidateStage,
  CandidateTrack,
  CurrentCohortCounts,
  CurrentCohortFilter,
  CurrentCohortMember,
} from "@/lib/evals/current-cohort";
import type { CandidateCutoffs } from "@/lib/evals/settings";
import type { SetTrackResult, TrackChoice } from "@/lib/evals/tracks";
import type { CurrentCohortSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import type { ActiveBootcamp } from "@/lib/scheduler/bootcamps";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  ChevronDown,
  CircleHelp,
  Clock,
  Code,
  GraduationCap,
  Handshake,
  Loader2,
  Pin,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDate, formatWhen } from "../../cohort-settings/format";

const STAGE_COUNTERS: { stage: CandidateStage; label: string; Icon: LucideIcon }[] = [
  { stage: "bootcamp", label: "Bootcamp", Icon: Users },
  { stage: "intermediate", label: "Intermediate", Icon: GraduationCap },
];

const TRACK_COUNTERS: { track: CandidateTrack; label: string; Icon: LucideIcon }[] = [
  { track: "sales", label: "Sales", Icon: Handshake },
  { track: "engineer", label: "Engineer", Icon: Code },
  { track: "undecided", label: "Undecided", Icon: CircleHelp },
  { track: "deferred", label: "Deferred", Icon: Clock },
];

const COLUMNS: { column: CurrentCohortSort; label: string }[] = [
  { column: "fullName", label: "Name" },
  { column: "email", label: "Email" },
  { column: "title", label: "Title" },
  { column: "track", label: "Track" },
  { column: "btcDate", label: "BTC date" },
];

/**
 * The tracks an administrator can give someone, each with the hint under it;
 * a list choice moves everyone with the title, so its hint says whose. No one
 * is set to Undecided by hand; "Let the rules decide" is the way back to it.
 */
const TRACK_OPTIONS: { choice: Exclude<TrackChoice, "automatic" | "undecided">; label: string; hint: (title?: string) => string | undefined }[] = [
  { choice: "sales", label: "Sales", hint: (t) => t && `All “${t}” will be automatically added to the Sales track` },
  { choice: "engineer", label: "Engineer", hint: (t) => t && `All “${t}” will be automatically added to the Engineer track` },
  { choice: "deferred", label: "Deferred", hint: () => "This person will be deferred until the next session" },
  { choice: "ignored", label: "Ignored", hint: (t) => t && `All “${t}” will be ignored going forward` },
  { choice: "exempt", label: "Exempt", hint: () => "Exempt this one person from Bootcamp" },
];

const CHOICE_LABELS: Record<Exclude<TrackChoice, "automatic">, string> = {
  ...(Object.fromEntries(TRACK_OPTIONS.map((o) => [o.choice, o.label])) as Record<(typeof TRACK_OPTIONS)[number]["choice"], string>),
  undecided: "Undecided",
};

const ERRORS: Record<string, string> = {
  not_found: "That person is no longer in the org — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

/** undo is null when the change moved a title between lists, which Undo can't put back; the Automation tab can. */
type Change = { member: CurrentCohortMember; undo: TrackChoice | null; message: string };

/** Picks a stage or a track, or clears it when it is the one already picked; back to page 1 either way. */
function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle(name: "stage" | "track", value: string) {
    const next = new URLSearchParams(params.toString());
    if (next.get(name) === value) next.delete(name);
    else next.set(name, value);
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { toggle, pending };
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((a, b) => a + b, 0);
}

export function CurrentCohortView({
  query,
  filter,
  page,
  counts,
  syncedAt,
  cutoffs,
  deferral,
  activeBootcamp,
  canSetTrack,
}: {
  query: ListQuery<CurrentCohortSort>;
  filter: CurrentCohortFilter;
  page: Page<CurrentCohortMember>;
  /** Everyone in each stage on each track, whatever the search or filter. */
  counts: CurrentCohortCounts;
  syncedAt: string | null;
  cutoffs: CandidateCutoffs;
  deferral: { days: number; bootcampStart: string | null };
  activeBootcamp: ActiveBootcamp | null;
  /** Whether the viewer may set anyone's track. */
  canSetTrack: boolean;
}) {
  const router = useRouter();
  const { toggle, pending } = useFilterParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<Change | null>(null);

  const total = sum(counts.bootcamp) + sum(counts.intermediate);
  // Each row counts within the other row's pick.
  const stageCount = (stage: CandidateStage) => (filter.track ? counts[stage][filter.track] : sum(counts[stage]));
  const trackCount = (track: CandidateTrack) =>
    filter.stage ? counts[filter.stage][track] : counts.bootcamp[track] + counts.intermediate[track];

  const deferralNote =
    deferral.days <= 0
      ? "Deferral is off on Cohort Settings → Automation"
      : deferral.bootcampStart
        ? `Started fewer than ${deferral.days} days before the bootcamp on ${formatDate(deferral.bootcampStart)}`
        : "No bootcamp is coming, so no one is deferred";

  async function setTrack(member: CurrentCohortMember, choice: TrackChoice, undoing = false) {
    setBusy(member.email);
    setError(null);
    try {
      const res = await fetch("/api/cohorts/current/track", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: member.email, track: choice }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return;
      }
      if (undoing) {
        setChange(null);
      } else {
        const result = body as SetTrackResult;
        const now = (result.track ?? "undecided") as Exclude<TrackChoice, "automatic">;
        const leaves = now === "ignored" || now === "exempt";
        const moved = result.title;
        const others = result.retracked - (now === member.track ? 0 : 1);
        setChange({
          member,
          undo: moved ? null : member.overridden ? member.track : "automatic",
          message:
            choice === "automatic"
              ? `${member.fullName} is back on the rules: ${CHOICE_LABELS[now]}.`
              : `${member.fullName} is now ${CHOICE_LABELS[now]}${leaves ? ", so they leave this tab" : ""}.` +
                (moved
                  ? ` “${moved.title}” is on the ${CHOICE_LABELS[moved.list]} titles now` +
                    (moved.from ? `, moved from ${CHOICE_LABELS[moved.from]}` : "") +
                    (others > 0 ? `, which moved ${others} more ${others === 1 ? "person" : "people"}.` : ".")
                  : ""),
        });
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="space-y-1.5">
        <h2 className="text-xl font-medium tracking-tight">Current</h2>
        {syncedAt && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{total.toLocaleString()} people</span> still to train, as of the HiBob
            sync on {formatWhen(syncedAt)}
            {cutoffs.startDateOnOrAfter && <>, started on or after {formatDate(cutoffs.startDateOnOrAfter)}</>}
            {cutoffs.activeEffectiveDateAfter && (
              <>
                {cutoffs.startDateOnOrAfter ? " and" : ","} in their position since after{" "}
                {formatDate(cutoffs.activeEffectiveDateAfter)}
              </>
            )}
            .
          </p>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          {activeBootcamp ? (
            <>
              Active bootcamp: <span className="font-medium text-foreground">{formatDate(activeBootcamp.startDate)}</span>,{" "}
              {activeBootcamp.btcDays} days
              {activeBootcamp.intDays !== null && `, with ${activeBootcamp.intDays} days of intermediate`}.
            </>
          ) : (
            <>
              No bootcamp is active.{" "}
              <Link href="/scheduler" className="underline underline-offset-2 hover:text-foreground">
                Scheduler
              </Link>
            </>
          )}
        </p>
      </motion.div>

      <motion.div variants={riseChild} role="group" aria-label="Stage" className={COUNTER_GRID}>
        {STAGE_COUNTERS.map(({ stage, label, Icon }) => (
          <Counter
            key={stage}
            label={label}
            Icon={Icon}
            count={stageCount(stage)}
            on={filter.stage === stage}
            disabled={pending}
            onClick={() => toggle("stage", stage)}
          />
        ))}
      </motion.div>

      <motion.div variants={riseChild} role="group" aria-label="Track" className={COUNTER_GRID}>
        {TRACK_COUNTERS.map(({ track, label, Icon }) => (
          <Counter
            key={track}
            label={label}
            Icon={Icon}
            count={trackCount(track)}
            on={filter.track === track}
            disabled={pending}
            title={track === "deferred" ? deferralNote : undefined}
            onClick={() => toggle("track", track)}
          />
        ))}
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3 pt-2">
        <TableSearch
          value={query.q}
          placeholder="Search by name, email, title or track"
          label="Search the candidates"
          className="min-w-56 flex-1"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Waits for eVals judging</span>
          <Button variant="secondary" disabled>
            <Upload />
            Load Final Bootcamp Scores
          </Button>
          <Button variant="secondary" disabled>
            <Upload />
            Load Final Intermediate Scores
          </Button>
        </div>
      </motion.div>

      {(change || error) && (
        <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3 text-sm">
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : (
            change && (
              <>
                <p role="status" className="text-muted-foreground">
                  {change.message}
                </p>
                {change.undo && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => setTrack(change.member, change.undo!, true)}
                  >
                    {busy === change.member.email && <Loader2 className="animate-spin" />}
                    Undo
                  </Button>
                )}
              </>
            )
          )}
        </motion.div>
      )}

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                {COLUMNS.map((c) => (
                  <SortHeader key={c.column} column={c.column} sort={query.sort} dir={query.dir}>
                    {c.label}
                  </SortHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((m) => (
                <tr key={m.email} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="px-5 py-2.5 font-medium">{m.fullName}</td>
                  <td className="px-5 py-2.5 text-muted-foreground">{m.email}</td>
                  <td className="px-5 py-2.5">{m.title || "—"}</td>
                  <td className="px-5 py-1.5">
                    {canSetTrack ? (
                      <TrackMenu
                        member={m}
                        busy={busy === m.email}
                        disabled={busy !== null}
                        onPick={(choice) => setTrack(m, choice)}
                      />
                    ) : (
                      <TrackLabel member={m} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">{formatDate(m.btcDate)}</td>
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q || filter.stage || filter.track
                      ? "No one matches."
                      : page.page > 1
                        ? "No one on this page."
                        : "No candidates."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="people" />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Both rows share four columns, so Bootcamp and Intermediate line up with the four tracks below. */
const COUNTER_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-3xl";

function Counter({
  label,
  Icon,
  count,
  on,
  disabled,
  title,
  onClick,
}: {
  label: string;
  Icon: LucideIcon;
  count: number;
  on: boolean;
  disabled: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-left shadow-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait",
        on ? "border-brand-border bg-brand-subtle" : "bg-card hover:bg-muted/40",
      )}
    >
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", on ? "bg-background" : "bg-muted")}>
        <Icon className={cn("size-3.5", on ? "text-brand" : "text-muted-foreground")} />
      </span>
      <span className="min-w-0">
        <span className="block text-lg leading-tight font-medium tabular-nums">{count.toLocaleString()}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </button>
  );
}

function TrackLabel({ member }: { member: CurrentCohortMember }) {
  const label = CHOICE_LABELS[member.track];
  return (
    <span className="inline-flex items-center gap-1.5 py-1">
      {member.track === "undecided" ? (
        <Badge variant="outline" className="border-dashed">
          {label}
        </Badge>
      ) : member.track === "deferred" ? (
        <Badge variant="secondary">{label}</Badge>
      ) : (
        label
      )}
      {member.overridden && <Pin className="size-3 text-muted-foreground" aria-label="Set by an administrator" />}
    </span>
  );
}

function TrackMenu({
  member,
  busy,
  disabled,
  onPick,
}: {
  member: CurrentCohortMember;
  busy: boolean;
  disabled: boolean;
  onPick: (choice: TrackChoice) => void;
}) {
  const title = member.title?.trim() || undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Track for ${member.fullName}`}
        className="-mx-2 flex cursor-pointer items-center gap-1 rounded-md px-2 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait"
      >
        <TrackLabel member={member} />
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {member.overridden ? "Set by an administrator" : "Set by the rules"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={member.overridden ? member.track : ""} onValueChange={(v) => onPick(v as TrackChoice)}>
          {TRACK_OPTIONS.map((o) => {
            const hint = o.hint(title);
            return (
              <DropdownMenuRadioItem key={o.choice} value={o.choice}>
                <span className="grid gap-0.5">
                  <span>{o.label}</span>
                  {hint && <span className="max-w-64 text-xs text-muted-foreground">{hint}</span>}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        {member.overridden && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onPick("automatic")}>Let the rules decide</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
